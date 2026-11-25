import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, DatePicker, Modal, Table, Upload } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { apiFetch } from './api'

type ImportRow = {
  line: number; district: string
  censusCount: unknown; completedMfyCount: unknown; completedObjectCount: unknown; migrationCount: unknown
  // Million so‘m, as entered in the manual form; the file has whole so‘m.
  paymentDebt: number | null
}
type Parsed = { fileName: string; region: string; rows: ImportRow[] }

const plain = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] }
    return cell.result ?? (cell.richText ? cell.richText.map((part) => part.text).join('') : cell.text)
  }
  return value
}

// Reads a file laid out like "Xatlov_2026-11-25.xlsx": header rows starting with "T/r" and "Hudud nomi",
// then the region total (T/r 0, e.g. "Navoiy viloyati") and one row per district.
async function readXatlov(file: File): Promise<Parsed> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  for (const sheet of workbook.worksheets) {
    const text = (row: number, column: number) => String(plain(sheet.getRow(row).getCell(column).value) ?? '').trim()
    const headerRows: number[] = []
    for (let row = 1; row <= Math.min(sheet.rowCount, 15); row++) if (/hudud|tuman/i.test(text(row, 2)) && /t\/r|№/i.test(text(row, 1))) headerRows.push(row)
    if (!headerRows.length) continue
    // A column's title is the text of all its header rows, e.g. "shundan Xatlov soni".
    const titles = Array.from({ length: sheet.columnCount }, (_, index) => [...new Set(headerRows.map((row) => text(row, index + 1)))].join(' ').toLowerCase())
    const find = (pattern: RegExp) => titles.findIndex((title) => pattern.test(title)) + 1
    const columns = {
      censusCount: find(/xatlov soni/), completedMfyCount: find(/mahalla|mfy/), completedObjectCount: find(/yakunlangan obyekt/),
      migrationCount: find(/migratsiya/), paymentDebt: find(/to.?lov|qarz/),
    }
    const missing = Object.entries(columns).filter(([key, column]) => column === 0 && key !== 'paymentDebt')
    if (missing.length) throw new Error('Faylda "Xatlov soni", "Yakunlangan mahallalar", "Xatlov yakunlangan obyekt" va "Migratsiya soni" ustunlari bo‘lishi kerak')
    let region = ''
    const rows: ImportRow[] = []
    for (let row = headerRows.at(-1)! + 1; row <= sheet.rowCount; row++) {
      const name = text(row, 2)
      if (!name) continue
      const value = (column: number) => plain(sheet.getRow(row).getCell(column).value)
      // The total row has T/r 0 or a region name.
      if (text(row, 1) === '0' || /viloyat/i.test(name)) { region ||= name; continue }
      const debt = columns.paymentDebt ? value(columns.paymentDebt) : null
      rows.push({
        line: row, district: name,
        censusCount: value(columns.censusCount), completedMfyCount: value(columns.completedMfyCount),
        completedObjectCount: value(columns.completedObjectCount), migrationCount: value(columns.migrationCount),
        paymentDebt: typeof debt === 'number' ? Math.round(debt / 10_000) / 100 : null,
      })
    }
    if (!region) throw new Error('Faylda viloyat jami qatori (masalan, "Navoiy viloyati") topilmadi')
    if (!rows.length) throw new Error('Faylda tumanlar topilmadi')
    return { fileName: file.name, region, rows }
  }
  throw new Error('Faylda "T/r" va "Hudud nomi" ustunli jadval topilmadi')
}

// The date is in the file name ("Xatlov_2026-11-25.xlsx" or "25.11.2026"); otherwise the page's date is offered.
function dateFromName(name: string, fallback: Dayjs) {
  const iso = name.match(/(\d{4})-(\d{2})-(\d{2})/)
  const dotted = name.match(/(\d{2})\.(\d{2})\.(\d{4})/)
  const date = iso ? dayjs(`${iso[1]}-${iso[2]}-${iso[3]}`) : dotted ? dayjs(`${dotted[3]}-${dotted[2]}-${dotted[1]}`) : fallback
  return date.isValid() ? date : fallback
}

const show = (value: unknown) => typeof value === 'number' ? value.toLocaleString('ru-RU') : String(value ?? '—')

// Loads one day of district results from Excel; manual entry stays on the page.
function XatlovImportButton({ token, defaultDate, onSaved }: { token: string; defaultDate: Dayjs; onSaved: (date: Dayjs, message: string) => void }) {
  const client = useQueryClient()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [date, setDate] = useState<Dayjs>(defaultDate)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function pick(file: File) {
    setError(null)
    try {
      const result = await readXatlov(file)
      setDate(dateFromName(file.name, defaultDate))
      setParsed(result)
    } catch (cause) {
      setParsed({ fileName: file.name, region: '', rows: [] })
      setError(cause instanceof Error ? cause.message : 'Faylni o‘qib bo‘lmadi')
    }
  }

  async function save() {
    if (!parsed) return
    setError(null)
    setSaving(true)
    try {
      const result = await apiFetch<{ saved: number; created: number; updated: number }>(token, '/api/xatlov/import', {
        method: 'POST', body: JSON.stringify({ recordDate: date.format('YYYY-MM-DD'), region: parsed.region, rows: parsed.rows }),
      })
      await Promise.all(['xatlov', 'report', 'dashboard'].map((key) => client.invalidateQueries({ queryKey: [key] })))
      onSaved(date, `${date.format('DD.MM.YYYY')} uchun ${result.saved} ta tuman saqlandi (${result.created} ta yangi, ${result.updated} ta yangilandi).`)
      setParsed(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlab bo‘lmadi') }
    finally { setSaving(false) }
  }

  return <>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void pick(file); return false }}>
      <Button>Excel’dan yuklash</Button>
    </Upload>
    <Modal title={`Excel’dan yuklash — ${parsed?.fileName ?? ''}`} open={!!parsed} width={760} okText="Saqlash" cancelText="Bekor qilish"
      onOk={save} onCancel={() => setParsed(null)} confirmLoading={saving} okButtonProps={{ disabled: !parsed?.rows.length }} destroyOnHidden>
      {error && <Alert className="!mb-3" type="error" showIcon message={error} />}
      {!!parsed?.rows.length && <>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span>Sana:</span>
          <DatePicker allowClear={false} format="DD.MM.YYYY" value={date} disabledDate={(day) => day.isAfter(dayjs(), 'day')} onChange={(value) => value && setDate(value)} />
          <span className="text-slate-500">{parsed.region}, {parsed.rows.length} ta tuman</span>
        </div>
        <Alert className="!mb-3" type="info" showIcon message="Shu sanada yozuvi bor tumanlar yangilanadi (MFY nomlari saqlanib qoladi), yo‘qlari qo‘shiladi. To‘lov so‘mda o‘qilib, mln so‘mda saqlanadi." />
        <Table size="small" bordered rowKey="line" pagination={false} scroll={{ y: 320 }} dataSource={parsed.rows} columns={[
          { title: 'Tuman', dataIndex: 'district' },
          { title: 'Xatlov soni', dataIndex: 'censusCount', align: 'center', render: show },
          { title: 'Yakunlangan MFY', dataIndex: 'completedMfyCount', align: 'center', render: show },
          { title: 'Yakunlangan obyekt', dataIndex: 'completedObjectCount', align: 'center', render: show },
          { title: 'Migratsiya', dataIndex: 'migrationCount', align: 'center', render: show },
          { title: 'Qarzdorlik (mln so‘m)', dataIndex: 'paymentDebt', align: 'center', render: (value: number | null) => value === null ? '—' : value.toLocaleString('ru-RU') },
        ]} />
      </>}
    </Modal>
  </>
}

export default XatlovImportButton
