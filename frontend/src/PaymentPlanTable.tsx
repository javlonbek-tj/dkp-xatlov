import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { dailyPlan, formatAmount, percentOf, weeklyPlan } from './payments'

// A district's plan row: applications' debt and what the district collected, in million so'm.
export type PlanRow = { id: string; name: string; region: { name: string }; paymentDebt: number | null; daily: { amount: number }; weekly: { amount: number } }

const amountOrDash = (value: number | null) => value === null ? '—' : formatAmount(value)
const percentCell = (value: number | null) => value === null ? '—' : <span className={value < 100 ? 'font-semibold text-red-600' : 'text-green-700'}>{value.toLocaleString('ru-RU')}%</span>

// Daily and weekly plan, collected sum and completion percent of each district, with a totals row.
function PaymentPlanTable({ rows, workDays, deadline }: { rows: PlanRow[]; workDays?: number; deadline?: string }) {
  const debtSum = rows.reduce((sum, row) => sum + (row.paymentDebt ?? 0), 0)
  const collected = { daily: rows.reduce((sum, row) => sum + row.daily.amount, 0), weekly: rows.reduce((sum, row) => sum + row.weekly.amount, 0) }
  const plan = (key: 'daily' | 'weekly', debt: number | null) => key === 'daily' ? dailyPlan(debt, workDays) : weeklyPlan(debt, workDays)
  const columns: ColumnsType<PlanRow> = [
    { title: 'Tuman', key: 'district', width: 180, render: (_, row) => <div className="truncate leading-tight"><span className="font-medium">{row.name}</span><div className="text-xs text-slate-500">{row.region.name}</div></div> },
    { title: <span className="leading-tight">Arizalar qarzi<br />(mln so‘m)</span>, key: 'paymentDebt', width: 120, align: 'right', render: (_, row) => amountOrDash(row.paymentDebt) },
    { title: <span className="leading-tight">{deadline ? dayjs(deadline).format('DD.MM.YYYY') : ''} gacha<br />ish kunlari</span>, key: 'workDays', width: 120, align: 'center', render: () => workDays ?? '—' },
    ...([['daily', 'Kunlik'], ['weekly', 'Haftalik (Du–Ya)']] as const).map(([key, title]) => ({
      title, children: [
        { title: <span className="leading-tight">Reja<br />(mln so‘m)</span>, key: `${key}Plan`, width: 110, align: 'right' as const, render: (_: unknown, row: PlanRow) => amountOrDash(plan(key, row.paymentDebt)) },
        { title: <span className="leading-tight">Undirilgan<br />(mln so‘m)</span>, key: `${key}Collected`, width: 110, align: 'right' as const, render: (_: unknown, row: PlanRow) => formatAmount(row[key].amount) },
        { title: <span className="leading-tight">Bajarilishi<br />(%)</span>, key: `${key}Percent`, width: 90, align: 'center' as const, render: (_: unknown, row: PlanRow) => percentCell(percentOf(row[key].amount, plan(key, row.paymentDebt))) },
      ],
    })),
  ]
  return <Table size="small" bordered tableLayout="fixed" className="max-w-[1060px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" rowKey="id" columns={columns} dataSource={rows}
    pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100], hideOnSinglePage: true }} scroll={{ x: 1040 }} sticky={{ offsetHeader: 64 }} locale={{ emptyText: 'Ma’lumot topilmadi' }}
    summary={() => rows.length > 1 ? <Table.Summary fixed="top"><Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
      <Table.Summary.Cell index={0}>Jami ({rows.length} ta tuman)</Table.Summary.Cell>
      <Table.Summary.Cell index={1} align="right">{formatAmount(debtSum)}</Table.Summary.Cell>
      <Table.Summary.Cell index={2} align="center">{workDays ?? '—'}</Table.Summary.Cell>
      {(['daily', 'weekly'] as const).flatMap((key, index) => [
        <Table.Summary.Cell key={`${key}p`} index={3 + index * 3} align="right">{amountOrDash(plan(key, debtSum))}</Table.Summary.Cell>,
        <Table.Summary.Cell key={`${key}c`} index={4 + index * 3} align="right">{formatAmount(collected[key])}</Table.Summary.Cell>,
        <Table.Summary.Cell key={`${key}r`} index={5 + index * 3} align="center">{percentCell(percentOf(collected[key], plan(key, debtSum)))}</Table.Summary.Cell>,
      ])}
    </Table.Summary.Row></Table.Summary> : null} />
}

export default PaymentPlanTable
