import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
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

const formatDate = (value: string) => dayjs(value.slice(0, 10)).format('DD.MM.YYYY')
// Years from 2020 up to the current year, newest first.
const yearOptions = Array.from({ length: dayjs().year() - 2019 }, (_, index) => dayjs().year() - index).map((year) => ({ value: year, label: `${year}-yil` }))

function MkdPage({ token, user }: { token: string; user: User }) {
  const [data, setData] = useState<PageData>({ districts: [], records: [], writableDistrictIds: [] })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ districtId: string; record?: MkdRecord } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, year: undefined as number | undefined, date: dayjs().subtract(1, 'day') })
  const [form] = Form.useForm()
  const canWrite = user.role !== 'REGIONAL_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ date: filters.date.format('YYYY-MM-DD') })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      if (filters.year) params.set('year', String(filters.year))
      const response = await fetch(`/api/mkd?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'MKD ma’lumotlarini yuklab bo‘lmadi')
      setData(result as PageData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MKD ma’lumotlarini yuklab bo‘lmadi')
    } finally { setLoading(false) }
  }, [filters, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  const filterDistricts = data.districts.filter((item) => !filters.regionId || item.regionId === filters.regionId)
  const visibleRecords = data.records.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName, `${row.year}-yil`]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: MkdRecord) {
    setEditor({ districtId, record })
    form.setFieldsValue(record
      ? { year: record.year, recordDate: dayjs(record.recordDate.slice(0, 10)), inProgressCount: record.inProgressCount }
      : { year: filters.year ?? dayjs().year(), recordDate: filters.date, inProgressCount: 0 })
    if (!record) void prefill(districtId, filters.year ?? dayjs().year(), filters.date)
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
    ], { totalRows: 1 })
  }

  const columns: ColumnsType<MkdRecord> = [
    { title: 'Tuman', key: 'district', width: 190, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika xodimi', key: 'republic', width: 190, ellipsis: true, render: (_, row) => row.district.republicEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Hududiy xodim', key: 'regional', width: 190, ellipsis: true, render: (_, row) => row.district.regionalEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Sana', dataIndex: 'recordDate', width: 130, align: 'center', render: (value: string) => formatDate(value) },
    { title: 'Yil', dataIndex: 'year', width: 110, align: 'center', render: (value: number) => <Tag color="blue" className="!m-0 !font-semibold">{value}-yil</Tag> },
    { title: 'Jarayonda', dataIndex: 'inProgressCount', width: 120, align: 'center', render: (value: number) => value.toLocaleString('ru-RU') },
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 120, fixed: 'right', align: 'center', render: (_: unknown, row: MkdRecord) => canEdit(row.districtId) && <Button size="small" onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<MkdRecord>[number]] : []),
  ]

  async function save(values: Values) {
    if (!editor) return
    try {
      const path = editor.record ? `/api/mkd/districts/${editor.districtId}/records/${editor.record.id}` : `/api/mkd/districts/${editor.districtId}`
      const response = await fetch(path, { method: editor.record ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, recordDate: values.recordDate.format('YYYY-MM-DD') }) })
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
      <Select allowClear placeholder="Yil" className="min-w-32" value={filters.year} options={yearOptions} onChange={(year) => setFilters((old) => ({ ...old, year }))} />
      <DatePicker allowClear={false} format="DD.MM.YYYY" value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={loading}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman, xodim yoki yil bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={exportTable}>Excel uchun eksport</Button><Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.filter((item) => canEdit(item.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visibleRecords} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1050 }} locale={{ emptyText: 'MKD yozuvlari topilmadi' }} /></Card>
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
