import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type Employee = { id: string; username: string; fullName: string; phone?: string | null; role: Role }
type RegionAssignment = { id: string; regionId: string; user: Employee }
type Region = {
  id: string
  name: string
  groupLeaderAssignmentId: string | null
  employeeAssignments: RegionAssignment[]
  _count: { districts: number; employeeAssignments: number }
}
type District = {
  id: string
  name: string
  regionId: string
  engineerCount: number | null
  xatlovEmployeeCount: number | null
  objectCount: number | null
  mfyCount: number | null
  region: { id: string; name: string }
  republicEmployeeAssignment: RegionAssignment | null
  regionalEmployeeAssignment: RegionAssignment | null
}
type UserRecord = Employee & { regionAssignments: { id: string; region: { id: string; name: string } }[] }
function employeeCell(user?: { fullName: string; phone?: string | null }) {
  if (!user) return '—'
  return <div className="truncate leading-tight" title={user.fullName}>{user.fullName}{user.phone && <div className="text-xs text-slate-500">{user.phone}</div>}</div>
}

const roleLabels: Record<Role, string> = {
  ADMIN: 'Administrator',
  REPUBLIC_EMPLOYEE: 'Respublika xodimi',
  REGIONAL_EMPLOYEE: 'Hududiy xodim',
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  if (response.status === 204) return undefined as T
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message ?? 'So‘rov bajarilmadi')
  return result as T
}

function AdminPanel({ token, user }: { token: string; user: Employee }) {
  const isAdmin = user.role === 'ADMIN'
  const [users, setUsers] = useState<UserRecord[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [userEditor, setUserEditor] = useState<UserRecord | null | undefined>(undefined)
  const [districtEditor, setDistrictEditor] = useState<District | null | undefined>(undefined)
  const [selectedRegionId, setAssignmentRegionId] = useState<string>()
  const [newEmployeeOpen, setNewEmployeeOpen] = useState(false)
  const [newEmployeeForm] = Form.useForm()
  const [pendingAssignmentUserId, setPendingAssignmentUserId] = useState<string>()
  const [districtDrafts, setDistrictDrafts] = useState<Record<string, string[]>>({})
  const [districtSearch, setDistrictSearch] = useState('')
  const [districtRegionFilter, setDistrictRegionFilter] = useState<string>()
  const [userForm] = Form.useForm()
  const [districtForm] = Form.useForm()
  const districtRegionId = Form.useWatch('regionId', districtForm)
  // A group leader with a single region gets it preselected.
  const assignmentRegionId = selectedRegionId ?? (regions.length === 1 ? regions[0].id : undefined)
  const assignmentRegion = regions.find((region) => region.id === assignmentRegionId)

  const loadData = useCallback(async () => {
    try {
      const [userData, regionData, districtData] = await Promise.all([
        api<{ users: UserRecord[] }>(token, '/users'),
        api<{ regions: Region[] }>(token, '/regions'),
        api<{ districts: District[] }>(token, '/districts'),
      ])
      setUsers(userData.users)
      setRegions(regionData.regions)
      setDistricts(districtData.districts)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ma’lumotlarni yuklab bo‘lmadi')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  async function run(action: () => Promise<unknown>) {
    try {
      setError(null)
      setLoading(true)
      await action()
      await loadData()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Amalni bajarib bo‘lmadi')
      return false
    }
  }

  function openUserEditor(record?: UserRecord) {
    setUserEditor(record ?? null)
    userForm.setFieldsValue(record ? { ...record, password: '' } : { role: 'REPUBLIC_EMPLOYEE' })
  }

  function openDistrictEditor(record?: District) {
    setDistrictEditor(record ?? null)
    districtForm.setFieldsValue(record ? {
      name: record.name,
      regionId: record.regionId,
      engineerCount: record.engineerCount,
      xatlovEmployeeCount: record.xatlovEmployeeCount,
      objectCount: record.objectCount,
      mfyCount: record.mfyCount,
      republicEmployeeAssignmentId: record.republicEmployeeAssignment?.id ?? null,
      regionalEmployeeAssignmentId: record.regionalEmployeeAssignment?.id ?? null,
    } : { engineerCount: null, xatlovEmployeeCount: null, objectCount: null, mfyCount: null })
  }

  const userColumns: ColumnsType<UserRecord> = [
    { title: 'F.I.Sh.', dataIndex: 'fullName' },
    { title: 'Foydalanuvchi nomi', dataIndex: 'username' },
    { title: 'Telefon', dataIndex: 'phone', render: (value: string | null) => value || '—' },
    { title: 'Turi', dataIndex: 'role', render: (role: Role) => roleLabels[role] },
    {
      title: 'Hududlar',
      render: (_, record) => record.regionAssignments.map((assignment) => assignment.region.name).join(', ') || '—',
    },
    {
      title: 'Amallar',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openUserEditor(record)}>Tahrirlash</Button>
          <Popconfirm title="Foydalanuvchini o‘chirasizmi?" onConfirm={() => run(() => api(token, `/users/${record.id}`, { method: 'DELETE' }))}>
            <Button size="small" danger>O‘chirish</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const districtColumns: ColumnsType<District> = [
    {
      title: 'Tuman', key: 'district', width: 190, fixed: 'left',
      render: (_, record) => <div className="truncate leading-tight" title={record.name}><span className="font-medium">{record.name}</span><div className="text-xs text-slate-500">{record.region.name}</div></div>,
    },
    { title: 'Respublika vakili', key: 'republic', width: 190, render: (_, record) => employeeCell(record.republicEmployeeAssignment?.user) },
    { title: 'Viloyat vakili', key: 'regional', width: 190, render: (_, record) => employeeCell(record.regionalEmployeeAssignment?.user) },
    {
      title: 'Xodimlar', children: [
        { title: 'Jami', dataIndex: 'engineerCount', width: 80, align: 'center', render: (value: number | null) => value ?? '—' },
        { title: 'Xatlovda', dataIndex: 'xatlovEmployeeCount', width: 90, align: 'center', render: (value: number | null) => value ?? '—' },
      ],
    },
    {
      title: 'Jami', children: [
        { title: 'Obyektlar', dataIndex: 'objectCount', width: 110, align: 'center', render: (value: number | null) => value?.toLocaleString('ru-RU') ?? '—' },
        { title: 'MFY', dataIndex: 'mfyCount', width: 90, align: 'center', render: (value: number | null) => value ?? '—' },
      ],
    },
    {
      title: 'Amallar', key: 'actions', width: isAdmin ? 200 : 120, fixed: 'right', align: 'center',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openDistrictEditor(record)}>Tahrirlash</Button>
          {isAdmin && (
            <Popconfirm title="Tumanni o‘chirasizmi?" onConfirm={() => run(() => api(token, `/districts/${record.id}`, { method: 'DELETE' }))}>
              <Button size="small" danger>O‘chirish</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const districtRepublicOptions = useMemo(() => {
    const region = regions.find((item) => item.id === districtRegionId)
    return (region?.employeeAssignments ?? [])
      .filter((assignment) => assignment.user.role === 'REPUBLIC_EMPLOYEE')
      .map((assignment) => ({ value: assignment.id, label: assignment.user.fullName }))
  }, [districtRegionId, regions])

  const districtRegionalOptions = useMemo(() => {
    const region = regions.find((item) => item.id === districtRegionId)
    return (region?.employeeAssignments ?? [])
      .filter((assignment) => assignment.user.role === 'REGIONAL_EMPLOYEE')
      .map((assignment) => ({ value: assignment.id, label: assignment.user.fullName }))
  }, [districtRegionId, regions])

  const availableEmployees = (assignmentRegion?.employeeAssignments ?? []).map((item) => item.user.id)
  const availableUsers = users.filter((item) =>
    item.role !== 'ADMIN' && !availableEmployees.includes(item.id),
  )
  const republicEmployees = (assignmentRegion?.employeeAssignments ?? [])
    .filter((item) => item.user.role === 'REPUBLIC_EMPLOYEE')
  const visibleDistricts = districts.filter((item) =>
    (!districtRegionFilter || item.regionId === districtRegionFilter)
    && [item.name, item.region.name, item.republicEmployeeAssignment?.user.fullName, item.regionalEmployeeAssignment?.user.fullName]
      .join(' ').toLocaleLowerCase().includes(districtSearch.trim().toLocaleLowerCase()),
  )
  const assignmentDistricts = districts.filter((item) => item.regionId === assignmentRegionId)

  function districtField(assignment: RegionAssignment) {
    return assignment.user.role === 'REPUBLIC_EMPLOYEE' ? 'republicEmployeeAssignment' : 'regionalEmployeeAssignment'
  }

  function assignedDistrictIds(assignment: RegionAssignment) {
    const field = districtField(assignment)
    return assignmentDistricts.filter((item) => item[field]?.id === assignment.id).map((item) => item.id)
  }

  async function saveAssignmentDistricts(assignment: RegionAssignment) {
    const districtIds = districtDrafts[assignment.id]
    if (!districtIds) return
    const field = districtField(assignment)
    const current = assignedDistrictIds(assignment)
    const changes = [
      ...districtIds.filter((id) => !current.includes(id)).map((id) => ({ id, value: assignment.id })),
      ...current.filter((id) => !districtIds.includes(id)).map((id) => ({ id, value: null })),
    ]
    const success = await run(async () => {
      for (const change of changes) {
        await api(token, `/districts/${change.id}`, {
          method: 'PATCH', body: JSON.stringify({ [`${field}Id`]: change.value }),
        })
      }
    })
    if (success) {
      setDistrictDrafts((drafts) => {
        const next = { ...drafts }
        delete next[assignment.id]
        return next
      })
    }
  }

  const districtsWithoutRepublic = assignmentDistricts.filter((item) => !item.republicEmployeeAssignment)
  const districtsWithoutRegional = assignmentDistricts.filter((item) => !item.regionalEmployeeAssignment)
  // Group leader first, then Republic employees, then regional employees.
  const regionAssignments = [...(assignmentRegion?.employeeAssignments ?? [])].sort((a, b) =>
    Number(b.id === assignmentRegion?.groupLeaderAssignmentId) - Number(a.id === assignmentRegion?.groupLeaderAssignmentId)
    || b.user.role.localeCompare(a.user.role)
    || a.user.fullName.localeCompare(b.user.fullName))

  const assignmentColumns: ColumnsType<RegionAssignment> = [
    {
      title: 'Xodim', key: 'user', width: 240,
      render: (_, assignment) => {
        const phone = users.find((item) => item.id === assignment.user.id)?.phone
        return <div className="leading-tight">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium" title={assignment.user.fullName}>{assignment.user.fullName}</span>
            {assignmentRegion?.groupLeaderAssignmentId === assignment.id && <Tag color="gold" className="!m-0">Guruh rahbari</Tag>}
          </div>
          {phone && <div className="text-xs text-slate-500">{phone}</div>}
        </div>
      },
    },
    {
      title: 'Turi', key: 'role', width: 160, align: 'center',
      render: (_, assignment) => <Tag color={assignment.user.role === 'REPUBLIC_EMPLOYEE' ? 'blue' : 'green'} className="!m-0">{roleLabels[assignment.user.role]}</Tag>,
    },
    {
      title: 'Biriktirilgan tumanlar', key: 'districts',
      render: (_, assignment) => <Select
        mode="multiple"
        aria-label="Tumanlar"
        className="w-full"
        placeholder="Tuman biriktirilmagan"
        optionFilterProp="label"
        value={districtDrafts[assignment.id] ?? assignedDistrictIds(assignment)}
        options={assignmentDistricts.map((item) => {
          const holder = item[districtField(assignment)]
          return {
            value: item.id,
            label: holder && holder.id !== assignment.id ? `${item.name} (hozir: ${holder.user.fullName})` : item.name,
          }
        })}
        onChange={(value: string[]) => setDistrictDrafts((drafts) => ({ ...drafts, [assignment.id]: value }))}
      />,
    },
    {
      title: 'Amallar', key: 'actions', width: 300, align: 'center',
      render: (_, assignment) => <Space>
        <Button size="small" type="primary" disabled={!districtDrafts[assignment.id]} onClick={() => saveAssignmentDistricts(assignment)}>Saqlash</Button>
        <Button size="small" onClick={() => openUserEditor(users.find((item) => item.id === assignment.user.id) ?? { ...assignment.user, regionAssignments: [] })}>Tahrirlash</Button>
        <Popconfirm title="Xodimni bu hududdan olib tashlaysizmi?" onConfirm={() => run(() => api(token, `/regions/${assignmentRegion!.id}/assignments/${assignment.id}`, { method: 'DELETE' }))}>
          <Button size="small" danger>Olib tashlash</Button>
        </Popconfirm>
      </Space>,
    },
  ]

  return (
    <div>
      <Space direction="vertical" size="middle" className="w-full">
        {error && <Alert type="error" showIcon message={error} />}

        <Card loading={loading}>
          <Tabs items={[
            {
              key: 'users', label: 'Foydalanuvchilar', children: <>
                <div className="mb-4 flex justify-end"><Button type="primary" onClick={() => openUserEditor()}>Xodim qo‘shish</Button></div>
                <Table rowKey="id" columns={userColumns} dataSource={users} pagination={{ pageSize: 10 }} scroll={{ x: true }} />
              </>,
            },
            {
              key: 'districts', label: 'Tumanlar', children: <>
                <div className="mb-4 flex flex-wrap justify-between gap-3">
                  <Space wrap>
                    <Input.Search allowClear placeholder="Tuman yoki xodim bo‘yicha qidirish" className="w-72" value={districtSearch} onChange={(event) => setDistrictSearch(event.target.value)} />
                    <Select allowClear placeholder="Hudud" className="min-w-52" value={districtRegionFilter} options={regions.map((item) => ({ value: item.id, label: item.name }))} onChange={setDistrictRegionFilter} />
                  </Space>
                  {isAdmin && <Button type="primary" onClick={() => openDistrictEditor()}>Tuman qo‘shish</Button>}
                </div>
                <Table
                  size="middle" bordered tableLayout="fixed" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
                  rowKey="id" columns={districtColumns} dataSource={visibleDistricts} sticky={{ offsetHeader: 64 }}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
                  scroll={{ x: isAdmin ? 1140 : 1060 }}
                />
              </>,
            },
            {
              key: 'assignments', label: 'Hududiy tayinlovlar', children: <Space direction="vertical" size="middle" className="w-full">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Hudud</div>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      className="w-72"
                      placeholder="Hududni tanlang"
                      value={assignmentRegionId}
                      onChange={setAssignmentRegionId}
                      options={regions.map((region) => ({ value: region.id, label: region.name }))}
                    />
                  </div>
                  {assignmentRegion && <Space wrap>
                    <Space.Compact>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        className="w-72"
                        placeholder="Mavjud xodimni tanlang"
                        value={pendingAssignmentUserId}
                        onChange={setPendingAssignmentUserId}
                        notFoundContent="Biriktirilmagan xodim yo‘q — “Yangi xodim” orqali qo‘shing"
                        options={availableUsers.map((item) => ({ value: item.id, label: `${item.fullName} · ${roleLabels[item.role]}` }))}
                      />
                      <Button disabled={!pendingAssignmentUserId} onClick={async () => {
                        if (!pendingAssignmentUserId) return
                        const success = await run(() => api(token, `/regions/${assignmentRegion.id}/assignments`, {
                          method: 'POST', body: JSON.stringify({ userId: pendingAssignmentUserId }),
                        }))
                        if (success) setPendingAssignmentUserId(undefined)
                      }}>Hududga biriktirish</Button>
                    </Space.Compact>
                    <Button type="primary" onClick={() => { newEmployeeForm.resetFields(); setNewEmployeeOpen(true) }}>Yangi xodim</Button>
                  </Space>}
                </div>

                {!assignmentRegion && <Alert type="info" showIcon message="Tayinlovlarni ko‘rish uchun hududni tanlang" />}

                {assignmentRegion && <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-1 text-xs text-slate-500">Guruh rahbari</div>
                      <Select
                        className="w-full"
                        allowClear
                        disabled={!isAdmin}
                        placeholder="Tanlanmagan"
                        value={assignmentRegion.groupLeaderAssignmentId ?? undefined}
                        options={republicEmployees.map((item) => ({ value: item.id, label: item.user.fullName }))}
                        onChange={(value) => run(() => api(token, `/regions/${assignmentRegion.id}/group-leader`, {
                          method: 'PUT', body: JSON.stringify({ assignmentId: value ?? null }),
                        }))}
                      />
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Xodimlar</div>
                      <div className="text-xl font-semibold">{assignmentRegion.employeeAssignments.length}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Respublika vakili yo‘q tumanlar</div>
                      <div className={`text-xl font-semibold ${districtsWithoutRepublic.length ? 'text-amber-600' : ''}`}>{districtsWithoutRepublic.length} / {assignmentDistricts.length}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Viloyat vakili yo‘q tumanlar</div>
                      <div className={`text-xl font-semibold ${districtsWithoutRegional.length ? 'text-amber-600' : ''}`}>{districtsWithoutRegional.length} / {assignmentDistricts.length}</div>
                    </div>
                  </div>

                  <Table
                    size="middle" bordered tableLayout="fixed" rowKey="id" pagination={false}
                    columns={assignmentColumns}
                    dataSource={regionAssignments}
                    scroll={{ x: 1000 }}
                    locale={{ emptyText: 'Bu hududga hali xodim biriktirilmagan' }}
                  />
                </>}
              </Space>,
            },
          ].filter((item) => isAdmin || item.key !== 'users')} />
        </Card>
      </Space>

      <Modal
        title={userEditor ? 'Xodimni tahrirlash' : 'Xodim qo‘shish'}
        open={userEditor !== undefined}
        onCancel={() => setUserEditor(undefined)}
        onOk={() => userForm.submit()}
        destroyOnHidden
      >
        <Form key={userEditor?.id ?? 'new-user'} form={userForm} layout="vertical" onFinish={async (values) => {
          // Group leaders may change only the name and phone number.
          const payload = isAdmin ? { ...values } : { fullName: values.fullName, phone: values.phone }
          if (!payload.password) delete payload.password
          const success = await run(() => api(token, userEditor ? `/users/${userEditor.id}` : '/users', {
            method: userEditor ? 'PATCH' : 'POST', body: JSON.stringify(payload),
          }))
          if (success) setUserEditor(undefined)
        }}>
          {!userEditor && <Form.Item label="Foydalanuvchi nomi" name="username" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>}
          <Form.Item label="F.I.Sh." name="fullName" rules={[{ required: true }]}><Input maxLength={150} /></Form.Item>
          <Form.Item label="Telefon raqami" name="phone"><Input maxLength={30} placeholder="+998-90-123-45-67" /></Form.Item>
          {isAdmin && <>
            <Form.Item label="Turi" name="role" rules={[{ required: true }]}>
              <Select options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item label={userEditor ? 'Yangi parol (ixtiyoriy)' : 'Parol'} name="password" rules={userEditor ? [] : [{ required: true }]}>
              <Input.Password maxLength={200} autoComplete="new-password" />
            </Form.Item>
          </>}
        </Form>
      </Modal>

      <Modal
        title={`Yangi xodim — ${assignmentRegion?.name ?? ''}`}
        open={newEmployeeOpen}
        onCancel={() => setNewEmployeeOpen(false)}
        onOk={() => newEmployeeForm.submit()}
        destroyOnHidden
      >
        <Form form={newEmployeeForm} layout="vertical" initialValues={{ role: 'REPUBLIC_EMPLOYEE' }} onFinish={async (values) => {
          if (!assignmentRegion) return
          const success = await run(() => api(token, `/regions/${assignmentRegion.id}/employees`, {
            method: 'POST', body: JSON.stringify(values),
          }))
          if (success) setNewEmployeeOpen(false)
        }}>
          <Form.Item label="Turi" name="role" rules={[{ required: true }]}>
            <Select options={[
              { value: 'REPUBLIC_EMPLOYEE', label: roleLabels.REPUBLIC_EMPLOYEE },
              { value: 'REGIONAL_EMPLOYEE', label: roleLabels.REGIONAL_EMPLOYEE },
            ]} />
          </Form.Item>
          <Form.Item label="F.I.Sh." name="fullName" rules={[{ required: true }]}><Input maxLength={150} /></Form.Item>
          <Form.Item label="Telefon raqami" name="phone"><Input maxLength={30} placeholder="+998-90-123-45-67" /></Form.Item>
          <Form.Item label="Foydalanuvchi nomi" name="username" rules={[{ required: true }]}><Input maxLength={100} autoComplete="off" /></Form.Item>
          <Form.Item label="Parol" name="password" rules={[{ required: true }]}><Input.Password maxLength={200} autoComplete="new-password" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={districtEditor ? 'Tumanni tahrirlash' : 'Tuman qo‘shish'}
        open={districtEditor !== undefined}
        onCancel={() => setDistrictEditor(undefined)}
        onOk={() => districtForm.submit()}
        destroyOnHidden
      >
        <Form key={districtEditor?.id ?? 'new-district'} form={districtForm} layout="vertical" onFinish={async (values) => {
          const success = await run(() => api(token, districtEditor ? `/districts/${districtEditor.id}` : '/districts', {
            method: districtEditor ? 'PATCH' : 'POST', body: JSON.stringify(values),
          }))
          if (success) setDistrictEditor(undefined)
        }}>
          <Form.Item label="Hudud" name="regionId" rules={[{ required: true }]}>
            <Select disabled={!isAdmin} options={regions.map((region) => ({ value: region.id, label: region.name }))} />
          </Form.Item>
          <Form.Item label="Tuman nomi" name="name" rules={[{ required: true }]}><Input disabled={!isAdmin} maxLength={150} /></Form.Item>
          <Form.Item label="Jami xodimlar soni" name="engineerCount"><InputNumber className="w-full" min={0} precision={0} /></Form.Item>
          <Form.Item label="Shundan xatlovga biriktirilgan xodimlar soni" name="xatlovEmployeeCount"><InputNumber className="w-full" min={0} precision={0} /></Form.Item>
          <Form.Item label="Jami obyektlar soni" name="objectCount"><InputNumber className="w-full" min={0} precision={0} /></Form.Item>
          <Form.Item label="Jami MFY soni" name="mfyCount"><InputNumber className="w-full" min={0} precision={0} /></Form.Item>
          <Form.Item label="Respublika xodimi" name="republicEmployeeAssignmentId">
            <Select allowClear options={districtRepublicOptions} onChange={(value) => districtForm.setFieldValue('republicEmployeeAssignmentId', value ?? null)} />
          </Form.Item>
          <Form.Item label="Hududiy xodim" name="regionalEmployeeAssignmentId">
            <Select allowClear options={districtRegionalOptions} onChange={(value) => districtForm.setFieldValue('regionalEmployeeAssignmentId', value ?? null)} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AdminPanel
