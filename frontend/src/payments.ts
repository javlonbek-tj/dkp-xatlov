import { Modal } from 'antd'
import { apiFetch } from './api'

export type PaymentRecord = { id: string; recordDate: string; applicationNumber: string; amount: string; createdAt: string }
type District = { id: string; name: string; regionId: string; region: { id: string; name: string } }
export type ApplicationStatus = 'UNPAID' | 'PARTIAL' | 'PAID'
// Debt, collected sum and remainder of an application, in so'm.
export type PaymentApplication = { number: string; district: District; debt: number; paid: number; remaining: number; status: ApplicationStatus }
export type ApplicationDetails = PaymentApplication & { lastPayment: { recordDate: string; fullName: string } | null }

export const statusLabels: Record<ApplicationStatus, { label: string; color: string }> = {
  UNPAID: { label: 'Undirilmagan', color: 'red' },
  PARTIAL: { label: 'Qisman undirilgan', color: 'orange' },
  PAID: { label: 'To‘liq undirilgan', color: 'green' },
}

// Million so'm with up to three decimals.
export const formatAmount = (value: number | string) => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 })
// Specialists enter whole so'm; amounts are stored in million so'm.
export const toSom = (mln: number | string) => Math.round(Number(mln) * 1_000_000)
export const toMln = (som: number) => som / 1_000_000
export const formatSom = (mln: number | string) => toSom(mln).toLocaleString('ru-RU')
export const formatWholeSom = (som: number) => som.toLocaleString('ru-RU')
// Debt to collect each working day so that it is finished by the deadline; a week is 5 working days.
export const dailyPlan = (debt: number | null, workDays?: number) => debt !== null && workDays ? debt / workDays : null
export const weeklyPlan = (debt: number | null, workDays?: number) => { const plan = dailyPlan(debt, workDays); return plan === null ? null : plan * 5 }
// Share of the plan collected, in percent with one decimal.
export const percentOf = (collected: number, plan: number | null) => plan ? Math.round((collected / plan) * 1000) / 10 : null
// A payment of this many million so'm or more is saved only after a confirmation.
const largeAmount = 50

// Saves a payment (amount in million so'm), asking first when the amount is large.
// The server refuses unknown and fully paid applications and amounts above the remainder.
export async function savePayment(token: string, path: string, method: 'POST' | 'PATCH', payload: { amount: number; recordDate: string; applicationNumber: string }): Promise<boolean> {
  if (payload.amount >= largeAmount && !await new Promise<boolean>((resolve) => Modal.confirm({
    title: 'Summa juda katta',
    content: `Siz ${formatSom(payload.amount)} so‘m (${formatAmount(payload.amount)} mln so‘m) kiritdingiz. Summa to‘g‘rimi?`,
    okText: 'Ha, to‘g‘ri', cancelText: 'Bekor qilish',
    onOk: () => resolve(true), onCancel: () => resolve(false),
  }))) return false
  await apiFetch(token, path, { method, body: JSON.stringify(payload) })
  return true
}
