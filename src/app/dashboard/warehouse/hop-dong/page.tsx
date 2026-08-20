'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { Search, ChevronRight, ChevronDown } from 'lucide-react'

// [PORT Thương Mại — Module 4] Danh sách Hợp đồng toàn cục (mọi dự án). Tạo/sửa HĐ vẫn ở trang dự án.
interface PO { id: string; poCode: string; status: string; totalValue: number }
interface CItem { id: string; itemCode: string | null; description: string | null; unit: string | null; actualProfile: string | null; actualGrade: string | null; contractQty: number; contractWeight: number; unitPriceNoVat: number; currency: string; totalNoVat: number; deliveredQty: number; lineStatus: string; inspections: Array<{ type: string; reportNo: string | null; acceptedQty: number; result: string | null }> }
interface Contract {
  id: string; contractCode: string; contractType: string; tradeType?: string | null; title: string; value: number; currency: string
  signedDate: string | null; effectiveDate: string | null; arrivedDate?: string | null; status: string
  vendorName: string; projectCode: string | null; projectName: string; itemCount?: number; poCount: number; poTotal: number; orders: PO[]
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
  const [items, setItems] = useState<Record<string, CItem[]>>({})

  const fetchItems = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/purchase-contracts/${id}/items`)
    if (r.ok) setItems(p => ({ ...p, [id]: r.items || [] }))
  }, [])
  const importItems = async (id: string, file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const pick = (r: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) if (r[k] !== undefined && r[k] !== '') return r[k]; return '' }
      const rows = raw.map(r => ({
        itemCode: pick(r, 'Mã VT', 'Mã', 'itemCode'), description: pick(r, 'Mô tả', 'Tên vật tư', 'description'),
        unit: pick(r, 'ĐVT', 'unit'), actualProfile: pick(r, 'Quy cách', 'Profile', 'actualProfile'), actualGrade: pick(r, 'Mác', 'Grade', 'actualGrade'),
        contractQty: pick(r, 'SL', 'Số lượng', 'contractQty'), contractWeight: pick(r, 'KL', 'Khối lượng', 'contractWeight'),
        unitPriceNoVat: pick(r, 'Đơn giá', 'unitPriceNoVat'), currency: pick(r, 'Tiền tệ', 'currency'), vatRate: pick(r, 'VAT', 'vatRate'),
      }))
      if (rows.length === 0) { notify('File không có dòng nào', 'error'); return }
      const res = await apiFetch(`/api/purchase-contracts/${id}/items/import`, { method: 'POST', body: JSON.stringify({ rows }) })
      if (res.ok) { notify(res.message || 'Đã nhập', 'success'); fetchItems(id); load() } else notify(res.error || 'Lỗi nhập', 'error')
    } catch (e) { console.error(e); notify('Không đọc được file Excel', 'error') }
  }

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

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); if (n.has(id)) { n.delete(id) } else { n.add(id); if (!items[id]) fetchItems(id) } return n })

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
                      <tr style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => toggle(c.id)}>
                        <td className="px-2 py-1.5 text-center">{open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}</td>
                        <td className="px-2 py-1.5 font-mono font-bold" style={{ color: 'var(--accent)' }}>{c.contractCode}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">{TYPE_LABEL[c.contractType] || c.contractType}</span>
                          {c.tradeType && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: c.tradeType === 'IMPORT' ? '#eef2ff' : '#f0fdf4', color: c.tradeType === 'IMPORT' ? '#4338ca' : '#166534' }}>{c.tradeType === 'IMPORT' ? 'Nhập khẩu' : 'Nội địa'}</span>}
                          {!!c.itemCount && <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>· {c.itemCount} dòng</span>}
                        </td>
                        <td className="px-2 py-1.5 max-w-[220px] truncate" title={c.title}>{c.title}</td>
                        <td className="px-2 py-1.5">{c.vendorName}</td>
                        <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{c.projectCode || '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmtM(c.value)}</td>
                        <td className="px-2 py-1.5">{c.signedDate ? formatDate(c.signedDate) : '—'}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{c.poCount}</td>
                        <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span></td>
                      </tr>
                      {open && (
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <td></td>
                          <td colSpan={9} className="px-2 py-2 space-y-3">
                            {/* Dòng chi tiết hợp đồng */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-semibold text-slate-600">Dòng chi tiết hợp đồng ({items[c.id]?.length ?? '…'})</span>
                                <label className="text-[11px] px-2 py-1 rounded cursor-pointer" style={{ border: '1px solid #16a34a', color: '#166534', background: '#f0fdf4' }} onClick={e => e.stopPropagation()} title='Cột: Mã VT · Mô tả · ĐVT · Quy cách · Mác · SL · KL · Đơn giá'>
                                  ⬆ Nhập dòng từ Excel
                                  <input type="file" accept=".xlsx,.xls" hidden onClick={e => e.stopPropagation()} onChange={e => { const f = e.target.files?.[0]; if (f) importItems(c.id, f); e.currentTarget.value = '' }} />
                                </label>
                              </div>
                              {!items[c.id] ? <div className="text-[11px] text-slate-400">Đang tải…</div>
                                : items[c.id].length === 0 ? <div className="text-[11px] text-slate-400">Chưa có dòng chi tiết — nhập từ Excel.</div>
                                  : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                                        <thead><tr style={{ color: 'var(--text-muted)' }}>
                                          {['Mã VT', 'Mô tả', 'QC / Mác', 'ĐVT', 'SL', 'KL(kg)', 'Đơn giá', 'Thành tiền', 'Đã giao', 'QC', 'TT'].map(h => <th key={h} className="px-2 py-1 text-left whitespace-nowrap">{h}</th>)}
                                        </tr></thead>
                                        <tbody>
                                          {items[c.id].map(it => (
                                            <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                                              <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                                              <td className="px-2 py-1 max-w-[200px] truncate" title={it.description || ''}>{it.description || '—'}</td>
                                              <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.actualProfile || '—'}{it.actualGrade ? ` / ${it.actualGrade}` : ''}</td>
                                              <td className="px-2 py-1">{it.unit || ''}</td>
                                              <td className="px-2 py-1 text-right font-mono">{formatNumber(it.contractQty)}</td>
                                              <td className="px-2 py-1 text-right font-mono">{formatNumber(it.contractWeight)}</td>
                                              <td className="px-2 py-1 text-right font-mono">{formatNumber(it.unitPriceNoVat)} <span style={{ color: 'var(--text-muted)' }}>{it.currency !== 'VND' ? it.currency : ''}</span></td>
                                              <td className="px-2 py-1 text-right font-mono font-semibold" style={{ color: '#166534' }}>{fmtM(it.totalNoVat)}</td>
                                              <td className="px-2 py-1 text-right font-mono">{formatNumber(it.deliveredQty)}</td>
                                              <td className="px-2 py-1 text-center">{it.inspections.length > 0 ? <span title={it.inspections.map(q => `${q.type}: ${q.result || '—'}`).join(' · ')}>✓{it.inspections.length}</span> : '—'}</td>
                                              <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">{it.lineStatus}</span></td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                            </div>
                            {/* PO thuộc HĐ */}
                            {c.orders.length > 0 && (
                              <div>
                                <div className="text-[11px] font-semibold text-slate-600 mb-1">Đơn đặt hàng ({c.poCount}) · tổng {fmtM(c.poTotal)}</div>
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
                              </div>
                            )}
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
