import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Space, Statistic, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { apiFetch } from './api'
import { formatAmount, savePayment, type PaymentRecord } from './payments'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD' | 'PAYMENT_SPECIALIST'
type User = { id: string; username: string; fullName: string; role: Role }
type Totals = { count: number; amount: number }
type ApiData = {
  specialist: { fullName: string; position: string | null; district: { name: string; region: { name: string } } | null } | null
  records: PaymentRecord[]
  totals: { daily: Totals; weekly: Totals; monthly: Totals }
  editableFrom: string
}
type Values = { applicationNumber: string; amount: number }

function PaymentEntryPage({ token }: { token: string; user: User }) {
  const client = useQueryClient()
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<PaymentRecord | null>(null)
  const [form] = Form.useForm<Values>()
  const [editForm] = Form.useForm<Values>()
  const query = useQuery({
    queryKey: ['payments-mine', token, date.format('YYYY-MM-DD')],
    queryFn: () => apiFetch<ApiData>(token, `/api/payments/mine?date=${date.format('YYYY-MM-DD')}`),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const shownError = error ?? query.error?.message ?? null
  // Only records entered today can be changed.
  const editable = (record: PaymentRecord) => !!data && record.createdAt >= data.editableFrom

  async function run(action: () => Promise<boolean | void>, after?: () => void) {
    setError(null)
    setSaving(true)
    try {
      if ((await action()) !== false) after?.()
      await client.invalidateQueries({ queryKey: ['payments-mine'] })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlab bo‘lmadi') }
    finally { setSaving(false) }
  }

  const add = (values: Values) => run(
    () => savePayment(token, '/api/payments/records', 'POST', { ...values, recordDate: date.format('YYYY-MM-DD') }),
    () => { form.resetFields(); form.focusField('applicationNumber') },
  )
  const update = (values: Values) => editing && run(
    () => savePayment(token, `/api/payments/records/${editing.id}`, 'PATCH', { ...values, recordDate: editing.recordDate.slice(0, 10) }),
    () => setEditing(null),
  )

  const columns: ColumnsType<PaymentRecord> = [
    { title: '№', key: 'index', width: 50, align: 'center', render: (_, _row, index) => index + 1 },
    { title: 'Ariza raqami', dataIndex: 'applicationNumber' },
    { title: 'To‘lov miqdori (mln so‘m)', dataIndex: 'amount', align: 'right', render: formatAmount },
    { title: 'Kiritilgan vaqt', dataIndex: 'createdAt', width: 140, align: 'center', render: (value: string) => dayjs(value).format('DD.MM.YYYY HH:mm') },
    { title: 'Amallar', key: 'actions', width: 190, align: 'center', render: (_, record) => editable(record) && <Space>
      <Button size="small" onClick={() => { setEditing(record); editForm.setFieldsValue({ applicationNumber: record.applicationNumber, amount: Number(record.amount) }) }}>Tahrirlash</Button>
      <Popconfirm title="To‘lovni o‘chirasizmi?" okText="Ha" cancelText="Yo‘q" onConfirm={() => run(() => apiFetch(token, `/api/payments/records/${record.id}`, { method: 'DELETE' }))}><Button size="small" danger>O‘chirish</Button></Popconfirm>
    </Space> },
  ]

  const amountField = <Form.Item label="To‘lov miqdori (mln so‘m)" name="amount" rules={[{ required: true, message: 'Miqdorni kiriting' }]}><InputNumber min={0.001} precision={3} className="!w-48" placeholder="0,000" /></Form.Item>
  const numberField = <Form.Item label="Ariza raqami" name="applicationNumber" rules={[{ required: true, whitespace: true, message: 'Ariza raqamini kiriting' }]}><Input maxLength={50} className="!w-56" placeholder="Ariza raqami" /></Form.Item>

  return <Space direction="vertical" size="middle" className="w-full">
    <div>
      <Typography.Title level={3} className="!mb-1">To‘lov undirish</Typography.Title>
      <Typography.Text type="secondary">{data?.specialist ? `${data.specialist.district?.region.name ?? ''} · ${data.specialist.district?.name ?? ''}${data.specialist.position ? ` · ${data.specialist.position}` : ''}` : 'Kunlik undirilgan to‘lovlar'}</Typography.Text>
    </div>
    {shownError && <Alert type="error" showIcon message={shownError} />}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {([['Tanlangan kun', data?.totals.daily], ['Hafta (Du–Ju)', data?.totals.weekly], ['Oy boshidan', data?.totals.monthly]] as const).map(([label, totals]) => <Card key={label} size="small" loading={query.isPending}>
        <Typography.Text type="secondary">{label}</Typography.Text>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Statistic title="Arizalar" value={totals?.count ?? 0} />
          <Statistic title="Summa (mln)" value={formatAmount(totals?.amount ?? 0)} />
        </div>
      </Card>)}
    </div>
    <Card size="small">
      <Form form={form} layout="inline" onFinish={add} className="flex-wrap gap-y-3">
        <Form.Item label="Sana"><DatePicker allowClear={false} value={date} disabledDate={(day) => day.isAfter(dayjs(), 'day')} onChange={(value) => value && setDate(value)} /></Form.Item>
        {numberField}
        {amountField}
        <Form.Item><Button type="primary" htmlType="submit" loading={saving}>Qo‘shish</Button></Form.Item>
      </Form>
    </Card>
    <Card size="small" loading={query.isPending} title={`${date.format('DD.MM.YYYY')} kuni kiritilgan to‘lovlar`}>
      <Table size="small" rowKey="id" columns={columns} dataSource={data?.records ?? []} pagination={false} locale={{ emptyText: 'Bu kunga to‘lov kiritilmagan' }}
        summary={(rows) => rows.length ? <Table.Summary.Row className="font-semibold [&>td]:!bg-slate-100">
          <Table.Summary.Cell index={0} colSpan={2}>Jami: {rows.length} ta ariza</Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right">{formatAmount(rows.reduce((sum, row) => sum + Number(row.amount), 0))}</Table.Summary.Cell>
          <Table.Summary.Cell index={3} colSpan={2} />
        </Table.Summary.Row> : null} />
      <Typography.Text type="secondary" className="text-xs">Faqat bugun kiritilgan yozuvlarni tahrirlash yoki o‘chirish mumkin.</Typography.Text>
    </Card>
    <Modal title="To‘lovni tahrirlash" open={!!editing} onCancel={() => setEditing(null)} onOk={() => editForm.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={editForm} layout="vertical" onFinish={update}>{numberField}{amountField}</Form>
    </Modal>
  </Space>
}

export default PaymentEntryPage
