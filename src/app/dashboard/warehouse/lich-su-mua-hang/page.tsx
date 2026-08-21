'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { Search } from 'lucide-react'

// [PORT Thương Mại — F3] Tra cứu lịch sử mua hàng theo mã vật tư (giá/NCC/GD trong quá khứ).
interface Tx { id: string; source?: 'HĐ' | 'PO'; poCode: string; vendorName: string; orderDate: string | null; qty: number; unitPrice: number; currency: string; totalNoVAT: number; status: string; projectCode: string; projectName: string }
interface Vendor { vendorName: string; txCount: number; totalQty: number; totalValue: number; avgPrice: number; minPrice: number; maxPrice: number }
interface Item {
  itemCode: string; itemName: string; profile: string; grade: string; uom: string
  summary: { totalTransactions: number; totalVendors: number; totalQtyBought: number; totalValueNoVAT: number; avgUnitPrice: number; minUnitPrice: number; maxUnitPrice: number; latestVendor: string | null; latestPrice: number | null; latestDate: string | null }
  vendorSummary: Vendor[]; transactions: Tx[]
}

const fmt = (n: number | null | undefined, c = 'VND') => !n ? '—' : (c === 'VND' ? n.toLocaleString('vi-VN') + ' ₫' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + c)
const fmtDate = (d: string | null | undefined) => !d ? '—' : new Date(d).toLocaleDateString('vi-VN')
const fmtQty = (n: number, uom?: string) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + (uom ? ' ' + uom : '')

// Biểu đồ xu hướng đơn giá theo thời gian (SVG, khớp Commerce PriceTrendChart)
function PriceTrendChart({ txns }: { txns: Tx[] }) {
  const pts = txns.filter(t => t.orderDate && t.unitPrice > 0)
    .map(t => ({ t: new Date(t.orderDate as string).getTime(), p: t.unitPrice, v: t.vendorName, d: t.orderDate as string }))
    .sort((a, b) => a.t - b.t)
  if (pts.length < 2) return null
  const W = 600, H = 120, padL = 8, padR = 8, padT = 12, padB = 16
  const ts = pts.map(p => p.t), ps = pts.map(p => p.p)
  const tMin = Math.min(...ts), tMax = Math.max(...ts), pMin = Math.min(...ps), pMax = Math.max(...ps)
  const x = (t: number) => padL + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - padL - padR)
  const y = (p: number) => padT + (pMax === pMin ? 0.5 : 1 - (p - pMin) / (pMax - pMin)) * (H - padT - padB)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ')
  const area = `${line} L${x(tMax).toFixed(1)},${H - padB} L${x(tMin).toFixed(1)},${H - padB} Z`
  const last = pts[pts.length - 1]
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Xu hướng đơn giá theo thời gian ({pts.length} mốc)</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 110, display: 'block' }} preserveAspectRatio="none">
        <path d={area} fill="var(--accent)" opacity="0.08" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.p)} r={i === pts.length - 1 ? 3.5 : 2.2} fill={i === pts.length - 1 ? '#166534' : 'var(--accent)'}>
            <title>{fmtDate(p.d)} · {fmt(p.p)} · {p.v}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span>{fmtDate(pts[0].d)} · thấp {fmt(pMin)}</span>
        <span>Gần nhất: <b style={{ color: '#166534' }}>{fmt(last.p)}</b> ({fmtDate(last.d)})</span>
        <span>cao {fmt(pMax)}</span>
      </div>
    </div>
  )
}

export default function LichSuMuaHangPage() {
  const sp = useSearchParams()
  const [input, setInput] = useState(sp.get('itemCodes') || '')
  const [data, setData] = useState<Item[]>([])
  const [notFound, setNotFound] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async (codes: string) => {
    const q = codes.trim()
    if (!q) return
    setLoading(true); setSearched(true)
    const r = await apiFetch(`/api/procurement/purchase-history?itemCodes=${encodeURIComponent(q)}`)
    setLoading(false)
    if (r.ok) { setData(r.data || []); setNotFound(r.notFound || []) } else notify(r.error || 'Lỗi tra cứu', 'error')
  }, [])

  useEffect(() => { const q = sp.get('itemCodes'); if (q) search(q) }, [sp, search])

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Lịch sử mua hàng" subtitle="Tra cứu giá — nhà cung cấp — số lần mua theo mã vật tư (từ đơn đặt hàng đã tạo)" />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(input) }} placeholder="Nhập mã vật tư (nhiều mã cách nhau dấu phẩy)…" className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/30" />
        </div>
        <Button variant="primary" onClick={() => search(input)}>Tra cứu</Button>
      </div>

      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>}
      {!loading && searched && data.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Không tìm thấy lịch sử mua cho mã đã nhập.</div>}
      {notFound.length > 0 && <div className="text-xs rounded-lg px-3 py-2" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>Không có lịch sử: {notFound.join(', ')}</div>}

      <div className="space-y-4">
        {data.map(item => (
          <div key={item.itemCode} className="card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold font-mono" style={{ color: 'var(--accent)' }}>{item.itemCode}</span>
              <span className="text-sm text-slate-700">{item.itemName}</span>
              {item.profile && <span className="text-xs text-slate-400">{item.profile}</span>}
              {item.grade && <span className="text-xs text-blue-600">{item.grade}</span>}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                ['Số giao dịch', String(item.summary.totalTransactions)],
                ['Nhà cung cấp', String(item.summary.totalVendors)],
                ['Tổng SL mua', fmtQty(item.summary.totalQtyBought, item.uom)],
                ['Giá TB (min–max)', `${fmt(item.summary.avgUnitPrice)}`],
              ].map(([l, v]) => <div key={l} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)' }}><div className="text-[11px] text-slate-500">{l}</div><div className="text-sm font-semibold text-slate-800">{v}</div></div>)}
            </div>

            {item.vendorSummary.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                    <th className="text-left px-2 py-1.5">Nhà cung cấp</th><th className="text-right px-2 py-1.5">Số GD</th><th className="text-right px-2 py-1.5">Tổng SL</th>
                    <th className="text-right px-2 py-1.5">Giá TB</th><th className="text-right px-2 py-1.5">Thấp nhất</th><th className="text-right px-2 py-1.5">Cao nhất</th>
                  </tr></thead>
                  <tbody>
                    {item.vendorSummary.map(v => (
                      <tr key={v.vendorName} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-1">{v.vendorName}</td>
                        <td className="px-2 py-1 text-right font-mono">{v.txCount}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtQty(v.totalQty, item.uom)}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(v.avgPrice)}</td>
                        <td className="px-2 py-1 text-right font-mono text-emerald-700">{fmt(v.minPrice)}</td>
                        <td className="px-2 py-1 text-right font-mono text-red-600">{fmt(v.maxPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <PriceTrendChart txns={item.transactions} />

            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Chi tiết giao dịch ({item.transactions.length})</div>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                    <th className="text-left px-2 py-1.5">Ngày</th><th className="text-left px-2 py-1.5">Chứng từ</th><th className="text-left px-2 py-1.5">NCC</th>
                    <th className="text-right px-2 py-1.5">SL</th><th className="text-right px-2 py-1.5">Đơn giá</th><th className="text-right px-2 py-1.5">Thành tiền</th>
                    <th className="text-left px-2 py-1.5">Dự án</th><th className="text-left px-2 py-1.5">TT</th>
                  </tr></thead>
                  <tbody>
                    {item.transactions.map(t => (
                      <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-1 whitespace-nowrap">{fmtDate(t.orderDate)}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {t.source && <span className="mr-1 px-1 py-0.5 rounded text-[10px] font-semibold" style={{ background: t.source === 'HĐ' ? '#dcfce7' : '#e0e7ff', color: t.source === 'HĐ' ? '#166534' : '#3730a3' }}>{t.source}</span>}
                          <span className="font-mono" style={{ color: 'var(--accent)' }}>{t.poCode}</span>
                        </td>
                        <td className="px-2 py-1">{t.vendorName}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtQty(t.qty, item.uom)}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(t.unitPrice, t.currency)}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(t.totalNoVAT, t.currency)}</td>
                        <td className="px-2 py-1 font-mono text-slate-500">{t.projectCode || '—'}</td>
                        <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">{t.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
