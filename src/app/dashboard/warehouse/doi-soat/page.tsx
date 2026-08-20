'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'
import { formatCurrency } from '@/lib/utils'

// [PORT Thương Mại — Alert Center] Đối soát 3 chiều BID (duyệt) ↔ Mua (PO) ↔ Hóa đơn, theo dự án × NCC.
interface Proj { id: string; projectCode: string; projectName: string }
interface Row {
  key: string; projectCode: string; vendorName: string; bid: number; po: number; inv: number
  deltaPoInv: number; deltaBidPo: number; flags: string[]; severity: string
  resolved: boolean; resolvedBy: string | null; note: string | null
}
const FLAG: Record<string, string> = {
  HOA_DON_KHONG_PO: 'HĐ không có PO', CHUA_XUAT_HD: 'Đã mua chưa xuất HĐ', LECH_MUA_HD: 'Lệch Mua↔HĐ',
  BID_KHONG_MUA: 'Duyệt nhưng chưa mua', LECH_BID_MUA: 'Lệch Duyệt↔Mua',
}
const SEV: Record<string, { label: string; bg: string; tx: string }> = {
  HIGH: { label: 'Cao', bg: '#fef2f2', tx: '#dc2626' }, MEDIUM: { label: 'Vừa', bg: '#fffbeb', tx: '#b45309' }, LOW: { label: 'Thấp', bg: '#f1f5f9', tx: '#64748b' },
}
const fmt = (n: number) => (n ? formatCurrency(n) : '—')

export default function DoiSoatPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [kpi, setKpi] = useState<{ total: number; high: number; medium: number; resolved: number } | null>(null)
  const [canResolve, setCanResolve] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sevF, setSevF] = useState('')
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])
  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch(`/api/procurement/reconciliation${projectId ? `?projectId=${projectId}` : ''}`)
    setLoading(false)
    if (r.ok) { setRows(r.rows || []); setKpi(r.kpi || null); setCanResolve(!!r.canResolve) } else notify(r.error || 'Lỗi', 'error')
  }, [projectId])
  useEffect(() => { load() }, [load])

  const resolve = async (row: Row) => {
    const r = row.resolved
      ? await apiFetch(`/api/procurement/reconciliation?key=${encodeURIComponent(row.key)}`, { method: 'DELETE' })
      : await apiFetch('/api/procurement/reconciliation', { method: 'POST', body: JSON.stringify({ key: row.key }) })
    if (r.ok) { notify(r.message || 'Đã cập nhật', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }

  const shown = rows.filter(r => (!sevF || r.severity === sevF) && (showResolved || !r.resolved))

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Đối soát mua sắm (Alert Center)" subtitle="Đối chiếu 3 chiều: BID duyệt ↔ Mua (PO) ↔ Hóa đơn — theo dự án × nhà cung cấp" />

      <div className="flex items-center gap-3 flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 340 }}>
          <option value="">— Tất cả dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        <select value={sevF} onChange={e => setSevF(e.target.value)} className="input text-sm">
          <option value="">Mọi mức độ</option><option value="HIGH">Cao</option><option value="MEDIUM">Vừa</option><option value="LOW">Thấp</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Hiện cả đã xử lý
        </label>
      </div>

      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {([['Tổng cảnh báo', kpi.total, 'var(--text-primary)'], ['Mức Cao', kpi.high, '#dc2626'], ['Mức Vừa', kpi.medium, '#b45309'], ['Đã xử lý', kpi.resolved, '#166534']] as const).map(([l, v, c], i) => (
            <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
              <div className="text-lg font-bold" style={{ color: c }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang đối soát…</div>}
      {!loading && shown.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Không có cảnh báo đối soát {projectId ? 'cho dự án này' : ''}. 👍</div>}

      {shown.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                {['Mức', 'Dự án', 'Nhà cung cấp', 'BID duyệt', 'Đã mua (PO)', 'Hóa đơn', 'Chênh Mua↔HĐ', 'Cảnh báo', ''].map(h => (
                  <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {shown.map(r => {
                  const s = SEV[r.severity] || SEV.LOW
                  return (
                    <tr key={r.key} style={{ borderTop: '1px solid var(--border)', opacity: r.resolved ? 0.55 : 1 }}>
                      <td className="px-2 py-1.5"><span style={{ background: s.bg, color: s.tx, padding: '1px 8px', borderRadius: 999, fontWeight: 700, fontSize: 10 }}>{s.label}</span></td>
                      <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{r.projectCode}</td>
                      <td className="px-2 py-1.5">{r.vendorName}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(r.bid)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(r.po)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(r.inv)}</td>
                      <td className="px-2 py-1.5 text-right font-mono" style={{ color: Math.abs(r.deltaPoInv) > 1 ? '#dc2626' : 'var(--text-muted)' }}>{fmt(r.deltaPoInv)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 flex-wrap">{r.flags.map(f => <span key={f} className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>{FLAG[f] || f}</span>)}</div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {canResolve && <button onClick={() => resolve(r)} className="text-[11px] font-semibold" style={{ color: r.resolved ? 'var(--text-muted)' : '#166534' }}>{r.resolved ? '↺ Bỏ đánh dấu' : '✓ Đã xử lý'}</button>}
                      </td>
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
