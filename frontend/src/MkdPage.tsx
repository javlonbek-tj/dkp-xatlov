import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type User = { id: string; username: string; fullName: string; role: Role }
type District = {
  id: string; name: string; engineerCount: number | null; regionId: string
  region: { id: string; name: string }
  republicEmployeeAssignment: { user: { fullName: string } } | null
  regionalEmployeeAssignment: { user: { fullName: string } } | null
}
type MkdType = 'YEAR_2025' | 'YEAR_2024' | 'NEW_UZBEKISTAN'
type MkdRecord = {
  id: string; districtId: string; type: MkdType; targetDate: string
  totalBuildings: number; completedBuildings: number; remainingBuildings: number
  plannedBuildings: number; completedAgainstPlan: number; remainingPlan: number
  district: District
}
type PageData = { districts: District[]; records: MkdRecord[] }
type FormValues = {
  type: MkdType; targetDate: Dayjs; totalBuildings: number; completedBuildings: number
  plannedBuildings: number; completedAgainstPlan: number
}

const typeLabels: Record<MkdType, string> = {
  YEAR_2025: '2025', YEAR_2024: '2024', NEW_UZBEKISTAN: "Yangi O'zbekiston",
}
const typeOptions = Object.entries(typeLabels).map(([value, label]) => ({ value, label }))

function MkdPage({ token, user }: { token: string; user: User }) {
  const [data, setData] = useState<PageData>({ districts: [], records: [] })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ districtId: string; record?: MkdRecord } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, type: undefined as MkdType | undefined, from: undefined as string | undefined, to: undefined as string | undefined })
  const [form] = Form.useForm()
  const canWrite = user.role !== 'REGIONAL_EMPLOYEE'

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      if (filters.type) params.set('type', filters.type)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      const response = await fetch(`/api/mkd?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? "MKD ma'lumotlarini yuklab bo'lmadi")
      setData(result as PageData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MKD ma'lumotlarini yuklab bo'lmadi")
    } finally { setLoading(false) }
  }, [filters, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  const filterDistricts = data.districts.filter((item) => !filters.regionId || item.regionId === filters.regionId)
  const visibleRecords = data.records.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName, typeLabels[row.type], row.targetDate]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: MkdRecord) {
    setEditor({ districtId, record })
    form.setFieldsValue(record ? {
      ...record,
      targetDate: dayjs(record.targetDate),
    } : { type: 'YEAR_2025', targetDate: undefined, totalBuildings: 0, completedBuildings: 0, plannedBuildings: 0, completedAgainstPlan: 0 })
  }

  const columns: ColumnsType<MkdRecord> = [
    { title: 'Hudud', dataIndex: ['district', 'region', 'name'] },
    { title: 'Tuman', dataIndex: ['district', 'name'] },
    { title: 'Muhandislar', render: (_, row) => row.district.engineerCount ?? '—' },
    { title: 'Respublika xodimi', render: (_, row) => row.district.republicEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Hududiy xodim', render: (_, row) => row.district.regionalEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'MKD turi', dataIndex: 'type', render: (type: MkdType) => typeLabels[type] },
    { title: 'Jami ko‘p kvartirali uylar', dataIndex: 'totalBuildings' },
    { title: 'Bajarilgan', dataIndex: 'completedBuildings' },
    { title: 'Qolgan', dataIndex: 'remainingBuildings' },
    { title: 'Reja sanasi', dataIndex: 'targetDate', render: (value: string) => value.slice(0, 10) },
    { title: 'Rejadagi ishlar', dataIndex: 'plannedBuildings' },
    { title: 'Reja bo‘yicha bajarilgan', dataIndex: 'completedAgainstPlan' },
    { title: 'Rejada qolgan', dataIndex: 'remainingPlan' },
    ...(canWrite ? [{ title: 'Amallar', render: (_: unknown, row: MkdRecord) => <Button size="small" onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<MkdRecord>[number]] : []),
  ]

  async function save(values: FormValues) {
    if (!editor) return
    const payload = {
      ...values,
      targetDate: values.targetDate.format('YYYY-MM-DD'),
    }
    try {
      const path = editor.record ? `/api/mkd/districts/${editor.districtId}/records/${editor.record.id}` : `/api/mkd/districts/${editor.districtId}`
      const response = await fetch(path, { method: editor.record ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Saqlash amalga oshmadi')
      setEditor(null)
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlash amalga oshmadi') }
  }

  return <div><Space direction="vertical" size="large" className="w-full">
    <div><Typography.Title level={3} className="!mb-1">MKD</Typography.Title><Typography.Text type="secondary">Ko‘p kvartirali uylar bo‘yicha reja va bajarilish</Typography.Text></div>
    {error && <Alert type="error" showIcon message={error} />}
    <Card title="Filtrlar"><Space wrap>
      <Select allowClear placeholder="Hudud" className="min-w-52" value={filters.regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <Select allowClear placeholder="MKD turi" className="min-w-52" value={filters.type} options={typeOptions} onChange={(type) => setFilters((old) => ({ ...old, type }))} />
      <DatePicker placeholder="Sanadan" onChange={(value) => setFilters((old) => ({ ...old, from: value?.format('YYYY-MM-DD') }))} />
      <DatePicker placeholder="Sanagacha" onChange={(value) => setFilters((old) => ({ ...old, to: value?.format('YYYY-MM-DD') }))} />
    </Space></Card>
    <Card loading={loading}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman yoki MKD turi bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={() => void exportExcel('mkd.xlsx', ['Hudud', 'Tuman', 'Muhandislar', 'Respublika xodimi', 'Hududiy xodim', 'MKD turi', 'Jami uylar', 'Bajarilgan', 'Qolgan', 'Reja sanasi', 'Rejalashtirilgan', 'Reja bo‘yicha bajarilgan', 'Rejada qolgan'], visibleRecords.map((row) => [row.district.region.name, row.district.name, row.district.engineerCount, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName, typeLabels[row.type], row.totalBuildings, row.completedBuildings, row.remainingBuildings, row.targetDate.slice(0, 10), row.plannedBuildings, row.completedAgainstPlan, row.remainingPlan]))}>Excel uchun eksport</Button><Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table rowKey="id" columns={columns} dataSource={visibleRecords} pagination={{ pageSize: 10 }} scroll={{ x: true }} locale={{ emptyText: 'MKD yozuvlari topilmadi' }} /></Card>
  </Space>
  <Modal title={editor?.record ? 'MKD yozuvini tahrirlash' : 'MKD yozuvini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="MKD turi" name="type" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item>
      <Form.Item label="Reja sanasi" name="targetDate" rules={[{ required: true, message: 'Reja sanasini tanlang' }]}><DatePicker className="w-full" /></Form.Item>
      {([
        ['totalBuildings', 'Jami ko‘p kvartirali uylar'],
        ['completedBuildings', 'Bajarilgan uylar'],
        ['plannedBuildings', 'Reja bo‘yicha bajariladigan uylar'],
        ['completedAgainstPlan', 'Reja bo‘yicha bajarilgan uylar'],
      ] as const).map(([name, label]) => <Form.Item key={name} label={label} name={name} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>)}
    </Form>
  </Modal>
  </div>
}

export default MkdPage
