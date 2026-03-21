'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Invoice {
  id: string; invoiceCode: string; type: string; clientName: string | null;
  description: string | null; amount: string; totalAmount: string; paidAmount: string;
  status: string; issueDate: string; dueDate: string | null;
  project: { projectCode: string; projectName: string } | null
}
interface Totals { receivable: number; payable: number; paid: number; outstanding: number }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT: { label: 'Nháp', bg: '#f1f5f9', color: '#64748b' },
  SENT: { label: 'Đã gửi', bg: '#eff6ff', color: '#2563eb' },
  PARTIALLY_PAID: { label: 'Thanh toán 1 phần', bg: '#fefce8', color: '#ca8a04' },
  PAID: { label: 'Đã thanh toán', bg: '#f0fdf4', color: '#16a34a' },
  OVERDUE: { label: 'Quá hạn', bg: '#fef2f2', color: '#dc2626' },
  CANCELLED: { label: 'Đã hủy', bg: '#f1f5f9', color: '#94a3b8' },
}

export default function FinancePage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [totals, setTotals] = useState<Totals>({ receivable: 0, payable: 0, paid: 0, outstanding: 0 })
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [search, typeFilter])
  useEffect(() => { loadData() }, [search, typeFilter, page])

  async function loadData() {
    const params = new URLSearchParams()
    if (typeFilter) params.set('type', typeFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/finance/invoices?${params}`)
    if (res.ok) { setInvoices(res.invoices); setTotals(res.totals); setPagination(res.pagination) }
    setLoading(false)
  }

  const fmt = (v: number) => v.toLocaleString('vi-VN')

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Tài chính</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pagination.total} hóa đơn</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-accent">+ Tạo hóa đơn</button>
      </div>

      {/* Finance KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4" style={{ borderTop: '3px solid #16a34a' }}>
          <p className="text-xl font-extrabold" style={{ color: '#16a34a' }}>{fmt(totals.receivable)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Phải thu (VNĐ)</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #dc2626' }}>
          <p className="text-xl font-extrabold" style={{ color: '#dc2626' }}>{fmt(totals.payable)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Phải trả</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #0ea5e9' }}>
          <p className="text-xl font-extrabold" style={{ color: '#0ea5e9' }}>{fmt(totals.paid)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Đã thanh toán</p>
        </div>
        <div className="card p-4" style={{ borderTop: `3px solid ${totals.outstanding > 0 ? '#f59e0b' : '#16a34a'}` }}>
          <p className="text-xl font-extrabold" style={{ color: totals.outstanding > 0 ? '#f59e0b' : '#16a34a' }}>{fmt(totals.outstanding)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Còn lại</p>
        </div>
      </div>

      {showCreate && <CreateInvoiceForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <input className="input w-72" placeholder="Tìm mã HĐ, tên KH..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2">
          {[{ v: '', l: 'Tất cả' }, { v: 'RECEIVABLE', l: '📥 Phải thu' }, { v: 'PAYABLE', l: '📤 Phải trả' }].map(f => (
            <button key={f.v} onClick={() => setTypeFilter(f.v)} className="px-3 py-1.5 text-xs rounded-full font-medium transition-colors" style={{
              background: typeFilter === f.v ? 'var(--primary)' : 'var(--bg-card)',
              color: typeFilter === f.v ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${typeFilter === f.v ? 'var(--primary)' : 'var(--border)'}`,
            }}>{f.l}</button>
          ))}
        </div>
      </div>

      {/* Invoice table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã HĐ</th><th>Loại</th><th>Khách hàng</th><th>Dự án</th>
              <th className="text-right">Tổng tiền</th><th className="text-right">Đã TT</th>
              <th>Ngày tạo</th><th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có hóa đơn nào</td></tr>
            ) : invoices.map(inv => {
              const st = STATUS_MAP[inv.status] || STATUS_MAP.DRAFT
              return (
                <tr key={inv.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{inv.invoiceCode}</span></td>
                  <td><span className="badge" style={{ background: inv.type === 'RECEIVABLE' ? '#f0fdf4' : '#fef2f2', color: inv.type === 'RECEIVABLE' ? '#16a34a' : '#dc2626' }}>
                    {inv.type === 'RECEIVABLE' ? '📥 Thu' : '📤 Chi'}
                  </span></td>
                  <td style={{ color: 'var(--text-primary)' }}>{inv.clientName || '-'}</td>
                  <td className="text-xs" style={{ color: 'var(--accent)' }}>{inv.project?.projectCode || '-'}</td>
                  <td className="text-right font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(Number(inv.totalAmount))}</td>
                  <td className="text-right font-mono text-sm" style={{ color: '#16a34a' }}>{Number(inv.paidAmount) > 0 ? fmt(Number(inv.paidAmount)) : '-'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(inv.issueDate).toLocaleDateString('vi-VN')}</td>
                  <td><span className="badge" style={{ background: st.bg, color: st.color }}>{st.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CreateInvoiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    invoiceCode: `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
    type: 'RECEIVABLE', clientName: '', amount: '', taxRate: '10', description: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch('/api/finance/invoices', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  const numAmount = Number(form.amount) || 0
  const tax = numAmount * Number(form.taxRate) / 100
  const total = numAmount + tax

  return (
    <div className="card p-6 animate-fade-in">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tạo hóa đơn mới</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mã HĐ *</label>
          <input className="input" value={form.invoiceCode} onChange={e => setForm({ ...form, invoiceCode: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Loại</label>
          <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="RECEIVABLE">Phải thu (từ khách)</option>
            <option value="PAYABLE">Phải trả (cho NCC)</option>
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Khách hàng / NCC</label>
          <input className="input" value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Số tiền trước thuế *</label>
          <input className="input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>VAT %</label>
          <input className="input" type="number" value={form.taxRate} onChange={e => setForm({ ...form, taxRate: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tổng (auto)</label>
          <div className="input font-semibold" style={{ color: '#16a34a', background: 'var(--bg-primary)' }}>{total.toLocaleString('vi-VN')} VNĐ</div></div>
        <div className="col-span-3 flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
          <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">{submitting ? 'Đang tạo...' : 'Tạo HĐ'}</button>
        </div>
      </form>
    </div>
  )
}
