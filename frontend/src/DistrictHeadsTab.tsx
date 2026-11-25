import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiFetch } from './api'

type District = { id: string; name: string; regionId: string; region: { id: string; name: string } }
type Head = { id: string; username: string; fullName: string; phone: string | null; district: District | null }
type Values = { districtId: string; fullName: string; phone?: string; username: string; password?: string }

// District head (branch head) accounts, kept by administrators and the Republic employees of the region.
function DistrictHeadsTab({ token, districts }: { token: string; districts: District[] }) {
  const client = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [districtFilter, setDistrictFilter] = useState<string>()
  const [editor, setEditor] = useState<{ head?: Head } | null>(null)
  const [form] = Form.useForm<Values>()
  const query = useQuery({
    queryKey: ['district-heads', token],
    queryFn: () => apiFetch<{ heads: Head[] }>(token, '/api/district-heads'),
  })
  const term = search.trim().toLocaleLowerCase()
  const heads = (query.data?.heads ?? []).filter((row) =>
    (!districtFilter || row.district?.id === districtFilter)
    && JSON.stringify([row.fullName, row.username, row.phone]).toLocaleLowerCase().includes(term))
  const districtOptions = districts.map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError(null)
    setSaving(true)
    try {
      await action()
      after?.()
      await client.invalidateQueries({ queryKey: ['district-heads'] })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlab bo‘lmadi') }
    finally { setSaving(false) }
  }

  function open(head?: Head) {
    setEditor({ head })
    form.setFieldsValue(head
      ? { districtId: head.district?.id, fullName: head.fullName, phone: head.phone ?? '', username: head.username, password: '' }
      : { districtId: districtFilter, fullName: '', phone: '', username: '', password: '' })
  }

  function save(values: Values) {
    const head = editor?.head
    // An empty password keeps the current one when editing; the login is set only once.
    const payload = head ? { districtId: values.districtId, fullName: values.fullName, phone: values.phone, password: values.password || undefined } : values
    void run(
      () => apiFetch(token, head ? `/api/district-heads/${head.id}` : '/api/district-heads', { method: head ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
      () => setEditor(null),
    )
  }

  const columns: ColumnsType<Head> = [
    { title: 'F.I.Sh.', dataIndex: 'fullName', width: 260 },
    { title: 'Tuman', key: 'district', width: 200, render: (_, row) => row.district ? <div className="leading-tight">{row.district.name}<div className="text-xs text-slate-500">{row.district.region.name}</div></div> : '—' },
    { title: 'Telefon', dataIndex: 'phone', width: 150, render: (value: string | null) => value ?? '—' },
    { title: 'Login', dataIndex: 'username', width: 170 },
    { title: 'Amallar', key: 'actions', width: 190, align: 'center', render: (_, row) => <Space>
      <Button size="small" onClick={() => open(row)}>Tahrirlash</Button>
      <Popconfirm title="Tuman rahbarini o‘chirasizmi?" okText="Ha" cancelText="Yo‘q" onConfirm={() => run(() => apiFetch(token, `/api/district-heads/${row.id}`, { method: 'DELETE' }))}><Button size="small" danger>O‘chirish</Button></Popconfirm>
    </Space> },
  ]

  return <>
    {(error ?? query.error?.message) && <Alert className="!mb-4" type="error" showIcon message={error ?? query.error?.message} />}
    <div className="mb-4 flex flex-wrap justify-between gap-3">
      <Space wrap>
        <Input.Search allowClear placeholder="F.I.Sh., login yoki telefon bo‘yicha qidirish" className="w-72" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Tuman" className="min-w-64" value={districtFilter} options={districtOptions} onChange={setDistrictFilter} />
      </Space>
      <Button type="primary" onClick={() => open()}>Tuman rahbarini qo‘shish</Button>
    </div>
    <Table rowKey="id" size="small" loading={query.isPending} columns={columns} dataSource={heads} pagination={{ pageSize: 20 }} scroll={{ x: true }} locale={{ emptyText: 'Tuman rahbarlari kiritilmagan' }} />
    <Modal title={editor?.head ? 'Tuman rahbarini tahrirlash' : 'Tuman rahbarini qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save} autoComplete="off">
        <Form.Item label="Tuman" name="districtId" rules={[{ required: true, message: 'Tumanni tanlang' }]}><Select showSearch optionFilterProp="label" options={districtOptions} /></Form.Item>
        <Form.Item label="F.I.Sh." name="fullName" rules={[{ required: true, whitespace: true, message: 'F.I.Sh. ni kiriting' }]}><Input maxLength={150} /></Form.Item>
        <Form.Item label="Telefon" name="phone"><Input maxLength={30} placeholder="+998XXXXXXXXX" /></Form.Item>
        <Form.Item label="Login" name="username" rules={[{ required: true, whitespace: true, message: 'Loginni kiriting' }]}><Input maxLength={100} autoComplete="off" disabled={!!editor?.head} /></Form.Item>
        <Form.Item label="Parol" name="password" extra={editor?.head ? 'Bo‘sh qoldirilsa, parol o‘zgarmaydi' : undefined} rules={editor?.head ? [] : [{ required: true, message: 'Parolni kiriting' }]}><Input.Password maxLength={200} autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>
  </>
}

export default DistrictHeadsTab
