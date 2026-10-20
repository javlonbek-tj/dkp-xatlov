import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import { Alert, Button, Card, Input, Select, Space, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { employeeText, exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD'
type User = { id: string; username: string; fullName: string; role: Role }
type Assignment = { id: string; user: { fullName: string; phone: string | null } }
type Region = { id: string; name: string; groupLeaderAssignmentId: string | null }
type District = {
  id: string
  name: string
  regionId: string
  republicEmployeeAssignment: Assignment | null
  regionalEmployeeAssignment: Assignment | null
}
type Row = {
  id: string
  district: District
  region: Region
  republic?: Assignment
  regional?: Assignment
}
type Status = 'complete' | 'missingRepublic' | 'missingRegional'

function AssignmentsPage({ token }: { token: string; user: User }) {
  const [search, setSearch] = useState('')
  const [regionId, setRegionId] = useState<string>()
  const [districtId, setDistrictId] = useState<string>()
  const [status, setStatus] = useState<Status>()
  const assignmentsQuery = useQuery({
    queryKey: ['assignments', token],
    queryFn: () => apiFetch<{ regions: Region[]; districts: District[] }>(token, '/api/assignments'),
  })
  const regions = useMemo(() => assignmentsQuery.data?.regions ?? [], [assignmentsQuery.data])
  const districts = useMemo(() => assignmentsQuery.data?.districts ?? [], [assignmentsQuery.data])
  const error = assignmentsQuery.error?.message ?? null
  const loading = assignmentsQuery.isPending

  // One row per district with its Republic and regional representatives.
  const rows = useMemo(() => {
    const regionById = new Map(regions.map((region) => [region.id, region]))
    return districts.flatMap((district): Row[] => {
      const region = regionById.get(district.regionId)
      if (!region) return []
      return [{
        id: district.id,
        district,
        region,
        republic: district.republicEmployeeAssignment ?? undefined,
        regional: district.regionalEmployeeAssignment ?? undefined,
      }]
    }).sort((a, b) => a.region.name.localeCompare(b.region.name) || a.district.name.localeCompare(b.district.name))
  }, [districts, regions])

  const query = search.trim().toLocaleLowerCase()
  const visibleRows = rows.filter((row) =>
    (!query || [row.district.name, row.republic?.user.fullName, row.regional?.user.fullName].join(' ').toLocaleLowerCase().includes(query))
    && (!regionId || row.region.id === regionId)
    && (!districtId || row.district.id === districtId)
    && (!status
      || (status === 'complete' && row.republic && row.regional)
      || (status === 'missingRepublic' && !row.republic)
      || (status === 'missingRegional' && !row.regional)),
  )

  function employeeCell(row: Row, assignment?: Assignment) {
    if (!assignment) return <span className="text-amber-600">Biriktirilmagan</span>
    return <div className="leading-tight">
      <div className="flex items-center gap-2">
        <span className="truncate" title={assignment.user.fullName}>{assignment.user.fullName}</span>
        {row.region.groupLeaderAssignmentId === assignment.id && <Tag color="gold" className="!m-0">Guruh rahbari</Tag>}
      </div>
      {assignment.user.phone && <div className="text-xs text-slate-500">{assignment.user.phone}</div>}
    </div>
  }

  const columns: ColumnsType<Row> = [
    { title: 'Viloyat', key: 'region', width: 180, sorter: (a, b) => a.region.name.localeCompare(b.region.name), render: (_, row) => row.region.name },
    {
      title: 'Tuman', key: 'district', width: 200,
      sorter: (a, b) => a.district.name.localeCompare(b.district.name),
      render: (_, row) => <span className="font-medium">{row.district.name}</span>,
    },
    {
      title: 'Respublika vakili', key: 'republic', width: 280,
      sorter: (a, b) => (a.republic?.user.fullName ?? '').localeCompare(b.republic?.user.fullName ?? ''),
      render: (_, row) => employeeCell(row, row.republic),
    },
    {
      title: 'Viloyat vakili', key: 'regional', width: 280,
      sorter: (a, b) => (a.regional?.user.fullName ?? '').localeCompare(b.regional?.user.fullName ?? ''),
      render: (_, row) => employeeCell(row, row.regional),
    },
  ]

  return (
    <Space direction="vertical" size="middle" className="w-full">
      {error && <Alert type="error" showIcon message={error} />}

      <Card loading={loading}>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input.Search allowClear className="!w-64" placeholder="Tuman yoki vakil bo‘yicha qidirish" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className="w-56"
            placeholder="Viloyat"
            value={regionId}
            onChange={(value) => { setRegionId(value); setDistrictId(undefined) }}
            options={regions.map((region) => ({ value: region.id, label: region.name }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className="w-56"
            placeholder="Tuman"
            value={districtId}
            onChange={setDistrictId}
            options={districts
              .filter((district) => !regionId || district.regionId === regionId)
              .map((district) => ({ value: district.id, label: district.name }))}
          />
          <Select
            allowClear
            className="w-64"
            placeholder="Biriktirilish holati"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'complete', label: 'Ikkala vakil biriktirilgan' },
              { value: 'missingRepublic', label: 'Respublika vakili yo‘q' },
              { value: 'missingRegional', label: 'Viloyat vakili yo‘q' },
            ]}
          />
          <Button className="ml-auto" onClick={() => void exportExcel('tayinlangan-xodimlar.xlsx',
            ['Viloyat', 'Tuman', 'Respublika vakili', 'Viloyat vakili'],
            visibleRows.map((row) => [row.region.name, row.district.name, employeeText(row.republic?.user), employeeText(row.regional?.user)]))}>
            Excel uchun eksport
          </Button>
        </div>
        <Table
          size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
          rowKey="id" columns={columns} dataSource={visibleRows} sticky={{ offsetHeader: 64 }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
          scroll={{ x: 940 }}
          locale={{ emptyText: 'Tumanlar topilmadi' }}
        />
      </Card>
    </Space>
  )
}

export default AssignmentsPage
