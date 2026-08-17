'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatNumber } from '@/lib/utils'

// [PORT Thương Mại — F1] Kiểm tra tồn kho trước RFQ: soát tồn khả dụng → phân bổ dùng từ tồn → tính lại "cần mua".
interface Inv { currentStock: number; reservedStock: number; availableQty: number }
interface Row { prDetailId: string; itemCode: string; itemName: string; profile: string; grade: string; uom: string; reqQty: number; remainQty: number; toBuyQty: number; inventory: Inv | null; stockStatus: string; suggestedUseFromStock: number }
interface Summary { total: number; hasStock: number; partial: number; noStock: number }
interface PROpt { id: string; prCode: string; project?: { projectCode: string } | null }

const ST: Record<string, { label: string; cls: string }> = {
  HAS_STOCK: { label: 'Còn đủ tồn', cls: 'bg-emerald-100 text-emerald-700' },
  PARTIAL: { label: 'Còn một phần', cls: 'bg-amber-100 text-amber-700' },
  NO_STOCK: { label: 'Không tồn', cls: 'bg-slate-100 text-slate-500' },
}
const nn = (v: number) => (v ? formatNumber(v) : '0')

export default function KiemTraTonKhoPage() {
  const sp = useSearchParams()
  const [prs, setPrs] = useState<PROpt[]>([])
  const [prId, setPrId] = useState(sp.get('prId') || '')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { apiFetch('/api/purchase-requests?limit=100').then(r => { if (r.ok) setPrs(r.purchaseRequests || []) }) }, [])

  const load = useCallback(async () => {
    if (!prId) { setRows([]); setSummary(null); setEdited({}); return }
    setLoading(true)
    const r = await apiFetch(`/api/procurement/inventory-check?prId=${prId}`)
    setLoading(false)
    if (r.ok) {
      const rr: Row[] = r.rows || []
      setRows(rr); setSummary(r.summary || null)
      // Khởi tạo "dùng từ tồn": ưu tiên remainQty đã lưu, else gợi ý = min(tồn, yêu cầu)
      const init: Record<string, string> = {}
      rr.forEach(x => { init[x.prDetailId] = String(x.remainQty > 0 ? x.remainQty : x.suggestedUseFromStock) })
      setEdited(init)
    } else notify(r.error || 'Lỗi tải', 'error')
  }, [prId])
  useEffect(() => { load() }, [load])

  const setUse = (id: string, val: string) => setEdited(p => ({ ...p, [id]: val }))
  const dirty = rows.some(r => Number(edited[r.prDetailId] || 0) !== r.remainQty)

  const save = async () => {
    const updates = rows.map(r => ({ prDetailId: r.prDetailId, remainQty: Number(edited[r.prDetailId] || 0) }))
    setSaving(true)
    const r = await apiFetch('/api/procurement/inventory-check', { method: 'PATCH', body: JSON.stringify({ updates }) })
    setSaving(false)
    if (r.ok) { notify(r.message || 'Đã lưu phân bổ tồn', 'success'); load() } else notify(r.error || 'Lỗi lưu', 'error')
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Kiểm tra tồn kho" subtitle="Soát tồn khả dụng cho từng dòng vật tư PR → phân bổ dùng từ tồn → tính lại số cần mua (trước khi RFQ)" />

      <div className="flex items-center gap-3 flex-wrap">
        <select value={prId} onChange={e => setPrId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn phiếu yêu cầu (PR) —</option>
          {prs.map(p => <option key={p.id} value={p.id}>{p.prCode}{p.project?.projectCode ? ` — ${p.project.projectCode}` : ''}</option>)}
        </select>
        {rows.length > 0 && <Button variant="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Đang lưu…' : `Lưu phân bổ tồn${dirty ? '' : ' (chưa đổi)'}`}</Button>}
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-4">
          {[
            { label: 'Tổng dòng', value: summary.total, color: 'text-slate-800' },
            { label: 'Còn đủ tồn', value: summary.hasStock, color: 'text-emerald-600' },
            { label: 'Còn một phần', value: summary.partial, color: 'text-amber-600' },
            { label: 'Không tồn', value: summary.noStock, color: 'text-slate-500' },
          ].map(k => <div key={k.label} className="flex items-center gap-1.5"><span className={`text-lg font-bold ${k.color}`}>{k.value}</span><span className="text-xs text-slate-500">{k.label}</span></div>)}
        </div>
      )}

      {!prId && <div className="text-center py-16 text-slate-400 text-sm">Chọn 1 phiếu yêu cầu (PR) để kiểm tra tồn kho.</div>}
      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                {['Mã VT', 'Tên vật tư', 'Quy cách / Mác', 'ĐVT', 'SL yêu cầu', 'Tồn khả dụng', 'Dùng từ tồn ✎', 'Cần mua', 'Trạng thái'].map(h => (
                  <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const st = ST[r.stockStatus] || ST.NO_STOCK
                  const use = Number(edited[r.prDetailId] || 0)
                  const avail = r.inventory?.availableQty ?? 0
                  const over = use > avail // dùng vượt tồn khả dụng
                  const overReq = use > r.reqQty // dùng vượt yêu cầu
                  const toBuy = Math.max(0, r.reqQty - use)
                  return (
                    <tr key={r.prDetailId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--accent)' }}>{r.itemCode || '—'}</td>
                      <td className="px-2 py-1.5">{r.itemName}</td>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{r.profile || '—'}{r.grade && ` / ${r.grade}`}</td>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{r.uom}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{nn(r.reqQty)}</td>
                      <td className="px-2 py-1.5 text-right font-mono" style={{ color: avail > 0 ? '#16a34a' : 'var(--text-muted)' }}>{r.inventory ? nn(avail) : '—'}</td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" value={edited[r.prDetailId] ?? ''} onChange={e => setUse(r.prDetailId, e.target.value)}
                          className="input text-xs text-right" style={{ width: 90, borderColor: (over || overReq) ? '#f59e0b' : undefined }}
                          title={over ? 'Dùng vượt tồn khả dụng' : overReq ? 'Dùng vượt số yêu cầu' : ''} placeholder="0" />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">{nn(toBuy)}</td>
                      <td className="px-2 py-1.5"><span className={`px-2 py-0.5 rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span></td>
                    </tr>
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
