import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Card, DatePicker, Empty, Progress, Select, Space, Statistic, Typography } from 'antd'
import { AlertOutlined, BarChartOutlined, CheckCircleOutlined, FileSearchOutlined, SwapOutlined } from '@ant-design/icons'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type User = { id: string; username: string; fullName: string; role: Role }
type DistrictOption = { id: string; name: string; regionId: string; region: { id: string; name: string } }
type DashboardData = {
  filters: { from: string | null; to: string | null; radMonth: number; radYear: number }
  regions: { id: string; name: string }[]
  districts: DistrictOption[]
  geography: { regionCount: number; districtCount: number }
  xatlov: { districtCount: number; completedMfyCount: number; censusCount: number; migrationCount: number }
  mkd: { totalBuildings: number; completedBuildings: number; remainingBuildings: number; plannedBuildings: number; completedAgainstPlan: number; remainingPlan: number }
  rad: { month: number; year: number; monthlyLimit: number; rejectedApplications: number; remainingLimit: number }
  overdue: { total: number; stages: { stage: string; count: number }[] }
}

const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const stageLabels: Record<string, string> = { '1-3': '1–3 kun', '4-7': '4–7 kun', '8-14': '8–14 kun', '15-30': '15–30 kun', '31-90': '31–90 kun', '90+': '90+ kun' }

function DashboardPage({ token }: { token: string; user: User }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ regionId: undefined as string | undefined, districtId: undefined as string | undefined, from: undefined as string | undefined, to: undefined as string | undefined })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.regionId) params.set('regionId', filters.regionId)
      if (filters.districtId) params.set('districtId', filters.districtId)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      const response = await fetch(`/api/dashboard?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Dashboard ma’lumotlarini yuklab bo‘lmadi')
      setData(result as DashboardData)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dashboard ma’lumotlarini yuklab bo‘lmadi')
    } finally { setLoading(false) }
  }, [filters, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const filterDistricts = useMemo(() => (data?.districts ?? []).filter((district) => !filters.regionId || district.regionId === filters.regionId), [data?.districts, filters.regionId])

  const percent = (part: number, total: number) => (total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0)
  const overdueTotal = data?.overdue.total ?? 0

  return <div><Space direction="vertical" size="large" className="w-full">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><Typography.Title level={3} className="!mb-1">Bosh sahifa</Typography.Title><Typography.Text type="secondary">Asosiy monitoring ko‘rsatkichlari</Typography.Text></div>
      <Space wrap>
        <Select allowClear placeholder="Hudud" className="min-w-48" value={filters.regionId} options={(data?.regions ?? []).map((region) => ({ value: region.id, label: region.name }))} onChange={(regionId) => setFilters((old) => ({ ...old, regionId, districtId: undefined }))} />
        <Select allowClear placeholder="Tuman" className="min-w-48" value={filters.districtId} options={filterDistricts.map((district) => ({ value: district.id, label: district.name }))} onChange={(districtId) => setFilters((old) => ({ ...old, districtId }))} />
        <DatePicker.RangePicker onChange={(range) => setFilters((old) => ({ ...old, from: range?.[0]?.format('YYYY-MM-DD'), to: range?.[1]?.format('YYYY-MM-DD') }))} />
      </Space>
    </div>
    {error && <Alert type="error" showIcon message={error} />}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'Tugallangan mahallalar', value: data?.xatlov.completedMfyCount, icon: <CheckCircleOutlined />, tone: 'bg-emerald-50 text-emerald-600' },
        { label: 'Migratsiya soni', value: data?.xatlov.migrationCount, icon: <SwapOutlined />, tone: 'bg-sky-50 text-sky-600' },
        {
          label: 'Rad etilgan arizalar', value: data?.rad.rejectedApplications, icon: <BarChartOutlined />, tone: 'bg-amber-50 text-amber-600',
          suffix: data?.rad.monthlyLimit ? <span className="text-base text-slate-500">({Math.round(data.rad.rejectedApplications / data.rad.monthlyLimit * 100)}%)</span> : undefined,
        },
        { label: 'Muddati o‘tgan arizalar', value: data?.overdue.total, icon: <AlertOutlined />, tone: 'bg-rose-50 text-rose-600' },
      ].map((item) => <Card key={item.label} loading={loading}>
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${item.tone}`}>{item.icon}</div>
          <Statistic title={item.label} value={item.value ?? 0} suffix={item.suffix} />
        </div>
      </Card>)}
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card loading={loading} title={<span className="flex items-center gap-2"><FileSearchOutlined className="text-emerald-600" />Xatlov · so‘nggi yozuvlar</span>}>
        <div className="grid grid-cols-2 gap-4">
          <Statistic title="Yozuvi bor tumanlar" value={data?.xatlov.districtCount ?? 0} />
          <Statistic title="Tugallangan MFY" value={data?.xatlov.completedMfyCount ?? 0} />
          <Statistic title="Xatlov soni" value={data?.xatlov.censusCount ?? 0} />
          <Statistic title="Migratsiya" value={data?.xatlov.migrationCount ?? 0} />
        </div>
      </Card>
      <Card loading={loading} title={<span className="flex items-center gap-2"><BarChartOutlined className="text-amber-600" />RAD · {data ? `${monthNames[data.rad.month - 1]} ${data.rad.year}` : 'joriy oy'}</span>}>
        <div className="grid grid-cols-3 gap-4">
          <Statistic title="Oylik limit" value={data?.rad.monthlyLimit ?? 0} />
          <Statistic title="Rad etilgan" value={data?.rad.rejectedApplications ?? 0} />
          <Statistic title="Qolgan limit" value={data?.rad.remainingLimit ?? 0} />
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-sm"><Typography.Text type="secondary">Limitdan foydalanish</Typography.Text><Typography.Text>{data?.rad.rejectedApplications ?? 0} / {data?.rad.monthlyLimit ?? 0}</Typography.Text></div>
          <Progress percent={percent(data?.rad.rejectedApplications ?? 0, data?.rad.monthlyLimit ?? 0)} strokeColor="#d97706" />
          <Typography.Text type="secondary" className="text-xs">RAD ko‘rsatkichlari joriy oy bo‘yicha hisoblanadi.</Typography.Text>
        </div>
      </Card>
    </div>
    <Card loading={loading} title={<span className="flex items-center gap-2"><AlertOutlined className="text-rose-600" />Muddati o‘tgan arizalar · {overdueTotal}</span>}>
      {data?.overdue.stages.length ? <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
        {data.overdue.stages.map((item) => <div key={item.stage}>
          <div className="flex justify-between text-sm"><Typography.Text>{stageLabels[item.stage] ?? item.stage}</Typography.Text><Typography.Text strong>{item.count}</Typography.Text></div>
          <Progress percent={percent(item.count, overdueTotal)} showInfo={false} strokeColor="#e11d48" />
        </div>)}
      </div> : <Empty description="Ma’lumot yo‘q" />}
    </Card>
    <Typography.Text type="secondary" className="text-xs">Xatlovda tanlangan davrdagi har bir tuman uchun eng so‘nggi yozuv ko‘rsatiladi. RAD joriy oy va yil bo‘yicha.</Typography.Text>
  </Space></div>
}

export default DashboardPage
