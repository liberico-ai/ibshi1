'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Search, ChevronRight, ChevronDown } from 'lucide-react'

// [PORT Thương Mại — Module 4] Danh sách Hợp đồng toàn cục (mọi dự án). Tạo/sửa HĐ vẫn ở trang dự án.
interface PO { id: string; poCode: string; status: string; totalValue: number }
interface Contract {
  id: string; contractCode: string; contractType: string; title: string; value: number; currency: string
  signedDate: string | null; effectiveDate: string | null; status: string
  vendorName: string; projectCode: string | null; projectName: string; poCount: number; poTotal: number; orders: PO[]
}
interface Summary { total: number; draft: number; active: number; completed: number; cancelled: number; totalValue: number }

const TYPE_LABEL: Record<string, string> = { HDMB: 'HĐ mua bán', HDKT: 'HĐ kinh tế', KHAC: 'Khác' }
const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'bg-slate-100 text-slate-600' },
  ACTIVE: { label: 'Hiệu lực', cls: 'bg-emerald-100 text-emerald-700' },
  COMPLETED: { label: 'Hoàn thành', cls: 'bg-blue-100 text-blue-700' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-red-100 text-red-600' },
}
const fmtM = (n: number) => (n ? formatCurrency(n) : '—')

export default function HopDongPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [vendor, setVendor] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (vendor) qs.set('vendor', vendor)
    if (type) qs.set('type', type)
    if (status) qs.set('status', status)
    const r = await apiFetch(`/api/purchase-contracts?${qs}`)
    setLoading(false)
    if (r.ok) { setContracts(r.contracts || []); setSummary(r.summary || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [vendor, type, status])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Hợp đồng" subtitle="Danh sách hợp đồng mua hàng toàn hệ thống — tra cứu, lọc theo NCC / loại / trạng thái. Tạo & sửa HĐ ở trang dự án." />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Tìm theo nhà cung cấp…" className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/30" />
        </div>
        <select value={type} onChange={e => setType(e.target.value)} className="input text-sm" style={{ maxWidth: 180 }}>
          <option value="">— Loại HĐ —</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="input text-sm" style={{ maxWidth: 160 }}>
          <option value="">— Trạng thái —</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {(vendor || type || status) && <button onClick={() => { setVendor(''); setType(''); setStatus('') }} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>✕ Bỏ lọc</button>}
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-4">
          {[
            { label: 'Tổng HĐ', value: String(summary.total), color: 'text-slate-800' },
            { label: 'Hiệu lực', value: String(summary.active), color: 'text-emerald-600' },
            { label: 'Hoàn thành', value: String(summary.completed), color: 'text-blue-600' },
            { label: 'Nháp', value: String(summary.draft), color: 'text-slate-500' },
            { label: 'Tổng giá trị', value: fmtM(summary.totalValue), color: 'text-emerald-700' },
          ].map(k => <div key={k.label} className="flex items-center gap-1.5"><span className={`text-lg font-bold ${k.color}`}>{k.value}</span><span className="text-xs text-slate-500">{k.label}</span></div>)}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>}
      {!loading && contracts.length === 0 && <div className="text-center py-16 text-slate-400 text-sm">Chưa có hợp đồng nào{(vendor || type || status) ? ' khớp bộ lọc' : ''}. Tạo hợp đồng ở trang dự án (Đơn đặt hàng → Hợp đồng).</div>}

      {contracts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                <th className="px-2 py-2 w-6"></th>
                {['Số HĐ', 'Loại', 'Tên hợp đồng', 'Nhà cung cấp', 'Dự án', 'Giá trị', 'Ngày ký', 'Số PO', 'Trạng thái'].map(h => (
                  <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {contracts.map(c => {
                  const st = STATUS[c.status] || STATUS.DRAFT
                  const open = expanded.has(c.id)
                  return (
                    <Fragment key={c.id}>
                      <tr style={{ borderTop: '1px solid var(--border)', cursor: c.orders.length ? 'pointer' : 'default' }} onClick={() => c.orders.length && toggle(c.id)}>
                        <td className="px-2 py-1.5 text-center">{c.orders.length ? (open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />) : ''}</td>
                        <td className="px-2 py-1.5 font-mono font-bold" style={{ color: 'var(--accent)' }}>{c.contractCode}</td>
                        <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">{TYPE_LABEL[c.contractType] || c.contractType}</span></td>
                        <td className="px-2 py-1.5 max-w-[220px] truncate" title={c.title}>{c.title}</td>
                        <td className="px-2 py-1.5">{c.vendorName}</td>
                        <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{c.projectCode || '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmtM(c.value)}</td>
                        <td className="px-2 py-1.5">{c.signedDate ? formatDate(c.signedDate) : '—'}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{c.poCount}</td>
                        <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span></td>
                      </tr>
                      {open && c.orders.length > 0 && (
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <td></td>
                          <td colSpan={8} className="px-2 py-2">
                            <div className="text-[11px] font-semibold text-slate-600 mb-1">Đơn đặt hàng thuộc hợp đồng ({c.poCount}) · tổng {fmtM(c.poTotal)}</div>
                            <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                              <tbody>
                                {c.orders.map(o => (
                                  <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{o.poCode}</td>
                                    <td className="px-2 py-1 text-right font-mono">{fmtM(o.totalValue)}</td>
                                    <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">{o.status}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
