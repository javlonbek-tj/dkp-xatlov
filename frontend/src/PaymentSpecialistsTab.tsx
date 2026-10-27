import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { apiFetch } from './api'

type District = { id: string; name: string; regionId: string; region: { id: string; name: string } }
type Specialist = { id: string; username: string; fullName: string; phone: string | null; position: string | null; district: District | null }
type Values = { districtId: string; fullName: string; position?: string; phone?: string; username: string; password?: string }

// Payment specialist accounts (login "familiya.ism"), kept by administrators; districts come from the admin panel.
function PaymentSpecialistsTab({ token, districts }: { token: string; districts: District[] }) {
  const client = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [districtFilter, setDistrictFilter] = useState<string>()
  const [editor, setEditor] = useState<{ specialist?: Specialist } | null>(null)
  const [form] = Form.useForm<Values>()
  const query = useQuery({
    queryKey: ['payment-specialists', token],
    queryFn: () => apiFetch<{ specialists: Specialist[] }>(token, '/api/payments/specialists'),
  })
  const term = search.trim().toLocaleLowerCase()
  const specialists = (query.data?.specialists ?? []).filter((row) =>
    (!districtFilter || row.district?.id === districtFilter)
    && JSON.stringify([row.fullName, row.username, row.phone, row.position]).toLocaleLowerCase().includes(term))
  const districtOptions = districts.map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError(null)
    setSaving(true)
    try {
      await action()
      after?.()
      await Promise.all([client.invalidateQueries({ queryKey: ['payment-specialists'] }), client.invalidateQueries({ queryKey: ['payments'] })])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlab bo‘lmadi') }
    finally { setSaving(false) }
  }

  function open(specialist?: Specialist) {
    setEditor({ specialist })
    form.setFieldsValue(specialist
      ? { districtId: specialist.district?.id, fullName: specialist.fullName, position: specialist.position ?? '', phone: specialist.phone ?? '', username: specialist.username, password: '' }
      : { districtId: districtFilter, fullName: '', position: '', phone: '', username: '', password: '' })
  }

  function save(values: Values) {
    const specialist = editor?.specialist
    // An empty password keeps the current one when editing.
    const payload = { ...values, password: values.password || undefined }
    void run(
      () => apiFetch(token, specialist ? `/api/payments/specialists/${specialist.id}` : '/api/payments/specialists', { method: specialist ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
      () => setEditor(null),
    )
  }

  const columns: ColumnsType<Specialist> = [
    { title: 'F.I.Sh.', dataIndex: 'fullName', width: 240 },
    { title: 'Tuman', key: 'district', width: 200, render: (_, row) => row.district ? <div className="leading-tight">{row.district.name}<div className="text-xs text-slate-500">{row.district.region.name}</div></div> : '—' },
    { title: 'Lavozimi', dataIndex: 'position', width: 200, render: (value: string | null) => value ?? '—' },
    { title: 'Telefon', dataIndex: 'phone', width: 140, render: (value: string | null) => value ?? '—' },
    { title: 'Login', dataIndex: 'username', width: 160 },
    { title: 'Amallar', key: 'actions', width: 190, align: 'center', render: (_, row) => <Space>
      <Button size="small" onClick={() => open(row)}>Tahrirlash</Button>
      <Popconfirm title="Mutaxassisni o‘chirasizmi?" description="To‘lov kiritgan mutaxassisni o‘chirib bo‘lmaydi." okText="Ha" cancelText="Yo‘q" onConfirm={() => run(() => apiFetch(token, `/api/payments/specialists/${row.id}`, { method: 'DELETE' }))}><Button size="small" danger>O‘chirish</Button></Popconfirm>
    </Space> },
  ]

  return <>
    {(error ?? query.error?.message) && <Alert className="!mb-4" type="error" showIcon message={error ?? query.error?.message} />}
    <div className="mb-4 flex flex-wrap justify-between gap-3">
      <Space wrap>
        <Input.Search allowClear placeholder="F.I.Sh., login yoki telefon bo‘yicha qidirish" className="w-72" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Tuman" className="min-w-64" value={districtFilter} options={districtOptions} onChange={setDistrictFilter} />
      </Space>
      <Button type="primary" onClick={() => open()}>Mutaxassis qo‘shish</Button>
    </div>
    <Table rowKey="id" size="small" loading={query.isPending} columns={columns} dataSource={specialists} pagination={{ pageSize: 20 }} scroll={{ x: true }} locale={{ emptyText: 'To‘lov undirish mutaxassislari kiritilmagan' }} />
    <Modal title={editor?.specialist ? 'Mutaxassisni tahrirlash' : 'Mutaxassis qo‘shish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save} autoComplete="off">
        <Form.Item label="Tuman" name="districtId" rules={[{ required: true, message: 'Tumanni tanlang' }]}><Select showSearch optionFilterProp="label" options={districtOptions} /></Form.Item>
        <Form.Item label="F.I.Sh." name="fullName" rules={[{ required: true, whitespace: true, message: 'F.I.Sh. ni kiriting' }]}><Input maxLength={150} /></Form.Item>
        <Form.Item label="Lavozimi" name="position"><Input maxLength={150} /></Form.Item>
        <Form.Item label="Telefon" name="phone"><Input maxLength={30} placeholder="+998XXXXXXXXX" /></Form.Item>
        <Form.Item label="Login" name="username" extra="familiya.ism ko‘rinishida" rules={[{ required: true, whitespace: true, message: 'Loginni kiriting' }]}><Input maxLength={100} autoComplete="off" /></Form.Item>
        <Form.Item label="Parol" name="password" extra={editor?.specialist ? 'Bo‘sh qoldirilsa, parol o‘zgarmaydi' : undefined} rules={editor?.specialist ? [] : [{ required: true, message: 'Parolni kiriting' }]}><Input.Password maxLength={200} autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>
  </>
}

export default PaymentSpecialistsTab
