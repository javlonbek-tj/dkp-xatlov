import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel } from './excel-export'
import { apiFetch, applySaved, isOptimistic, optimisticId, useOptimisticMutation } from './api'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD'
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
type SaveInput = { districtId: string; record?: OverdueRecord; payload: { recordDate: string } & Record<StageField, number> }
const emptyData: PageData = { districts: [], records: [], writableDistrictIds: [] }

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
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ districtId: string; record?: OverdueRecord } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, date: dayjs().subtract(1, 'day') })
  const [form] = Form.useForm()
  const queryKey = ['overdue-applications', token, filters.date.format('YYYY-MM-DD'), filters.regionId, filters.districtId] as const
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ date: queryKey[2] })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      return apiFetch<PageData>(token, `/api/overdue-applications?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const data = query.data ?? emptyData
  const shownError = error ?? query.error?.message ?? null
  const canWrite = user.role === 'ADMIN' || user.role === 'REPUBLIC_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const saveMutation = useOptimisticMutation<PageData, SaveInput>({
    queryKey, invalidate: ['overdue-applications'],
    mutationFn: ({ districtId, record, payload }) => apiFetch(token,
      record ? `/api/overdue-applications/districts/${districtId}/records/${record.id}` : `/api/overdue-applications/districts/${districtId}`,
      { method: record ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
    ).catch((cause: Error & { code?: string }) => {
      throw cause.code === 'DUPLICATE_SNAPSHOT' ? new Error('Bu tuman uchun shu sanada yozuv mavjud — uni tahrirlang') : cause
    }),
    update: (old, { districtId, record, payload }) => {
      const district = old.districts.find((item) => item.id === districtId)
      if (!district) return old
      return { ...old, records: applySaved(old.records, queryKey[2], { ...payload, id: record?.id ?? optimisticId(), districtId, district }, record?.id) }
    },
    onError: setError,
    onSuccess: () => setError(null),
  })

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
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: OverdueRecord) => canEdit(row.districtId) && <Button size="small" disabled={isOptimistic(row.id)} onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<OverdueRecord>[number]] : []),
  ]

  function save(values: Values) {
    if (!editor) return
    const payload = { recordDate: values.recordDate.format('YYYY-MM-DD'), ...Object.fromEntries(stages.map((stage) => [stage.field, values[stage.field] ?? 0])) } as SaveInput['payload']
    saveMutation.mutate({ districtId: editor.districtId, record: editor.record, payload })
    setEditor(null)
  }

  const editorDistrict = data.districts.find((item) => item.id === editor?.districtId)

  return <div><Space direction="vertical" size="middle" className="w-full">
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <Card size="small"><Space wrap>
      <Select allowClear placeholder="Hudud" className="min-w-52" value={filters.regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <DatePicker allowClear={false} format="DD.MM.YYYY" value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={query.isPending}>
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
