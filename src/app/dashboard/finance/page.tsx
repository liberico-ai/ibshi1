'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { PageHeader, StatCard, DataTable, StatusBadge, Button, type Column } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { TrendingUp, TrendingDown, CreditCard, Clock } from 'lucide-react'

interface Invoice {
  id: string; invoiceCode: string; type: string; clientName: string | null;
  description: string | null; amount: string; totalAmount: string; paidAmount: string;
  status: string; issueDate: string; dueDate: string | null;
  project: { projectCode: string; projectName: string } | null
}
interface Totals { receivable: number; payable: number; paid: number; outstanding: number }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

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

  const fmt = (v: number) => formatNumber(v)

  const columns: Column<Invoice>[] = [
    { key: 'invoiceCode', label: 'Mã HĐ', mono: true, render: (inv) => (
      <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{inv.invoiceCode}</span>
    )},
    { key: 'type', label: 'Loại', render: (inv) => (
      <StatusBadge category={inv.type === 'RECEIVABLE' ? 'payment' : 'ncr'} status={inv.type === 'RECEIVABLE' ? 'PAID' : 'OPEN'} />
    )},
    { key: 'clientName', label: 'Khách hàng', render: (inv) => inv.clientName || '-' },
    { key: 'project', label: 'Dự án', render: (inv) => (
      <span className="text-xs" style={{ color: 'var(--accent)' }}>{inv.project?.projectCode || '-'}</span>
    )},
    { key: 'totalAmount', label: 'Tổng tiền', align: 'right', mono: true, render: (inv) => (
      <span className="font-semibold">{fmt(Number(inv.totalAmount))}</span>
    )},
    { key: 'paidAmount', label: 'Đã TT', align: 'right', mono: true, render: (inv) => (
      <span style={{ color: SEMANTIC_COLORS.success.solid }}>{Number(inv.paidAmount) > 0 ? fmt(Number(inv.paidAmount)) : '-'}</span>
    )},
    { key: 'issueDate', label: 'Ngày tạo', render: (inv) => (
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(inv.issueDate)}</span>
    )},
    { key: 'status', label: 'Trạng thái', render: (inv) => (
      <StatusBadge category="invoice" status={inv.status} />
    )},
  ]

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Tài chính"
        subtitle={`${pagination.total} hóa đơn`}
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Tạo hóa đơn</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Phải thu (VNĐ)" value={fmt(totals.receivable)} color={SEMANTIC_COLORS.success.solid} icon={<TrendingUp size={20} />} />
        <StatCard label="Phải trả" value={fmt(totals.payable)} color={SEMANTIC_COLORS.danger.solid} icon={<TrendingDown size={20} />} />
        <StatCard label="Đã thanh toán" value={fmt(totals.paid)} color={SEMANTIC_COLORS.info.solid} icon={<CreditCard size={20} />} />
        <StatCard label="Còn lại" value={fmt(totals.outstanding)} color={totals.outstanding > 0 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.success.solid} icon={<Clock size={20} />} accent={totals.outstanding > 0} />
      </div>

      {showCreate && <CreateInvoiceForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}

      <div className="flex gap-3 items-center">
        <input className="input w-72" placeholder="Tìm mã HĐ, tên KH..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2">
          {[{ v: '', l: 'Tất cả' }, { v: 'RECEIVABLE', l: 'Phải thu' }, { v: 'PAYABLE', l: 'Phải trả' }].map(f => (
            <button key={f.v} onClick={() => setTypeFilter(f.v)} className={`filter-pill ${typeFilter === f.v ? 'active' : ''}`}>{f.l}</button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={invoices}
        rowKey={(inv) => inv.id}
        emptyText="Chưa có hóa đơn nào"
      />
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
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: 'var(--danger-light, #fef2f2)', color: 'var(--danger)' }}>{error}</div>}
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
          <div className="input font-semibold" style={{ color: SEMANTIC_COLORS.success.solid, background: 'var(--bg-primary)' }}>{formatCurrency(total)}</div></div>
        <div className="col-span-3 flex gap-3 justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo HĐ'}</Button>
        </div>
      </form>
    </div>
  )
}
