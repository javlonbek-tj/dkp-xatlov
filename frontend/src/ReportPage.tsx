import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { employeeText, exportExcel, type ExportHeader } from './excel-export'
import { exportPdf } from './pdf-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD'
type User = { id: string; username: string; fullName: string; role: Role }
type Employee = { fullName: string; phone: string | null } | null
type ReportRow = {
  id: string
  name: string
  republicEmployee: Employee
  regionalEmployee: Employee
  engineerCount: number | null
  xatlovEmployeeCount: number | null
  objectCount: number | null
  mfyCount: number | null
  xatlov: { recordDate: string; completedMfyCount: number; censusCount: number; completedObjectCount: number | null; migrationCount: number; paymentDebt: number | null } | null
  weeklyMigrationCount: number | null
  weeklyDays: number
  rad: { monthlyLimit: number; rejectedApplications: number } | null
  overdue15to30: number
  overdueOver30: number
  // In-progress MKD count by year.
  mkdInProgress: Record<string, number>
}
type ReportData = {
  date: string
  mkdYears: number[]
  regions: { id: string; name: string }[]
  region: { id: string; name: string; groupLeader: string | null } | null
  rows: ReportRow[]
}
type Line = {
  key: string
  index: number | null
  name: string
  republic: Employee
  regional: Employee
  leader?: string | null
  engineerCount: number | null
  xatlovEmployeeCount: number | null
  objectCount: number | null
  mfyCount: number | null
  completedMfyCount: number | null
  censusCount: number | null
  dailyCompletedObjects: number | null
  weeklyMigration: number | null
  employeeDays: number | null
  migrationPerEmployeeDay: number | null
  radPlan: number | null
  radActual: number | null
  radPercent: number | null
  radRemainder: number | null
  overdue15to30: number
  overdueOver30: number
  mkdTotal: number | null
  mkdByYear: Record<string, number>
  paymentDebt: number | null
}

const months = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const summedFields = [
  'engineerCount', 'xatlovEmployeeCount', 'objectCount', 'mfyCount', 'completedMfyCount', 'censusCount',
  'dailyCompletedObjects', 'weeklyMigration', 'employeeDays', 'radPlan', 'radActual', 'overdue15to30', 'overdueOver30', 'mkdTotal', 'paymentDebt',
] as const

// Migration per Xatlov employee per worked day of the week.
function perEmployeeDay(migration: number | null, employeeDays: number | null) {
  return migration === null || !employeeDays ? null : Math.round((migration / employeeDays) * 100) / 100
}

function percent(actual: number | null, plan: number | null) {
  return actual === null || !plan ? null : Math.round((actual / plan) * 100)
}

function toLine(row: ReportRow, index: number): Line {
  const radPlan = row.rad?.monthlyLimit ?? null
  const radActual = row.rad?.rejectedApplications ?? null
  return {
    key: row.id,
    index: index + 1,
    name: row.name,
    republic: row.republicEmployee,
    regional: row.regionalEmployee,
    engineerCount: row.engineerCount,
    xatlovEmployeeCount: row.xatlovEmployeeCount,
    objectCount: row.objectCount,
    mfyCount: row.mfyCount,
    completedMfyCount: row.xatlov?.completedMfyCount ?? null,
    censusCount: row.xatlov?.completedObjectCount ?? null,
    dailyCompletedObjects: row.xatlov?.migrationCount ?? null,
    weeklyMigration: row.weeklyMigrationCount,
    employeeDays: row.weeklyDays && row.xatlovEmployeeCount ? row.weeklyDays * row.xatlovEmployeeCount : null,
    migrationPerEmployeeDay: perEmployeeDay(row.weeklyMigrationCount, row.weeklyDays * (row.xatlovEmployeeCount ?? 0)),
    radPlan,
    radActual,
    radPercent: percent(radActual, radPlan),
    radRemainder: radPlan === null || radActual === null ? null : radActual - radPlan,
    overdue15to30: row.overdue15to30,
    overdueOver30: row.overdueOver30,
    mkdTotal: Object.keys(row.mkdInProgress).length ? Object.values(row.mkdInProgress).reduce((sum, value) => sum + value, 0) : null,
    mkdByYear: row.mkdInProgress,
    paymentDebt: row.xatlov?.paymentDebt ?? null,
  }
}

function totalLine(lines: Line[], region: NonNullable<ReportData['region']>): Line {
  const total = { key: 'total', index: null, name: region.name, republic: null, regional: null, leader: region.groupLeader, mkdByYear: {} } as Line
  for (const field of summedFields) {
    const values = lines.map((line) => line[field]).filter((value): value is number => value !== null)
    ;(total[field] as number | null) = values.length ? values.reduce((sum, value) => sum + value, 0) : null
  }
  for (const line of lines) {
    for (const [year, count] of Object.entries(line.mkdByYear)) total.mkdByYear[year] = (total.mkdByYear[year] ?? 0) + count
  }
  total.migrationPerEmployeeDay = perEmployeeDay(total.weeklyMigration, total.employeeDays)
  total.radPercent = percent(total.radActual, total.radPlan)
  total.radRemainder = total.radPlan === null || total.radActual === null ? null : total.radActual - total.radPlan
  return total
}

function formatNumber(value: number | null) {
  return value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function employeeCell(employee: Employee) {
  if (!employee) return '—'
  return <div className="leading-tight">{employee.fullName}{employee.phone && <div className="text-xs text-slate-500">{employee.phone}</div>}</div>
}

function ReportPage({ token }: { token: string; user: User }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [date, setDate] = useState(dayjs())
  const [regionId, setRegionId] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pdfLoading, setPdfLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ date: date.format('YYYY-MM-DD') })
      if (regionId) params.set('regionId', regionId)
      const response = await fetch(`/api/report?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Hisobotni yuklab bo‘lmadi')
      setData(result as ReportData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hisobotni yuklab bo‘lmadi')
    } finally {
      setLoading(false)
    }
  }, [date, regionId, token])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const districtLines = (data?.rows ?? []).map(toLine)
  const lines = data?.region ? [totalLine(districtLines, data.region), ...districtLines] : []
  const monthName = months[date.month()]
  const mkdYears = data?.mkdYears ?? []
  const mkdYearValue = (line: Line, year: number) => line.mkdByYear[year] ?? null
  // The three districts with the highest value of a field (ignoring zero and empty values).
  const topThree = (value: (line: Line) => number | null) => new Set(districtLines
    .filter((line) => (value(line) ?? 0) > 0)
    .sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0))
    .slice(0, 3)
    .map((line) => line.key))
  // A limit of zero with rejected applications counts as the worst usage.
  const worstRad = topThree((line) => line.radPlan ? (line.radActual ?? 0) / line.radPlan : (line.radActual ?? 0) > 0 ? Infinity : null)
  // The three districts with the lowest migration per employee per day (empty values are ignored).
  const worstPerEmployee = new Set(districtLines
    .filter((line) => line.migrationPerEmployeeDay !== null)
    .sort((a, b) => (a.migrationPerEmployeeDay ?? 0) - (b.migrationPerEmployeeDay ?? 0))
    .slice(0, 3)
    .map((line) => line.key))
  const worstOverdue15to30 = topThree((line) => line.overdue15to30)
  const worstOverdueOver30 = topThree((line) => line.overdueOver30)
  const worstMkd = topThree((line) => line.mkdTotal)
  const redCell = (keys: Set<string>) => (line: Line) => keys.has(line.key) ? { className: '!bg-red-50 font-semibold text-red-600' } : {}
  const number = (field: keyof Line, title: string, highlight?: Set<string>) => ({
    title, align: 'center' as const, render: (_: unknown, line: Line) => formatNumber(line[field] as number | null),
    ...(highlight ? { onCell: redCell(highlight) } : {}),
  })

  // Key columns are shown as badges.
  const badge = (field: keyof Line, title: string, color: string) => ({
    title, align: 'center' as const,
    render: (_: unknown, line: Line) => line[field] === null ? '—' : <Tag color={color} className="!m-0 min-w-10 text-center !font-semibold">{formatNumber(line[field] as number)}</Tag>,
  })

  const columns: ColumnsType<Line> = [
    { title: 'T/r', dataIndex: 'index', align: 'center', render: (value: number | null) => value ?? '' },
    { title: 'Hudud nomi', dataIndex: 'name', render: (value: string, line) => line.index === null ? <strong>{value}</strong> : value },
    {
      title: 'Respublika vakili',
      onCell: (line) => ({ colSpan: line.index === null ? 2 : 1 }),
      render: (_, line) => line.index === null
        ? <strong>{line.leader ? `Bosh vakil — ${line.leader}` : 'Bosh vakil belgilanmagan'}</strong>
        : employeeCell(line.republic),
    },
    { title: 'Viloyat vakili', onCell: (line) => ({ colSpan: line.index === null ? 0 : 1 }), render: (_, line) => employeeCell(line.regional) },
    {
      title: 'Xatlov va migratsiya',
      children: [
        number('engineerCount', 'Jami xodimlar soni'),
        { title: 'shundan', children: [number('xatlovEmployeeCount', 'xatlovga biriktirilgan xodimlar soni')] },
        number('objectCount', 'Jami obyektlar soni'),
        number('mfyCount', 'Jami MFY soni'),
        {
          title: 'Yakunlangan MFY soni', align: 'center' as const,
          render: (_: unknown, line: Line) => line.completedMfyCount === null ? '—' : <Tag color="blue" className="!m-0 min-w-10 text-center !font-semibold">{formatNumber(line.completedMfyCount)}</Tag>,
        },
        number('censusCount', 'Xatlov yakunlangan obyekt'),
        { title: 'shundan', children: [badge('dailyCompletedObjects', 'bir kunda', 'blue'), badge('weeklyMigration', 'Du–Ju', 'purple'), number('migrationPerEmployeeDay', '1 xodimga kunlik', worstPerEmployee)] },
      ],
    },
    {
      title: 'Rad etish',
      children: [
        number('radPlan', `${monthName} oyi rejasi`, worstRad),
        number('radActual', 'amalda', worstRad),
        { title: 'farqi', children: [number('radPercent', 'foiz', worstRad), number('radRemainder', 'qoldiq', worstRad)] },
      ],
    },
    {
      title: 'Muddat kechikishi',
      children: [number('overdue15to30', '15-30 kungacha', worstOverdue15to30), number('overdueOver30', '1 oydan ortiq', worstOverdueOver30)],
    },
    {
      title: 'MKD (jarayonda)',
      children: [
        number('mkdTotal', 'Jami', worstMkd),
        ...(mkdYears.length ? [{
          title: 'shundan',
          children: mkdYears.map((year) => ({ title: `${year}-yil`, key: `mkd-${year}`, align: 'center' as const, render: (_: unknown, line: Line) => formatNumber(mkdYearValue(line, year)), onCell: redCell(worstMkd) })),
        }] : []),
      ],
    },
    number('paymentDebt', 'To‘lov bo‘yicha qarzdorlik (mln so‘m)'),
  ]

  // Excel and PDF share the title, columns and highlights.
  function exportReport(format: 'excel' | 'pdf') {
    // Leaf column positions of the red-highlighted cells, matching the table.
    const radColumns = [13, 14, 15, 16]
    const title = {
      lines: [`“Dolzarb 90 kunlik” doirasida ${data?.region?.name ?? ''} boshqarmasi tomonidan amalga oshirilgan ishlar to‘g‘risida`, 'MA’LUMOT'],
      note: `${date.format('DD.MM.YYYY')} y. soat ${dayjs().format('HH:mm')}`,
    }
    const headers: ExportHeader[] = [
      'T/r', 'Hudud nomi',
      'Respublika vakili', 'Viloyat vakili',
      {
        title: 'Xatlov va migratsiya', children: [
          'Jami xodimlar soni',
          { title: 'shundan', children: ['xatlovga biriktirilgan xodimlar soni'] },
          'Jami obyektlar soni', 'Jami MFY soni', 'Yakunlangan MFY soni', 'Xatlov yakunlangan obyekt',
          { title: 'shundan', children: ['bir kunda', 'Du–Ju', '1 xodimga kunlik'] },
        ],
      },
      {
        title: 'Rad etish', children: [
          `${monthName} oyi rejasi`, 'amalda',
          { title: 'farqi', children: ['foiz', 'qoldiq'] },
        ],
      },
      { title: 'Muddat kechikishi', children: ['15-30 kungacha', '1 oydan ortiq'] },
      { title: 'MKD (jarayonda)', children: ['Jami', ...(mkdYears.length ? [{ title: 'shundan', children: mkdYears.map((year) => `${year}-yil`) }] : [])] },
      'To‘lov bo‘yicha qarzdorlik (mln so‘m)',
    ]
    const rows = lines.map((line) => [
      line.index, line.name,
      line.index === null ? `Bosh vakil — ${line.leader ?? ''}` : employeeText(line.republic),
      employeeText(line.regional),
      line.engineerCount, line.xatlovEmployeeCount, line.objectCount, line.mfyCount, line.completedMfyCount,
      line.censusCount, line.dailyCompletedObjects, line.weeklyMigration, line.migrationPerEmployeeDay, line.radPlan, line.radActual, line.radPercent, line.radRemainder,
      line.overdue15to30, line.overdueOver30, line.mkdTotal, ...mkdYears.map((year) => mkdYearValue(line, year)), line.paymentDebt,
    ])
    const options = {
      title,
      totalRows: 1,
      highlight: (row: number, column: number) => {
        const key = lines[row].key
        return (column === 12 && worstPerEmployee.has(key))
          || (radColumns.includes(column) && worstRad.has(key))
          || (column === 17 && worstOverdue15to30.has(key))
          || (column === 18 && worstOverdueOver30.has(key))
          // MKD "Jami" and the year columns.
          || (column >= 19 && column <= 19 + mkdYears.length && worstMkd.has(key))
      },
    }
    const filename = `hisobot-${date.format('YYYY-MM-DD')}`
    if (format === 'pdf') {
      setPdfLoading(true)
      exportPdf(filename, headers, rows, options)
        .catch(() => setError('PDF faylni yaratib bo‘lmadi'))
        .finally(() => setPdfLoading(false))
    }
    else void exportExcel(`${filename}.xlsx`, headers, rows, options)
  }

  return (
    <Space direction="vertical" size="middle" className="w-full">
      {error && <Alert type="error" showIcon message={error} />}

      <Card loading={loading}>
        <div className="mb-4 flex flex-wrap justify-between gap-3">
          <Space wrap>
            <DatePicker allowClear={false} value={date} onChange={(value) => value && setDate(value)} />
            <Select
              className="w-64"
              placeholder="Hudud"
              showSearch
              optionFilterProp="label"
              value={regionId ?? data?.region?.id}
              onChange={setRegionId}
              options={(data?.regions ?? []).map((region) => ({ value: region.id, label: region.name }))}
            />
          </Space>
          <Space>
            <Button onClick={() => exportReport('excel')} disabled={!lines.length}>Excel uchun eksport</Button>
            <Button onClick={() => exportReport('pdf')} disabled={!lines.length} loading={pdfLoading}>PDF yuklab olish</Button>
          </Space>
        </div>
        <Table
          rowKey="key"
          bordered
          size="small"
          columns={columns}
          dataSource={lines}
          pagination={false}
          scroll={{ x: true }}
          rowClassName={(line) => line.index === null ? 'bg-sky-50 font-semibold' : ''}
          locale={{ emptyText: 'Ma’lumot topilmadi' }}
        />
        <Typography.Paragraph type="secondary" className="!mb-0 !mt-3 text-xs">
          Xatlov ustunlari va qarzdorlik tanlangan sanagacha bo‘lgan eng so‘nggi Xatlov yozuvidan olinadi. Rad etish — tanlangan oy uchun RAD limiti.
          Muddat kechikishi va MKD (jarayonda) — tanlangan sanagacha bo‘lgan eng so‘nggi yozuv (MKD har bir yil uchun alohida). Qizil — eng yuqori ko‘rsatkichli uchta tuman.
        </Typography.Paragraph>
      </Card>
    </Space>
  )
}

export default ReportPage
