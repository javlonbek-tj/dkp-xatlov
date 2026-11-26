import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Space, Table, Typography, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { apiFetch } from './api'
import { exportExcel, type ExportHeader } from './excel-export'

export type AdliyaSnapshot = { asOf: string; inPublic: number; inAdliya: number; inPayment: number; returned: number }
type Row = { id: string; name: string; adliyaMorning: AdliyaSnapshot | null; adliyaLatest: AdliyaSnapshot | null }
type Values = { total: number; inPublic: number; inAdliya: number; inPayment: number; returned: number }
type Line = { key: string; index: number | null; name: string; morning: Values | null; latest: Values | null }

const fields = ['total', 'inPublic', 'inAdliya', 'inPayment', 'returned'] as const
const titles: Record<(typeof fields)[number], string> = {
  total: 'Jami adliyada turganlar', inPublic: 'Ochiq muhokamada', inAdliya: 'Adliyada', inPayment: 'To‘lovda', returned: 'Tuzatish uchun qaytarilgan',
}

// ---- Reading the file: title "… (26.11.2026 11:48 ҳолатига)", a "Туман / шаҳар" header row, one row per district ----

const plain = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] }
    return cell.result ?? (cell.richText ? cell.richText.map((part) => part.text).join('') : cell.text)
  }
  return value
}

async function readAdliya(file: File) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  for (const sheet of workbook.worksheets) {
    const text = (row: number, column: number) => String(plain(sheet.getRow(row).getCell(column).value) ?? '').trim()
    let header = 0
    for (let row = 1; row <= Math.min(sheet.rowCount, 10) && !header; row++) if (/туман|tuman/i.test(text(row, 2))) header = row
    if (!header) continue
    const title = text(1, 1)
    const asOf = title.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/)
    if (!asOf) throw new Error('Sarlavhada ma’lumot olingan sana va vaqt (masalan, "26.11.2026 11:48 ҳолатига") topilmadi')
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => text(header, index + 1).toLowerCase())
    const find = (pattern: RegExp) => headers.findIndex((item) => pattern.test(item)) + 1
    const columns = {
      inPublic: find(/очиқ|ochiq/), inAdliya: find(/^(адлияда|adliyada)$/), inPayment: find(/тўлов|to.?lov/), returned: find(/қайтарил|qaytaril/),
    }
    if (Object.values(columns).some((column) => column === 0)) throw new Error('Faylda "Очиқ муҳокамада", "Адлияда", "Тўловда" va "Тузатиш учун қайтарилган" ustunlari bo‘lishi kerak')
    const rows: Record<string, unknown>[] = []
    for (let row = header + 1; row <= sheet.rowCount && text(row, 2) && !/жами|jami/i.test(text(row, 2)); row++) {
      const number = (column: number) => {
        const value = plain(sheet.getRow(row).getCell(column).value)
        return value === null || value === undefined || value === '' ? 0 : value
      }
      rows.push({ line: row, district: text(row, 2), inPublic: number(columns.inPublic), inAdliya: number(columns.inAdliya), inPayment: number(columns.inPayment), returned: number(columns.returned) })
    }
    return { title, asOf: `${asOf[3]}-${asOf[2]}-${asOf[1]}T${asOf[4].padStart(2, '0')}:${asOf[5]}:00+05:00`, rows }
  }
  throw new Error('Faylda "Туман / шаҳар" ustunli jadval topilmadi')
}

// ---- Table: morning, now and the difference for each indicator ----

const values = (snapshot: AdliyaSnapshot | null): Values | null => snapshot && {
  total: snapshot.inPublic + snapshot.inAdliya + snapshot.inPayment + snapshot.returned,
  inPublic: snapshot.inPublic, inAdliya: snapshot.inAdliya, inPayment: snapshot.inPayment, returned: snapshot.returned,
}
const sum = (items: (Values | null)[]): Values | null => {
  const saved = items.filter((item): item is Values => item !== null)
  return saved.length ? Object.fromEntries(fields.map((field) => [field, saved.reduce((total, item) => total + item[field], 0)])) as Values : null
}
const format = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString('ru-RU')
const formatDifference = (value: number | null) => value === null ? '—' : value > 0 ? `+${value.toLocaleString('ru-RU')}` : value.toLocaleString('ru-RU')
const difference = (line: Line, field: (typeof fields)[number]) => line.morning && line.latest ? line.latest[field] - line.morning[field] : null

function AdliyaTab({ token, region, date, rows, canImport, onSaved }: {
  token: string; region: string; date: string; rows: Row[]; canImport: boolean; onSaved: (date: string) => void
}) {
  const client = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const latestTime = (items: (AdliyaSnapshot | null)[]) => items.filter((item): item is AdliyaSnapshot => item !== null).map((item) => item.asOf).sort().at(-1)
  const morningAt = latestTime(rows.map((row) => row.adliyaMorning))
  const latestAt = latestTime(rows.map((row) => row.adliyaLatest))
  const morningTitle = `Ertalab${morningAt ? ` (${dayjs(morningAt).format('HH:mm')})` : ''}`
  const latestTitle = `Hozir${latestAt ? ` (${dayjs(latestAt).format('HH:mm')})` : ''}`
  const compare = !!latestAt

  const districtLines: Line[] = rows.map((row, index) => ({ key: row.id, index: index + 1, name: row.name, morning: values(row.adliyaMorning), latest: values(row.adliyaLatest) }))
  const total: Line = { key: 'total', index: null, name: 'Viloyat bo‘yicha jami', morning: sum(districtLines.map((line) => line.morning)), latest: sum(districtLines.map((line) => line.latest)) }
  const lines = [total, ...districtLines]
  // The share in the region is taken from the newest numbers.
  const current = (line: Line) => line.latest ?? line.morning
  const share = (line: Line) => {
    const regionTotal = current(total)?.total
    const value = current(line)?.total
    return value === undefined || !regionTotal ? null : Math.round((value / regionTotal) * 1000) / 10
  }

  async function importFile(file: File) {
    setMessage(null)
    setImporting(true)
    try {
      const result = await apiFetch<{ saved: number; date: string; morning: boolean }>(token, '/api/etirof/adliya/import', { method: 'POST', body: JSON.stringify(await readAdliya(file)) })
      setMessage({ type: 'success', text: `${dayjs(result.date).format('DD.MM.YYYY')}: ${result.saved} ta tuman ${result.morning ? 'ertalabki ma’lumot sifatida saqlandi' : 'saqlandi va ertalabki bilan solishtirildi (avvalgi kunduzgi yuklash almashtirildi)'}.` })
      await client.invalidateQueries({ queryKey: ['etirof'] })
      onSaved(result.date)
    } catch (cause) { setMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Faylni yuklab bo‘lmadi' }) }
    finally { setImporting(false) }
  }

  const center = 'center' as const
  const columns: ColumnsType<Line> = [
    { title: '№', dataIndex: 'index', width: 44, align: center, render: (index: number | null) => index ?? '' },
    { title: 'Tuman / shahar', dataIndex: 'name', width: 170 },
    ...fields.map((field) => compare ? {
      title: titles[field],
      children: [
        { title: morningTitle, key: `${field}-morning`, width: 85, align: center, render: (_: unknown, line: Line) => format(line.morning?.[field]) },
        { title: latestTitle, key: `${field}-latest`, width: 85, align: center, render: (_: unknown, line: Line) => format(line.latest?.[field]) },
        { title: 'Farqi', key: `${field}-difference`, width: 75, align: center, render: (_: unknown, line: Line) => <span className="font-semibold">{formatDifference(difference(line, field))}</span> },
      ],
    } : { title: titles[field], key: field, width: 110, align: center, render: (_: unknown, line: Line) => format(line.morning?.[field]) }),
    { title: 'Viloyatdagi ulushi (%)', key: 'share', width: 100, align: center, render: (_, line) => format(share(line)) },
  ]

  function exportTable() {
    const headers: ExportHeader[] = ['№', 'Tuman / shahar', ...fields.map((field) => compare ? { title: titles[field], children: [morningTitle, latestTitle, 'Farqi'] } : `${titles[field]} (${morningTitle})`), 'Viloyatdagi ulushi (%)']
    void exportExcel(`adliyada-turganlar-${date}.xlsx`, headers, lines.map((line) => [
      line.index, line.name,
      ...fields.flatMap((field) => compare ? [line.morning?.[field], line.latest?.[field], difference(line, field)] : [line.morning?.[field]]),
      share(line),
    ]), { title: { lines: [`${region} bo‘yicha adliyada turgan obyektlar to‘g‘risida ma’lumot (${dayjs(date).format('DD.MM.YYYY')})`] }, totalRows: 1 })
  }

  return <div>
    {message && <Alert className="!mb-3" type={message.type} showIcon closable message={message.text} onClose={() => setMessage(null)} />}
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <Typography.Title level={5} className="!mb-0">{region} bo‘yicha adliyada turgan obyektlar ({dayjs(date).format('DD.MM.YYYY')})</Typography.Title>
      <Space wrap>
        {canImport && <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void importFile(file); return false }}>
          <Button type="primary" loading={importing}>Adliya svodini yuklash</Button>
        </Upload>}
        <Button onClick={exportTable} disabled={!total.morning}>Excel uchun eksport</Button>
      </Space>
    </div>
    {!total.morning && <Alert className="!mb-2" type="info" showIcon message={`${dayjs(date).format('DD.MM.YYYY')} uchun adliya ma’lumoti yuklanmagan`} />}
    <Table rowKey="key" bordered size="small" tableLayout="fixed" columns={columns} dataSource={lines} pagination={false} scroll={{ x: compare ? 1600 : 900 }}
      rowClassName={(line) => line.index === null ? 'bg-sky-50 font-semibold' : ''} locale={{ emptyText: 'Ma’lumot topilmadi' }} />
    <Typography.Paragraph type="secondary" className="!mb-0 !mt-3 text-xs">
      Manba: sync.kadastr.uz, «Эътироф йиғмаси» — «Умумий маълумот», «Адлияда турганлар» bloki. Jami = ochiq muhokamada + adliyada + to‘lovda + tuzatish uchun qaytarilgan.
      Kunning birinchi yuklashi ertalabki ma’lumot bo‘lib qoladi; keyingi har bir yuklash «Hozir» ustunini yangilaydi va ertalabki bilan solishtiriladi. Farqi = hozir − ertalab.
    </Typography.Paragraph>
  </div>
}

export default AdliyaTab
