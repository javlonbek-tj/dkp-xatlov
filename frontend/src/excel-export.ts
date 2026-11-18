type ExportValue = string | number | null | undefined
// A plain title is one column; a group spans its children, like grouped table headers.
export type ExportHeader = string | { title: string; children: ExportHeader[] }
// Centered title lines above the table and a small right-aligned note (e.g. the date) under them.
export type ExportTitle = { lines: string[]; note?: string }
type ExportOptions = {
  title?: ExportTitle
  // The first N data rows are totals and are shown in bold.
  totalRows?: number
  // Data cells (zero-based row and column) to highlight in red.
  highlight?: (row: number, column: number) => boolean
  // Print-ready layout: A4 landscape, page width fitted, fixed fonts and row heights.
  print?: PrintLayout
}
export type PrintLayout = {
  titleSize: number
  // Plain top-level titles and the titles inside groups.
  headerSize: number
  groupHeaderSize: number
  firstColumnSize: number
  textSize: number
  numberSize: number
  // Header row heights from top to bottom (30 when missing) and data row heights.
  headerHeights: number[]
  rowHeight: number
  multilineRowHeight: number
  zoom: number
  // Fit the whole table on one page; otherwise only the width is fitted and the header repeats on each page.
  onePage: boolean
}

export const depth = (header: ExportHeader): number => typeof header === 'string' ? 1 : 1 + Math.max(...header.children.map(depth))
export const width = (header: ExportHeader): number => typeof header === 'string' ? 1 : header.children.reduce((sum, child) => sum + width(child), 0)
const leaves = (header: ExportHeader): string[] => typeof header === 'string' ? [header] : header.children.flatMap(leaves)

// Builds a styled .xlsx file with multi-row merged headers, borders, a frozen header, filters and fitted column widths.
// exceljs is loaded on demand so it is not part of the main bundle.
export async function exportExcel(filename: string, headers: ExportHeader[], rows: ExportValue[][], options: ExportOptions = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const titleRows = options.title ? options.title.lines.length + (options.title.note ? 1 : 0) : 0
  // Header rows come right after the title rows.
  const headerRows = titleRows + Math.max(...headers.map(depth))
  const columnCount = headers.reduce((sum, header) => sum + width(header), 0)
  const print = options.print
  const sheet = workbook.addWorksheet('Ma’lumotlar', {
    views: [{ state: 'frozen', ySplit: headerRows, ...(print ? { style: 'pageBreakPreview' as const, zoomScale: print.zoom } : {}) }],
    ...(print ? {
      pageSetup: {
        paperSize: 9, orientation: 'landscape' as const, fitToPage: true, fitToWidth: 1, fitToHeight: print.onePage ? 1 : 0, horizontalCentered: true,
        margins: { left: 0.12, right: 0.12, top: 0.75, bottom: 0.75, header: 0.31, footer: 0.31 },
        ...(print.onePage ? {} : { printTitlesRow: `${titleRows + 1}:${headerRows}` }),
      },
    } : {}),
  })
  const border = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
  const borders = { top: border, left: border, bottom: border, right: border }
  const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

  // Plain titles fill down to the last header row; group titles span their children's columns.
  function place(header: ExportHeader, row: number, column: number) {
    sheet.getCell(row, column).value = typeof header === 'string' ? header : header.title
    if (typeof header === 'string') {
      if (row < headerRows) sheet.mergeCells(row, column, headerRows, column)
      return
    }
    if (width(header) > 1) sheet.mergeCells(row, column, row, column + width(header) - 1)
    let child = column
    for (const item of header.children) {
      place(item, row + 1, child)
      child += width(item)
    }
  }
  if (options.title) {
    const { lines, note } = options.title
    lines.forEach((text, index) => {
      const cell = sheet.getCell(index + 1, 1)
      cell.value = text
      cell.font = { bold: true, size: print?.titleSize ?? 13, color: { argb: index === 0 ? 'FF991B1B' : 'FF1E3A8A' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      sheet.mergeCells(index + 1, 1, index + 1, columnCount)
      sheet.getRow(index + 1).height = print ? Math.max(22, print.titleSize * 1.4) : 22
    })
    if (note) {
      const cell = sheet.getCell(titleRows, 1)
      cell.value = note
      cell.font = { italic: true, size: 9 }
      cell.alignment = { horizontal: 'right' }
      sheet.mergeCells(titleRows, 1, titleRows, columnCount)
    }
  }
  let column = 1
  // Columns of plain top-level titles; in print they use a smaller font than the group columns.
  const plainColumns = new Set<number>()
  for (const header of headers) {
    if (typeof header === 'string') plainColumns.add(column)
    place(header, titleRows + 1, column)
    column += width(header)
  }
  for (let row = titleRows + 1; row <= headerRows; row += 1) {
    sheet.getRow(row).height = print?.headerHeights[row - titleRows - 1] ?? 30
    for (let col = 1; col <= columnCount; col += 1) {
      const cell = sheet.getCell(row, col)
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, ...(print ? { size: plainColumns.has(col) ? print.headerSize : print.groupHeaderSize } : {}) }
      cell.fill = solid('FF1E40AF')
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = borders
    }
  }

  rows.forEach((values, index) => {
    const row = sheet.addRow(values.map((value) => value ?? ''))
    const isTotal = index < (options.totalRows ?? 0)
    if (print) row.height = values.some((value) => typeof value === 'string' && value.includes('\n')) ? print.multilineRowHeight : print.rowHeight
    for (let col = 1; col <= columnCount; col += 1) {
      const cell = row.getCell(col)
      const highlighted = options.highlight?.(index, col - 1)
      cell.border = borders
      cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' ? 'center' : 'left', wrapText: typeof cell.value === 'string' && cell.value.includes('\n') }
      if (typeof cell.value === 'number') cell.numFmt = Number.isInteger(cell.value) ? '#,##0' : '#,##0.00'
      // In print numbers are bold.
      const size = !print ? undefined : col === 1 ? print.firstColumnSize : typeof cell.value === 'number' ? print.numberSize : print.textSize
      const bold = isTotal || highlighted || (print && col > 1 && typeof cell.value === 'number')
      if (bold || size) cell.font = { bold, ...(size ? { size } : {}), ...(highlighted ? { color: { argb: 'FFDC2626' } } : {}) }
      if (highlighted) cell.fill = solid('FFFEE2E2')
      else if (isTotal) cell.fill = solid('FFE2E8F0')
      else if (index % 2 === 1) cell.fill = solid('FFF8FAFC')
    }
  })

  const titles = headers.flatMap(leaves)
  sheet.columns.forEach((item, index) => {
    // Multi-line cells are as wide as their longest line.
    const lengths = [titles[index] ?? '', ...rows.map((row) => String(row[index] ?? ''))].flatMap((text) => text.split('\n')).map((text) => text.length)
    if (!print) item.width = Math.min(Math.max(...lengths, 8) + 2, 40)
    else {
      // Header titles wrap, so only the data decides the width; larger fonts need wider columns.
      const data = rows.flatMap((row) => String(row[index] ?? '').split('\n')).map((text) => text.length)
      const numeric = rows.some((row) => typeof row[index] === 'number')
      // A numeric first column is the narrow T/r.
      if (index === 0 && numeric) item.width = 4
      else item.width = Math.min(Math.max(Math.max(...data, 0) * (numeric ? print.numberSize : print.textSize) / 12 + 3, 10), 30)
    }
  })
  if (!print) sheet.autoFilter ={ from: { row: headerRows, column: 1 }, to: { row: headerRows, column: columnCount } }

  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Name and phone on two lines of one cell.
export function employeeText(employee?: { fullName: string; phone?: string | null } | null) {
  return employee ? [employee.fullName, employee.phone].filter(Boolean).join('\n') : ''
}
