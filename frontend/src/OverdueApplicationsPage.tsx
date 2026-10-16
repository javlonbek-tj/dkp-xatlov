import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER'
type User = { id: string; username: string; fullName: string; role: Role }
type Employee = { fullName: string; phone: string | null }
type District = {
  id: string; name: string; regionId: string; region: { id: string; name: string }
  republicEmployeeAssignment: { user: Employee } | null
  regionalEmployeeAssignment: { user: Employee } | null
}
type StageField = 'stage1to3' | 'stage4to7' | 'stage8to14' | 'stage15to30' | 'stage31to90' | 'stage90plus'
type OverdueRecord = { id: string; districtId: string; recordDate: string; district: District } & Record<StageField, number>
type PageData = { districts: District[]; records: OverdueRecord[]; writableDistrictIds: string[] | null }
type Values = { recordDate: Dayjs } & Record<StageField, number>

const stages: { field: StageField; label: string }[] = [
  { field: 'stage1to3', label: '1–3 kun' }, { field: 'stage4to7', label: '4–7 kun' }, { field: 'stage8to14', label: '8–14 kun' },
  { field: 'stage15to30', label: '15–30 kun' }, { field: 'stage31to90', label: '31–90 kun' }, { field: 'stage90plus', label: '90+ kun' },
]
const total = (row: Record<StageField, number>) => stages.reduce((sum, stage) => sum + row[stage.field], 0)

function employeeCell(user?: Employee) {
  if (!user) return '—'
  return <div className="truncate leading-tight" title={user.fullName}>{user.fullName}{user.phone && <div className="text-xs text-slate-500">{user.phone}</div>}</div>
}

function OverdueApplicationsPage({ token, user }: { token: string; user: User }) {
  const [data, setData] = useState<PageData>({ districts: [], records: [], writableDistrictIds: [] })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ districtId: string; record?: OverdueRecord } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, date: dayjs().subtract(1, 'day') })
  const [form] = Form.useForm()
  const canWrite = user.role === 'ADMIN' || user.role === 'REPUBLIC_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      params.set('date', filters.date.format('YYYY-MM-DD'))
      const response = await fetch(`/api/overdue-applications?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Ma’lumotlarni yuklab bo‘lmadi')
      setData(result as PageData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ma’lumotlarni yuklab bo‘lmadi')
    } finally { setLoading(false) }
  }, [filters, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  const filterDistricts = data.districts.filter((item) => !filters.regionId || item.regionId === filters.regionId)
  const visibleRecords = data.records.filter((row) => [row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  // The three records with the most overdue applications are highlighted.
  const worstIds = useMemo(() => new Set(data.records
    .filter((row) => total(row) > 0)
    .sort((a, b) => total(b) - total(a))
    .slice(0, 3)
    .map((row) => row.id)), [data.records])

  function openEditor(districtId: string, record?: OverdueRecord) {
    setEditor({ districtId, record })
    form.setFieldsValue(record
      ? { ...record, recordDate: dayjs(record.recordDate.slice(0, 10)) }
      : { recordDate: filters.date, ...Object.fromEntries(stages.map((stage) => [stage.field, 0])) })
  }

  const columns: ColumnsType<OverdueRecord> = [
    { title: 'Tuman', key: 'district', width: 190, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika vakili', key: 'republic', width: 190, render: (_, row) => employeeCell(row.district.republicEmployeeAssignment?.user) },
    { title: 'Viloyat vakili', key: 'regional', width: 190, render: (_, row) => employeeCell(row.district.regionalEmployeeAssignment?.user) },
    { title: 'Kechikish bosqichlari', children: stages.map((stage) => ({
      title: stage.label, dataIndex: stage.field, width: 95, align: 'center' as const,
      render: (value: number) => value === 0 ? <span className="text-slate-300">0</span> : <span className={`font-semibold ${stage.field === 'stage90plus' || stage.field === 'stage31to90' ? 'text-red-600' : ''}`}>{value}</span>,
    })) },
    { title: 'Jami', key: 'total', width: 90, align: 'center', render: (_, row) => <Tag color={worstIds.has(row.id) ? 'red' : total(row) ? 'orange' : 'default'} className="!m-0 min-w-10 text-center !font-semibold">{total(row)}</Tag> },
    { title: 'Sana', dataIndex: 'recordDate', width: 110, align: 'center', render: (value: string) => dayjs(value.slice(0, 10)).format('DD.MM.YYYY') },
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: OverdueRecord) => canEdit(row.districtId) && <Button size="small" onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<OverdueRecord>[number]] : []),
  ]

  async function save(values: Values) {
    if (!editor) return
    const payload = { recordDate: values.recordDate.format('YYYY-MM-DD'), ...Object.fromEntries(stages.map((stage) => [stage.field, values[stage.field] ?? 0])) }
    try {
      const path = editor.record ? `/api/overdue-applications/districts/${editor.districtId}/records/${editor.record.id}` : `/api/overdue-applications/districts/${editor.districtId}`
      const response = await fetch(path, { method: editor.record ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.code === 'DUPLICATE_SNAPSHOT' ? 'Bu tuman uchun shu sanada yozuv mavjud — uni tahrirlang' : result.error?.message ?? 'Saqlash amalga oshmadi')
      setEditor(null)
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlash amalga oshmadi') }
  }

  const editorDistrict = data.districts.find((item) => item.id === editor?.districtId)

  return <div><Space direction="vertical" size="middle" className="w-full">
    {error && <Alert type="error" showIcon message={error} />}
    <Card size="small"><Space wrap>
      <Select allowClear placeholder="Hudud" className="min-w-52" value={filters.regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <DatePicker allowClear={false} format="DD.MM.YYYY" value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={loading}>
      <div className="mb-4 flex flex-wrap justify-between gap-3">
        <Input.Search allowClear placeholder="Tuman yoki vakil bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Space>
          <Button onClick={() => void exportExcel(`muddati-otgan-arizalar-${filters.date.format('YYYY-MM-DD')}.xlsx`, [
            'Hudud', 'Tuman', 'Respublika vakili', 'Viloyat vakili',
            { title: 'Kechikish bosqichlari', children: stages.map((stage) => stage.label) },
            'Jami', 'Sana',
          ], visibleRecords.map((row) => [
            row.district.region.name, row.district.name,
            row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName,
            ...stages.map((stage) => row[stage.field]), total(row), dayjs(row.recordDate.slice(0, 10)).format('DD.MM.YYYY'),
          ]), { highlight: (row) => worstIds.has(visibleRecords[row].id) })}>Excel uchun eksport</Button>
          <Select showSearch optionFilterProp="label" placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} value={null} options={filterDistricts.filter((item) => canEdit(item.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => id && openEditor(id)} />
        </Space>
      </div>
      <Table
        size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
        rowKey="id" columns={columns} dataSource={visibleRecords} rowClassName={(row) => worstIds.has(row.id) ? "[&>td]:!bg-red-50" : ""} sticky={{ offsetHeader: 64 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
        scroll={{ x: 1460 }} locale={{ emptyText: 'Yozuvlar topilmadi' }}
      />
    </Card>
  </Space>
  <Modal title={`${editor?.record ? 'Yozuvni tahrirlash' : 'Yozuv qo‘shish'}${editorDistrict ? ` — ${editorDistrict.name}` : ''}`} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="Sana" name="recordDate" rules={[{ required: true, message: 'Sanani tanlang' }]}><DatePicker className="w-full" format="DD.MM.YYYY" /></Form.Item>
      <div className="mb-2 text-sm font-medium">Kechikish bosqichlari bo‘yicha arizalar soni</div>
      <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
        {stages.map((stage) => <Form.Item key={stage.field} label={stage.label} name={stage.field} rules={[{ required: true, message: 'Sonni kiriting' }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>)}
      </div>
    </Form>
  </Modal>
  </div>
}

export default OverdueApplicationsPage
