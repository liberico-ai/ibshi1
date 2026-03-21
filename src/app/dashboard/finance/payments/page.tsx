'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Payment {
  id: string; amount: string; paymentDate: string; method: string; reference: string | null; notes: string | null;
  invoice: { invoiceCode: string; type: string; clientName: string; totalAmount: string }
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [totalPaid, setTotalPaid] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [invoices, setInvoices] = useState<{ id: string; invoiceCode: string; clientName: string; totalAmount: string; paidAmount: string }[]>([])

  const load = () => {
    apiFetch(`/api/finance/payments?page=${page}`).then(res => {
      if (res.ok) {
        setPayments(res.payments); setTotalPages(res.totalPages)
        setTotalPaid(res.summary.totalPaid)
      }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [page])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/finance/payments', {
      method: 'POST',
      body: JSON.stringify({
        invoiceId: fd.get('invoiceId'),
        amount: Number(fd.get('amount')),
        paymentDate: fd.get('paymentDate'),
        method: fd.get('method'),
        reference: fd.get('reference') || null,
        notes: fd.get('notes') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const openForm = async () => {
    const res = await apiFetch('/api/finance/invoices?page=1&limit=100')
    if (res.ok) setInvoices(res.invoices.filter((i: { status: string }) => i.status !== 'PAID'))
    setShowForm(true)
  }

  const fmt = (v: number | string) => Number(v).toLocaleString('vi-VN')
  const methodLabel: Record<string, string> = { BANK_TRANSFER: 'Chuyển khoản', CASH: 'Tiền mặt', CHECK: 'Séc' }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>💳 Quản lý thanh toán</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tổng đã thanh toán: {fmt(totalPaid)} VNĐ</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Ghi nhận thanh toán</button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ghi nhận thanh toán mới</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <select name="invoiceId" required className="input-field text-sm">
              <option value="">— Chọn hóa đơn —</option>
              {invoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceCode} • {inv.clientName} (Còn: {fmt(Number(inv.totalAmount) - Number(inv.paidAmount))})
                </option>
              ))}
            </select>
            <input name="amount" type="number" placeholder="Số tiền" required className="input-field text-sm" />
            <input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input-field text-sm" />
            <select name="method" className="input-field text-sm">
              <option value="BANK_TRANSFER">Chuyển khoản</option>
              <option value="CASH">Tiền mặt</option>
              <option value="CHECK">Séc</option>
            </select>
            <input name="reference" placeholder="Mã GD ngân hàng" className="input-field text-sm" />
            <input name="notes" placeholder="Ghi chú" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Hóa đơn</th><th>Khách hàng</th><th className="text-right">Số tiền</th>
              <th>Ngày TT</th><th>Phương thức</th><th>Mã GD</th><th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có thanh toán</td></tr>
            ) : payments.map(p => (
              <tr key={p.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{p.invoice.invoiceCode}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.invoice.clientName}</td>
                <td className="text-right font-mono text-xs font-bold" style={{ color: '#16a34a' }}>+{fmt(p.amount)}</td>
                <td className="text-xs">{new Date(p.paymentDate).toLocaleDateString('vi-VN')}</td>
                <td><span className="badge">{methodLabel[p.method] || p.method}</span></td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{p.reference || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-xs px-3 py-1 rounded">← Trước</button>
          <span className="text-xs py-1" style={{ color: 'var(--text-muted)' }}>Trang {page}/{totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-secondary text-xs px-3 py-1 rounded">Sau →</button>
        </div>
      )}
    </div>
  )
}
