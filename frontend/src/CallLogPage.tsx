import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { exportExcel } from './excel-export'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type User = { id: string; username: string; fullName: string; role: Role }
type District = {
  id: string; name: string; regionId: string; engineerCount: number | null; region: { id: string; name: string }
  republicEmployeeAssignment: { user: { fullName: string } } | null
  regionalEmployeeAssignment: { user: { fullName: string } } | null
}
type Status = 'CALLED_SUCCESSFULLY' | 'NO_ANSWER' | 'CALLBACK_REQUIRED'
type CallRecord = { id: string; districtId: string; callDate: string; status: Status; monitoringAreas: string[]; issues: string | null; nextAction: string | null; followUpDate: string | null; district: District }
type PageData = { districts: District[]; records: CallRecord[]; writableDistrictIds: string[] | null; needsAttention: District[]; notContactedCount: number }
type Values = { callDate: Dayjs; status: Status; monitoringAreas: string; issues?: string; nextAction?: string; followUpDate?: Dayjs | null }

const statusLabels: Record<Status, string> = { CALLED_SUCCESSFULLY: 'Muvaffaqiyatli bogʻlanildi', NO_ANSWER: 'Javob bermadi', CALLBACK_REQUIRED: 'Qayta qoʻngʻiroq kerak' }

function CallLogPage({ token, user }: { token: string; user: User }) {
  const [data, setData] = useState<PageData>({ districts: [], records: [], writableDistrictIds: [], needsAttention: [], notContactedCount: 0 })
  const [selectedDate, setSelectedDate] = useState(dayjs())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ districtId: string; record?: CallRecord } | null>(null)
  const [form] = Form.useForm()
  const canWrite = user.role !== 'REGIONAL_EMPLOYEE'
  // Republic employees see their whole region but edit only the districts they are responsible for.
  const canEdit = (districtId: string) => canWrite && (data.writableDistrictIds === null || data.writableDistrictIds.includes(districtId))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/call-log?date=${selectedDate.format('YYYY-MM-DD')}`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Qoʻngʻiroqlarni yuklab boʻlmadi')
      setData(result as PageData)
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Qoʻngʻiroqlarni yuklab boʻlmadi') }
    finally { setLoading(false) }
  }, [selectedDate, token])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const visibleRecords = data.records.filter((row) => JSON.stringify([row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, row.monitoringAreas, row.issues, row.nextAction]).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function openEditor(districtId: string, record?: CallRecord) {
    setEditor({ districtId, record })
    form.setFieldsValue(record ? {
      callDate: dayjs(record.callDate), status: record.status, monitoringAreas: record.monitoringAreas.join('\n'),
      issues: record.issues, nextAction: record.nextAction, followUpDate: record.followUpDate ? dayjs(record.followUpDate) : null,
    } : { callDate: selectedDate, status: 'CALLED_SUCCESSFULLY', monitoringAreas: '', issues: '', nextAction: '', followUpDate: null })
  }

  const columns: ColumnsType<CallRecord> = [
    { title: 'Hudud', dataIndex: ['district', 'region', 'name'] },
    { title: 'Tuman', dataIndex: ['district', 'name'] },
    { title: 'Respublika xodimi', render: (_, row) => row.district.republicEmployeeAssignment?.user.fullName ?? '—' },
    { title: 'Holati', dataIndex: 'status', render: (status: Status) => <Tag color={status === 'CALLED_SUCCESSFULLY' ? 'green' : status === 'CALLBACK_REQUIRED' ? 'orange' : 'default'}>{statusLabels[status]}</Tag> },
    { title: 'Muhokama qilingan yoʻnalishlar', render: (_, row) => row.monitoringAreas.join(', ') || '—' },
    { title: 'Aniqlangan muammolar', dataIndex: 'issues', ellipsis: true },
    { title: 'Keyingi chora / izoh', dataIndex: 'nextAction', ellipsis: true },
    { title: 'Qayta aloqa sanasi', dataIndex: 'followUpDate', render: (value: string | null) => value?.slice(0, 10) ?? '—' },
    ...(canWrite ? [{ title: 'Amallar', render: (_: unknown, row: CallRecord) => canEdit(row.districtId) && <Button size="small" onClick={() => openEditor(row.districtId, row)}>Tahrirlash</Button> } as ColumnsType<CallRecord>[number]] : []),
  ]

  async function save(values: Values) {
    if (!editor) return
    const payload = {
      callDate: values.callDate.format('YYYY-MM-DD'), status: values.status,
      monitoringAreas: values.monitoringAreas.split('\n').map((item) => item.trim()).filter(Boolean),
      issues: values.issues?.trim() || null, nextAction: values.nextAction?.trim() || null,
      followUpDate: values.followUpDate?.format('YYYY-MM-DD') ?? null,
    }
    try {
      const path = editor.record ? `/api/call-log/districts/${editor.districtId}/records/${editor.record.id}` : `/api/call-log/districts/${editor.districtId}`
      const response = await fetch(path, { method: editor.record ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message ?? 'Saqlash amalga oshmadi')
      setEditor(null)
      setSelectedDate(dayjs(payload.callDate))
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saqlash amalga oshmadi') }
  }

  return <div><Space direction="vertical" size="large" className="w-full">
    <div><Typography.Title level={3} className="!mb-1">Qoʻngʻiroqlar jurnali</Typography.Title><Typography.Text type="secondary">Tumanlar bilan kunlik aloqa qaydlari</Typography.Text></div>
    {error && <Alert type="error" showIcon message={error} />}
    <Card title="Sana"><DatePicker value={selectedDate} onChange={(value) => value && setSelectedDate(value)} /></Card>
    <Card title={`Bogʻlanilmagan yoki qayta qoʻngʻiroq kerak (${data.needsAttention.length})`} loading={loading}>
      <Table rowKey="id" dataSource={data.needsAttention} pagination={{ pageSize: 10 }} scroll={{ x: true }} locale={{ emptyText: 'Barcha tumanlar bo‘yicha qo‘ng‘iroq qayd etilgan' }} columns={[
        { title: 'Hudud', dataIndex: ['region', 'name'] }, { title: 'Tuman', dataIndex: 'name' },
        { title: 'Holati', render: (_, district) => { const row = data.records.find((item) => item.districtId === district.id); return row ? statusLabels.CALLBACK_REQUIRED : 'Qoʻngʻiroq qayd etilmagan' } },
        ...(canWrite ? [{ title: 'Amallar', render: (_: unknown, district: District) => { const row = data.records.find((item) => item.districtId === district.id); return canEdit(district.id) && <Button size="small" onClick={() => openEditor(district.id, row)}> {row ? 'Tahrirlash' : 'Qoʻngʻiroqni qayd etish'} </Button> } } as ColumnsType<District>[number]] : []),
      ]} />
    </Card>
    <Card title={`Qoʻngʻiroqlar tarixi — ${selectedDate.format('YYYY-MM-DD')}`} loading={loading}>
      <div className="mb-4 flex justify-end"><Select placeholder="Tuman uchun qoʻngʻiroq qayd etish" className="min-w-64" disabled={!canWrite} options={data.districts.filter((district) => canEdit(district.id) && !data.records.some((row) => row.districtId === district.id)).map((item) => ({ value: item.id, label: `${item.region.name} · ${item.name}` }))} onChange={(id) => openEditor(id)} /></div>
      <div className="mb-4 flex flex-wrap justify-between gap-3"><Input.Search allowClear placeholder="Hudud, tuman yoki muammo bo‘yicha qidirish" className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} /><Button onClick={() => void exportExcel('qongiroqlar-jurnali.xlsx', ['Sana', 'Hudud', 'Tuman', 'Respublika xodimi', 'Holati', 'Muhokama qilingan yoʻnalishlar', 'Aniqlangan muammolar', 'Keyingi chora / izoh', 'Qayta aloqa sanasi'], visibleRecords.map((row) => [row.callDate.slice(0, 10), row.district.region.name, row.district.name, row.district.republicEmployeeAssignment?.user.fullName, statusLabels[row.status], row.monitoringAreas.join('; '), row.issues, row.nextAction, row.followUpDate?.slice(0, 10)]))}>Excel uchun eksport</Button></div>
      <Table rowKey="id" columns={columns} dataSource={visibleRecords} pagination={{ pageSize: 10 }} scroll={{ x: true }} locale={{ emptyText: 'Bu sana uchun qoʻngʻiroqlar qayd etilmagan' }} />
    </Card>
  </Space>
  <Modal title={editor?.record ? 'Qoʻngʻiroq yozuvini tahrirlash' : 'Qoʻngʻiroqni qayd etish'} open={!!editor} onCancel={() => setEditor(null)} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={save}>
      <Form.Item label="Sana" name="callDate" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
      <Form.Item label="Qoʻngʻiroq holati" name="status" rules={[{ required: true }]}><Select options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item label="Muhokama qilingan yoʻnalishlar (har qatorda bittadan)" name="monitoringAreas"><Input.TextArea rows={3} /></Form.Item>
      <Form.Item label="Aniqlangan muammolar" name="issues"><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
      <Form.Item label="Keyingi chora yoki izoh" name="nextAction"><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
      <Form.Item label="Qayta aloqa sanasi" name="followUpDate"><DatePicker className="w-full" /></Form.Item>
    </Form>
  </Modal>
  </div>
}

export default CallLogPage
