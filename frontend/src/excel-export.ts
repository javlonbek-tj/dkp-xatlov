type ExportValue = string | number | null | undefined
// A plain title is one column; a group spans its children, like grouped table headers.
export type ExportHeader = string | { title: string; children: ExportHeader[] }
type ExportOptions = {
  // The first N data rows are totals and are shown in bold.
  totalRows?: number
  // Data cells (zero-based row and column) to highlight in red.
  highlight?: (row: number, column: number) => boolean
}

const depth = (header: ExportHeader): number => typeof header === 'string' ? 1 : 1 + Math.max(...header.children.map(depth))
const width = (header: ExportHeader): number => typeof header === 'string' ? 1 : header.children.reduce((sum, child) => sum + width(child), 0)
const leaves = (header: ExportHeader): string[] => typeof header === 'string' ? [header] : header.children.flatMap(leaves)

// Builds a styled .xlsx file with multi-row merged headers, borders, a frozen header, filters and fitted column widths.
// exceljs is loaded on demand so it is not part of the main bundle.
export async function exportExcel(filename: string, headers: ExportHeader[], rows: ExportValue[][], options: ExportOptions = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const headerRows = Math.max(...headers.map(depth))
  const sheet = workbook.addWorksheet('Ma’lumotlar', { views: [{ state: 'frozen', ySplit: headerRows }] })
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
  let column = 1
  for (const header of headers) {
    place(header, 1, column)
    column += width(header)
  }
  const columnCount = column - 1
  for (let row = 1; row <= headerRows; row += 1) {
    sheet.getRow(row).height = 30
    for (let col = 1; col <= columnCount; col += 1) {
      const cell = sheet.getCell(row, col)
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = solid('FF1E40AF')
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = borders
    }
  }

  rows.forEach((values, index) => {
    const row = sheet.addRow(values.map((value) => value ?? ''))
    const isTotal = index < (options.totalRows ?? 0)
    for (let col = 1; col <= columnCount; col += 1) {
      const cell = row.getCell(col)
      const highlighted = options.highlight?.(index, col - 1)
      cell.border = borders
      cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' ? 'center' : 'left', wrapText: typeof cell.value === 'string' && cell.value.includes('\n') }
      if (typeof cell.value === 'number') cell.numFmt = Number.isInteger(cell.value) ? '#,##0' : '#,##0.00'
      if (isTotal || highlighted) cell.font = { bold: true, ...(highlighted ? { color: { argb: 'FFDC2626' } } : {}) }
      if (highlighted) cell.fill = solid('FFFEE2E2')
      else if (isTotal) cell.fill = solid('FFE2E8F0')
      else if (index % 2 === 1) cell.fill = solid('FFF8FAFC')
    }
  })

  const titles = headers.flatMap(leaves)
  sheet.columns.forEach((item, index) => {
    // Multi-line cells are as wide as their longest line.
    const lengths = [titles[index] ?? '', ...rows.map((row) => String(row[index] ?? ''))].flatMap((text) => text.split('\n')).map((text) => text.length)
    item.width = Math.min(Math.max(...lengths, 8) + 2, 40)
  })
  sheet.autoFilter = { from: { row: headerRows, column: 1 }, to: { row: headerRows, column: columnCount } }

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
