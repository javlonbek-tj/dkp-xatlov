import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'
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
// In-progress MKD of the given year as of the record date.
type MkdRecord = { id: string; districtId: string; year: number; recordDate: string; inProgressCount: number; district: District }
type PageData = { districts: District[]; records: MkdRecord[]; writableDistrictIds: string[] | null }
type Values = { year: number; recordDate: Dayjs; inProgressCount: number }
type SaveInput = { districtId: string; record?: MkdRecord; payload: Pick<MkdRecord, 'year' | 'recordDate' | 'inProgressCount'> }
const emptyData: PageData = { districts: [], records: [], writableDistrictIds: [] }

const formatDate = (value: string) => dayjs(value.slice(0, 10)).format('DD.MM.YYYY')
// Years from 2020 up to the current year, newest first.
const yearOptions = Array.from({ length: dayjs().year() - 2019 }, (_, index) => dayjs().year() - index).map((year) => ({ value: year, label: `${year}-yil` }))

function MkdPage({ token, user }: { token: string; user: User }) {
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ districtId: string; record?: MkdRecord } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, year: undefined as number | null | undefined, date: dayjs().subtract(1, 'day') })
  const [form] = Form.useForm()
  const queryKey = ['mkd', token, filters.date.format('YYYY-MM-DD'), filters.regionId, filters.districtId] as const
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ date: queryKey[2] })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      return apiFetch<PageData>(token, `/api/mkd?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const data = query.data ?? emptyData
  const shownError = error ?? query.error?.message ?? null
  const canWrite = user.role === 'ADMIN' || user.role === 'REPUBLIC_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const saveMutation = useOptimisticMutation<PageData, SaveInput>({
    queryKey, invalidate: ['mkd'],
    mutationFn: ({ districtId, record, payload }) => apiFetch(token,
      record ? `/api/mkd/districts/${districtId}/records/${record.id}` : `/api/mkd/districts/${districtId}`,
      { method: record ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
    update: (old, { districtId, record, payload }) => {
      const district = old.districts.find((item) => item.id === districtId)
      if (!district) return old
      return { ...old, records: applySaved(old.records, queryKey[2], { ...payload, id: record?.id ?? optimisticId(), districtId, district }, record?.id) }
    },
    onError: setError,
    onSuccess: () => setError(null),
  })
  // Districts that get a 0 are known only to the server, so this change is shown after it answers.
  const fillZeroMutation = useOptimisticMutation<PageData, { year: number }, { created: number }>({
    queryKey, invalidate: ['mkd'],
    mutationFn: ({ year }) => apiFetch(token, '/api/mkd/fill-zero', { method: 'POST', body: JSON.stringify({ year, recordDate: queryKey[2], regionId: filters.regionId, districtId: filters.districtId }) }),
    onError: setError,
    onSuccess: (result) => {
      setError(null)
      void message.success(result.created ? `${result.created} ta tumanga 0 kiritildi` : 'Barcha tumanlarda yozuv bor')
    },
  })

  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  const filterDistricts = data.districts.filter((item) => !filters.regionId || item.regionId === filters.regionId)
  // All years of the date are loaded; until a year is picked, 2024 is shown if it has MKD in progress, otherwise 2023.
  // Clearing the year filter shows every year.
  const year = filters.year === undefined ? (data.records.some((row) => row.year === 2024 && row.inProgressCount > 0) ? 2024 : 2023) : filters.year
  const yearRecords = useMemo(() => year ? data.records.filter((row) => row.year === year) : data.records, [data.records, year])
  // The three districts with the most MKD in progress (summed over the shown years) are highlighted.
  const worstDistricts = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of yearRecords) totals.set(row.districtId, (totals.get(row.districtId) ?? 0) + row.inProgressCount)
    return new Set([...totals].filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id))
  }, [yearRecords])
  const visibleRecords = yearRecords.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName, `${row.year}-yil`]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: MkdRecord) {
    setEditor({ districtId, record })
    form.setFieldsValue(record
      ? { year: record.year, recordDate: dayjs(record.recordDate.slice(0, 10)), inProgressCount: record.inProgressCount }
      : { year: year ?? dayjs().year(), recordDate: filters.date, inProgressCount: 0 })
    if (!record) void prefill(districtId, year ?? dayjs().year(), filters.date)
  }

  // A new record starts from the district's previous record of the same year.
  async function prefill(districtId: string, year: number, date: Dayjs) {
    try {
      const response = await fetch(`/api/mkd/districts/${districtId}/previous?year=${year}&date=${date.format('YYYY-MM-DD')}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Oldingi ma’lumotni yuklab bo‘lmadi')
      const previous = result.record as { recordDate: string; inProgressCount: number } | null
      // Ignore the answer if the user has picked another year or date meanwhile.
      if (form.getFieldValue('year') !== year || !form.getFieldValue('recordDate')?.isSame(date, 'day')) return
      form.setFieldsValue({ inProgressCount: previous?.inProgressCount ?? 0 })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Oldingi ma’lumotni yuklab bo‘lmadi') }
  }

  // Totals for the visible rows.
  const totals = {
    districts: new Set(visibleRecords.map((row) => row.districtId)).size,
    inProgress: visibleRecords.reduce((sum, row) => sum + row.inProgressCount, 0),
  }
  const summary = () => visibleRecords.length ? <Table.Summary fixed="top">
    <Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
      <Table.Summary.Cell index={0}>Jami ({totals.districts} ta tuman)</Table.Summary.Cell>
      <Table.Summary.Cell index={1} colSpan={4} />
      <Table.Summary.Cell index={5} align="center">{totals.inProgress.toLocaleString('ru-RU')}</Table.Summary.Cell>
      {canWrite && <Table.Summary.Cell index={6} />}
    </Table.Summary.Row>
  </Table.Summary> : null

  function exportTable() {
    void exportExcel(`mkd-${filters.date.format('YYYY-MM-DD')}.xlsx`, ['Hudud', 'Tuman', 'Respublika xodimi', 'Hududiy xodim', 'Sana', 'Yil', 'Jarayonda'], [
      ['Jami', `${totals.districts} ta tuman`, '', '', '', '', totals.inProgress],
      ...visibleRecords.map((row) => [
        row.district.region.name, row.district.name,
        row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName,
        formatDate(row.recordDate), `${row.year}-yil`, row.inProgressCount,
      ]),
    ], { totalRows: 1, highlight: (row) => row > 0 && worstDistricts.has(visibleRecords[row - 1].districtId) })
  }

  const columns: ColumnsType<MkdRecord> = [
    { title: 'Tuman', key: 'district', width: 190, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika xodimi', key: 'republic', width: 190, ellipsis: true, render: (_, row) => row.district.republicEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Hududiy xodim', key: 'regional', width: 190, ellipsis: true, render: (_, row) => row.district.regionalEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Sana', dataIndex: 'recordDate', width: 130, align: 'center', render: (value: string) => formatDate(value) },
    { title: 'Yil', dataIndex: 'year', width: 110, align: 'center', render: (value: number) => <Tag color="blue" className="!m-0 !font-semibold">{value}-yil</Tag> },
    { title: 'Jarayonda', dataIndex: 'inProgressCount', width: 120, align: 'center', render: (value: number, row) => <span className={worstDistricts.has(row.districtId) ? 'font-semibold text-red-600' : ''}>{value.toLocaleString('ru-RU')}</span> },
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: MkdRecord) => canEdit(row.districtId) && <Button size="small" disabled={isOptimistic(row.id)} onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<MkdRecord>[number]] : []),
  ]

  // Adds 0 for the shown year and date to every editable district without a record, so only non-zero values need editing.
  function fillZero() {
    if (year) fillZeroMutation.mutate({ year })
  }

  function save(values: Values) {
    if (!editor) return
    saveMutation.mutate({ districtId: editor.districtId, record: editor.record, payload: { year: values.year, inProgressCount: values.inProgressCount, recordDate: values.recordDate.format('YYYY-MM-DD') } })
    setEditor(null)
  }

  return <div><Space direction="vertical" size="middle" className="w-full">
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <Card size="small"><Space wrap>
      <Select allowClear placeholder="Hudud" className="min-w-52" value={filters.regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <Select allowClear placeholder="Yil" className="min-w-32" value={year ?? undefined} options={yearOptions} onChange={(value?: number) => setFilters((old) => ({ ...old, year: value ?? null }))} />
      <DatePicker allowClear={false} format="DD.MM.YYYY" value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={query.isPending}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman, xodim yoki yil bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={exportTable}>Excel uchun eksport</Button>{canWrite && <Popconfirm title={`${filters.date.format('DD.MM.YYYY')} uchun ${year}-yil bo‘yicha yozuvi yo‘q barcha tumanlarga 0 kiritilsinmi?`} okText="Ha" cancelText="Yo‘q" disabled={!year} onConfirm={fillZero}><Button disabled={!year} loading={fillZeroMutation.isPending} title={year ? undefined : 'Avval yilni tanlang'}>Barchasiga 0 kiritish</Button></Popconfirm>}<Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.filter((item) => canEdit(item.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visibleRecords} rowClassName={(row) => worstDistricts.has(row.districtId) ? '[&>td]:!bg-red-50' : ''} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1050 }} locale={{ emptyText: 'MKD yozuvlari topilmadi' }} /></Card>
  </Space>
  <Modal title={editor?.record ? 'MKD yozuvini tahrirlash' : 'MKD yozuvini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save} onValuesChange={(changed: Partial<Values>, all: Values) => {
      if (editor && !editor.record && (changed.recordDate || changed.year) && all.year && all.recordDate) void prefill(editor.districtId, all.year, all.recordDate)
    }}>
      <Form.Item label="Sana" name="recordDate" rules={[{ required: true, message: 'Sanani tanlang' }]}><DatePicker className="w-full" format="DD.MM.YYYY" /></Form.Item>
      <Form.Item label="Yil" name="year" rules={[{ required: true, message: 'Yilni tanlang' }]}><Select options={yearOptions} /></Form.Item>
      <Form.Item label="Jarayondagi MKD soni" name="inProgressCount" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
    </Form>
  </Modal>
  </div>
}

export default MkdPage
