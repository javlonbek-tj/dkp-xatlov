import { Modal } from 'antd'
import { apiFetch } from './api'

export type PaymentRecord = { id: string; recordDate: string; applicationNumber: string; amount: string; createdAt: string }

// Million so'm with up to three decimals.
export const formatAmount = (value: number | string) => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 })

// Saves a payment; when the application number was entered before, asks whether to save it anyway.
export async function savePayment(token: string, path: string, method: 'POST' | 'PATCH', payload: object): Promise<boolean> {
  try {
    await apiFetch(token, path, { method, body: JSON.stringify(payload) })
    return true
  } catch (cause) {
    if ((cause as { code?: string }).code !== 'DUPLICATE_APPLICATION') throw cause
    const confirmed = await new Promise<boolean>((resolve) => Modal.confirm({
      title: 'Ariza raqami avval kiritilgan',
      content: `${(cause as Error).message}. Baribir saqlansinmi?`,
      okText: 'Saqlash', cancelText: 'Bekor qilish',
      onOk: () => resolve(true), onCancel: () => resolve(false),
    }))
    if (!confirmed) return false
    await apiFetch(token, path, { method, body: JSON.stringify({ ...payload, allowDuplicate: true }) })
    return true
  }
}
