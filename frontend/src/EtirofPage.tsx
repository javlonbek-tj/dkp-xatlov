import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Select, Space, Table, Tabs, Typography, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { apiFetch } from './api'
import { exportExcel, type ExportHeader } from './excel-export'
import AdliyaTab, { type AdliyaSnapshot } from './AdliyaTab'

type User = { id: string; role: string }
type EtirofRecord = {
  toPublic: number; toAdliya: number; adliyaToPayment: number; editToAdliya: number; paid: number; dayAsOf: string | null
  kengashTotal: number; kengashInTerm: number; kengashOver90: number; kengashAsOf: string
}
type EtirofData = {
  date: string
  previousDate: string
  regions: { id: string; name: string }[]
  region: { id: string; name: string } | null
  canImport: boolean
  rows: { id: string; name: string; previous: EtirofRecord | null; current: EtirofRecord | null; adliyaMorning: AdliyaSnapshot | null; adliyaLatest: AdliyaSnapshot | null }[]
}
type Line = { key: string; index: number | null; name: string; record: Omit<EtirofRecord, 'dayAsOf' | 'kengashAsOf'> | null }

const dayFields = ['toPublic', 'toAdliya', 'adliyaToPayment', 'editToAdliya', 'paid'] as const
const kengashFields = ['kengashTotal', 'kengashInTerm', 'kengashOver90'] as const
const dayTitles = [
  'Tashkilotlar xulosalaridan ochiq muhokamaga o‘tdi',
  'Xulosa adliyaga o‘tdi (ochiq muhokamadan adliya qaroriga)',
  'Adliyadan to‘lovga o‘tdi',
  'Tahrirlashga qaytarilganlardan adliyaga chiqarildi',
  'To‘lov qildi (Kengashga o‘tdi)',
]
const kengashTitles = ['Jami', 'Muddat ichida (30 kungacha)', 'Muddati o‘tgan (30 kundan ortiq)', 'shundan 90 kundan ortiq', 'Muddati o‘tganlar ulushi (%)']

// ---- Reading the svod file: one sheet per day, laid out like "Свод 24.11.2026" ----

type ImportSheet = { name: string; title: string; date: string; kengashAsOf: string; dayAsOf: string | null; rows: Record<string, unknown>[] }

const plain = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] }
    return cell.result ?? (cell.richText ? cell.richText.map((part) => part.text).join('') : cell.text)
  }
  return value
}
// "24.11.2026" → "2026-11-24"; the times in the file are Tashkent time.
const isoDate = (match: RegExpMatchArray) => `${match[3]}-${match[2]}-${match[1]}`
const tashkentTime = (date: string, hours: string, minutes: string) => `${date}T${hours.padStart(2, '0')}:${minutes}:00+05:00`

async function readSvod(file: File): Promise<ImportSheet[]> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheets: ImportSheet[] = []
  for (const sheet of workbook.worksheets) {
    const text = (row: number, column: number) => String(plain(sheet.getRow(row).getCell(column).value) ?? '').trim()
    const rowText = (row: number) => (sheet.getRow(row).values as unknown[]).map((value) => String(plain(value) ?? '')).join(' ')
    const title = text(1, 1)
    const dateMatch = title.match(/(\d{2})\.(\d{2})\.(\d{4})/)
    let header = 0
    for (let row = 1; row <= Math.min(sheet.rowCount, 10) && !header; row++) if (/туман|tuman/i.test(text(row, 2))) header = row
    if (!dateMatch || !header) continue
    const date = isoDate(dateMatch)
    const asOf = rowText(header).match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/)
    if (!asOf) throw new Error(`"${sheet.name}": Kengash ma’lumotlari olingan vaqt (masalan, "25.11.2026 16:20 ҳолатига") topilmadi`)
    const number = (row: number, column: number) => {
      const value = plain(sheet.getRow(row).getCell(column).value)
      return value === null || value === undefined || value === '' ? 0 : value
    }
    const rows: Record<string, unknown>[] = []
    let row = header + 2
    for (; row <= sheet.rowCount && text(row, 2) && !/жами|jami/i.test(text(row, 2)); row++) {
      rows.push({
        line: row, district: text(row, 2),
        toPublic: number(row, 3), toAdliya: number(row, 4), adliyaToPayment: number(row, 5), editToAdliya: number(row, 6), paid: number(row, 7),
        kengashTotal: number(row, 8), kengashInTerm: number(row, 9), kengashOver90: number(row, 11),
      })
    }
    // An unfinished day has a note like "кунлик кўрсаткичлар соат 17:33 ҳолатига".
    let dayAsOf: string | null = null
    for (; row <= sheet.rowCount && !dayAsOf; row++) {
      const time = rowText(row).match(/(?:соат|soat)\s*(\d{1,2}):(\d{2})/i)
      if (time) dayAsOf = tashkentTime(date, time[1], time[2])
    }
    sheets.push({ name: sheet.name, title, date, kengashAsOf: tashkentTime(isoDate(asOf), asOf[4], asOf[5]), dayAsOf, rows })
  }
  if (!sheets.length) throw new Error('Faylda svod jadvali topilmadi (sarlavhada sana va "Туман / шаҳар" ustuni bo‘lishi kerak)')
  return sheets
}

// ---- Table of one day ----

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toLocaleString('ru-RU')
}
const overdue = (record: Line['record']) => record ? record.kengashTotal - record.kengashInTerm : null
const share = (record: Line['record']) => record ? (record.kengashTotal ? Math.round((overdue(record)! / record.kengashTotal) * 1000) / 10 : 0) : null

function DayTable({ region, date, records, rows }: { region: string; date: string; records: (EtirofRecord | null)[]; rows: EtirofData['rows'] }) {
  const saved = records.filter((record): record is EtirofRecord => record !== null)
  const latest = (values: (string | null)[]) => values.filter((value): value is string => value !== null).sort().at(-1) ?? null
  const dayAsOf = latest(saved.map((record) => record.dayAsOf))
  const kengashAsOf = latest(saved.map((record) => record.kengashAsOf))
  const day = dayjs(date).format('DD.MM.YYYY')
  const dayTitle = `${day} yil davomida${dayAsOf ? ` (soat ${dayjs(dayAsOf).format('HH:mm')} holatiga)` : ''}`
  const kengashTitle = `Kengashda turgan obyektlar${kengashAsOf ? ` (${dayjs(kengashAsOf).format('DD.MM.YYYY HH:mm')} holatiga)` : ''}`

  const districtLines: Line[] = rows.map((row, index) => ({ key: row.id, index: index + 1, name: row.name, record: records[index] }))
  const total: Line = {
    key: 'total', index: null, name: 'Viloyat bo‘yicha jami',
    record: saved.length ? Object.fromEntries([...dayFields, ...kengashFields].map((field) => [field, saved.reduce((sum, record) => sum + record[field], 0)])) as Line['record'] : null,
  }
  const lines = [total, ...districtLines]

  const value = (get: (record: NonNullable<Line['record']>) => number) => (_: unknown, line: Line) => formatNumber(line.record ? get(line.record) : null)
  const columns: ColumnsType<Line> = [
    { title: '№', dataIndex: 'index', width: 44, align: 'center', render: (index: number | null) => index ?? '' },
    { title: 'Tuman / shahar', dataIndex: 'name', width: 170 },
    {
      title: dayTitle,
      children: dayFields.map((field, index) => ({ title: dayTitles[index], key: field, width: 120, align: 'center' as const, render: value((record) => record[field]) })),
    },
    {
      title: kengashTitle,
      children: [
        { title: kengashTitles[0], key: 'kengashTotal', width: 90, align: 'center', render: value((record) => record.kengashTotal) },
        { title: kengashTitles[1], key: 'kengashInTerm', width: 110, align: 'center', render: value((record) => record.kengashInTerm) },
        { title: kengashTitles[2], key: 'overdue', width: 110, align: 'center', render: value((record) => record.kengashTotal - record.kengashInTerm) },
        { title: kengashTitles[3], key: 'kengashOver90', width: 100, align: 'center', render: value((record) => record.kengashOver90) },
        { title: kengashTitles[4], key: 'share', width: 100, align: 'center', render: (_, line) => line.record ? `${share(line.record)!.toLocaleString('ru-RU')}%` : '—' },
      ],
    },
  ]

  function exportTable() {
    const headers: ExportHeader[] = ['№', 'Tuman / shahar', { title: dayTitle, children: dayTitles }, { title: kengashTitle, children: kengashTitles }]
    void exportExcel(`etirof-${date}.xlsx`, headers, lines.map((line) => [
      line.index, line.name, ...dayFields.map((field) => line.record?.[field]),
      line.record?.kengashTotal, line.record?.kengashInTerm, overdue(line.record), line.record?.kengashOver90, share(line.record),
    ]), { title: { lines: [`${region} bo‘yicha e’tirof jarayoni holati to‘g‘risida SVOD (${day} yil)`] }, totalRows: 1 })
  }

  return <div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <Typography.Title level={5} className="!mb-0">{region} bo‘yicha e’tirof jarayoni holati to‘g‘risida SVOD ({day} yil)</Typography.Title>
      <Button onClick={exportTable} disabled={!saved.length}>Excel uchun eksport</Button>
    </div>
    {!saved.length && <Alert className="!mb-2" type="info" showIcon message={`${day} uchun ma’lumot yuklanmagan`} />}
    <Table rowKey="key" bordered size="small" tableLayout="fixed" columns={columns} dataSource={lines} pagination={false} scroll={{ x: 1400 }}
      rowClassName={(line) => line.index === null ? 'bg-sky-50 font-semibold' : ''} locale={{ emptyText: 'Ma’lumot topilmadi' }} />
  </div>
}

// ---- Page: the svod tab (the previous day in full and the selected day as of its upload) and the adliya tab ----

function EtirofPage({ token }: { token: string; user: User }) {
  const client = useQueryClient()
  const [date, setDate] = useState(dayjs())
  const [regionId, setRegionId] = useState<string>()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const query = useQuery({
    queryKey: ['etirof', token, date.format('YYYY-MM-DD'), regionId],
    queryFn: () => {
      const params = new URLSearchParams({ date: date.format('YYYY-MM-DD') })
      if (regionId) params.set('regionId', regionId)
      return apiFetch<EtirofData>(token, `/api/etirof?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const data = query.data

  async function importFile(file: File) {
    setMessage(null)
    setImporting(true)
    try {
      const result = await apiFetch<{ saved: number; dates: string[] }>(token, '/api/etirof/import', { method: 'POST', body: JSON.stringify({ sheets: await readSvod(file) }) })
      setMessage({ type: 'success', text: `${result.dates.map((day) => dayjs(day).format('DD.MM.YYYY')).join(', ')} uchun ${result.saved} ta tuman ma’lumoti saqlandi.` })
      await client.invalidateQueries({ queryKey: ['etirof'] })
    } catch (cause) { setMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Faylni yuklab bo‘lmadi' }) }
    finally { setImporting(false) }
  }

  return (
    <Space direction="vertical" size="middle" className="w-full">
      {(message || query.error) && <Alert type={message?.type ?? 'error'} showIcon closable message={message?.text ?? query.error?.message} onClose={() => setMessage(null)} />}
      <Card loading={query.isPending}>
        <div className="mb-4 flex flex-wrap justify-between gap-3">
          <Space wrap>
            <DatePicker allowClear={false} value={date} disabledDate={(day) => day.isAfter(dayjs(), 'day')} onChange={(value) => value && setDate(value)} />
            <Select className="w-64" placeholder="Hudud" showSearch optionFilterProp="label" value={regionId ?? data?.region?.id} onChange={setRegionId}
              options={(data?.regions ?? []).map((region) => ({ value: region.id, label: region.name }))} />
          </Space>
        </div>
        {data?.region ? <Tabs items={[
          { key: 'svod', label: 'Ish dinamikasi va Kengash', children: <>
            {data.canImport && <div className="mb-3 flex justify-end"><Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void importFile(file); return false }}>
              <Button type="primary" loading={importing}>Svodni Excel’dan yuklash</Button>
            </Upload></div>}
            <Space direction="vertical" size="large" className="w-full">
              <DayTable region={data.region.name} date={data.previousDate} records={data.rows.map((row) => row.previous)} rows={data.rows} />
              <DayTable region={data.region.name} date={data.date} records={data.rows.map((row) => row.current)} rows={data.rows} />
            </Space>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-3 text-xs">
          Manba: sync.kadastr.uz, «Эътироф йиғмаси» — «Иш динамикаси» va «Кенгаш» bo‘limlari. Ochiq muhokamaga o‘tdi — «Tashkilotlar xulosalari → in-public»;
          xulosa adliyaga o‘tdi — «in-public → adliya-decision»; adliyadan to‘lovga — «adliya-decision → To‘lovni kutish»; tahrirlashdan adliyaga — «Tahrirlashda → adliya-decision»;
          to‘lov qildi — «To‘lovni kutish → Kengash». Kengash ma’lumotlari portalda faqat joriy holatda ko‘rsatiladi; Kengashdagi muddat — 30 kun.
              Muddati o‘tgan = Jami − Muddat ichida. Bir kunning fayli qayta yuklansa, avvalgi ma’lumot yangilanadi.
            </Typography.Paragraph>
          </> },
          { key: 'adliya', label: 'Adliyada turganlar', children: <AdliyaTab token={token} region={data.region.name} date={data.date} rows={data.rows} canImport={data.canImport}
            onSaved={(day) => setDate(dayjs(day))} /> },
        ]} /> : <Alert type="info" showIcon message="Hudud topilmadi" />}
      </Card>
    </Space>
  )
}

export default EtirofPage
