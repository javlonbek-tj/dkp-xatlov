import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { employeeText, exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type User = { id: string; username: string; fullName: string; role: Role }
type District = {
  id: string; name: string; engineerCount: number | null; regionId: string
  xatlovEmployeeCount: number | null; objectCount: number | null; mfyCount: number | null
  region: { id: string; name: string }
  republicEmployeeAssignment: { user: { fullName: string; phone: string | null } } | null
  regionalEmployeeAssignment: { user: { fullName: string; phone: string | null } } | null
}
type RecordRow = {
  id: string; districtId: string; recordDate: string; completedMfyCount: number; censusCount: number; completedObjectCount: number | null; migrationCount: number
  paymentDebt: string | null
  completedMfyNames: string[]; district: District
}
type ApiData = { districts: District[]; records: RecordRow[]; writableDistrictIds: string[] | null }
type Values = {
  recordDate: Dayjs
  completedMfyCount: number; censusCount: number; completedObjectCount: number; migrationCount: number
  paymentDebt: number | null
  completedMfyNames: string
}

function employeeCell(user?: { fullName: string; phone?: string | null }) {
  if (!user) return '—'
  return <div className="truncate leading-tight" title={user.fullName}>{user.fullName}{user.phone && <div className="text-xs text-slate-500">{user.phone}</div>}</div>
}

function XatlovPage({ token, user }: { token: string; user: User }) {
  const [data, setData] = useState<ApiData>({ districts: [], records: [], writableDistrictIds: [] })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ districtId: string; record?: RecordRow } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, from: undefined as string | undefined, to: undefined as string | undefined })
  const [form] = Form.useForm()
  const canWrite = user.role !== 'REGIONAL_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      const response = await fetch(`/api/xatlov?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Ma’lumotlarni yuklab bo‘lmadi')
      setData(result as ApiData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ma’lumotlarni yuklab bo‘lmadi')
    } finally { setLoading(false) }
  }, [filters, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  const filterDistricts = data.districts.filter((item) => !filters.regionId || item.regionId === filters.regionId)
  const visibleRecords = data.records.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName, row.recordDate, row.completedMfyNames]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: RecordRow) {
    setEditor({ districtId, record })
    form.setFieldsValue(record ? {
      ...record,
      recordDate: dayjs(record.recordDate),
      paymentDebt: record.paymentDebt === null ? null : Number(record.paymentDebt),
      completedMfyNames: record.completedMfyNames.join('\n'),
    } : { recordDate: undefined, completedMfyCount: 0, censusCount: 0, completedObjectCount: 0, migrationCount: 0, paymentDebt: null, completedMfyNames: '' })
  }

  // Totals for the visible rows; employee counts are per district, so each district is counted once.
  const visibleDistricts = [...new Map(visibleRecords.map((row) => [row.districtId, row.district])).values()]
  const totals = {
    engineers: visibleDistricts.reduce((sum, item) => sum + (item.engineerCount ?? 0), 0),
    xatlovEmployees: visibleDistricts.reduce((sum, item) => sum + (item.xatlovEmployeeCount ?? 0), 0),
    completedMfy: visibleRecords.reduce((sum, row) => sum + row.completedMfyCount, 0),
    census: visibleRecords.reduce((sum, row) => sum + Math.max(row.censusCount, 0), 0),
    completedObjects: visibleRecords.reduce((sum, row) => sum + (row.completedObjectCount ?? 0), 0),
    migration: visibleRecords.reduce((sum, row) => sum + row.migrationCount, 0),
  }
  const summary = () => visibleRecords.length ? <Table.Summary fixed="top">
    <Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
      <Table.Summary.Cell index={0}>Jami ({visibleDistricts.length} ta tuman)</Table.Summary.Cell>
      <Table.Summary.Cell index={1} colSpan={2} />
      <Table.Summary.Cell index={3} align="center">{totals.engineers.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={4} align="center">{totals.xatlovEmployees.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={5} align="center">{totals.completedMfy.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={6} align="center">{totals.census.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={7} align="center">{totals.completedObjects.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={8} align="center"><Tag color="blue" className="!m-0 min-w-10 text-center !font-semibold">{totals.migration.toLocaleString('ru-RU')}</Tag></Table.Summary.Cell>
      <Table.Summary.Cell index={9} colSpan={canWrite ? 3 : 2} />
    </Table.Summary.Row>
  </Table.Summary> : null

  // Same layout as the table: grouped headers and the totals row first.
  function exportTable() {
    void exportExcel('xatlov.xlsx', [
      'Hudud', 'Tuman',
      'Respublika vakili', 'Viloyat vakili',
      { title: 'Xodimlar', children: ['Jami', 'Xatlovda'] },
      { title: 'Natijalar', children: ['Tugallangan MFY', 'Xatlov soni', 'Yakunlangan obyekt', 'Migratsiya soni'] },
      'Tugallangan MFY nomlari', 'Sana',
    ], [
      ['Jami', `${visibleDistricts.length} ta tuman`, '', '', totals.engineers, totals.xatlovEmployees, totals.completedMfy, totals.census, totals.completedObjects, totals.migration, '', ''],
      ...visibleRecords.map((row) => [
        row.district.region.name, row.district.name,
        employeeText(row.district.republicEmployeeAssignment?.user),
        employeeText(row.district.regionalEmployeeAssignment?.user),
        row.district.engineerCount, row.district.xatlovEmployeeCount,
        row.completedMfyCount, row.censusCount, row.completedObjectCount, row.migrationCount,
        row.completedMfyNames.join(', '), dayjs(row.recordDate.slice(0, 10)).format('DD.MM.YYYY'),
      ]),
    ], { totalRows: 1 })
  }

  const columns: ColumnsType<RecordRow> = [
    { title: 'Tuman', key: 'district', width: 190, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika vakili', key: 'republic', width: 190, render: (_, row) => employeeCell(row.district.republicEmployeeAssignment?.user) },
    { title: 'Viloyat vakili', key: 'regional', width: 190, render: (_, row) => employeeCell(row.district.regionalEmployeeAssignment?.user) },
    { title: 'Xodimlar', children: [
      { title: 'Jami', key: 'engineers', width: 80, align: 'center', render: (_, row) => row.district.engineerCount ?? '—' },
      { title: 'Xatlovda', key: 'xatlovEmployees', width: 90, align: 'center', render: (_, row) => row.district.xatlovEmployeeCount ?? '—' },
    ] },
    { title: 'Natijalar', children: [
      { title: 'Tugallangan MFY', dataIndex: 'completedMfyCount', width: 130, align: 'center' },
      { title: 'Xatlov soni', dataIndex: 'censusCount', width: 100, align: 'center', render: (value: number) => <span className={value < 0 ? 'text-red-600' : ''}>{value.toLocaleString('ru-RU')}</span> },
      { title: 'Yakunlangan obyekt', dataIndex: 'completedObjectCount', width: 130, align: 'center', render: (value: number | null) => value?.toLocaleString('ru-RU') ?? '—' },
      { title: 'Migratsiya soni', dataIndex: 'migrationCount', width: 120, align: 'center', render: (value: number) => <Tag color="blue" className="!m-0 min-w-10 text-center !font-semibold">{value.toLocaleString('ru-RU')}</Tag> },
    ] },
    { title: 'Tugallangan MFY nomlari', key: 'completedMfyNames', width: 220, ellipsis: true, render: (_, row) => row.completedMfyNames.join(', ') || '—' },
    { title: 'Sana', dataIndex: 'recordDate', width: 110, align: 'center', render: (value: string) => dayjs(value.slice(0, 10)).format('DD.MM.YYYY') },
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: RecordRow) => canEdit(row.districtId) && <Button size="small" onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<RecordRow>[number]] : []),
  ]

  async function save(values: Values) {
    if (!editor) return
    const payload = {
      recordDate: values.recordDate.format('YYYY-MM-DD'),
      completedMfyCount: values.completedMfyCount,
      censusCount: values.censusCount,
      completedObjectCount: values.completedObjectCount,
      migrationCount: values.migrationCount,
      paymentDebt: values.paymentDebt ?? null,
      completedMfyNames: values.completedMfyNames.split('\n').map((name) => name.trim()).filter(Boolean),
    }
    try {
      const path = editor.record ? `/api/xatlov/districts/${editor.districtId}/records/${editor.record.id}` : `/api/xatlov/districts/${editor.districtId}`
      const response = await fetch(path, { method: editor.record ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
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
      <DatePicker placeholder="Sanadan" onChange={(value) => setFilters((old) => ({ ...old, from: value?.format('YYYY-MM-DD') }))} />
      <DatePicker placeholder="Sanagacha" onChange={(value) => setFilters((old) => ({ ...old, to: value?.format('YYYY-MM-DD') }))} />
    </Space></Card>
    <Card loading={loading}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman yoki MFY bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={exportTable}>Excel uchun eksport</Button><Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.filter((item) => canEdit(item.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visibleRecords} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1670 }} locale={{ emptyText: 'Xatlov yozuvlari topilmadi' }} /></Card>
  </Space>
  <Modal title={editor?.record ? 'Xatlov yozuvini tahrirlash' : 'Xatlov yozuvini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="Sana" name="recordDate" rules={[{ required: true, message: 'Sanani tanlang' }]}><DatePicker className="w-full" /></Form.Item>
      {(['completedMfyCount', 'censusCount', 'completedObjectCount', 'migrationCount'] as const).map((name) => <Form.Item key={name} label={{ completedMfyCount: 'Tugallangan MFY soni', censusCount: 'Xatlov soni', completedObjectCount: 'Xatlov yakunlangan obyekt', migrationCount: 'Migratsiya soni' }[name]} name={name} rules={[{ required: true }]}><InputNumber min={name === 'censusCount' ? undefined : 0} precision={0} className="w-full" /></Form.Item>)}
      <Form.Item label="To‘lov bo‘yicha qarzdorlik (mln so‘m)" name="paymentDebt"><InputNumber min={0} precision={2} className="w-full" /></Form.Item>
      <Form.Item label="Tugallangan MFY nomlari (har qatorda bittadan)" name="completedMfyNames"><Input.TextArea rows={3} /></Form.Item>
    </Form>
  </Modal>
  </div>
}

export default XatlovPage
