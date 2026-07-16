'use client'

import { useEffect, useState, use, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar } from '@/components/mobile'
import { Check, Flame } from 'lucide-react'

interface Joint {
  id: string
  jointNo: string
  jointType: string
  wpsNo: string | null
  status: string // PENDING | WELDED | REPAIRED
  ndtStatus: string | null // PASSED | FAILED | null
  welder: { id: string; fullName: string } | null
  ncr: { id: string; ncrCode: string; status: string } | null
}
interface Stats { total: number; welded: number; pending: number; ndtPassed: number; ndtFailed: number }

function jointTag(j: Joint): { cls: string; label: string; dot: string } {
  if (j.ndtStatus === 'PASSED') return { cls: 'm-tag-green', label: 'NDT đạt', dot: 'var(--m-green)' }
  if (j.ndtStatus === 'FAILED') return { cls: 'm-tag-red', label: 'NDT lỗi', dot: 'var(--m-red)' }
  if (j.status === 'WELDED' || j.status === 'REPAIRED') return { cls: 'm-tag-amber', label: 'Đã hàn · chờ NDT', dot: 'var(--m-amber)' }
  return { cls: 'm-tag-grey', label: 'Chưa hàn', dot: '#c2c7cd' }
}

export default function MobileWeldMapJoints({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [joints, setJoints] = useState<Joint[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [woCode, setWoCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/production/weld-map?workOrderId=${id}`)
    if (res.ok) {
      setJoints(res.joints || [])
      setStats(res.stats || null)
      if (res.joints?.[0]?.workOrder?.woCode) setWoCode(res.joints[0].workOrder.woCode)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const confirmWelded = async (j: Joint) => {
    setBusy(j.id)
    setToast(null)
    const res = await apiFetch(`/api/production/weld-map/${j.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'WELDED' }),
    })
    setBusy(null)
    if (res.ok) {
      setToast({ kind: 'ok', text: `Mối hàn ${j.jointNo} đã xác nhận hàn` })
      load()
    } else {
      // Gate chứng chỉ thợ hàn chặn ở đây → hiện nguyên văn lý do.
      setToast({ kind: 'err', text: res.error || 'Không xác nhận được' })
    }
  }

  if (loading) return <><MAppBar title="Weld map" backHref="/m/prod/weld-map" /><div className="m-spinner" /></>

  return (
    <>
      <MAppBar title={woCode || 'Weld map'} subtitle="Mối hàn — thợ xác nhận" backHref="/m/prod/weld-map" />

      <main className="m-main">
        {stats && (
          <div className="m-card" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>{stats.total} mối hàn</div>
              <div style={{ fontSize: 11.5, color: 'var(--m-ink-3)' }}>{stats.pending} chưa hàn · {stats.ndtFailed} NDT lỗi</div>
            </div>
            <div className="m-mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--m-green)' }}>{stats.welded}/{stats.total} hàn</div>
          </div>
        )}

        {toast && (
          <div className={`m-note ${toast.kind === 'ok' ? 'm-note-ok' : 'm-note-err'}`}><span>{toast.text}</span></div>
        )}

        {joints.length === 0 && (
          <div className="m-empty">
            <Flame size={30} />
            <strong>Lệnh này chưa có mối hàn</strong>
            <span>Weld map được lập trên bản máy tính.</span>
          </div>
        )}

        {joints.map((j) => {
          const tag = jointTag(j)
          const canConfirm = j.status === 'PENDING'
          return (
            <div className="m-card" key={j.id}>
              <div className="m-card-head" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: tag.dot, display: 'inline-block' }} />
                  <span className="m-mono" style={{ fontSize: 14, fontWeight: 700 }}>{j.jointNo}</span>
                </div>
                <span className={`m-tag ${tag.cls}`}>{tag.label}</span>
              </div>
              <dl className="m-facts">
                <div className="m-fact"><dt>Loại · WPS</dt><dd className="m-mono">{j.jointType} · {j.wpsNo || '—'}</dd></div>
                <div className="m-fact"><dt>Thợ hàn</dt><dd>{j.welder?.fullName || '—'}</dd></div>
                {j.ncr && (
                  <div className="m-fact"><dt>NCR</dt><dd className="m-mono" style={{ color: 'var(--m-red-ink)' }}>{j.ncr.ncrCode}</dd></div>
                )}
              </dl>

              {canConfirm && (
                <button
                  type="button"
                  className="m-btn m-btn-go"
                  style={{ height: 50, fontSize: 15 }}
                  disabled={busy === j.id}
                  onClick={() => confirmWelded(j)}
                >
                  <Check size={20} strokeWidth={2.6} /> Xác nhận đã hàn
                </button>
              )}
            </div>
          )
        })}
      </main>
    </>
  )
}
