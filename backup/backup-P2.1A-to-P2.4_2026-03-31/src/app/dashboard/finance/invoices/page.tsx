'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Invoice {
  id: string; invoiceCode: string; type: string; status: string; clientName: string | null;
  amount: number; taxAmount: number; totalAmount: number; paidAmount: number;
  dueDate: string | null; createdAt: string;
  project: { projectCode: string; projectName: string } | null
}

const statusLabel: Record<string, string> = { DRAFT: 'Nháp', SENT: 'Đã gửi', PAID: 'Đã TT', PARTIAL: 'TT 1 phần', OVERDUE: 'Quá hạn', CANCELLED: 'Hủy' }
const statusColor: Record<string, string> = { DRAFT: '#888', SENT: '#0ea5e9', PAID: '#16a34a', PARTIAL: '#f59e0b', OVERDUE: '#dc2626', CANCELLED: '#888' }

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [totals, setTotals] = useState({ receivable: 0, payable: 0, paid: 0, outstanding: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const load = () => {
    const url = filter ? `/api/finance/invoices?type=${filter}` : '/api/finance/invoices'
    apiFetch(url).then(res => {
      if (res.ok) { setInvoices(res.invoices || []); setTotals(res.totals || totals) }
      setLoading(false)
    })
  }
  useEffect(() => { load() }, [filter])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const fmt = (n: number) => n.toLocaleString('vi-VN')

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🧾 Hóa đơn</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{invoices.length} hóa đơn</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Phải thu</p><p className="text-lg font-bold" style={{ color: '#16a34a' }}>{fmt(totals.receivable)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Phải trả</p><p className="text-lg font-bold" style={{ color: '#dc2626' }}>{fmt(totals.payable)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Đã thanh toán</p><p className="text-lg font-bold" style={{ color: '#0ea5e9' }}>{fmt(totals.paid)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Còn lại</p><p className="text-lg font-bold" style={{ color: '#f59e0b' }}>{fmt(totals.outstanding)} ₫</p></div>
      </div>

      <div className="flex gap-2">
        {([['', 'Tất cả'], ['RECEIVABLE', '📥 Phải thu'], ['PAYABLE', '📤 Phải trả']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === v ? 'var(--accent)' : 'var(--surface-hover)', color: filter === v ? '#fff' : 'var(--text-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã HĐ</th><th>Loại</th><th>Khách</th><th>Dự án</th><th className="text-right">Giá trị</th><th className="text-right">Đã TT</th><th>Hạn</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có hóa đơn</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{inv.invoiceCode}</span></td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: inv.type === 'RECEIVABLE' ? '#16a34a20' : '#dc262620', color: inv.type === 'RECEIVABLE' ? '#16a34a' : '#dc2626' }}>{inv.type === 'RECEIVABLE' ? 'Thu' : 'Trả'}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{inv.clientName || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{inv.project?.projectCode || '—'}</td>
                <td className="text-right text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(inv.totalAmount)} ₫</td>
                <td className="text-right text-xs" style={{ color: '#16a34a' }}>{fmt(inv.paidAmount)} ₫</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('vi-VN') : '—'}</td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[inv.status] || '#888'}20`, color: statusColor[inv.status] || '#888' }}>{statusLabel[inv.status] || inv.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
