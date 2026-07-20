'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { AlertTriangle, Clock, ArrowRight, X } from 'lucide-react'

interface UrgentTask { id: string; title: string; deadline: string | null; projectCode: string | null }
interface Pending { pending: number; overdue: number; urgent: UrgentTask[] }

const POLL_MS = 60000
const DISMISS_KEY = 'pendingBannerDismissed'   // ẩn dải băng trong phiên
const MODAL_KEY = 'urgentModalShown'           // modal chỉ bật 1 lần/phiên

function daysOverdue(deadline: string | null): number {
  if (!deadline) return 0
  const d = new Date(deadline); d.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86400000))
}

export default function PendingAlerts() {
  const router = useRouter()
  const [data, setData] = useState<Pending | null>(null)
  const [bannerHidden, setBannerHidden] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/me/pending')
    if (!res.ok) return
    setData(res)
    // Modal chỉ bật khi có việc GẤP và chưa bật trong phiên này.
    if (res.overdue > 0 && sessionStorage.getItem(MODAL_KEY) !== '1') {
      setModalOpen(true)
      sessionStorage.setItem(MODAL_KEY, '1')
    }
  }, [])

  useEffect(() => {
    setBannerHidden(sessionStorage.getItem(DISMISS_KEY) === '1')
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  if (!data || data.pending === 0) return null

  const hasUrgent = data.overdue > 0
  const goWork = (overdue: boolean) => {
    setModalOpen(false)
    router.push(overdue ? '/dashboard/work?tab=overdue' : '/dashboard/work')
  }
  const dismissBanner = () => { setBannerHidden(true); sessionStorage.setItem(DISMISS_KEY, '1') }

  return (
    <>
      {!bannerHidden && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', marginBottom: 16,
            borderRadius: 10, fontSize: 14,
            border: `1px solid ${hasUrgent ? 'var(--ibs-red)' : '#f0c675'}`,
            background: hasUrgent ? 'var(--ibs-red-50, #fdecea)' : '#fbf1df',
            color: hasUrgent ? '#b81c14' : '#8a6d2e',
          }}
        >
          {hasUrgent ? <AlertTriangle size={18} style={{ flexShrink: 0 }} /> : <Clock size={18} style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1, lineHeight: 1.4 }}>
            Bạn đang có <b>{data.pending} việc cần xử lý</b>
            {hasUrgent && <> — trong đó <b>{data.overdue} việc đã quá hạn</b></>}.
          </span>
          <button
            onClick={() => goWork(hasUrgent)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', flexShrink: 0,
              background: hasUrgent ? 'var(--ibs-red)' : '#c97a0e',
            }}
          >
            Xem ngay <ArrowRight size={14} />
          </button>
          <button onClick={dismissBanner} aria-label="Ẩn" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, flexShrink: 0, padding: 2 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {modalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(23,25,29,.5)' }}
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog" aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-elevated, #fff)', borderRadius: 16, maxWidth: 460, width: '100%', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--ibs-red-50, #fdecea)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={20} style={{ color: 'var(--ibs-red)' }} />
              </span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Bạn có {data.overdue} việc đã quá hạn</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Cần xử lý sớm để không ảnh hưởng tiến độ dự án</div>
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: '10px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.urgent.map((t) => {
                const d = daysOverdue(t.deadline)
                return (
                  <button key={t.id} onClick={() => { setModalOpen(false); router.push(`/dashboard/work/${t.id}`) }}
                    style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t.projectCode || '—'}</div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#b81c14', background: 'var(--ibs-red-50, #fdecea)', padding: '3px 8px', borderRadius: 6, flexShrink: 0 }}>
                      quá {d} ngày
                    </span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setModalOpen(false)} className="btn-outline" style={{ flex: 1 }}>Để sau</button>
              <button onClick={() => goWork(true)} className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                Xem tất cả <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
