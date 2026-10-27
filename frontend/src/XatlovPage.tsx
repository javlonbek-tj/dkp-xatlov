import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { employeeText, exportExcel, type ExportHeader } from './excel-export'
import { exportPdf } from './pdf-export'
import XatlovEmployeesTab from './XatlovEmployeesTab'
import { apiFetch, applySaved, isOptimistic, optimisticId, useOptimisticMutation } from './api'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD'
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
  weeklyCensusCount: number; weeklyMigrationCount: number; weeklyDays: number
  paceMigrationCount: number; paceDays: number
}
type Plan = { deadline: string; fiveDayWorkDays: number; sixDayWorkDays: number; holidays: { date: string; name: string }[]; fiveDayDaysOff: string[] }
type ApiData = { districts: District[]; records: RecordRow[]; writableDistrictIds: string[] | null; plan: Plan | null }
type Values = {
  recordDate: Dayjs
  completedMfyCount: number; censusCount: number; completedObjectCount: number; migrationCount: number
  paymentDebt: number | null
  completedMfyNames: string
}

type Payload = Pick<RecordRow, 'recordDate' | 'completedMfyCount' | 'censusCount' | 'completedObjectCount' | 'migrationCount' | 'completedMfyNames'> & { paymentDebt: number | null }
type SaveInput = { districtId: string; record?: RecordRow; payload: Payload }
const emptyData: ApiData = { districts: [], records: [], writableDistrictIds: [], plan: null }

// Rows as they will look after the save, shown until the server answers; weekly totals are adjusted by the change.
function optimisticRecords(data: ApiData, shownDate: string, { districtId, payload, record }: SaveInput): ApiData {
  const district = data.districts.find((item) => item.id === districtId)
  if (!district) return data
  const saved: RecordRow = {
    ...payload, paymentDebt: payload.paymentDebt === null ? null : String(payload.paymentDebt),
    id: record?.id ?? optimisticId(), districtId, district,
    weeklyCensusCount: (record?.weeklyCensusCount ?? 0) + payload.censusCount - (record?.censusCount ?? 0),
    weeklyMigrationCount: (record?.weeklyMigrationCount ?? 0) + payload.migrationCount - (record?.migrationCount ?? 0),
    weeklyDays: record?.weeklyDays ?? 1,
    paceMigrationCount: (record?.paceMigrationCount ?? 0) + payload.migrationCount - (record?.migrationCount ?? 0),
    paceDays: record?.paceDays ?? 1,
  }
  return { ...data, records: applySaved(data.records, shownDate, saved, record?.id) }
}

// Migration per Xatlov employee per worked day of the week.
function perEmployeeDay(migration: number, employeeDays: number) {
  return employeeDays > 0 ? Math.round((migration / employeeDays) * 100) / 100 : null
}
const employeeDays = (row: RecordRow) => row.weeklyDays * (row.district.xatlovEmployeeCount ?? 0)

// Objects still to complete by the deadline, and how many a day that needs.
const remainingObjects = (row: RecordRow) => Math.max((row.district.objectCount ?? 0) - (row.completedObjectCount ?? 0), 0)
const dailyPlan = (remaining: number, workDays?: number) => workDays ? Math.ceil(remaining / workDays) : null
// Migration per day with a record in the last 5 working days.
const dailyPace = (row: RecordRow) => row.paceDays > 0 ? row.paceMigrationCount / row.paceDays : 0

// Day the remaining objects are done at the current pace, in a 5-day week without holidays; null when there is no pace or it takes over 10 years.
function forecastDate(from: Dayjs, remaining: number, pace: number, daysOff: Set<string>) {
  if (remaining <= 0) return from
  if (pace <= 0) return null
  let days = Math.ceil(remaining / pace)
  if (days > 2600) return null
  let date = from
  while (days > 0) {
    date = date.add(1, 'day')
    if (date.day() !== 0 && date.day() !== 6 && !daysOff.has(date.format('YYYY-MM-DD'))) days--
  }
  return date
}

function employeeCell(user?: { fullName: string; phone?: string | null }) {
  if (!user) return '—'
  return <div className="truncate leading-tight" title={user.fullName}>{user.fullName}{user.phone && <div className="text-xs text-slate-500">{user.phone}</div>}</div>
}

function XatlovPage({ token, user }: { token: string; user: User }) {
  const [error, setError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [editor, setEditor] = useState<{ districtId: string; record?: RecordRow } | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, date: dayjs().subtract(1, 'day') })
  const [form] = Form.useForm()
  const queryKey = ['xatlov', token, filters.date.format('YYYY-MM-DD'), filters.regionId, filters.districtId] as const
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ date: queryKey[2] })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      return apiFetch<ApiData>(token, `/api/xatlov?${params}`)
    },
    // Keep showing the previous result while another date or filter loads.
    placeholderData: keepPreviousData,
  })
  const data = query.data ?? emptyData
  const shownError = error ?? query.error?.message ?? null
  const canWrite = user.role === 'ADMIN' || user.role === 'REPUBLIC_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  // The table changes at once; the server answer replaces it, and a failed save restores the previous rows.
  const saveMutation = useOptimisticMutation<ApiData, SaveInput>({
    queryKey, invalidate: ['xatlov'],
    mutationFn: ({ districtId, record, payload }) => apiFetch(token,
      record ? `/api/xatlov/districts/${districtId}/records/${record.id}` : `/api/xatlov/districts/${districtId}`,
      { method: record ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
    update: (old, input) => optimisticRecords(old, queryKey[2], input),
    onError: setError,
    onSuccess: () => setError(null),
  })

  const regions = useMemo(() => [...new Map(data.districts.map((item) => [item.region.id, item.region])).values()], [data.districts])
  // A user who sees a single region (e.g. a Republic employee or viewer assigned to Navoiy) has it selected by default.
  const regionId = filters.regionId ?? (user.role !== 'ADMIN' && regions.length === 1 ? regions[0].id : undefined)
  const filterDistricts = data.districts.filter((item) => !regionId || item.regionId === regionId)
  const visibleRecords = data.records.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.district.regionalEmployeeAssignment?.user.fullName, row.recordDate, row.completedMfyNames]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: RecordRow) {
    setEditor({ districtId, record })
    form.setFieldsValue(record ? {
      ...record,
      recordDate: dayjs(record.recordDate),
      paymentDebt: record.paymentDebt === null ? null : Number(record.paymentDebt),
      completedMfyNames: record.completedMfyNames.join('\n'),
    } : { recordDate: filters.date, completedMfyCount: 0, censusCount: 0, completedObjectCount: 0, migrationCount: 0, paymentDebt: null, completedMfyNames: '' })
    if (!record) void prefill(districtId, filters.date)
  }

  // A new record starts from the district's previous record so unchanged values need not be typed again.
  async function prefill(districtId: string, date: Dayjs) {
    try {
      const response = await fetch(`/api/xatlov/districts/${districtId}/previous?date=${date.format('YYYY-MM-DD')}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Oldingi ma’lumotni yuklab bo‘lmadi')
      const previous = result.record as Omit<RecordRow, 'id' | 'districtId' | 'district' | 'weeklyCensusCount' | 'weeklyMigrationCount' | 'weeklyDays' | 'paceMigrationCount' | 'paceDays'> | null
      // Ignore the answer if the user has picked another date meanwhile.
      if (!form.getFieldValue('recordDate')?.isSame(date, 'day')) return
      form.setFieldsValue({
        completedMfyCount: previous?.completedMfyCount ?? 0,
        censusCount: previous?.censusCount ?? 0,
        completedObjectCount: previous?.completedObjectCount ?? 0,
        migrationCount: previous?.migrationCount ?? 0,
        paymentDebt: previous?.paymentDebt == null ? null : Number(previous.paymentDebt),
        completedMfyNames: previous?.completedMfyNames.join('\n') ?? '',
      })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Oldingi ma’lumotni yuklab bo‘lmadi') }
  }

  // Totals for the visible rows; employee counts are per district, so each district is counted once.
  const visibleDistricts = [...new Map(visibleRecords.map((row) => [row.districtId, row.district])).values()]
  // The three rows with the lowest migration per employee per day are highlighted in red.
  const worstPerEmployee = new Set(visibleRecords
    .map((row) => ({ id: row.id, value: perEmployeeDay(row.weeklyMigrationCount, employeeDays(row)) }))
    .filter((item) => item.value !== null)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .slice(0, 3)
    .map((item) => item.id))
  const totals = {
    engineers: visibleDistricts.reduce((sum, item) => sum + (item.engineerCount ?? 0), 0),
    xatlovEmployees: visibleDistricts.reduce((sum, item) => sum + (item.xatlovEmployeeCount ?? 0), 0),
    completedMfy: visibleRecords.reduce((sum, row) => sum + row.completedMfyCount, 0),
    census: visibleRecords.reduce((sum, row) => sum + Math.max(row.censusCount, 0), 0),
    completedObjects: visibleRecords.reduce((sum, row) => sum + (row.completedObjectCount ?? 0), 0),
    migration: visibleRecords.reduce((sum, row) => sum + row.migrationCount, 0),
    weeklyCensus: visibleRecords.reduce((sum, row) => sum + row.weeklyCensusCount, 0),
    weeklyMigration: visibleRecords.reduce((sum, row) => sum + row.weeklyMigrationCount, 0),
    employeeDays: visibleRecords.reduce((sum, row) => sum + employeeDays(row), 0),
    remaining: visibleRecords.reduce((sum, row) => sum + remainingObjects(row), 0),
  }
  const plan = data.plan
  // A district whose migration on the selected day is below its 5-day-week plan is shown in red.
  const behindPlan = (row: RecordRow) => (dailyPlan(remainingObjects(row), plan?.fiveDayWorkDays) ?? 0) > row.migrationCount
  const planText = (value: number | null) => value?.toLocaleString('ru-RU') ?? '—'
  const daysOff = new Set(plan?.fiveDayDaysOff)
  const forecast = (remaining: number, pace: number) => forecastDate(filters.date, remaining, pace, daysOff)
  const rowForecast = (row: RecordRow) => forecast(remainingObjects(row), dailyPace(row))
  const totalForecast = forecast(totals.remaining, visibleRecords.reduce((sum, row) => sum + dailyPace(row), 0))
  const lateForecast = (date: Dayjs | null) => !plan || !date || date.format('YYYY-MM-DD') > plan.deadline
  const forecastText = (date: Dayjs | null) => date?.format('DD.MM.YYYY') ?? 'Muddatsiz'
  const forecastCell = (date: Dayjs | null) => <span className={lateForecast(date) ? 'font-semibold text-red-600' : 'font-semibold text-emerald-600'}>{forecastText(date)}</span>
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
      <Table.Summary.Cell index={9} align="center">{totals.weeklyCensus.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={10} align="center"><Tag color="purple" className="!m-0 min-w-10 text-center !font-semibold">{totals.weeklyMigration.toLocaleString('ru-RU')}</Tag></Table.Summary.Cell>
      <Table.Summary.Cell index={11} align="center">{perEmployeeDay(totals.weeklyMigration, totals.employeeDays)?.toLocaleString('ru-RU') ?? '—'}</Table.Summary.Cell>
      <Table.Summary.Cell index={12} align="center">{totals.remaining.toLocaleString('ru-RU')}</Table.Summary.Cell>
      <Table.Summary.Cell index={13} align="center">{planText(dailyPlan(totals.remaining, plan?.fiveDayWorkDays))}</Table.Summary.Cell>
      <Table.Summary.Cell index={14} align="center">{planText(dailyPlan(totals.remaining, plan?.sixDayWorkDays))}</Table.Summary.Cell>
      <Table.Summary.Cell index={15} align="center">{forecastCell(totalForecast)}</Table.Summary.Cell>
      <Table.Summary.Cell index={16} colSpan={canWrite ? 3 : 2} />
    </Table.Summary.Row>
  </Table.Summary> : null

  // Same layout as the table: grouped headers and the totals row first; Excel and PDF share the title and highlights.
  function exportTable(format: 'excel' | 'pdf') {
    const place = data.districts.find((item) => item.id === filters.districtId)?.name ?? regions.find((item) => item.id === regionId)?.name ?? 'Respublika'
    const title = {
      lines: [`“Dolzarb 90 kunlik” doirasida ${place} bo‘yicha xatlov va migratsiya ishlari to‘g‘risida`, 'MA’LUMOT'],
      note: `${filters.date.format('DD.MM.YYYY')} y. soat ${dayjs().format('HH:mm')}`,
    }
    const planTitle = `Kunlik reja (${planDeadline} gacha)`
    const headers: ExportHeader[] = [
      'Hudud', 'Tuman',
      'Respublika vakili', 'Viloyat vakili',
      { title: 'Xodimlar', children: ['Jami', 'Xatlovda'] },
      { title: 'Natijalar', children: ['Tugallangan MFY', 'Xatlov soni', 'Yakunlangan obyekt', 'Migratsiya soni'] },
      { title: 'Haftalik (Du–Ju)', children: ['Xatlov soni', 'Migratsiya soni', '1 xodimga kunlik migratsiya'] },
      { title: planTitle, children: ['Qolgan obyekt', '5 kunlik haftada', '6 kunlik haftada', 'Taxminiy tugash (oxirgi 5 ish kuni sur’atida)'] },
      'Tugallangan MFY nomlari', 'Sana',
    ]
    const rows = [
      ['Jami', `${visibleDistricts.length} ta tuman`, '', '', totals.engineers, totals.xatlovEmployees, totals.completedMfy, totals.census, totals.completedObjects, totals.migration, totals.weeklyCensus, totals.weeklyMigration, perEmployeeDay(totals.weeklyMigration, totals.employeeDays), totals.remaining, dailyPlan(totals.remaining, plan?.fiveDayWorkDays), dailyPlan(totals.remaining, plan?.sixDayWorkDays), forecastText(totalForecast), '', ''],
      ...visibleRecords.map((row) => [
        row.district.region.name, row.district.name,
        employeeText(row.district.republicEmployeeAssignment?.user),
        employeeText(row.district.regionalEmployeeAssignment?.user),
        row.district.engineerCount, row.district.xatlovEmployeeCount,
        row.completedMfyCount, row.censusCount, row.completedObjectCount, row.migrationCount,
        row.weeklyCensusCount, row.weeklyMigrationCount, perEmployeeDay(row.weeklyMigrationCount, employeeDays(row)),
        remainingObjects(row), dailyPlan(remainingObjects(row), plan?.fiveDayWorkDays), dailyPlan(remainingObjects(row), plan?.sixDayWorkDays), forecastText(rowForecast(row)),
        row.completedMfyNames.join(', '), dayjs(row.recordDate.slice(0, 10)).format('DD.MM.YYYY'),
      ]),
    ]
    const options = { title, totalRows: 1, highlight: (row: number, column: number) => row > 0 && ((column === 12 && worstPerEmployee.has(visibleRecords[row - 1].id)) || (column === 14 && behindPlan(visibleRecords[row - 1])) || (column === 16 && lateForecast(rowForecast(visibleRecords[row - 1])))) }
    const filename = `xatlov-${filters.date.format('YYYY-MM-DD')}`
    if (format === 'pdf') {
      setError(null)
      setPdfLoading(true)
      exportPdf(filename, headers, rows, options)
        .catch(() => setError('PDF faylni yaratib bo‘lmadi'))
        .finally(() => setPdfLoading(false))
    }
    else void exportExcel(`${filename}.xlsx`, headers, rows, options)
  }

  const planDeadline = plan ? dayjs(plan.deadline).format('DD.MM.YYYY') : ''
  const columns: ColumnsType<RecordRow> = [
    { title: 'Tuman', key: 'district', width: 170, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.district.name}><span className="font-medium">{row.district.name}</span><div className="text-xs text-slate-500">{row.district.region.name}</div></div> },
    { title: 'Respublika vakili', key: 'republic', width: 170, render: (_, row) => employeeCell(row.district.republicEmployeeAssignment?.user) },
    { title: 'Viloyat vakili', key: 'regional', width: 170, render: (_, row) => employeeCell(row.district.regionalEmployeeAssignment?.user) },
    { title: 'Xodimlar', children: [
      { title: 'Jami', key: 'engineers', width: 60, align: 'center', render: (_, row) => row.district.engineerCount ?? '—' },
      { title: 'Xatlovda', key: 'xatlovEmployees', width: 75, align: 'center', render: (_, row) => row.district.xatlovEmployeeCount ?? '—' },
    ] },
    { title: 'Natijalar', children: [
      { title: <span className="leading-tight">Tugallangan<br />MFY</span>, dataIndex: 'completedMfyCount', width: 95, align: 'center' },
      { title: 'Xatlov soni', dataIndex: 'censusCount', width: 80, align: 'center', render: (value: number) => <span className={value < 0 ? 'text-red-600' : ''}>{value.toLocaleString('ru-RU')}</span> },
      { title: <span className="leading-tight">Yakunlangan<br />obyekt</span>, dataIndex: 'completedObjectCount', width: 95, align: 'center', render: (value: number | null) => value?.toLocaleString('ru-RU') ?? '—' },
      { title: <span className="leading-tight">Migratsiya<br />soni</span>, dataIndex: 'migrationCount', width: 95, align: 'center', render: (value: number) => <Tag color="blue" className="!m-0 min-w-10 text-center !font-semibold">{value.toLocaleString('ru-RU')}</Tag> },
    ] },
    { title: 'Haftalik (Du–Ju)', children: [
      { title: 'Xatlov soni', dataIndex: 'weeklyCensusCount', width: 80, align: 'center', render: (value: number) => <span className={value < 0 ? 'text-red-600' : ''}>{value.toLocaleString('ru-RU')}</span> },
      { title: <span className="leading-tight">Migratsiya<br />soni</span>, dataIndex: 'weeklyMigrationCount', width: 95, align: 'center', render: (value: number) => <Tag color="purple" className="!m-0 min-w-10 text-center !font-semibold">{value.toLocaleString('ru-RU')}</Tag> },
      { title: <span className="leading-tight">1 xodimga kunlik<br />migratsiya</span>, key: 'migrationPerEmployeeDay', width: 110, onCell: (row) => worstPerEmployee.has(row.id) ? { className: '!bg-red-50 font-semibold text-red-600' } : {}, align: 'center', render: (_, row) => perEmployeeDay(row.weeklyMigrationCount, employeeDays(row))?.toLocaleString('ru-RU') ?? '—' },
    ] },
    { title: <span className="leading-tight">Kunlik reja<br />({planDeadline} gacha)</span>, children: [
      { title: <span className="leading-tight">Qolgan<br />obyekt</span>, key: 'remainingObjects', width: 85, align: 'center', render: (_, row) => remainingObjects(row).toLocaleString('ru-RU') },
      { title: <span className="leading-tight">5 kunlik<br />haftada</span>, key: 'fiveDayPlan', width: 80, align: 'center', onCell: (row) => behindPlan(row) ? { className: '!bg-red-50 font-semibold text-red-600' } : {}, render: (_, row) => planText(dailyPlan(remainingObjects(row), plan?.fiveDayWorkDays)) },
      { title: <span className="leading-tight">6 kunlik<br />haftada</span>, key: 'sixDayPlan', width: 80, align: 'center', render: (_, row) => planText(dailyPlan(remainingObjects(row), plan?.sixDayWorkDays)) },
      { title: <span className="leading-tight">Taxminiy<br />tugash</span>, key: 'forecast', width: 95, align: 'center', render: (_, row) => forecastCell(rowForecast(row)) },
    ] },
    { title: 'Tugallangan MFY nomlari', key: 'completedMfyNames', width: 200, ellipsis: true, render: (_, row) => row.completedMfyNames.join(', ') || '—' },
    { title: 'Sana', dataIndex: 'recordDate', width: 95, align: 'center', render: (value: string) => dayjs(value.slice(0, 10)).format('DD.MM.YYYY') },
    ...(canWrite ? [{ title: 'Amallar', key: 'actions', width: 100, fixed: 'right', align: 'center', render: (_: unknown, row: RecordRow) => canEdit(row.districtId) && <Button size="small" disabled={isOptimistic(row.id)} onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<RecordRow>[number]] : []),
  ]

  function save(values: Values) {
    if (!editor) return
    const payload: Payload = {
      recordDate: values.recordDate.format('YYYY-MM-DD'),
      completedMfyCount: values.completedMfyCount,
      censusCount: values.censusCount,
      completedObjectCount: values.completedObjectCount,
      migrationCount: values.migrationCount,
      paymentDebt: values.paymentDebt ?? null,
      completedMfyNames: values.completedMfyNames.split('\n').map((name) => name.trim()).filter(Boolean),
    }
    saveMutation.mutate({ districtId: editor.districtId, record: editor.record, payload })
    setEditor(null)
  }

  const districtTab = <div><Space direction="vertical" size="middle" className="w-full">
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <Card size="small"><Space wrap>
      <Select allowClear={regions.length > 1} placeholder="Hudud" className="min-w-52" value={regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
      <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <DatePicker allowClear={false} value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    {plan && <Alert type="info" showIcon message={<span>Reja: {planDeadline} gacha qolgan ish kunlari — 5 kunlik haftada <b>{plan.fiveDayWorkDays}</b> kun, 6 kunlik haftada <b>{plan.sixDayWorkDays}</b> kun.</span>} />}
    <Card loading={query.isPending}><div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman yoki MFY bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Space><Button onClick={() => exportTable('excel')}>Excel uchun eksport</Button><Button onClick={() => exportTable('pdf')} disabled={!visibleRecords.length} loading={pdfLoading}>PDF yuklab olish</Button><Select placeholder="Yangi yozuv uchun tuman" className="min-w-64" disabled={!canWrite} options={filterDistricts.filter((item) => canEdit(item.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></Space></div><Table size="small" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" summary={summary} columns={columns} dataSource={visibleRecords} sticky={{ offsetHeader: 64 }} pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 2030 }} locale={{ emptyText: 'Xatlov yozuvlari topilmadi' }} /></Card>
  </Space>
  <Modal title={editor?.record ? 'Xatlov yozuvini tahrirlash' : 'Xatlov yozuvini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save} onValuesChange={(changed: Partial<Values>) => { if (editor && !editor.record && changed.recordDate) void prefill(editor.districtId, changed.recordDate) }}>
      <Form.Item label="Sana" name="recordDate" rules={[{ required: true, message: 'Sanani tanlang' }]}><DatePicker className="w-full" /></Form.Item>
      {(['completedMfyCount', 'censusCount', 'completedObjectCount', 'migrationCount'] as const).map((name) => <Form.Item key={name} label={{ completedMfyCount: 'Tugallangan MFY soni', censusCount: 'Xatlov soni', completedObjectCount: 'Xatlov yakunlangan obyekt', migrationCount: 'Migratsiya soni' }[name]} name={name} rules={[{ required: true }]}><InputNumber min={name === 'censusCount' ? undefined : 0} precision={0} className="w-full" /></Form.Item>)}
      <Form.Item label="To‘lov bo‘yicha qarzdorlik (mln so‘m)" name="paymentDebt"><InputNumber min={0} precision={2} className="w-full" /></Form.Item>
      <Form.Item label="Tugallangan MFY nomlari (har qatorda bittadan)" name="completedMfyNames"><Input.TextArea rows={3} /></Form.Item>
    </Form>
  </Modal>
  </div>

  return <Tabs items={[
    { key: 'districts', label: 'Tumanlar bo‘yicha', children: districtTab },
    { key: 'employees', label: 'Xodimlar kesimida', children: <XatlovEmployeesTab token={token} user={user} /> },
  ]} />
}

export default XatlovPage
