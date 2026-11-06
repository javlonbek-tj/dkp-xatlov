import { Form, InputNumber } from 'antd'
import { formatAmount, toMln } from './payments'

// Payment amount entered in whole so'm with digit grouping, showing the same amount in million so'm below.
function PaymentAmountField({ className }: { className?: string }) {
  return <Form.Item label="To‘lov miqdori (so‘m)" required>
    <Form.Item noStyle name="amount" rules={[{ required: true, message: 'Miqdorni kiriting' }]}>
      <InputNumber<number> min={1} max={99_999_999_999} precision={0} className={className} placeholder="800 000"
        formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
        parser={(value) => Number((value ?? '').replace(/\D/g, ''))} />
    </Form.Item>
    <Form.Item noStyle shouldUpdate={(before, after) => before.amount !== after.amount}>
      {({ getFieldValue }) => {
        const som = getFieldValue('amount') as number | null | undefined
        return <div className="mt-1 text-xs text-slate-500">{som ? `= ${formatAmount(toMln(som))} mln so‘m` : 'So‘mda kiriting, masalan: 800 000'}</div>
      }}
    </Form.Item>
  </Form.Item>
}

export default PaymentAmountField
