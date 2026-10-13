import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type User = { id: string; username: string; fullName: string; role: Role }
type District = {
  id: string; name: string; regionId: string; region: { id: string; name: string }
  republicEmployeeAssignment: { user: { fullName: string } } | null
  regionalEmployeeAssignment: { user: { fullName: string } } | null
}
type RadLimit = {
  id: string; districtId: string; month: number; year: number; monthlyLimit: number
  rejectedApplications: number; remainingLimit: number; district: District
}
type PageData = { districts: District[]; records: RadLimit[] }
type Values = { month: number; year: number; monthlyLimit: number; rejectedApplications: number }

const months = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const monthOptions = months.map((label, index) => ({ value: index + 1, label }))
const currentMonth = new Date().getMonth() + 1
const currentYear = new Date().getFullYear()

function RadLimitPage({ token, user }: { token: string; user: User }) {
  const [data, setData] = useState<PageData>({ districts: [], records: [] })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ districtId: string; record?: RadLimit } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, month: currentMonth as number | undefined, year: currentYear as number | undefined })
  const [form] = Form.useForm()
  const canWrite = user.role !== 'REGIONAL_EMPLOYEE'

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      if (filters.month) params.set('month', String(filters.month))
      if (filters.year) params.set('year', String(filters.year))
      const response = await fetch(`/api/rad-limits?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'RAD ma’lumotlarini yuklab bo‘lmadi')
      setData(result as PageData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'RAD ma’lumotlarini yuklab bo‘lmadi')
    } finally { setLoading(false) }
  }, [filters, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  const filterDistricts = data.districts.filter((item) => !filters.regionId || item.regionId === filters.regionId)
  // The three districts that have used the largest share of their limit (including those over it) are highlighted.
  const worstIds = useMemo(() => new Set(data.records
    .filter((row) => row.rejectedApplications > 0)
    .map((row) => ({ id: row.id, usage: row.monthlyLimit > 0 ? row.rejectedApplications / row.monthlyLimit : Infinity }))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 3)
    .map((row) => row.id)), [data.records])
  const visibleRecords = data.records.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: RadLimit) {
    setEditor({ districtId, record })
    form.setFieldsValue(record ? {
      month: record.month,
      year: record.year,
      monthlyLimit: record.monthlyLimit,
      rejectedApplications: record.rejectedApplications,
    } : { month: currentMonth, year: currentYear, monthlyLimit: 0, rejectedApplications: 0 })
  }

  // Totals for the visible rows.
  const totals = {
    districts: new Set(visibleRecords.map((row) => row.districtId)).size,
    limit: visibleRecords.reduce((sum, row) => sum + row.monthlyLimit, 0),
    rejected: visibleRecords.reduce((sum, row) => sum + row.rejectedApplications, 0),
    remaining: visibleRecords.reduce((sum, row) => sum + row.remainingLimit, 0),
  }
  const summary = () => visibleRecords.length ? <Table.Summary fixed="top">
    <Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
      <Table.Summary.Cell index={0}>Jami ({totals.districts} ta tuman)</Table.Summary.Cell>
      <Table.Summary.Cell index={1} colSpan={3} />
      <Table.Summary.Cell index={4} align="center">{totals.limit.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={5} align="center">{totals.rejected.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={6} align="center"><span className={totals.remaining < 0 ? 'text-red-600' : ''}>{totals.remaining.toLocaleString('ru-RU')}</span></Table.Summary.Cell>
      <Table.Summary.Cell index={7} align="center">{totals.limit > 0 ? <Tag color="blue" className="!m-0 min-w-12 text-center !font-semibold">{Math.round(totals.rejected / totals.limit * 100)}%</Tag> : '—'}</Table.Summary.Cell>
      {canWrite && <Table.Summary.Cell index={8} />}
    </Table.Summary.Row>
  </Table.Summary> : null

  const usagePercent = (limit: number, rejected: number) => limit > 0 ? `${Math.round(rejected / limit * 100)}%` : rejected > 0 ? 'Limit yo‘q' : ''

  // Same layout as the table: grouped headers, the totals row first and the worst districts in red.
  function exportTable() {
    void exportExcel('rad-limitlari.xlsx', [
      'Hudud', 'Tuman', 'Respublika xodimi', 'Hududiy xodim', 'Davr',
      { title: 'Limit', children: ['Oylik limit', 'Rad etilgan', 'Qolgan limit'] },
      'Foiz',
    ], [
      ['Jami', `${totals.districts} ta tuman`, '', '', '', totals.limit, totals.rejected, totals.remaining, usagePercent(totals.limit, totals.rejected)],
      ...visibleRecords.map((row) => [
        row.district.region.name, row.district.name,
        row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName,
        `${months[row.month - 1]} ${row.year}`, row.monthlyLimit, row.rejectedApplications, row.remainingLimit,
        usagePercent(row.monthlyLimit, row.rejectedApplications),
      ]),
    ], { totalRows: 1, highlight: (row) => row > 0 && worstIds.has(visibleRecords[row - 1].id) })
  }

  const columns: ColumnsType<RadLimit> = [
    { title: 'Tuman', key: 'district', width: 190, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika xodimi', key: 'republic', width: 190, ellipsis: true, render: (_, row) => row.district.republicEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Hududiy xodim', key: 'regional', width: 190, ellipsis: true, render: (_, row) => row.district.regionalEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Davr', key: 'period', width: 130, align: 'center', render: (_, row) => `${months[row.month - 1]} ${row.year}` },
    { title: 'Limit', children: [
      { title: 'Oylik limit', dataIndex: 'monthlyLimit', width: 110, align: 'center', render: (value: number) => value.toLocaleString('ru-RU') },
      { title: 'Rad etilgan', dataIndex: 'rejectedApplications', width: 110, align: 'center', render: (value: number) => value.toLocaleString('ru-RU') },
      { title: 'Qolgan limit', dataIndex: 'remainingLimit', width: 120, align: 'center', render: (value: number, row) => <span className={worstIds.has(row.id) || value < 0 ? 'font-semibold text-red-600' : ''}>{value.toLocaleString('ru-RU')}</span> },
    ] },
    { title: 'Foiz', key: 'usage', width: 100, align: 'center', render: (_, row) => {
      if (row.monthlyLimit === 0) return row.rejectedApplications > 0 ? <Tag color="red" className="!m-0 !font-semibold">Limit yo‘q</Tag> : '—'
      const percent = Math.round(row.rejectedApplications / row.monthlyLimit * 100)
      return <Tag color={worstIds.has(row.id) ? 'red' : 'blue'} className="!m-0 min-w-12 text-center !font-semibold">{percent}%</Tag>
    } },
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: RadLimit) => <Button size="small" onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<RadLimit>[number]] : []),
  ]

  async function save(values: Values) {
    if (!editor) return
    try {
      const path = editor.record ? `/api/rad-limits/districts/${editor.districtId}/records/${editor.record.id}` : `/api/rad-limits/districts/${editor.districtId}`
      const response = await fetch(path, { method: editor.record ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Saqlash amalga oshmadi')
      setEditor(null)
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlash amalga oshmadi') }
  }

  return <div><Space direction="vertical" size="middle" className="w-full">
    {error && <Alert type="error" showIcon message={error} />}
    <Card size="small"><Space wrap>
      <Select allowClear placeholder="Hudud" className="min-w-52" value={filters.regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <Select allowClear placeholder="Oy" className="min-w-36" value={filters.month} options={monthOptions} onChange={(month) => setFilters((old) => ({ ...old, month }))} />
      <InputNumber aria-label="Yil filtri" placeholder="Yil" min={1} max={9999} precision={0} value={filters.year} onChange={(year) => setFilters((old) => ({ ...old, year: year ?? undefined }))} />
    </Space></Card>
    <Card loading={loading}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman yoki xodim bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={exportTable}>Excel uchun eksport</Button><Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visibleRecords} rowClassName={(row) => worstIds.has(row.id) ? '[&>td]:!bg-red-50' : ''} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1260 }} locale={{ emptyText: 'RAD limitlari topilmadi' }} /></Card>
  </Space>
  <Modal title={editor?.record ? 'RAD limitini tahrirlash' : 'RAD limitini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="Oy" name="month" rules={[{ required: true }]}><Select options={monthOptions} /></Form.Item>
      <Form.Item label="Yil" name="year" rules={[{ required: true }]}><InputNumber min={1} max={9999} precision={0} className="w-full" /></Form.Item>
      <Form.Item label="Oylik limit" name="monthlyLimit" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
      <Form.Item label="Rad etilgan arizalar" name="rejectedApplications" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
    </Form>
  </Modal>
  </div>
}

export default RadLimitPage
