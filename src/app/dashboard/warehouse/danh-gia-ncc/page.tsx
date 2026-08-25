'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatDate } from '@/lib/utils'

// WIP-09 — Đánh giá & quản lý ASL nhà cung cấp (8 tiêu chí · 3 lần mua thử · sổ vi phạm).
interface Vendor { id: string; name: string; vendorCode: string; aslStatus: string; trialCount: number; vendorType?: string | null }
interface Evaluation { id: string; evaluatedAt: string; scoreContactPrice: number; scoreQuality: number; scoreDelivery: number; scoreExclusive: number; scoreAttitude: number; isCustomerDesignated: boolean; hasIso9001: boolean; sampleEvalPassed: boolean; overallResult: string; decision: string | null; note: string | null }
interface Violation { id: string; occurredAt: string; description: string; severity: string; status: string; note: string | null }
interface AslDetail { id: string; name: string; aslStatus: string; aslApprovedAt: string | null; trialCount: number; evaluations: Evaluation[]; violations: Violation[]; openViolations: number }

const ASL: Record<string, { l: string; bg: string; tx: string }> = {
  NONE: { l: 'Chưa vào ASL', bg: '#f1f5f9', tx: '#64748b' }, TRIAL: { l: 'Đang mua thử', bg: '#fffbeb', tx: '#b45309' },
  APPROVED: { l: 'Trong ASL', bg: '#ecfdf5', tx: '#166534' }, SUSPENDED: { l: 'Tạm dừng', bg: '#fff7ed', tx: '#c2410c' },
  REMOVED: { l: 'Đã loại', bg: '#fef2f2', tx: '#dc2626' },
}

export default function DanhGiaNccPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [aslF, setAslF] = useState('')
  const [detail, setDetail] = useState<AslDetail | null>(null)
  const roleCode = useAuthStore(s => s.user?.roleCode)
  const canManage = ['R01', 'R02', 'R07', 'R07a', 'R10'].includes(roleCode || '')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch('/api/vendors?limit=500')
    setLoading(false)
    if (r.ok) setVendors(r.vendors || []); else notify(r.error || 'Lỗi tải NCC', 'error')
  }, [])
  useEffect(() => { load() }, [load])

  const openDetail = async (id: string) => {
    const r = await apiFetch(`/api/vendors/${id}/asl`)
    if (r.ok) setDetail(r as never); else notify(r.error || 'Lỗi', 'error')
  }
  const act = async (id: string, body: Record<string, unknown>, confirmMsg?: string) => {
    if (confirmMsg && !await confirmDialog(confirmMsg)) return
    const r = await apiFetch(`/api/vendors/${id}/asl`, { method: 'POST', body: JSON.stringify(body) })
    if (r.ok) { notify(r.message || 'Đã cập nhật', 'success'); await openDetail(id); load() } else notify(r.error || 'Lỗi', 'error')
  }

  const shown = vendors.filter(v => (!q || v.name.toLowerCase().includes(q.toLowerCase()) || (v.vendorCode || '').toLowerCase().includes(q.toLowerCase())) && (!aslF || (v.aslStatus || 'NONE') === aslF))

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Đánh giá & ASL nhà cung cấp" subtitle="WIP-09 — chấm 8 tiêu chí, 3 lần mua thử → duyệt vào ASL; sổ theo dõi NCC vi phạm" />
      <div className="flex items-center gap-3 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm NCC…" className="input text-sm" style={{ maxWidth: 260 }} />
        <select value={aslF} onChange={e => setAslF(e.target.value)} className="input text-sm">
          <option value="">Mọi trạng thái ASL</option>{Object.entries(ASL).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{shown.length} NCC</span>
      </div>
      {loading ? <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div> : (
        <div className="card p-0 overflow-hidden"><div style={{ overflowX: 'auto' }}>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--bg-secondary)' }}>{['Mã', 'Tên NCC', 'Loại', 'Mua thử', 'ASL', ''].map(h => <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.slice(0, 300).map(v => {
                const s = ASL[v.aslStatus || 'NONE'] || ASL.NONE
                return (
                  <tr key={v.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{v.vendorCode}</td>
                    <td className="px-2 py-1.5">{v.name}</td>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{v.vendorType === 'IMPORT' ? 'Nhập khẩu' : 'Nội địa'}</td>
                    <td className="px-2 py-1.5 text-center font-mono">{v.trialCount || 0}/3</td>
                    <td className="px-2 py-1.5"><span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: s.bg, color: s.tx }}>{s.l}</span></td>
                    <td className="px-2 py-1.5"><button onClick={() => openDetail(v.id)} className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>Đánh giá / ASL →</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div></div>
      )}
      {detail && <AslModal detail={detail} canManage={canManage} onClose={() => setDetail(null)} act={act} />}
    </div>
  )
}

function AslModal({ detail, canManage, onClose, act }: { detail: AslDetail; canManage: boolean; onClose: () => void; act: (id: string, body: Record<string, unknown>, confirmMsg?: string) => void }) {
  const s = ASL[detail.aslStatus || 'NONE'] || ASL.NONE
  const [tab, setTab] = useState<'eval' | 'violations'>('eval')
  const [sc, setSc] = useState({ scoreContactPrice: 3, scoreQuality: 3, scoreDelivery: 3, scoreExclusive: 3, scoreAttitude: 3 })
  const [fl, setFl] = useState({ isCustomerDesignated: false, hasIso9001: false, sampleEvalPassed: false })
  const [note, setNote] = useState('')
  const [vio, setVio] = useState({ description: '', severity: 'MINOR' })
  const CRIT: Array<[keyof typeof sc, string]> = [['scoreContactPrice', 'Liên hệ & giá'], ['scoreQuality', 'Chất lượng DV'], ['scoreDelivery', 'Giao hàng'], ['scoreExclusive', 'Độc quyền'], ['scoreAttitude', 'Thái độ']]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 640, width: '100%', maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{detail.name} <span className="px-2 py-0.5 rounded text-[11px] font-bold ml-1" style={{ background: s.bg, color: s.tx }}>{s.l}</span> <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>· mua thử {detail.trialCount}/3</span></h3>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => act(detail.id, { action: 'incTrial' })} className="text-[11px] px-2 py-1 rounded font-semibold" style={{ border: '1px solid #b45309', color: '#b45309' }}>+ Ghi lần mua thử</button>
            <button onClick={() => act(detail.id, { action: 'setAsl', status: 'APPROVED' }, 'Duyệt NCC vào ASL?')} className="text-[11px] px-2 py-1 rounded font-semibold" style={{ background: '#166534', color: '#fff' }}>✓ Vào ASL</button>
            <button onClick={() => act(detail.id, { action: 'setAsl', status: 'SUSPENDED' })} className="text-[11px] px-2 py-1 rounded font-semibold" style={{ border: '1px solid #c2410c', color: '#c2410c' }}>Tạm dừng</button>
            <button onClick={() => act(detail.id, { action: 'setAsl', status: 'REMOVED' }, 'Loại NCC khỏi ASL (không mua nữa)?')} className="text-[11px] px-2 py-1 rounded font-semibold" style={{ border: '1px solid #dc2626', color: '#dc2626' }}>Loại khỏi ASL</button>
          </div>
        )}
        <div className="flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
          {(['eval', 'violations'] as const).map(t => <button key={t} onClick={() => setTab(t)} className="text-xs px-2 py-1 font-semibold" style={{ borderBottom: tab === t ? '2px solid var(--accent)' : 'none', color: tab === t ? 'var(--accent)' : 'var(--text-muted)' }}>{t === 'eval' ? 'Đánh giá' : `Vi phạm (${detail.openViolations})`}</button>)}
        </div>

        {tab === 'eval' ? (
          <div className="space-y-2">
            {canManage && (
              <div className="rounded-lg p-2 space-y-2" style={{ border: '1px solid var(--border)' }}>
                <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Chấm điểm mới (0-5):</div>
                <div className="grid grid-cols-2 gap-2">
                  {CRIT.map(([k, l]) => (
                    <label key={k} className="text-xs flex items-center justify-between gap-1">{l}
                      <input type="number" min={0} max={5} value={sc[k]} onChange={e => setSc({ ...sc, [k]: Number(e.target.value) })} className="input text-xs" style={{ width: 52 }} />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  {([['isCustomerDesignated', 'Khách chỉ định'], ['hasIso9001', 'ISO 9001'], ['sampleEvalPassed', 'Mẫu đạt']] as const).map(([k, l]) => (
                    <label key={k} className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={fl[k]} onChange={e => setFl({ ...fl, [k]: e.target.checked })} />{l}</label>
                  ))}
                </div>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi chú" className="input text-xs w-full" />
                <Button variant="primary" onClick={() => act(detail.id, { action: 'evaluate', ...sc, ...fl, note })}>Lưu đánh giá</Button>
              </div>
            )}
            <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Lịch sử đánh giá ({detail.evaluations.length})</div>
            {detail.evaluations.length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Chưa có.</div>
              : detail.evaluations.map(e => (
                <div key={e.id} className="text-[11px] rounded p-1.5" style={{ border: '1px solid var(--border)' }}>
                  <b style={{ color: e.overallResult === 'PASS' ? '#166534' : '#dc2626' }}>{e.overallResult === 'PASS' ? 'Đạt' : 'Chưa đạt'}</b> · {formatDate(e.evaluatedAt)} · Giá {e.scoreContactPrice} · CL {e.scoreQuality} · Giao {e.scoreDelivery} · TĐ {e.scoreAttitude}{e.hasIso9001 ? ' · ISO' : ''}{e.sampleEvalPassed ? ' · Mẫu đạt' : ''}{e.note ? ` — ${e.note}` : ''}
                </div>
              ))}
          </div>
        ) : (
          <div className="space-y-2">
            {canManage && (
              <div className="flex gap-1.5">
                <input value={vio.description} onChange={e => setVio({ ...vio, description: e.target.value })} placeholder="Mô tả vi phạm…" className="input text-xs flex-1" />
                <select value={vio.severity} onChange={e => setVio({ ...vio, severity: e.target.value })} className="input text-xs"><option value="MINOR">Nhẹ</option><option value="MAJOR">Nặng</option><option value="CRITICAL">Nghiêm trọng</option></select>
                <Button variant="outline" onClick={() => { if (vio.description) act(detail.id, { action: 'addViolation', ...vio }) }}>Ghi</Button>
              </div>
            )}
            {detail.violations.length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Chưa có vi phạm.</div>
              : detail.violations.map(v => (
                <div key={v.id} className="text-[11px] rounded p-1.5 flex items-center justify-between gap-2" style={{ border: '1px solid var(--border)' }}>
                  <span><b style={{ color: v.severity === 'CRITICAL' ? '#dc2626' : v.severity === 'MAJOR' ? '#c2410c' : '#b45309' }}>[{v.severity}]</b> {formatDate(v.occurredAt)} · {v.description} {v.status === 'RESOLVED' && <span style={{ color: '#166534' }}>(đã xử lý)</span>}</span>
                  {canManage && v.status === 'OPEN' && <button onClick={() => act(detail.id, { action: 'resolveViolation', violationId: v.id })} className="text-[11px] font-semibold flex-none" style={{ color: '#166534' }}>Xử lý</button>}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
