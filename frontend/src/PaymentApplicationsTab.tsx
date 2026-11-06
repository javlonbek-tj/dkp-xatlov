import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Input, Select, Space, Table, Tag, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiFetch } from './api'
import { exportExcel } from './excel-export'
import { formatWholeSom, statusLabels, type ApplicationStatus, type PaymentApplication } from './payments'

type ImportRow = { district: unknown; number: unknown; debt: unknown }

// Reads the first sheet that has district, application number and remainder columns, e.g. "Район", "Заявление UZKAD", "Остаток, сум".
async function readApplications(file: File): Promise<ImportRow[]> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const plain = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
      const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] }
      return cell.result ?? (cell.richText ? cell.richText.map((part) => part.text).join('') : cell.text)
    }
    return value
  }
  for (const sheet of workbook.worksheets) {
    for (let headerRow = 1; headerRow <= Math.min(sheet.rowCount, 10); headerRow++) {
      const headers = (sheet.getRow(headerRow).values as unknown[]).map((value) => String(plain(value) ?? '').toLowerCase())
      const find = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header))
      const columns = { district: find(/район|tuman|filial/), number: find(/заявлени|ariza/), debt: find(/остаток|qoldiq|qarz/) }
      if (Object.values(columns).some((column) => column < 1)) continue
      const rows: ImportRow[] = []
      for (let index = headerRow + 1; index <= sheet.rowCount; index++) {
        const values = sheet.getRow(index).values as unknown[]
        const row = { district: plain(values[columns.district]), number: plain(values[columns.number]), debt: plain(values[columns.debt]) }
        if (row.district || row.number || row.debt !== undefined && row.debt !== null) rows.push(row)
      }
      return rows
    }
  }
  throw new Error('Faylda "Район", "Заявление" va "Остаток" ustunlari topilmadi')
}

function PaymentApplicationsTab({ token, regionId, districtId }: { token: string; regionId?: string; districtId?: string }) {
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ApplicationStatus | undefined>()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const query = useQuery({
    queryKey: ['payment-applications', token, regionId, districtId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (regionId) params.set('regionId', regionId)
      if (districtId) params.set('districtId', districtId)
      return apiFetch<{ applications: PaymentApplication[]; canImport: boolean }>(token, `/api/payments/applications?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const term = search.trim().toLocaleLowerCase()
  const rows = (query.data?.applications ?? []).filter((row) => (!status || row.status === status) && JSON.stringify([row.number, row.district.name]).toLocaleLowerCase().includes(term))
  const sum = (key: 'debt' | 'paid' | 'remaining') => rows.reduce((total, row) => total + row[key], 0)

  async function importFile(file: File) {
    setMessage(null)
    setImporting(true)
    try {
      const result = await apiFetch<{ added: number; skipped: number }>(token, '/api/payments/applications/import', { method: 'POST', body: JSON.stringify({ rows: await readApplications(file) }) })
      setMessage({ type: 'success', text: `${result.added} ta yangi ariza qo‘shildi${result.skipped ? `, ${result.skipped} tasi avval kiritilgan` : ''}.` })
      await Promise.all([client.invalidateQueries({ queryKey: ['payment-applications'] }), client.invalidateQueries({ queryKey: ['payments'] })])
    } catch (cause) { setMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Faylni yuklab bo‘lmadi' }) }
    finally { setImporting(false) }
  }

  function exportTable() {
    void exportExcel('tolov-arizalari.xlsx', ['Hudud', 'Tuman', 'Ariza raqami', 'Qarz (so‘m)', 'Undirilgan (so‘m)', 'Qoldiq (so‘m)', 'Holati'], [
      ['Jami', `${rows.length} ta ariza`, '', sum('debt'), sum('paid'), sum('remaining'), ''],
      ...rows.map((row) => [row.district.region.name, row.district.name, row.number, row.debt, row.paid, row.remaining, statusLabels[row.status].label]),
    ], { totalRows: 1 })
  }

  const columns: ColumnsType<PaymentApplication> = [
    { title: 'Ariza raqami', dataIndex: 'number', width: 150 },
    { title: 'Tuman', key: 'district', width: 170, render: (_, row) => <div className="truncate leading-tight">{row.district.name}<div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Qarz (so‘m)', dataIndex: 'debt', width: 130, align: 'right', render: formatWholeSom },
    { title: 'Undirilgan (so‘m)', dataIndex: 'paid', width: 140, align: 'right', render: formatWholeSom },
    { title: 'Qoldiq (so‘m)', dataIndex: 'remaining', width: 130, align: 'right', render: formatWholeSom },
    { title: 'Holati', dataIndex: 'status', width: 150, align: 'center', render: (value: ApplicationStatus) => <Tag color={statusLabels[value].color}>{statusLabels[value].label}</Tag> },
  ]

  return <>
    {(message || query.error) && <Alert className="mb-3" type={message?.type ?? 'error'} showIcon closable message={message?.text ?? query.error?.message} onClose={() => setMessage(null)} />}
    <div className="mb-4 flex flex-wrap justify-between gap-3">
      <Space wrap>
        <Input.Search allowClear placeholder="Ariza raqami yoki tuman" className="!w-64" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select allowClear placeholder="Holati" className="min-w-44" value={status} onChange={setStatus} options={Object.entries(statusLabels).map(([value, item]) => ({ value, label: item.label }))} />
      </Space>
      <Space wrap>
        {query.data?.canImport && <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void importFile(file); return false }}>
          <Button loading={importing}>Arizalarni Excel’dan yuklash</Button>
        </Upload>}
        <Button onClick={exportTable}>Excel uchun eksport</Button>
      </Space>
    </div>
    <Table size="small" bordered tableLayout="fixed" className="max-w-[880px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="number" columns={columns} dataSource={rows} loading={query.isFetching}
      pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 870 }} sticky={{ offsetHeader: 64 }} locale={{ emptyText: 'Arizalar topilmadi' }}
      summary={() => rows.length ? <Table.Summary fixed="top"><Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
        <Table.Summary.Cell index={0} colSpan={2}>Jami ({rows.length} ta ariza)</Table.Summary.Cell>
        <Table.Summary.Cell index={2} align="right">{formatWholeSom(sum('debt'))}</Table.Summary.Cell>
        <Table.Summary.Cell index={3} align="right">{formatWholeSom(sum('paid'))}</Table.Summary.Cell>
        <Table.Summary.Cell index={4} align="right">{formatWholeSom(sum('remaining'))}</Table.Summary.Cell>
        <Table.Summary.Cell index={5} />
      </Table.Summary.Row></Table.Summary> : null} />
  </>
}

export default PaymentApplicationsTab
