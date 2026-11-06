import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { apiFetch } from './api'
import { exportExcel, type ExportHeader } from './excel-export'
import { exportPdf } from './pdf-export'
import PaymentAmountField from './PaymentAmountField'
import PaymentApplicationsTab from './PaymentApplicationsTab'
import { formatAmount, formatSom, savePayment, toMln, toSom, type PaymentRecord } from './payments'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD' | 'PAYMENT_SPECIALIST'
type User = { id: string; username: string; fullName: string; role: Role }
type Totals = { count: number; amount: number }
type Periods = { daily: Totals; weekly: Totals; monthly: Totals }
type District = { id: string; name: string; regionId: string; region: { id: string; name: string } }
type Specialist = Periods & { id: string; fullName: string; phone: string | null; position: string | null; district: District | null }
type DistrictTotal = Periods & District & { specialistCount: number; paymentDebt: number | null }
type ApiData = { districts: District[]; specialists: Specialist[]; districtTotals: DistrictTotal[]; plan: { baseDate: string; deadline: string; workDays: number }; canEdit: boolean }
type Values = { applicationNumber: string; amount: number }

// The three specialists with the smallest weekly sum are shown in red.
const lowestCount = 3
const sumPeriods = (rows: Periods[]): Periods => {
  const add = (key: keyof Periods) => ({ count: rows.reduce((sum, row) => sum + row[key].count, 0), amount: rows.reduce((sum, row) => sum + row[key].amount, 0) })
  return { daily: add('daily'), weekly: add('weekly'), monthly: add('monthly') }
}
const periodHeaders: ExportHeader[] = (['Kunlik', 'Haftalik (Du–Ya)', 'Oy boshidan'] as const).map((title) => ({ title, children: ['Ariza soni', 'Summa (mln so‘m)'] }))
const periodValues = (row: Periods) => [row.daily.count, Number(row.daily.amount.toFixed(3)), row.weekly.count, Number(row.weekly.amount.toFixed(3)), row.monthly.count, Number(row.monthly.amount.toFixed(3))]

// Debt to collect each working day so that it is finished by the deadline.
const dailyPlan = (debt: number | null, workDays?: number) => debt !== null && workDays ? debt / workDays : null
const amountOrDash = (value: number | null) => value === null ? '—' : formatAmount(value)
// Share of the daily plan collected on the selected day.
const percentOf = (collected: number, plan: number | null) => plan ? Math.round((collected / plan) * 1000) / 10 : null
const percentCell = (value: number | null) => value === null ? '—' : <span className={value < 100 ? 'font-semibold text-red-600' : 'text-green-700'}>{value.toLocaleString('ru-RU')}%</span>

function periodColumns<T extends Periods>(highlight?: (row: T) => boolean): ColumnsType<T> {
  return ([['daily', 'Kunlik'], ['weekly', 'Haftalik (Du–Ya)'], ['monthly', 'Oy boshidan']] as const).map(([key, title]) => ({
    title, children: [
      { title: 'Ariza soni', key: `${key}Count`, width: 85, align: 'center' as const, render: (_: unknown, row: T) => row[key].count.toLocaleString('ru-RU') },
      {
        title: <span className="leading-tight">Summa<br />(mln so‘m)</span>, key: `${key}Amount`, width: 105, align: 'right' as const,
        onCell: (row: T) => key === 'weekly' && highlight?.(row) ? { className: '!bg-red-50 font-semibold text-red-600' } : {},
        render: (_: unknown, row: T) => formatAmount(row[key].amount),
      },
    ],
  }))
}

function summaryCells(totals: Periods, from: number) {
  return (['daily', 'weekly', 'monthly'] as const).flatMap((key, index) => [
    <Table.Summary.Cell key={`${key}c`} index={from + index * 2} align="center">{totals[key].count.toLocaleString('ru-RU')}</Table.Summary.Cell>,
    <Table.Summary.Cell key={`${key}a`} index={from + index * 2 + 1} align="right">{formatAmount(totals[key].amount)}</Table.Summary.Cell>,
  ])
}

function PaymentsPage({ token, user }: { token: string; user: User }) {
  const client = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('specialists')
  const [details, setDetails] = useState<Specialist | null>(null)
  const [editing, setEditing] = useState<PaymentRecord | null>(null)
  const [saving, setSaving] = useState(false)
  const [editForm] = Form.useForm<Values>()
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, date: dayjs().subtract(1, 'day') })
  const dateText = filters.date.format('YYYY-MM-DD')
  const query = useQuery({
    queryKey: ['payments', token, dateText, filters.regionId, filters.districtId],
    queryFn: () => {
      const params = new URLSearchParams({ date: dateText })
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      return apiFetch<ApiData>(token, `/api/payments?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const recordsQuery = useQuery({
    queryKey: ['payments-records', token, details?.id, dateText],
    queryFn: () => apiFetch<{ records: PaymentRecord[] }>(token, `/api/payments/specialists/${details!.id}/records?date=${dateText}`),
    enabled: !!details,
  })
  const data = query.data
  const shownError = error ?? query.error?.message ?? recordsQuery.error?.message ?? null

  const districts = useMemo(() => data?.districts ?? [], [data?.districts])
  const regions = useMemo(() => [...new Map(districts.map((item) => [item.region.id, item.region])).values()], [districts])
  // A user who sees a single region has it selected by default, as on the Xatlov page.
  const regionId = filters.regionId ?? (user.role !== 'ADMIN' && regions.length === 1 ? regions[0].id : undefined)
  const filterDistricts = districts.filter((item) => !regionId || item.regionId === regionId)
  const term = search.trim().toLocaleLowerCase()
  const specialists = (data?.specialists ?? []).filter((row) => JSON.stringify([row.fullName, row.phone, row.position, row.district?.name, row.district?.region.name]).toLocaleLowerCase().includes(term))
  const districtTotals = (data?.districtTotals ?? []).filter((row) => JSON.stringify([row.name, row.region.name]).toLocaleLowerCase().includes(term))
  const specialistTotals = sumPeriods(specialists)
  const districtSum = sumPeriods(districtTotals)
  const workDays = data?.plan.workDays
  const deadlineText = data ? dayjs(data.plan.deadline).format('DD.MM.YYYY') : ''
  const baseDateText = data ? dayjs(data.plan.baseDate).format('DD.MM.YYYY') : ''
  const debtSum = districtTotals.reduce((sum, row) => sum + (row.paymentDebt ?? 0), 0)
  const planSum = dailyPlan(debtSum, workDays)
  // Weekly plan = daily plan × 5 working days.
  const weeklyPlan = (debt: number | null) => { const plan = dailyPlan(debt, workDays); return plan === null ? null : plan * 5 }
  const round = (value: number | null) => value === null ? null : Number(value.toFixed(3))
  // Plan, collected sum and percent for the day and for the week.
  const planValues = (debt: number | null, row: Periods) => [
    round(dailyPlan(debt, workDays)), round(row.daily.amount), percentOf(row.daily.amount, dailyPlan(debt, workDays)),
    round(weeklyPlan(debt)), round(row.weekly.amount), percentOf(row.weekly.amount, weeklyPlan(debt)),
  ]
  const lowest = new Set([...specialists].sort((a, b) => a.weekly.amount - b.weekly.amount).slice(0, lowestCount).map((row) => row.id))

  async function run(action: () => Promise<boolean | void>, after?: () => void) {
    setError(null)
    setSaving(true)
    try {
      if ((await action()) !== false) after?.()
      await Promise.all([client.invalidateQueries({ queryKey: ['payments'] }), client.invalidateQueries({ queryKey: ['payments-records'] }), client.invalidateQueries({ queryKey: ['payment-applications'] })])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlab bo‘lmadi') }
    finally { setSaving(false) }
  }

  function exportTable(format: 'excel' | 'pdf') {
    const place = districts.find((item) => item.id === filters.districtId)?.name ?? regions.find((item) => item.id === regionId)?.name ?? 'Respublika'
    const bySpecialists = tab === 'specialists'
    const subject = { specialists: 'to‘lov undirish mutaxassislari kesimida to‘lov undirish ishlari', districts: 'tumanlar kesimida to‘lov undirish ishlari', plan: `to‘lov bo‘yicha qarzdorlikni ${deadlineText} gacha tugatish rejasi` }[tab]
    const title = {
      lines: [`${place} bo‘yicha ${subject} to‘g‘risida`, 'MA’LUMOT'],
      note: `${filters.date.format('DD.MM.YYYY')} y. soat ${dayjs().format('HH:mm')}`,
    }
    const headers: ExportHeader[] = bySpecialists ? ['Hudud', 'Tuman', 'F.I.Sh.', 'Lavozimi', 'Telefon', ...periodHeaders] : tab === 'plan' ? ['Hudud', 'Tuman', 'Arizalar qarzi (mln so‘m)', `${baseDateText}–${deadlineText} ish kunlari`, ...(['Kunlik', 'Haftalik (Du–Ya)'].map((title) => ({ title, children: ['Reja (mln so‘m)', 'Undirilgan (mln so‘m)', 'Bajarilishi (%)'] })))] : ['Hudud', 'Tuman', 'Mutaxassislar', ...periodHeaders]
    const rows = bySpecialists
      ? [['Jami', '', `${specialists.length} ta mutaxassis`, '', '', ...periodValues(specialistTotals)],
        ...specialists.map((row) => [row.district?.region.name, row.district?.name, row.fullName, row.position, row.phone, ...periodValues(row)])]
      : tab === 'plan'
        ? [['Jami', `${districtTotals.length} ta tuman`, round(debtSum), workDays ?? null, ...planValues(debtSum, districtSum)],
          ...districtTotals.map((row) => [row.region.name, row.name, row.paymentDebt, workDays ?? null, ...planValues(row.paymentDebt, row)])]
        : [['Jami', `${districtTotals.length} ta tuman`, districtTotals.reduce((sum, row) => sum + row.specialistCount, 0), ...periodValues(districtSum)],
          ...districtTotals.map((row) => [row.region.name, row.name, row.specialistCount, ...periodValues(row)])]
    const options = { title, totalRows: 1, highlight: (row: number, column: number) => bySpecialists && column === 8 && row > 0 && lowest.has(specialists[row - 1].id) }
    const filename = `tolov-undirish${tab === 'plan' ? '-reja' : ''}-${dateText}`
    if (format === 'pdf') {
      setError(null)
      setPdfLoading(true)
      exportPdf(filename, headers, rows, options).catch(() => setError('PDF faylni yaratib bo‘lmadi')).finally(() => setPdfLoading(false))
    } else void exportExcel(`${filename}.xlsx`, headers, rows, options)
  }

  const specialistColumns: ColumnsType<Specialist> = [
    { title: 'Mutaxassis', key: 'specialist', width: 230, fixed: 'left', render: (_, row) => <div className="truncate leading-tight" title={row.fullName}><span className="font-medium">{row.fullName}</span><div className="text-xs text-slate-500">{[row.position, row.phone].filter(Boolean).join(' · ') || '—'}</div></div> },
    { title: 'Tuman', key: 'district', width: 170, render: (_, row) => <div className="truncate leading-tight">{row.district?.name ?? '—'}<div className="text-xs text-slate-500">{row.district?.region.name}</div></div> },
    ...periodColumns<Specialist>((row) => lowest.has(row.id)),
    { title: 'Amallar', key: 'actions', width: 100, fixed: 'right', align: 'center', render: (_, row) => <Button size="small" onClick={() => setDetails(row)}>Arizalar</Button> },
  ]
  const districtColumns: ColumnsType<DistrictTotal> = [
    { title: 'Tuman', key: 'district', width: 180, fixed: 'left', render: (_, row) => <div className="truncate leading-tight"><span className="font-medium">{row.name}</span><div className="text-xs text-slate-500">{row.region.name}</div></div> },
    { title: 'Mutaxassislar', dataIndex: 'specialistCount', width: 100, align: 'center' },
    ...periodColumns<DistrictTotal>(),
  ]
  const planColumns: ColumnsType<DistrictTotal> = [
    { title: 'Tuman', key: 'district', width: 180, render: (_, row) => <div className="truncate leading-tight"><span className="font-medium">{row.name}</span><div className="text-xs text-slate-500">{row.region.name}</div></div> },
    {
      title: <span className="leading-tight">Arizalar qarzi<br />(mln so‘m)</span>, key: 'paymentDebt', width: 120, align: 'right', render: (_, row) => amountOrDash(row.paymentDebt),
    },
    { title: <span className="leading-tight">{deadlineText} gacha<br />ish kunlari</span>, key: 'workDays', width: 120, align: 'center', render: () => workDays ?? '—' },
    ...([['daily', 'Kunlik'], ['weekly', 'Haftalik (Du–Ya)']] as const).map(([key, title]) => {
      const plan = (row: DistrictTotal) => key === 'daily' ? dailyPlan(row.paymentDebt, workDays) : weeklyPlan(row.paymentDebt)
      return {
        title, children: [
          { title: <span className="leading-tight">Reja<br />(mln so‘m)</span>, key: `${key}Plan`, width: 110, align: 'right' as const, render: (_: unknown, row: DistrictTotal) => amountOrDash(plan(row)) },
          { title: <span className="leading-tight">Undirilgan<br />(mln so‘m)</span>, key: `${key}Collected`, width: 110, align: 'right' as const, render: (_: unknown, row: DistrictTotal) => formatAmount(row[key].amount) },
          { title: <span className="leading-tight">Bajarilishi<br />(%)</span>, key: `${key}Percent`, width: 90, align: 'center' as const, render: (_: unknown, row: DistrictTotal) => percentCell(percentOf(row[key].amount, plan(row))) },
        ],
      }
    }),
  ]
  const recordColumns: ColumnsType<PaymentRecord> = [
    { title: '№', key: 'index', width: 50, align: 'center', render: (_, _row, index) => index + 1 },
    { title: 'Ariza raqami', dataIndex: 'applicationNumber' },
    { title: 'Miqdor (so‘m)', dataIndex: 'amount', align: 'right', render: formatSom },
    { title: 'Kiritilgan vaqt', dataIndex: 'createdAt', width: 140, align: 'center', render: (value: string) => dayjs(value).format('DD.MM.YYYY HH:mm') },
    ...(data?.canEdit ? [{ title: 'Amallar', key: 'actions', width: 190, align: 'center' as const, render: (_: unknown, record: PaymentRecord) => <Space>
      <Button size="small" onClick={() => { setEditing(record); editForm.setFieldsValue({ applicationNumber: record.applicationNumber, amount: toSom(record.amount) }) }}>Tahrirlash</Button>
      <Popconfirm title="To‘lovni o‘chirasizmi?" okText="Ha" cancelText="Yo‘q" onConfirm={() => run(() => apiFetch(token, `/api/payments/records/${record.id}`, { method: 'DELETE' }))}><Button size="small" danger>O‘chirish</Button></Popconfirm>
    </Space> }] : []),
  ]

  const toolbar = <div className="mb-4 flex flex-wrap justify-between gap-3">
    <Input.Search allowClear placeholder="F.I.Sh., tuman yoki telefon bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} />
    <Space><Button onClick={() => exportTable('excel')}>Excel uchun eksport</Button><Button onClick={() => exportTable('pdf')} loading={pdfLoading}>PDF yuklab olish</Button></Space>
  </div>

  return <Space direction="vertical" size="middle" className="w-full">
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <Card size="small"><Space wrap>
      <Select allowClear={regions.length > 1} placeholder="Hudud" className="min-w-52" value={regionId} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => setFilters((old) => ({ ...old, regionId: value, districtId: undefined }))} />
      <Select allowClear placeholder="Tuman" className="min-w-52" value={filters.districtId} options={filterDistricts.map((item) => ({ value: item.id, label: item.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
      <DatePicker allowClear={false} value={filters.date} onChange={(value) => value && setFilters((old) => ({ ...old, date: value }))} />
    </Space></Card>
    <Card loading={query.isPending}>
      <Tabs activeKey={tab} onChange={setTab} items={[
        {
          key: 'specialists', label: 'Mutaxassislar kesimida', children: <>{toolbar}
            <Table size="small" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" columns={specialistColumns} dataSource={specialists}
              pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1690 }} sticky={{ offsetHeader: 64 }} locale={{ emptyText: 'To‘lov undirish mutaxassislari topilmadi' }}
              summary={() => specialists.length ? <Table.Summary fixed="top"><Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
                <Table.Summary.Cell index={0} colSpan={2}>Jami ({specialists.length} ta mutaxassis)</Table.Summary.Cell>
                {summaryCells(specialistTotals, 2)}
                <Table.Summary.Cell index={8} />
              </Table.Summary.Row></Table.Summary> : null} /></>,
        },
        {
          key: 'districts', label: 'Tumanlar bo‘yicha', children: <>{toolbar}
            <Table size="small" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" columns={districtColumns} dataSource={districtTotals}
              pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 850 }} sticky={{ offsetHeader: 64 }} locale={{ emptyText: 'Ma’lumot topilmadi' }}
              summary={() => districtTotals.length ? <Table.Summary fixed="top"><Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
                <Table.Summary.Cell index={0}>Jami ({districtTotals.length} ta tuman)</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center">{districtTotals.reduce((sum, row) => sum + row.specialistCount, 0)}</Table.Summary.Cell>
                {summaryCells(districtSum, 2)}
              </Table.Summary.Row></Table.Summary> : null} /></>,
        },
        {
          key: 'plan', label: 'Reja', children: <>{toolbar}
            <Table size="small" bordered tableLayout="fixed" className="max-w-[1060px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" columns={planColumns} dataSource={districtTotals}
              pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1040 }} sticky={{ offsetHeader: 64 }} locale={{ emptyText: 'Ma’lumot topilmadi' }}
              summary={() => districtTotals.length ? <Table.Summary fixed="top"><Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
                <Table.Summary.Cell index={0}>Jami ({districtTotals.length} ta tuman)</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{formatAmount(debtSum)}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center">{workDays ?? '—'}</Table.Summary.Cell>
                {([['daily', planSum], ['weekly', weeklyPlan(debtSum)]] as const).flatMap(([key, plan], index) => [
                  <Table.Summary.Cell key={`${key}p`} index={3 + index * 3} align="right">{amountOrDash(plan)}</Table.Summary.Cell>,
                  <Table.Summary.Cell key={`${key}c`} index={4 + index * 3} align="right">{formatAmount(districtSum[key].amount)}</Table.Summary.Cell>,
                  <Table.Summary.Cell key={`${key}r`} index={5 + index * 3} align="center">{percentCell(percentOf(districtSum[key].amount, plan))}</Table.Summary.Cell>,
                ])}
              </Table.Summary.Row></Table.Summary> : null} /></>,
        },
        { key: 'applications', label: 'Arizalar', children: <PaymentApplicationsTab token={token} regionId={regionId} districtId={filters.districtId} /> },
      ]} />
    </Card>
    <Modal title={details ? `${details.fullName} · ${filters.date.format('DD.MM.YYYY')}` : ''} open={!!details} onCancel={() => setDetails(null)} footer={null} width={760} destroyOnHidden>
      <Table size="small" rowKey="id" loading={recordsQuery.isPending} columns={recordColumns} dataSource={recordsQuery.data?.records ?? []} pagination={false} locale={{ emptyText: 'Bu kunga to‘lov kiritilmagan' }} />
    </Modal>
    <Modal title="To‘lovni tahrirlash" open={!!editing} onCancel={() => setEditing(null)} onOk={() => editForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={editForm} layout="vertical" onFinish={(values) => editing && run(
        () => savePayment(token, `/api/payments/records/${editing.id}`, 'PATCH', { ...values, amount: toMln(values.amount), recordDate: editing.recordDate.slice(0, 10) }),
        () => setEditing(null),
      )}>
        <Form.Item label="Ariza raqami" name="applicationNumber" rules={[{ required: true, whitespace: true, message: 'Ariza raqamini kiriting' }]}><Input maxLength={50} /></Form.Item>
        <PaymentAmountField className="!w-full" />
      </Form>
    </Modal>
  </Space>
}

export default PaymentsPage
