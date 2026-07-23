'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import SkipReasonModal from '@/components/SkipReasonModal'

const FF_ON = process.env.NEXT_PUBLIC_FF_REVISE_FLOW === 'true'

interface SubStep { code: string; title: string | null; role: string | null; spawned: boolean; status: string | null }
interface Checkpoint { code: string; title: string | null; role: string | null; hint: 'affected' | 'clean'; taskId: string; status: string }
interface View { round: number; entry: string | null; subgraph: SubStep[]; checkpoints: Checkpoint[] }

const roleName = (r: string | null) => (r ? (ROLES as Record<string, { name: string }>)[r]?.name || r : '—')
const box: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)' }
const inp: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', fontSize: '.85rem', background: '#f8fafc' }
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer' })

function ReviseInner() {
  const sp = useSearchParams()
  const [projectId, setProjectId] = useState(sp.get('projectId') || '')
  const [round, setRound] = useState(sp.get('round') || '1')
  const [view, setView] = useState<View | null>(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [skipModal, setSkipModal] = useState<{ open: boolean; mode: 'single' | 'bulk'; cp?: Checkpoint }>({ open: false, mode: 'single' })
  const [skipBusy, setSkipBusy] = useState(false)

  const load = useCallback(async () => {
    if (!projectId || !round) return
    setLoading(true); setMsg('')
    const res = await apiFetch(`/api/work/revise?projectId=${encodeURIComponent(projectId)}&round=${round}`)
    setLoading(false)
    if (res.ok) setView(res.view as View)
    else { setView(null); setMsg(res.error || 'Không tải được vòng revise') }
  }, [projectId, round])

  useEffect(() => { if (sp.get('projectId')) load() }, [sp, load])

  // Mở modal thay window.prompt; khi Xác nhận mới gọi API (không đổi API/payload).
  function skipOne(cp: Checkpoint) { setSkipModal({ open: true, mode: 'single', cp }) }
  function bulkSkip() {
    const clean = view?.checkpoints.filter((c) => c.hint === 'clean') || []
    if (!clean.length) { setMsg('Không có bước "có thể bỏ qua"'); return }
    setSkipModal({ open: true, mode: 'bulk' })
  }
  async function confirmSkip(reason: string) {
    setSkipBusy(true)
    if (skipModal.mode === 'single' && skipModal.cp) {
      const res = await apiFetch(`/api/work/tasks/${skipModal.cp.taskId}/skip`, { method: 'POST', body: JSON.stringify({ skipReason: reason }) })
      setMsg(res.ok ? `Đã bỏ qua ${skipModal.cp.code}` : res.error || 'Lỗi bỏ qua')
    } else {
      const codes = view?.checkpoints.filter((c) => c.hint === 'clean').map((c) => c.code) || []
      const res = await apiFetch('/api/work/revise', { method: 'POST', body: JSON.stringify({ projectId, round: Number(round), codes, reason }) })
      setMsg(res.ok ? res.message || `Đã bỏ qua ${res.skipped?.length || 0} bước` : res.error || 'Lỗi bulk-skip')
    }
    setSkipBusy(false)
    setSkipModal({ open: false, mode: 'single' })
    await load()
  }

  if (!FF_ON) {
    return <div style={{ padding: 24 }}><h1 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Vòng Revise</h1><p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Tính năng Revise Flow chưa được bật (feature flag tắt).</p></div>
  }

  const cleanCount = view?.checkpoints.filter((c) => c.hint === 'clean').length || 0

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: '1.15rem', fontWeight: 800 }}>Vòng Revise — theo dõi & bỏ qua</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '.85rem', marginTop: 4 }}>Đi hết chuỗi hạ nguồn của vòng revise; bước không ảnh hưởng → bấm &quot;Bỏ qua&quot; (có log).</p>
      </div>

      <div style={{ ...box, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '.78rem', display: 'flex', flexDirection: 'column', gap: 4 }}>Project ID
          <input style={{ ...inp, width: 320 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="cmxxxx…" /></label>
        <label style={{ fontSize: '.78rem', display: 'flex', flexDirection: 'column', gap: 4 }}>Round
          <input style={{ ...inp, width: 80 }} value={round} onChange={(e) => setRound(e.target.value)} /></label>
        <button style={btn('#0369a1')} onClick={load} disabled={loading}>{loading ? 'Đang tải…' : 'Xem vòng'}</button>
      </div>

      {msg && <div style={{ ...box, background: '#f0f9ff', borderColor: '#bae6fd', fontSize: '.85rem' }}>{msg}</div>}

      {view && (
        <>
          <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>Checkpoint đang mở — Rev.{view.round}{view.entry ? ` · vào từ ${view.entry}` : ''}</div>
              {cleanCount > 0 && <button style={btn('#7c3aed')} onClick={bulkSkip}>Bỏ qua hàng loạt {cleanCount} bước sạch</button>}
            </div>
            {view.checkpoints.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '.85rem' }}>Không có checkpoint đang mở.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {view.checkpoints.map((c) => (
                <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, minWidth: 56 }}>{c.code}</span>
                  <span style={{ fontSize: '.82rem', flex: 1 }}><span style={{ fontWeight: 600 }}>{c.title || c.code}</span><span style={{ color: 'var(--text-secondary)' }}> · {roleName(c.role)}</span></span>
                  <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.hint === 'affected' ? '#fee2e2' : '#dcfce7', color: c.hint === 'affected' ? '#b91c1c' : '#15803d' }}>
                    {c.hint === 'affected' ? 'cần làm' : 'có thể bỏ qua'}
                  </span>
                  {c.hint === 'clean'
                    ? <button style={btn('#64748b')} onClick={() => skipOne(c)}>Không ảnh hưởng — Bỏ qua</button>
                    : <span style={{ fontSize: '.72rem', color: '#b91c1c' }}>xử lý riêng</span>}
                </div>
              ))}
            </div>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Toàn bộ chuỗi vòng (subgraph) — bước chưa tới hiện mờ</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {view.subgraph.map((s) => (
                <span key={s.code} title={`${s.title || ''}${s.title ? ' · ' : ''}${roleName(s.role)}`} style={{
                  fontSize: '.75rem', padding: '3px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 260,
                  border: '1px solid var(--border)', opacity: s.spawned ? 1 : 0.5,
                  background: s.status === 'DONE' ? '#dcfce7' : s.status === 'SKIPPED_NO_IMPACT' ? '#f1f5f9' : s.spawned ? '#fff' : '#f8fafc',
                }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{s.code}</span>
                  {s.title && <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>}
                  <span style={{ color: 'var(--text-secondary)' }}>{s.status === 'SKIPPED_NO_IMPACT' ? '⤼' : s.status === 'DONE' ? '✓' : !s.spawned ? '· chờ gate' : ''}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <SkipReasonModal
        open={skipModal.open}
        busy={skipBusy}
        title={skipModal.mode === 'single' ? `Bỏ qua bước ${skipModal.cp?.code ?? ''} — không ảnh hưởng` : `Bỏ qua hàng loạt ${cleanCount} bước sạch`}
        defaultReason={skipModal.mode === 'single' ? 'Không ảnh hưởng bởi revision này' : 'Rà 1 lượt — không ảnh hưởng'}
        onCancel={() => setSkipModal({ open: false, mode: 'single' })}
        onConfirm={confirmSkip}
      />
    </div>
  )
}

export default function RevisePage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>Đang tải…</div>}><ReviseInner /></Suspense>
}
