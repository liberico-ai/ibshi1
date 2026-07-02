'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate, formatNumber, formatCurrency } from '@/lib/utils'
import { FINANCE_WRITE_ROLES } from '@/lib/constants'

interface Invoice {
  id: string; invoiceCode: string; type: string; status: string; clientName: string | null;
  amount: number; taxAmount: number; totalAmount: number; paidAmount: number;
  dueDate: string | null; createdAt: string;
  project: { projectCode: string; projectName: string } | null
}

interface Receipt {
  id: string; amount: number; method: string; receivedAt: string;
  referenceNo: string | null; notes: string | null; createdBy: string; createdAt: string
}

const statusLabel: Record<string, string> = { DRAFT: 'Nháp', SENT: 'Đã gửi', PAID: 'Đã TT', PARTIAL: 'TT 1 phần', OVERDUE: 'Quá hạn', CANCELLED: 'Hủy' }
const statusColor: Record<string, string> = { DRAFT: '#888', SENT: '#0ea5e9', PAID: '#16a34a', PARTIAL: '#f59e0b', OVERDUE: '#dc2626', CANCELLED: '#888' }
const methodLabel: Record<string, string> = { BANK: 'Chuyển khoản', CASH: 'Tiền mặt', OTHER: 'Khác' }

const emptyForm = { amount: '', method: 'BANK', receivedAt: new Date().toISOString().slice(0, 10), referenceNo: '', notes: '' }

export default function InvoicesPage() {
  const user = useAuthStore(s => s.user)
  const canWrite = !!user && (FINANCE_WRITE_ROLES as readonly string[]).includes(user.roleCode)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [totals, setTotals] = useState({ receivable: 0, payable: 0, paid: 0, outstanding: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  // Chi tiết hóa đơn + lịch sử thu tiền (RECEIVABLE)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptsLoading, setReceiptsLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => {
    const url = filter ? `/api/finance/invoices?type=${filter}` : '/api/finance/invoices'
    apiFetch(url).then(res => {
      if (res.ok) { setInvoices(res.invoices || []); setTotals(res.totals || totals) }
      setLoading(false)
    })
  }
  useEffect(() => { load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadReceipts = async (invoiceId: string) => {
    setReceiptsLoading(true)
    try {
      const res = await apiFetch(`/api/finance/receipts?invoiceId=${invoiceId}`)
      setReceipts(res.ok ? (res.receipts || []) : [])
    } finally {
      setReceiptsLoading(false)
    }
  }

  const openDetail = (inv: Invoice) => {
    setDetail(inv)
    setMessage('')
    setShowForm(false)
    setForm({ ...emptyForm })
    if (inv.type === 'RECEIVABLE') loadReceipts(inv.id)
    else setReceipts([])
  }

  const closeDetail = () => { setDetail(null); setReceipts([]); setShowForm(false); setMessage('') }

  const submitReceipt = async () => {
    if (!detail || saving) return
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { setMessage('Số tiền phải > 0'); return }
    setSaving(true)
    try {
      const res = await apiFetch('/api/finance/receipts', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: detail.id,
          amount,
          method: form.method,
          receivedAt: form.receivedAt || undefined,
          referenceNo: form.referenceNo || undefined,
          notes: form.notes || undefined,
        }),
      })
      if (res.ok) {
        setMessage(res.message || 'Đã ghi nhận thu tiền')
        setShowForm(false)
        setForm({ ...emptyForm })
        await loadReceipts(detail.id)
        // Refresh bảng + số liệu đã thu trên panel chi tiết
        const listRes = await apiFetch(filter ? `/api/finance/invoices?type=${filter}` : '/api/finance/invoices')
        if (listRes.ok) {
          setInvoices(listRes.invoices || [])
          setTotals(listRes.totals || totals)
          const updated = (listRes.invoices || []).find((i: Invoice) => i.id === detail.id)
          if (updated) setDetail(updated)
        }
      } else {
        setMessage(res.error || 'Không ghi nhận được thu tiền')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const fmt = (n: number) => formatNumber(n)
  const collected = receipts.reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Hóa đơn</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{invoices.length} hóa đơn</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Phải thu</p><p className="text-lg font-bold" style={{ color: '#16a34a' }}>{fmt(totals.receivable)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Phải trả</p><p className="text-lg font-bold" style={{ color: '#dc2626' }}>{fmt(totals.payable)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Đã thanh toán</p><p className="text-lg font-bold" style={{ color: '#0ea5e9' }}>{fmt(totals.paid)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Còn lại</p><p className="text-lg font-bold" style={{ color: '#f59e0b' }}>{fmt(totals.outstanding)} ₫</p></div>
      </div>

      <div className="flex gap-2">
        {([['', 'Tất cả'], ['RECEIVABLE', 'Phải thu'], ['PAYABLE', 'Phải trả']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === v ? 'var(--accent)' : 'var(--surface-hover)', color: filter === v ? '#fff' : 'var(--text-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã HĐ</th><th>Loại</th><th>Khách</th><th>Dự án</th><th className="text-right">Giá trị</th><th className="text-right">Đã TT</th><th>Hạn</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có hóa đơn</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{inv.invoiceCode}</span></td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: inv.type === 'RECEIVABLE' ? '#16a34a20' : '#dc262620', color: inv.type === 'RECEIVABLE' ? '#16a34a' : '#dc2626' }}>{inv.type === 'RECEIVABLE' ? 'Thu' : 'Trả'}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{inv.clientName || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{inv.project?.projectName || inv.project?.projectCode || '—'}</td>
                <td className="text-right text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(inv.totalAmount)} ₫</td>
                <td className="text-right text-xs" style={{ color: '#16a34a' }}>{fmt(inv.paidAmount)} ₫</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[inv.status] || '#888'}20`, color: statusColor[inv.status] || '#888' }}>{statusLabel[inv.status] || inv.status}</span></td>
                <td>
                  <button onClick={() => openDetail(inv)} className="text-xs px-2 py-1 rounded-lg font-medium"
                    style={{ background: 'var(--surface-hover)', color: 'var(--accent)' }}>
                    Chi tiết
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal chi tiết hóa đơn + lịch sử thu tiền ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={closeDetail}>
          <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  <span className="font-mono" style={{ color: 'var(--accent)' }}>{detail.invoiceCode}</span>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: detail.type === 'RECEIVABLE' ? '#16a34a20' : '#dc262620', color: detail.type === 'RECEIVABLE' ? '#16a34a' : '#dc2626' }}>
                    {detail.type === 'RECEIVABLE' ? 'Phải thu' : 'Phải trả'}
                  </span>
                </h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {detail.clientName || '—'} · {detail.project?.projectName || detail.project?.projectCode || 'Không gắn dự án'}
                </p>
              </div>
              <button onClick={closeDetail} className="text-sm px-2 py-1 rounded-lg" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>✕</button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Giá trị hóa đơn</p>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(detail.totalAmount)}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Đã thu</p>
                <p className="text-sm font-bold" style={{ color: '#16a34a' }}>{formatCurrency(detail.paidAmount)}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Còn lại</p>
                <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>{formatCurrency(detail.totalAmount - detail.paidAmount)}</p>
              </div>
            </div>

            {message && <p className="text-xs font-medium" style={{ color: 'var(--accent)' }}>{message}</p>}

            {detail.type === 'RECEIVABLE' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Lịch sử thu tiền ({receipts.length})</h3>
                  {canWrite && !showForm && (
                    <button onClick={() => { setMessage(''); setShowForm(true) }} className="text-xs px-3 py-1.5 rounded-lg font-bold"
                      style={{ background: 'var(--accent)', color: '#fff' }}>
                      + Ghi nhận thu tiền
                    </button>
                  )}
                </div>

                {showForm && (
                  <div className="p-3 rounded-lg space-y-2" style={{ background: 'var(--surface-hover)' }}>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Số tiền (VNĐ) *</label>
                        <input type="number" min={0} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                          className="w-full mt-1 p-2 rounded-lg text-sm" style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                      </div>
                      <div>
                        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Hình thức</label>
                        <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                          className="w-full mt-1 p-2 rounded-lg text-sm" style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                          <option value="BANK">Chuyển khoản</option>
                          <option value="CASH">Tiền mặt</option>
                          <option value="OTHER">Khác</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Ngày thu</label>
                        <input type="date" value={form.receivedAt} onChange={e => setForm(f => ({ ...f, receivedAt: e.target.value }))}
                          className="w-full mt-1 p-2 rounded-lg text-sm" style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                      </div>
                      <div>
                        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Số chứng từ (UNC/phiếu thu)</label>
                        <input type="text" value={form.referenceNo} onChange={e => setForm(f => ({ ...f, referenceNo: e.target.value }))}
                          className="w-full mt-1 p-2 rounded-lg text-sm" style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Ghi chú</label>
                      <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                        className="w-full mt-1 p-2 rounded-lg text-sm" style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={submitReceipt} disabled={saving} className="text-xs px-3 py-1.5 rounded-lg font-bold"
                        style={{ background: 'var(--accent)', color: '#fff', opacity: saving ? 0.6 : 1 }}>
                        {saving ? 'Đang lưu…' : 'Lưu phiếu thu'}
                      </button>
                      <button onClick={() => setShowForm(false)} disabled={saving} className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        Hủy
                      </button>
                    </div>
                  </div>
                )}

                {receiptsLoading ? (
                  <div className="h-12 skeleton rounded-lg" />
                ) : receipts.length === 0 ? (
                  <p className="text-xs py-3 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có phiếu thu nào</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead><tr><th>Ngày thu</th><th>Hình thức</th><th>Số chứng từ</th><th className="text-right">Số tiền</th><th>Ghi chú</th></tr></thead>
                      <tbody>
                        {receipts.map(r => (
                          <tr key={r.id}>
                            <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{formatDate(r.receivedAt)}</td>
                            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{methodLabel[r.method] || r.method}</td>
                            <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{r.referenceNo || '—'}</td>
                            <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{formatCurrency(r.amount)}</td>
                            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={3} className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Tổng đã thu</td>
                          <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{formatCurrency(collected)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
