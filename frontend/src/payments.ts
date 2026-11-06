import { Modal } from 'antd'
import { apiFetch } from './api'

export type PaymentRecord = { id: string; recordDate: string; applicationNumber: string; amount: string; createdAt: string }

// Million so'm with up to three decimals.
export const formatAmount = (value: number | string) => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 })
// Specialists enter whole so'm; amounts are stored in million so'm.
export const toSom = (mln: number | string) => Math.round(Number(mln) * 1_000_000)
export const toMln = (som: number) => som / 1_000_000
export const formatSom = (mln: number | string) => toSom(mln).toLocaleString('ru-RU')
// A payment of this many million so'm or more is saved only after a confirmation.
const largeAmount = 50

const confirm = (title: string, content: string, okText: string) => new Promise<boolean>((resolve) => Modal.confirm({
  title, content, okText, cancelText: 'Bekor qilish',
  onOk: () => resolve(true), onCancel: () => resolve(false),
}))

// Saves a payment (amount in million so'm). Asks first when the amount is large, and when the application number was entered before.
export async function savePayment(token: string, path: string, method: 'POST' | 'PATCH', payload: { amount: number; recordDate: string; applicationNumber: string }): Promise<boolean> {
  if (payload.amount >= largeAmount && !await confirm(
    'Summa juda katta',
    `Siz ${formatSom(payload.amount)} so‘m (${formatAmount(payload.amount)} mln so‘m) kiritdingiz. Summa to‘g‘rimi?`,
    'Ha, to‘g‘ri',
  )) return false
  try {
    await apiFetch(token, path, { method, body: JSON.stringify(payload) })
    return true
  } catch (cause) {
    if ((cause as { code?: string }).code !== 'DUPLICATE_APPLICATION') throw cause
    if (!await confirm('Ariza raqami avval kiritilgan', `${(cause as Error).message}. Baribir saqlansinmi?`, 'Saqlash')) return false
    await apiFetch(token, path, { method, body: JSON.stringify({ ...payload, allowDuplicate: true }) })
    return true
  }
}
