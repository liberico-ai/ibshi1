'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'
import { formatDate } from '@/lib/utils'

// Màn "Hàng về & QC" (khớp Commerce) — theo dõi HĐ theo giai đoạn nhận hàng + thao tác MTC/QC/phiếu nhận.
interface Row {
  id: string; contractCode: string; tradeType: string | null; vendorName: string; projectCode: string | null
  arrivedDate: string | null; qcInvitationDate: string | null; mtcStatus: string; receiptCount: number
  itemCount: number; inspectedCount: number; passedCount: number; deliveredPct: number
  logistics: { lcDate: string | null; cifDate: string | null; customsDate: string | null }; stage: string
}
interface Stats { total: number; waiting: number; arrived: number; qc: number; accepted: number }

const STAGE: Record<string, { l: string; bg: string; tx: string }> = {
  waiting: { l: 'Chờ hàng về', bg: '#f1f5f9', tx: '#64748b' }, arrived: { l: 'Hàng đã về', bg: '#eff6ff', tx: '#1d4ed8' },
  qc: { l: 'Đã mời QC', bg: '#faf5ff', tx: '#7e22ce' }, accepted: { l: 'Đã nghiệm thu', bg: '#ecfdf5', tx: '#166534' },
}
const MTC: Record<string, { l: string; c: string }> = { PENDING: { l: 'chờ', c: '#b45309' }, ACCEPTED: { l: 'đạt ✓', c: '#166534' }, REJECTED: { l: 'không đạt', c: '#dc2626' } }

export default function HangVeQcPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [stageF, setStageF] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; projectCode: string }>>([])
  const roleCode = useAuthStore(s => s.user?.roleCode)
  const canQc = ['R01', 'R05', 'R05a', 'R07', 'R07a', 'R09', 'R09a', 'R10'].includes(roleCode || '')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch(`/api/procurement/arrivals${projectId ? `?projectId=${projectId}` : ''}`)
    setLoading(false)
    if (r.ok) { setRows(r.rows || []); setStats(r.stats || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [projectId])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const qc = async (id: string, action: string, extra?: Record<string, unknown>) => {
    const r = await apiFetch(`/api/purchase-contracts/${id}/qc`, { method: 'POST', body: JSON.stringify({ action, ...extra }) })
    if (r.ok) { notify(r.message || 'Đã cập nhật', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }
  const receipt = async (id: string) => {
    if (!await confirmDialog('Lập phiếu nhận hàng nhanh (kiểm đóng gói · số lượng · đóng tem · báo SX)?')) return
    const r = await apiFetch(`/api/purchase-contracts/${id}/goods-receipt`, { method: 'POST', body: JSON.stringify({ packingChecked: true, qtyChecked: true, tagged: true, notifiedProd: true }) })
    if (r.ok) { notify(r.message || 'Đã lập phiếu nhận', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }

  const shown = rows.filter(r => !stageF || r.stage === stageF)

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Hàng về & QC" subtitle="Theo dõi hợp đồng theo giai đoạn nhận hàng — chấp nhận MTC → mời QC → lập phiếu nhận → nghiệm thu" />

      <div className="flex items-center gap-3 flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 260 }}>
          <option value="">— Tất cả dự án —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
        </select>
        {stats && ([['', 'Tổng', stats.total, 'var(--text-primary)'], ['waiting', 'Chờ về', stats.waiting, '#64748b'], ['arrived', 'Hàng về', stats.arrived, '#1d4ed8'], ['qc', 'Mời QC', stats.qc, '#7e22ce'], ['accepted', 'Nghiệm thu', stats.accepted, '#166534']] as const).map(([s, l, v, c]) => (
          <button key={l} onClick={() => setStageF(s)} className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ border: stageF === s ? `1px solid ${c}` : '1px solid transparent' }}>
            <span className="text-lg font-bold" style={{ color: c }}>{v}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{l}</span>
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-16 text-slate-400 text-sm">Đang tải…</div>
        : shown.length === 0 ? <div className="text-center py-16 text-slate-400 text-sm">Không có hợp đồng ở giai đoạn này.</div>
          : (
            <div className="card p-0 overflow-hidden"><div style={{ overflowX: 'auto' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                  {['Số HĐ', 'NCC', 'Dự án', 'Loại', 'Ngày về', 'Đã giao', 'MTC', 'Nghiệm thu', 'Phiếu nhận', 'Giai đoạn', 'Thao tác'].map(h => <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map(r => {
                    const st = STAGE[r.stage] || STAGE.waiting
                    const m = MTC[r.mtcStatus] || MTC.PENDING
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-1.5"><Link href={`/dashboard/warehouse/hop-dong?contractNo=${encodeURIComponent(r.contractCode)}`} className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{r.contractCode}</Link></td>
                        <td className="px-2 py-1.5">{r.vendorName}</td>
                        <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{r.projectCode || '—'}</td>
                        <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{r.tradeType === 'IMPORT' ? 'Nhập khẩu' : 'Nội địa'}</td>
                        <td className="px-2 py-1.5">{r.arrivedDate ? formatDate(r.arrivedDate) : '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono" style={{ color: r.deliveredPct >= 100 ? '#166534' : 'var(--text-muted)' }}>{r.deliveredPct}%</td>
                        <td className="px-2 py-1.5 font-bold" style={{ color: m.c }}>{m.l}</td>
                        <td className="px-2 py-1.5 font-mono">{r.itemCount > 0 ? `${r.inspectedCount}/${r.itemCount}` : '—'}{r.passedCount > 0 && <span style={{ color: '#166534' }}> ✓{r.passedCount}</span>}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{r.receiptCount || '—'}</td>
                        <td className="px-2 py-1.5"><span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: st.bg, color: st.tx }}>{st.l}</span></td>
                        <td className="px-2 py-1.5">
                          {canQc && <div className="flex gap-1.5 flex-wrap">
                            {r.mtcStatus !== 'ACCEPTED' && <button onClick={() => qc(r.id, 'mtcAccept')} className="text-[11px] font-semibold" style={{ color: '#166534' }}>✓MTC</button>}
                            {!r.qcInvitationDate && <button onClick={() => qc(r.id, 'invite')} className="text-[11px] font-semibold" style={{ color: '#7e22ce' }}>🔬Mời QC</button>}
                            {r.receiptCount === 0 && <button onClick={() => receipt(r.id)} className="text-[11px] font-semibold" style={{ color: '#0e7490' }}>📦Phiếu nhận</button>}
                            <Link href={`/dashboard/warehouse/hop-dong?contractNo=${encodeURIComponent(r.contractCode)}`} className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>Nghiệm thu →</Link>
                          </div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div></div>
          )}
    </div>
  )
}
