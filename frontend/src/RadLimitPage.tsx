import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel } from './excel-export'
import { apiFetch, applySaved, isOptimistic, optimisticId, useOptimisticMutation } from './api'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD'
type User = { id: string; username: string; fullName: string; role: Role }
type District = {
  id: string; name: string; regionId: string; region: { id: string; name: string }
  republicEmployeeAssignment: { user: { fullName: string } } | null
  regionalEmployeeAssignment: { user: { fullName: string } } | null
}
type RadLimit = {
  id: string; districtId: string; recordDate: string; monthlyLimit: number
  rejectedApplications: number; remainingLimit: number; district: District
}
type PageData = { districts: District[]; records: RadLimit[]; writableDistrictIds: string[] | null }
// Values are month-to-date as of the record date.
type Values = { recordDate: Dayjs; monthlyLimit: number; rejectedApplications: number }
type SaveInput = { districtId: string; record?: RadLimit; payload: Pick<RadLimit, 'recordDate' | 'monthlyLimit' | 'rejectedApplications'> }
const emptyData: PageData = { districts: [], records: [], writableDistrictIds: [] }

const formatDate = (value: string) => dayjs(value.slice(0, 10)).format('DD.MM.YYYY')

function RadLimitPage({ token, user }: { token: string; user: User }) {
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ districtId: string; record?: RadLimit } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, date: dayjs().subtract(1, 'day') })
  const [form] = Form.useForm()
  const queryKey = ['rad-limits', token, filters.date.format('YYYY-MM-DD'), filters.regionId, filters.districtId] as const
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ date: queryKey[2] })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      return apiFetch<PageData>(token, `/api/rad-limits?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const data = query.data ?? emptyData
  const shownError = error ?? query.error?.message ?? null
  const canWrite = user.role === 'ADMIN' || user.role === 'REPUBLIC_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const saveMutation = useOptimisticMutation<PageData, SaveInput>({
    queryKey, invalidate: ['rad-limits'],
    mutationFn: ({ districtId, record, payload }) => apiFetch(token,
      record ? `/api/rad-limits/districts/${districtId}/records/${record.id}` : `/api/rad-limits/districts/${districtId}`,
      { method: record ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
    update: (old, { districtId, record, payload }) => {
      const district = old.districts.find((item) => item.id === districtId)
      if (!district) return old
      const saved = { ...payload, remainingLimit: payload.monthlyLimit - payload.rejectedApplications, id: record?.id ?? optimisticId(), districtId, district }
      return { ...old, records: applySaved(old.records, queryKey[2], saved, record?.id) }
    },
    onError: setError,
    onSuccess: () => setError(null),
  })

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
      recordDate: dayjs(record.recordDate.slice(0, 10)),
      monthlyLimit: record.monthlyLimit,
      rejectedApplications: record.rejectedApplications,
    } : { recordDate: filters.date, monthlyLimit: 0, rejectedApplications: 0 })
    if (!record) void prefill(districtId, filters.date)
  }

  // A new record starts from the district's previous record; rejections restart at 0 in a new month.
  async function prefill(districtId: string, date: Dayjs) {
    try {
      const response = await fetch(`/api/rad-limits/districts/${districtId}/previous?date=${date.format('YYYY-MM-DD')}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Oldingi ma’lumotni yuklab bo‘lmadi')
      const previous = result.record as { recordDate: string; monthlyLimit: number; rejectedApplications: number } | null
      // Ignore the answer if the user has picked another date meanwhile.
      if (!form.getFieldValue('recordDate')?.isSame(date, 'day')) return
      const sameMonth = previous && dayjs(previous.recordDate.slice(0, 10)).isSame(date, 'month')
      form.setFieldsValue({ monthlyLimit: previous?.monthlyLimit ?? 0, rejectedApplications: sameMonth ? previous.rejectedApplications : 0 })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Oldingi ma’lumotni yuklab bo‘lmadi') }
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
    void exportExcel(`rad-limitlari-${filters.date.format('YYYY-MM-DD')}.xlsx`, [
      'Hudud', 'Tuman', 'Respublika xodimi', 'Hududiy xodim', 'Sana',
      { title: 'Limit', children: ['Oylik limit', 'Rad etilgan', 'Qolgan limit'] },
      'Foiz',
    ], [
      ['Jami', `${totals.districts} ta tuman`, '', '', '', totals.limit, totals.rejected, totals.remaining, usagePercent(totals.limit, totals.rejected)],
      ...visibleRecords.map((row) => [
        row.district.region.name, row.district.name,
        row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName,
        formatDate(row.recordDate), row.monthlyLimit, row.rejectedApplications, row.remainingLimit,
        usagePercent(row.monthlyLimit, row.rejectedApplications),
      ]),
    ], { totalRows: 1, highlight: (row) => row > 0 && worstIds.has(visibleRecords[row - 1].id) })
  }

  const columns: ColumnsType<RadLimit> = [
    { title: 'Tuman', key: 'district', width: 190, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika xodimi', key: 'republic', width: 190, ellipsis: true, render: (_, row) => row.district.republicEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Hududiy xodim', key: 'regional', width: 190, ellipsis: true, render: (_, row) => row.district.regionalEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Sana', dataIndex: 'recordDate', width: 130, align: 'center', render: (value: string) => formatDate(value) },
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
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: RadLimit) => canEdit(row.districtId) && <Button size="small" disabled={isOptimistic(row.id)} onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<RadLimit>[number]] : []),
  ]

  function save(values: Values) {
    if (!editor) return
    saveMutation.mutate({ districtId: editor.districtId, record: editor.record, payload: { monthlyLimit: values.monthlyLimit, rejectedApplications: values.rejectedApplications, recordDate: values.recordDate.format('YYYY-MM-DD') } })
    setEditor(null)
  }

  return <div><Space direction="vertical" size="middle" className="w-full">
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <Card size="small"><Space wrap>
      <Select allowClear placeholder="Hudud" className="min-w-52" value={filters.regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <DatePicker allowClear={false} format="DD.MM.YYYY" value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={query.isPending}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman yoki xodim bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={exportTable}>Excel uchun eksport</Button><Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.filter((item) => canEdit(item.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visibleRecords} rowClassName={(row) => worstIds.has(row.id) ? '[&>td]:!bg-red-50' : ''} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1260 }} locale={{ emptyText: 'RAD limitlari topilmadi' }} /></Card>
  </Space>
  <Modal title={editor?.record ? 'RAD limitini tahrirlash' : 'RAD limitini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save} onValuesChange={(changed: Partial<Values>) => { if (editor && !editor.record && changed.recordDate) void prefill(editor.districtId, changed.recordDate) }}>
      <Form.Item label="Sana" name="recordDate" rules={[{ required: true, message: 'Sanani tanlang' }]}><DatePicker className="w-full" format="DD.MM.YYYY" /></Form.Item>
      <Form.Item label="Oylik limit" name="monthlyLimit" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
      <Form.Item label="Rad etilgan arizalar (oy boshidan)" name="rejectedApplications" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
    </Form>
  </Modal>
  </div>
}

export default RadLimitPage
