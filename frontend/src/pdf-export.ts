import { depth, width, type ExportHeader, type ExportTitle } from './excel-export'

type ExportValue = string | number | null | undefined
type PdfOptions = {
  title?: ExportTitle
  // The first N data rows are totals and are shown in bold.
  totalRows?: number
  // Data cells (zero-based row and column) to highlight in red.
  highlight?: (row: number, column: number) => boolean
}

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)

function formatValue(value: ExportValue) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return escape(value).replace(/\n/g, '<br>')
}

// A4 landscape with 8 mm margins; the page is laid out at a CSS width (wider if the table needs it) and scaled onto the paper.
const pageWidthMm = 297
const pageHeightMm = 210
const marginMm = 8
const contentWidthPx = 1062
const scale = 3

// Downloads the table as an A4 landscape PDF. The table is rendered to an image in a hidden frame and split into pages
// between rows; the column headers repeat at the top of every following page.
// jspdf and html2canvas are loaded on demand so they are not part of the main bundle.
export async function exportPdf(filename: string, headers: ExportHeader[], rows: ExportValue[][], options: PdfOptions = {}) {
  const headerDepth = Math.max(...headers.map(depth))
  const headerLines: string[][] = Array.from({ length: headerDepth }, () => [])
  // Plain titles span down to the last header row; group titles span their children's columns.
  function place(header: ExportHeader, level: number) {
    if (typeof header === 'string') {
      // Single-word titles (e.g. "T/r") stay on one line.
      headerLines[level].push(`<th rowspan="${headerDepth - level}"${header.includes(' ') ? '' : ' class="word"'}>${escape(header)}</th>`)
      return
    }
    headerLines[level].push(`<th colspan="${width(header)}">${escape(header.title)}</th>`)
    for (const child of header.children) place(child, level + 1)
  }
  for (const header of headers) place(header, 0)

  const body = rows.map((values, index) => {
    const cells = values.map((value, column) => {
      // Multi-line cells (name and phone) and short texts keep each line whole; long texts may wrap.
      const classes = [typeof value === 'number' ? 'num' : '', typeof value === 'string' && (value.includes('\n') || value.length <= 30) ? 'lines' : '', options.highlight?.(index, column) ? 'red' : ''].filter(Boolean).join(' ')
      return `<td${classes ? ` class="${classes}"` : ''}>${formatValue(value)}</td>`
    })
    return `<tr${index < (options.totalRows ?? 0) ? ' class="total"' : ''}>${cells.join('')}</tr>`
  }).join('')

  const title = options.title
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html { background: #fff; }
    /* Fixed pixel line heights: with "normal" line height html2canvas draws text lower than the browser on some systems. */
    body { margin: 0; width: ${contentWidthPx}px; font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 9px; line-height: 12px; }
    h1 { margin: 0; font-size: 16px; line-height: 22px; text-align: center; color: #991b1b; }
    h2 { margin: 2px 0 0; font-size: 16px; line-height: 22px; text-align: center; color: #1e3a8a; letter-spacing: 3px; }
    .note { margin: 2px 0 5px; font-size: 9px; line-height: 12px; font-style: italic; text-align: right; }
    /* Each cell draws only its right and bottom border, so lines are not doubled in the image. */
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 9px; line-height: 12px; border-top: 1px solid #64748b; border-left: 1px solid #64748b; }
    th, td { border-right: 1px solid #64748b; border-bottom: 1px solid #64748b; padding: 3px 3px; vertical-align: middle; line-height: 12px; }
    th.word { white-space: nowrap; }
    th { background: #dbeafe; color: #1e3a8a; font-weight: 700; text-align: center; }
    td.num { text-align: center; white-space: nowrap; }
    td.lines { white-space: nowrap; }
    tr.total td { background: #e0f2fe; font-weight: 700; font-size: 9.5px; }
    td.red { background: #fee2e2; color: #dc2626; font-weight: 700; }
  </style></head><body>
    ${title ? `${title.lines.map((line, index) => index === 0 ? `<h1>${escape(line)}</h1>` : `<h2>${escape(line)}</h2>`).join('')}${title.note ? `<div class="note">${escape(title.note)}</div>` : ''}` : ''}
    <table><thead>${headerLines.map((cells) => `<tr>${cells.join('')}</tr>`).join('')}</thead><tbody>${body}</tbody></table>
  </body></html>`

  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.left = '-10000px'
  frame.style.top = '0'
  frame.style.width = `${contentWidthPx}px`
  frame.style.height = '800px'
  frame.style.border = '0'
  document.body.appendChild(frame)
  try {
    const doc = frame.contentDocument!
    doc.open()
    doc.write(html)
    doc.close()
    await doc.fonts.ready
    // Widen the page to the table so the title stays centred over it.
    const widthPx = Math.max(contentWidthPx, Math.ceil(doc.querySelector('table')!.scrollWidth))
    frame.style.width = `${widthPx}px`
    doc.body.style.width = `${widthPx}px`
    const pxToMm = (pageWidthMm - 2 * marginMm) / widthPx
    const pageHeightPx = (pageHeightMm - 2 * marginMm) / pxToMm
    const canvas = await html2canvas(doc.body, { scale, backgroundColor: '#ffffff', width: widthPx, windowWidth: widthPx, logging: false })

    // Positions in CSS pixels from the top of the page.
    const totalHeight = doc.body.scrollHeight
    const head = doc.querySelector('thead')!.getBoundingClientRect()
    const rowEnds = [...doc.querySelectorAll('tbody tr')].map((row) => row.getBoundingClientRect().bottom)
    const pages: { from: number; to: number }[] = []
    for (let from = 0; from < totalHeight - 1;) {
      const available = pageHeightPx - (pages.length ? head.height : 0)
      // End the page after the last row that still fits; a row taller than a page is cut.
      const to = from + available >= totalHeight ? totalHeight : rowEnds.filter((end) => end > from && end <= from + available).pop() ?? from + available
      pages.push({ from, to })
      from = to
    }

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pages.forEach((page, index) => {
      // Following pages start with a copy of the column headers, including the table's top border.
      const parts = [...(index ? [{ from: head.top - 1, to: head.bottom }] : []), page]
      const height = parts.reduce((sum, part) => sum + part.to - part.from, 0)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = Math.ceil(height * scale)
      const context = slice.getContext('2d')!
      let y = 0
      for (const part of parts) {
        const partHeight = (part.to - part.from) * scale
        context.drawImage(canvas, 0, part.from * scale, canvas.width, partHeight, 0, y, canvas.width, partHeight)
        y += partHeight
      }
      if (index) pdf.addPage()
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', marginMm, marginMm, widthPx * pxToMm, height * pxToMm)
    })
    pdf.save(`${filename}.pdf`)
  } finally {
    frame.remove()
  }
}
