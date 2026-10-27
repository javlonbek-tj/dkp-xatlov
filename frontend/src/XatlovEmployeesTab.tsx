import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel, type ExportHeader } from './excel-export'
import { exportPdf } from './pdf-export'
import { apiFetch, isOptimistic, optimisticId, useOptimisticMutation } from './api'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD' | 'PAYMENT_SPECIALIST'
type User = { id: string; username: string; fullName: string; role: Role }
type Head = { id: string; username: string; fullName: string; phone: string | null }
type District = { id: string; name: string; regionId: string; region: { id: string; name: string }; heads?: Head[] }
type WorkRecord = { id: string; recordDate: string; censusCount: number; migrationCount: number }
type Employee = {
  id: string; districtId: string; fullName: string; position: string | null; phone: string | null; note: string | null
  district: { id: string; name: string; region: { id: string; name: string } }
  record: WorkRecord | null
  // Monday to Friday of the selected date's week, up to that date.
  weeklyCensusCount: number; weeklyMigrationCount: number
}
type ApiData = { districts: District[]; employees: Employee[]; canManage: boolean }
type WorkValues = { censusCount: number; migrationCount: number }
// Staff list and district head accounts edited in the "Tuman xodimlari" window.
type PersonEditor = { kind: 'employee'; employee?: Employee } | { kind: 'head'; head?: Head }
type Change = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: object; update?: (data: ApiData) => ApiData }
const emptyData: ApiData = { districts: [], employees: [], canManage: false }
const isPending = (row: Employee) => isOptimistic(row.id) || (!!row.record && isOptimistic(row.record.id))
// Number of employees with the lowest weekly migration that are shown in red.
const lowestCount = 3

function XatlovEmployeesTab({ token, user }: { token: string; user: User }) {
  const [error, setError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, date: dayjs().subtract(1, 'day') })
  const [workEditor, setWorkEditor] = useState<Employee | null>(null)
  const [staffDistrictId, setStaffDistrictId] = useState<string | null>(null)
  const [personEditor, setPersonEditor] = useState<PersonEditor | null>(null)
  const [workForm] = Form.useForm<WorkValues>()
  const [personForm] = Form.useForm()
  const isHead = user.role === 'DISTRICT_HEAD'

  const queryKey = ['district-employees', token, filters.date.format('YYYY-MM-DD'), filters.regionId, filters.districtId] as const
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ date: queryKey[2] })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      return apiFetch<ApiData>(token, `/api/district-employees?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const data = query.data ?? emptyData
  const shownError = error ?? query.error?.message ?? null

  // Every change goes through here; `update` shows its result in the table at once and is undone if the server refuses it.
  const change = useOptimisticMutation<ApiData, Change>({
    queryKey, invalidate: ['district-employees'],
    mutationFn: ({ path, method, body }) => apiFetch(token, `/api/district-employees${path}`, { method, body: body && JSON.stringify(body) }),
    update: (old, input) => input.update ? input.update(old) : old,
    onError: setError,
    onSuccess: () => setError(null),
  })
  const updateEmployee = (id: string, patch: (employee: Employee) => Employee) => (old: ApiData) =>
    ({ ...old, employees: old.employees.map((item) => item.id === id ? patch(item) : item) })

  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  // A user who sees a single region (e.g. a Republic employee or viewer assigned to Navoiy) has it selected by default.
  const regionId = filters.regionId ?? (user.role !== 'ADMIN' && regions.length === 1 ? regions[0].id : undefined)
  const filterDistricts = data.districts.filter((item) => !regionId || item.regionId === regionId)
  // The employees with the lowest weekly migration come first.
  const visible = data.employees
    .filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.fullName, row.position, row.phone, row.note]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.weeklyMigrationCount - b.weeklyMigrationCount)
  const lowest = new Set(visible.slice(0, lowestCount).map((row) => row.id))
  const staffDistrict = data.districts.find((item) => item.id === staffDistrictId)
  const staff = data.employees.filter((row) => row.districtId === staffDistrictId)
  const totals = {
    entered: visible.filter((row) => row.record).length,
    census: visible.reduce((sum, row) => sum + (row.record?.censusCount ?? 0), 0),
    migration: visible.reduce((sum, row) => sum + (row.record?.migrationCount ?? 0), 0),
    weeklyCensus: visible.reduce((sum, row) => sum + row.weeklyCensusCount, 0),
    weeklyMigration: visible.reduce((sum, row) => sum + row.weeklyMigrationCount, 0),
  }

  function openWorkEditor(employee: Employee) {
    setWorkEditor(employee)
    workForm.setFieldsValue({ censusCount: employee.record?.censusCount ?? 0, migrationCount: employee.record?.migrationCount ?? 0 })
  }

  function saveWork(values: WorkValues) {
    if (!workEditor) return
    const base = `/districts/${workEditor.districtId}/employees/${workEditor.id}/records`
    const recordDate = filters.date.format('YYYY-MM-DD')
    // Saturday and Sunday records are not part of the Monday–Friday totals.
    const inWeek = filters.date.day() >= 1 && filters.date.day() <= 5
    const weekly = (item: Employee) => inWeek ? {
      weeklyCensusCount: item.weeklyCensusCount + values.censusCount - (item.record?.censusCount ?? 0),
      weeklyMigrationCount: item.weeklyMigrationCount + values.migrationCount - (item.record?.migrationCount ?? 0),
    } : {}
    change.mutate({
      path: workEditor.record ? `${base}/${workEditor.record.id}` : base,
      method: workEditor.record ? 'PATCH' : 'POST',
      body: { ...values, recordDate },
      update: updateEmployee(workEditor.id, (item) => ({ ...item, ...weekly(item), record: { id: item.record?.id ?? optimisticId(), recordDate, ...values } })),
    })
    setWorkEditor(null)
  }

  function openPersonEditor(editor: PersonEditor) {
    setPersonEditor(editor)
    const person = editor.kind === 'employee' ? editor.employee : editor.head
    personForm.setFieldsValue({ fullName: person?.fullName, phone: person?.phone, position: editor.kind === 'employee' ? editor.employee?.position : undefined, note: editor.kind === 'employee' ? editor.employee?.note : undefined, username: undefined, password: undefined })
  }

  async function savePerson(values: { fullName: string; phone?: string; position?: string; note?: string; username?: string; password?: string }) {
    if (!personEditor || !staffDistrictId) return
    const district = data.districts.find((item) => item.id === staffDistrictId)
    if (personEditor.kind === 'employee') {
      const employee = personEditor.employee
      const fields = { fullName: values.fullName.trim(), phone: values.phone?.trim() || null, position: values.position?.trim() || null, note: values.note?.trim() || null }
      const base = `/districts/${staffDistrictId}/employees`
      change.mutate({
        path: employee ? `${base}/${employee.id}` : base,
        method: employee ? 'PATCH' : 'POST',
        body: { fullName: values.fullName, phone: values.phone, position: values.position, note: values.note },
        update: employee ? updateEmployee(employee.id, (item) => ({ ...item, ...fields }))
          : (old) => !district ? old : ({ ...old, employees: [...old.employees, { ...fields, id: optimisticId(), districtId: district.id, district, record: null, weeklyCensusCount: 0, weeklyMigrationCount: 0 }] }),
      })
      setPersonEditor(null)
      return
    }
    // A head account can be refused (e.g. a taken username), so its window stays open until the server accepts it.
    const id = personEditor.head?.id
    const base = `/districts/${staffDistrictId}/heads`
    try {
      await change.mutateAsync({
        path: id ? `${base}/${id}` : base,
        method: id ? 'PATCH' : 'POST',
        body: { fullName: values.fullName, phone: values.phone, ...(id ? {} : { username: values.username }), ...(values.password ? { password: values.password } : {}) },
      })
      setPersonEditor(null)
    } catch { /* The error is shown by the mutation. */ }
  }

  function removeEmployee(row: Employee) {
    change.mutate({
      path: `/districts/${row.districtId}/employees/${row.id}`, method: 'DELETE',
      update: (old) => ({ ...old, employees: old.employees.filter((item) => item.id !== row.id) }),
    })
  }

  // Excel and PDF share the title, columns and highlights.
  function exportTable(format: 'excel' | 'pdf') {
    const place = data.districts.find((item) => item.id === filters.districtId)?.name ?? regions.find((item) => item.id === regionId)?.name ?? 'Respublika'
    const title = {
      lines: [`“Dolzarb 90 kunlik” doirasida ${place} bo‘yicha xodimlar kesimida xatlov va migratsiya ishlari to‘g‘risida`, 'MA’LUMOT'],
      note: `${filters.date.format('DD.MM.YYYY')} y. soat ${dayjs().format('HH:mm')}`,
    }
    const headers: ExportHeader[] = [
      'Hudud', 'Tuman', 'F.I.Sh.', 'Lavozim', 'Telefon', 'Izoh',
      { title: 'Kunlik', children: ['Xatlov soni', 'Migratsiya soni'] },
      { title: 'Haftalik (Du–Ju)', children: ['Xatlov soni', 'Migratsiya soni'] },
    ]
    const rows = [
      ['Jami', '', `${visible.length} ta xodim (${totals.entered} ta kiritilgan)`, '', '', '', totals.census, totals.migration, totals.weeklyCensus, totals.weeklyMigration],
      ...visible.map((row) => [row.district.region.name, row.district.name, row.fullName, row.position, row.phone, row.note, row.record?.censusCount, row.record?.migrationCount, row.weeklyCensusCount, row.weeklyMigrationCount]),
    ]
    const options = { title, totalRows: 1, highlight: (row: number, column: number) => column === 9 && row > 0 && lowest.has(visible[row - 1].id) }
    const filename = `xatlov-xodimlar-${filters.date.format('YYYY-MM-DD')}`
    if (format === 'pdf') {
      setError(null)
      setPdfLoading(true)
      exportPdf(filename, headers, rows, options)
        .catch(() => setError('PDF faylni yaratib bo‘lmadi'))
        .finally(() => setPdfLoading(false))
    }
    else void exportExcel(`${filename}.xlsx`, headers, rows, options)
  }

  const columns: ColumnsType<Employee> = [
    { title: 'Tuman', key: 'district', width: 190, render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'F.I.Sh.', key: 'fullName', width: 220, render: (_, row) => <div className="truncate leading-tight" title={row.fullName}>{row.fullName}{row.phone && <div className="text-xs text-slate-500">{row.phone}</div>}</div> },
    // The note (e.g. on leave) is shown under the position so the reason for missing work is visible.
    { title: 'Lavozim', key: 'position', width: 170, render: (_, row) => <div className="truncate leading-tight" title={[row.position, row.note].filter(Boolean).join(' · ')}>{row.position ?? '—'}{row.note && <div className="text-xs text-orange-600">{row.note}</div>}</div> },
    { title: 'Kunlik', children: [
      { title: 'Xatlov soni', key: 'censusCount', width: 110, align: 'center', render: (_, row) => row.record ? row.record.censusCount.toLocaleString('ru-RU') : '—' },
      { title: 'Migratsiya soni', key: 'migrationCount', width: 130, align: 'center', render: (_, row) => row.record ? <Tag color="blue" className="!m-0 min-w-10 text-center !font-semibold">{row.record.migrationCount.toLocaleString('ru-RU')}</Tag> : '—' },
    ] },
    { title: 'Haftalik (Du–Ju)', children: [
      { title: 'Xatlov soni', key: 'weeklyCensusCount', width: 110, align: 'center', render: (_, row) => row.weeklyCensusCount.toLocaleString('ru-RU') },
      { title: 'Migratsiya soni', key: 'weeklyMigrationCount', width: 130, align: 'center', onCell: (row) => lowest.has(row.id) ? { className: '!bg-red-50 font-semibold text-red-600' } : {}, render: (_, row) => row.weeklyMigrationCount.toLocaleString('ru-RU') },
    ] },
    ...(data.canManage || isHead ? [{
      title: 'Amallar', key: 'actions', width: 120, align: 'center',
      // District heads add a record once; only Administrators and Republic employees change it afterwards.
      render: (_: unknown, row: Employee) => !row.record ? <Button size="small" type="primary" disabled={isPending(row)} onClick={() => openWorkEditor(row)}>Kiritish</Button>
        : data.canManage ? <Button size="small" disabled={isPending(row)} onClick={() => openWorkEditor(row)}>Tahrirlash</Button>
        : <Tag color="green" className="!m-0">Kiritilgan</Tag>,
    } as ColumnsType<Employee>[number]] : []),
  ]

  const summary = () => visible.length ? <Table.Summary fixed="top">
    <Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
      <Table.Summary.Cell index={0}>Jami</Table.Summary.Cell>
      <Table.Summary.Cell index={1} colSpan={2}>{visible.length} ta xodim ({totals.entered} ta kiritilgan)</Table.Summary.Cell>
      <Table.Summary.Cell index={3} align="center">{totals.census.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={4} align="center"><Tag color="blue" className="!m-0 min-w-10 text-center !font-semibold">{totals.migration.toLocaleString('ru-RU')}</Tag></Table.Summary.Cell>
      <Table.Summary.Cell index={5} align="center">{totals.weeklyCensus.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={6} align="center"><Tag color="purple" className="!m-0 min-w-10 text-center !font-semibold">{totals.weeklyMigration.toLocaleString('ru-RU')}</Tag></Table.Summary.Cell>
      {(data.canManage || isHead) && <Table.Summary.Cell index={7} />}
    </Table.Summary.Row>
  </Table.Summary> : null

  const staffColumns: ColumnsType<Employee> = [
    { title: 'F.I.Sh.', dataIndex: 'fullName', ellipsis: true },
    { title: 'Lavozim', dataIndex: 'position', ellipsis: true, render: (value: string | null) => value ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', width: 150, render: (value: string | null) => value ?? '—' },
    { title: 'Izoh', dataIndex: 'note', width: 180, ellipsis: true, render: (value: string | null) => value ?? '—' },
    { title: 'Amallar', key: 'actions', width: 190, render: (_, row) => isPending(row) ? <span className="text-slate-400">Saqlanmoqda…</span> : <Space>
      <Button size="small" onClick={() => openPersonEditor({ kind: 'employee', employee: row })}>Tahrirlash</Button>
      <Popconfirm title="Xodimni o‘chirasizmi?" onConfirm={() => removeEmployee(row)}>
        <Button size="small" danger>O‘chirish</Button>
      </Popconfirm>
    </Space> },
  ]
  const headColumns: ColumnsType<Head> = [
    { title: 'F.I.Sh.', dataIndex: 'fullName', ellipsis: true },
    { title: 'Foydalanuvchi nomi', dataIndex: 'username', ellipsis: true },
    { title: 'Telefon', dataIndex: 'phone', width: 150, render: (value: string | null) => value ?? '—' },
    { title: 'Amallar', key: 'actions', width: 190, render: (_, head) => <Space>
      <Button size="small" onClick={() => openPersonEditor({ kind: 'head', head })}>Tahrirlash</Button>
      <Popconfirm title="Tuman rahbarini o‘chirasizmi?" onConfirm={() => change.mutate({ path: `/districts/${staffDistrictId}/heads/${head.id}`, method: 'DELETE' })}>
        <Button size="small" danger>O‘chirish</Button>
      </Popconfirm>
    </Space> },
  ]

  return <div><Space direction="vertical" size="middle" className="w-full">
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <Card size="small"><Space wrap>
      {!isHead && <>
        <Select allowClear={regions.length > 1} placeholder="Hudud" className="min-w-52" value={regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
        <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      </>}
      <DatePicker allowClear={false} value={filters.date} onChange={(value: Dayjs | null) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={query.isPending}>
      <div className="mb-4 flex flex-wrap justify-between gap-3">
        <Input.Search allowClear placeholder="Tuman, xodim yoki lavozim bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Space>
          <Button onClick={() => exportTable('excel')}>Excel uchun eksport</Button>
          <Button onClick={() => exportTable('pdf')} disabled={!visible.length} loading={pdfLoading}>PDF yuklab olish</Button>
          {data.canManage && <Select placeholder="Tuman xodimlari ro‘yxati" className="min-w-64" value={null} options={filterDistricts.filter((item) => !filters.districtId || item.id === filters.districtId).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id: string) => setStaffDistrictId(id)} />}
        </Space>
      </div>
      <Table size="small" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visible} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 16, showSizeChanger: true, pageSizeOptions: [16, 50, 100] }} scroll={{ x: 1180 }} locale={{ emptyText: 'Tuman xodimlari topilmadi' }} />
    </Card>
  </Space>

  <Modal title={`${workEditor?.fullName ?? ''} · ${filters.date.format('DD.MM.YYYY')}`} open={!!workEditor} onCancel={() => setWorkEditor(null)} onOk={() => workForm.submit()} okText="Saqlash" destroyOnHidden>
    {isHead && <Alert className="!mb-4" type="warning" showIcon message="Saqlangandan keyin bu yozuvni faqat respublika vakili o‘zgartira oladi." />}
    <Form form={workForm} layout="vertical" onFinish={saveWork}>
      <Form.Item label="Xatlov soni" name="censusCount" rules={[{ required: true, message: 'Xatlov sonini kiriting' }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
      <Form.Item label="Migratsiya soni" name="migrationCount" rules={[{ required: true, message: 'Migratsiya sonini kiriting' }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
    </Form>
  </Modal>

  <Modal title={`Tuman xodimlari — ${staffDistrict ? `${staffDistrict.region.name} · ${staffDistrict.name}` : ''}`} open={!!staffDistrictId} onCancel={() => setStaffDistrictId(null)} footer={null} width={860} destroyOnHidden>
    <Space direction="vertical" size="middle" className="w-full">
      <div className="flex items-center justify-between"><span className="font-medium">Tuman rahbari</span><Button size="small" type="primary" onClick={() => openPersonEditor({ kind: 'head' })}>Tuman rahbarini qo‘shish</Button></div>
      <Table size="small" rowKey="id" columns={headColumns} dataSource={staffDistrict?.heads ?? []} pagination={false} locale={{ emptyText: 'Tuman rahbari kiritilmagan' }} />
      <div className="flex items-center justify-between"><span className="font-medium">Xodimlar</span><Button size="small" type="primary" onClick={() => openPersonEditor({ kind: 'employee' })}>Xodim qo‘shish</Button></div>
      <Table size="small" rowKey="id" columns={staffColumns} dataSource={staff} pagination={false} locale={{ emptyText: 'Xodimlar kiritilmagan' }} />
    </Space>
  </Modal>

  <Modal
    title={personEditor?.kind === 'head'
      ? (personEditor.head ? 'Tuman rahbarini tahrirlash' : 'Tuman rahbarini qo‘shish')
      : (personEditor?.employee ? 'Xodimni tahrirlash' : 'Xodim qo‘shish')}
    open={!!personEditor} onCancel={() => setPersonEditor(null)} onOk={() => personForm.submit()} okText="Saqlash" destroyOnHidden
  >
    <Form form={personForm} layout="vertical" onFinish={savePerson}>
      <Form.Item label="F.I.Sh." name="fullName" rules={[{ required: true, message: 'F.I.Sh.ni kiriting' }]}><Input maxLength={150} /></Form.Item>
      {personEditor?.kind === 'employee' && <Form.Item label="Lavozim" name="position"><Input maxLength={150} /></Form.Item>}
      <Form.Item label="Telefon raqami" name="phone"><Input maxLength={30} placeholder="+998-90-123-45-67" /></Form.Item>
      {personEditor?.kind === 'employee' && <Form.Item label="Izoh" name="note" extra="Masalan, mehnat ta’tilida yoki o‘qishda"><Input.TextArea maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>}
      {personEditor?.kind === 'head' && <>
        {!personEditor.head && <Form.Item label="Foydalanuvchi nomi" name="username" rules={[{ required: true, message: 'Foydalanuvchi nomini kiriting' }]}><Input maxLength={100} autoComplete="off" /></Form.Item>}
        <Form.Item label={personEditor.head ? 'Yangi parol (ixtiyoriy)' : 'Parol'} name="password" rules={personEditor.head ? [] : [{ required: true, message: 'Parolni kiriting' }]}><Input.Password maxLength={200} autoComplete="new-password" /></Form.Item>
      </>}
    </Form>
  </Modal>
  </div>
}

export default XatlovEmployeesTab
