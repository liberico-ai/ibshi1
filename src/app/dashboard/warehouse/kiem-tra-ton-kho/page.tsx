'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import * as XLSX from 'xlsx'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatNumber } from '@/lib/utils'
import PurchaseHistoryPanel from '@/components/PurchaseHistoryPanel'

// [PORT Thương Mại — F1] Kiểm tra tồn kho trước RFQ: soát tồn khả dụng → phân bổ dùng từ tồn → tính lại "cần mua".
interface Inv { currentStock: number; reservedStock: number; availableQty: number; matchedBy?: string; matchedCodes?: string[] }
interface Row { prDetailId: string; itemCode: string; itemName: string; profile: string; grade: string; uom: string; reqQty: number; remainQty: number; toBuyQty: number; inventory: Inv | null; stockStatus: string; suggestedUseFromStock: number; pegMaterialId: string | null; peggedQty: number }
interface Summary { total: number; hasStock: number; partial: number; noStock: number; matchedByAttr?: number }
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
  const [prStatus, setPrStatus] = useState<string>('')
  const roleCode = useAuthStore(s => s.user?.roleCode)
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [historyItem, setHistoryItem] = useState<{ itemCode: string; itemName: string } | null>(null)
  const [stockResult, setStockResult] = useState<{ updated: number; created?: number; soKhongThayMa: number; notFound: string[] } | null>(null)
  const [createMissing, setCreateMissing] = useState(false)

  const importStock = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const rows = raw.map(r => ({
        materialCode: r['Mã kho'] ?? r['Mã vật tư'] ?? r['Mã'] ?? r['materialCode'] ?? r['Code'],
        stock: r['Tồn'] ?? r['Tồn kho'] ?? r['Số lượng'] ?? r['SL'] ?? r['stock'],
        materialName: r['Tên vật tư'] ?? r['Tên'] ?? r['Diễn giải'] ?? r['Name'],
        unit: r['ĐVT'] ?? r['Đơn vị'] ?? r['Đơn vị tính'] ?? r['Unit'],
      }))
      if (rows.length === 0) { notify('File không có dòng nào', 'error'); return }
      const res = await apiFetch('/api/procurement/inventory-check/import-stock', { method: 'POST', body: JSON.stringify({ rows, createMissing }) })
      if (res.ok) { notify(res.message || 'Đã nhập tồn', 'success'); setStockResult({ updated: res.updated, created: res.created, soKhongThayMa: res.soKhongThayMa, notFound: res.notFound || [] }); load() }
      else notify(res.error || 'Lỗi nhập tồn', 'error')
    } catch (e) { console.error(e); notify('Không đọc được file Excel (cần cột "Mã kho" + "Tồn")', 'error') }
  }

  useEffect(() => { apiFetch('/api/purchase-requests?limit=100').then(r => { if (r.ok) setPrs(r.purchaseRequests || []) }) }, [])

  const load = useCallback(async () => {
    if (!prId) { setRows([]); setSummary(null); setEdited({}); setPrStatus(''); return }
    setLoading(true)
    const r = await apiFetch(`/api/procurement/inventory-check?prId=${prId}`)
    setLoading(false)
    if (r.ok) {
      const rr: Row[] = r.rows || []
      setRows(rr); setSummary(r.summary || null); setPrStatus(r.prStatus || '')
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

  // #5 — xem lịch sử rev của PR đang chọn.
  const [revData, setRevData] = useState<{ prCode: string; currentRev: number; currentLineCount: number; revisions: Array<{ revNo: number; lineCount: number; changedAt: string; note: string | null; sampleItems: Array<{ itemCode: string | null; description: string | null; quantity: number | null; unit: string | null }> }> } | null>(null)
  const [revOpen, setRevOpen] = useState(false)
  const loadRev = async () => {
    if (!prId) return
    const r = await apiFetch(`/api/purchase-requests/${prId}/revisions`)
    if (r.ok) { setRevData(r as never); setRevOpen(true) } else notify(r.error || 'Lỗi tải rev', 'error')
  }
  // QT19 bước 3 — trình/duyệt/từ chối PR.
  const prAction = async (action: 'submit' | 'approve' | 'reject') => {
    if (!prId) return
    let reason: string | undefined
    if (action === 'reject') { const s = window.prompt('Lý do từ chối PR:'); if (!s) return; reason = s }
    const r = await apiFetch(`/api/purchase-requests/${prId}/approve`, { method: 'POST', body: JSON.stringify({ action, reason }) })
    if (r.ok) { notify(r.message || 'Đã cập nhật', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }
  const canApprovePr = ['R07', 'R02', 'R01', 'R10'].includes(roleCode || '')

  const [pegBusy, setPegBusy] = useState<string | null>(null)
  // Giữ cứng tồn khả dụng cho dòng PR (mặc định giữ đủ nhu cầu) → tăng reservedStock, chống PR khác lấy mất.
  const pegRow = async (r: Row) => {
    setPegBusy(r.prDetailId)
    const res = await apiFetch('/api/procurement/hard-pegging', { method: 'POST', body: JSON.stringify({ prItemId: r.prDetailId }) })
    setPegBusy(null)
    if (res.ok) { notify(res.message || 'Đã giữ tồn', 'success'); load() } else notify(res.error || 'Lỗi giữ tồn', 'error')
  }
  const releaseRow = async (r: Row) => {
    setPegBusy(r.prDetailId)
    const res = await apiFetch(`/api/procurement/hard-pegging?prItemId=${encodeURIComponent(r.prDetailId)}`, { method: 'DELETE' })
    setPegBusy(null)
    if (res.ok) { notify(res.message || 'Đã nhả tồn', 'success'); load() } else notify(res.error || 'Lỗi nhả tồn', 'error')
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Kiểm tra tồn kho" subtitle="Soát tồn khả dụng cho từng dòng vật tư PR → phân bổ dùng từ tồn → tính lại số cần mua (trước khi RFQ)" />

      <div className="flex items-center gap-3 flex-wrap">
        <select value={prId} onChange={e => setPrId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn phiếu yêu cầu (PR) —</option>
          {prs.map(p => <option key={p.id} value={p.id}>{p.prCode}{p.project?.projectCode ? ` — ${p.project.projectCode}` : ''}</option>)}
        </select>
        {prId && prStatus && (() => {
          const b: Record<string, { l: string; bg: string; tx: string }> = { DRAFT: { l: 'Nháp', bg: '#f1f5f9', tx: '#64748b' }, PENDING: { l: 'Chờ duyệt', bg: '#fffbeb', tx: '#b45309' }, APPROVED: { l: 'Đã duyệt', bg: '#ecfdf5', tx: '#166534' }, REJECTED: { l: 'Bị từ chối', bg: '#fef2f2', tx: '#dc2626' } }
          const s = b[prStatus] || b.DRAFT
          return <span className="text-xs px-2 py-1 rounded-lg font-bold" style={{ background: s.bg, color: s.tx }} title="Trạng thái duyệt PR (QT19 bước 3)">PR: {s.l}</span>
        })()}
        {prId && (prStatus === 'DRAFT' || prStatus === 'REJECTED') && <button onClick={() => prAction('submit')} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid #4f46e5', color: '#4f46e5' }}>Trình duyệt PR</button>}
        {prId && prStatus === 'PENDING' && canApprovePr && <>
          <button onClick={() => prAction('approve')} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#166534', color: '#fff' }}>✓ Duyệt PR</button>
          <button onClick={() => prAction('reject')} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid #dc2626', color: '#dc2626' }}>Từ chối</button>
        </>}
        {prId && <button onClick={loadRev} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid #9333ea', color: '#7e22ce', background: '#faf5ff' }} title="Xem lịch sử các lần rev của PR này">🕘 Lịch sử rev</button>}
        {rows.length > 0 && <Button variant="primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Đang lưu…' : `Lưu phân bổ tồn${dirty ? '' : ' (chưa đổi)'}`}</Button>}
        <label className="text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer" style={{ border: '1px solid #16a34a', color: '#166534', background: '#f0fdf4' }} title='File Excel có cột "Mã kho" + "Tồn" (tùy chọn "Tên vật tư", "ĐVT")'>
          ⬆ Nhập tồn từ Excel
          <input type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importStock(f); e.currentTarget.value = '' }} />
        </label>
        <label className="text-xs flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-muted)' }} title="Mã chưa có trong danh mục sẽ được tạo mã tạm (chờ chuẩn hóa)">
          <input type="checkbox" checked={createMissing} onChange={e => setCreateMissing(e.target.checked)} />
          Tạo mã tạm nếu chưa có
        </label>
      </div>

      {stockResult && (
        <div className="card p-3 text-xs flex items-center gap-4 flex-wrap" style={{ borderLeft: `3px solid ${stockResult.soKhongThayMa ? '#f59e0b' : '#16a34a'}` }}>
          <span style={{ color: '#166534' }}>Đã cập nhật tồn: <b>{stockResult.updated}</b> mã</span>
          {(stockResult.created ?? 0) > 0 && <span style={{ color: '#3730a3' }}>Tạo mã tạm: <b>{stockResult.created}</b></span>}
          {stockResult.soKhongThayMa > 0 && <span style={{ color: '#b45309' }}>Không có trong danh mục: <b>{stockResult.soKhongThayMa}</b> ({stockResult.notFound.slice(0, 10).join(', ')}{stockResult.notFound.length > 10 ? '…' : ''})</span>}
          <button onClick={() => setStockResult(null)} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>
      )}

      {summary && (
        <div className="flex flex-wrap items-center gap-4">
          {[
            { label: 'Tổng dòng', value: summary.total, color: 'text-slate-800' },
            { label: 'Còn đủ tồn', value: summary.hasStock, color: 'text-emerald-600' },
            { label: 'Còn một phần', value: summary.partial, color: 'text-amber-600' },
            { label: 'Không tồn', value: summary.noStock, color: 'text-slate-500' },
          ].map(k => <div key={k.label} className="flex items-center gap-1.5"><span className={`text-lg font-bold ${k.color}`}>{k.value}</span><span className="text-xs text-slate-500">{k.label}</span></div>)}
          {!!summary.matchedByAttr && (
            <span className="text-xs" style={{ color: 'var(--warning)' }} title="Số dòng có mã PR khác hệ mã kho, đã khớp tồn theo tên + quy cách + mác (đánh dấu ≈)">
              ≈ {summary.matchedByAttr} dòng khớp theo quy cách
            </span>
          )}
        </div>
      )}

      {!prId && <div className="text-center py-16 text-slate-400 text-sm">Chọn 1 phiếu yêu cầu (PR) để kiểm tra tồn kho.</div>}
      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                {['Mã VT', 'Tên vật tư', 'Quy cách / Mác', 'ĐVT', 'SL yêu cầu', 'Tồn khả dụng', 'Dùng từ tồn ✎', 'Cần mua', 'Giữ cứng', 'Trạng thái'].map(h => (
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
                      <td className="px-2 py-1.5 text-right font-mono" style={{ color: avail > 0 ? '#16a34a' : 'var(--text-muted)' }}>
                        {r.inventory ? nn(avail) : '—'}
                        {r.inventory?.matchedBy === 'attributes' && (
                          <span title={`Khớp theo tên + quy cách + mác (mã PR khác hệ mã kho)${r.inventory.matchedCodes?.length ? ` — mã kho: ${r.inventory.matchedCodes.join(', ')}` : ''}`}
                            className="ml-1 cursor-help" style={{ color: 'var(--warning)' }}>≈</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" value={edited[r.prDetailId] ?? ''} onChange={e => setUse(r.prDetailId, e.target.value)}
                          className="input text-xs text-right" style={{ width: 90, borderColor: (over || overReq) ? '#f59e0b' : undefined }}
                          title={over ? 'Dùng vượt tồn khả dụng' : overReq ? 'Dùng vượt số yêu cầu' : ''} placeholder="0" />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">{nn(toBuy)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-right">
                        {r.peggedQty > 0 && <span className="mr-1.5 font-mono font-semibold" style={{ color: '#3730a3' }} title="Đang giữ cứng cho dòng này">🔒 {nn(r.peggedQty)}</span>}
                        {r.pegMaterialId ? (
                          r.peggedQty > 0
                            ? <button onClick={() => releaseRow(r)} disabled={pegBusy === r.prDetailId} className="text-[11px] font-semibold" style={{ color: '#b45309' }} title="Nhả tồn đang giữ">Nhả</button>
                            : <button onClick={() => pegRow(r)} disabled={pegBusy === r.prDetailId || (r.inventory?.availableQty ?? 0) <= 0} className="text-[11px] font-semibold" style={{ color: (r.inventory?.availableQty ?? 0) > 0 ? '#166534' : 'var(--text-muted)' }} title={(r.inventory?.availableQty ?? 0) > 0 ? 'Giữ cứng tồn khả dụng cho dòng này' : 'Không còn tồn khả dụng'}>Giữ</button>
                        ) : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }} title="Chưa liên kết mã kho xác định">—</span>}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                        {r.itemCode && <button onClick={() => setHistoryItem({ itemCode: r.itemCode, itemName: r.itemName })} className="ml-2 text-[11px] font-medium" style={{ color: 'var(--accent)' }} title="Lịch sử mua hàng">🕘 Lịch sử</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historyItem && <PurchaseHistoryPanel itemCode={historyItem.itemCode} itemName={historyItem.itemName} onClose={() => setHistoryItem(null)} />}

      {revOpen && revData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setRevOpen(false)}>
          <div className="card p-5 space-y-3" style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Lịch sử rev — {revData.prCode} <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(hiện tại: Rev {revData.currentRev} · {revData.currentLineCount} dòng)</span></h3>
              <button onClick={() => setRevOpen(false)} style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>
            {revData.revisions.length === 0
              ? <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có phiên bản cũ nào — PR chưa bị cập nhật lại lần nào (mới ở Rev {revData.currentRev}).</p>
              : (
                <div className="space-y-3">
                  {revData.revisions.map(rv => (
                    <div key={rv.revNo} className="rounded-lg p-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold" style={{ color: '#7e22ce' }}>Rev {rv.revNo}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{rv.lineCount} dòng · {new Date(rv.changedAt).toLocaleString('vi-VN')}</span>
                      </div>
                      {rv.note && <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>{rv.note}</div>}
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                          <thead><tr style={{ color: 'var(--text-muted)' }}><th className="text-left px-1">Mã VT</th><th className="text-left px-1">Mô tả</th><th className="text-right px-1">SL</th><th className="text-left px-1">ĐVT</th></tr></thead>
                          <tbody>
                            {rv.sampleItems.map((it, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                <td className="px-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                                <td className="px-1 max-w-[240px] truncate" title={it.description || ''}>{it.description || '—'}</td>
                                <td className="px-1 text-right font-mono">{it.quantity != null ? formatNumber(Number(it.quantity)) : '—'}</td>
                                <td className="px-1">{it.unit || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rv.lineCount > rv.sampleItems.length && <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>…+{rv.lineCount - rv.sampleItems.length} dòng nữa</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  )
}
