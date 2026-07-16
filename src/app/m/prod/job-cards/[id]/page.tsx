'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MNumberStepper, MBottomSheet } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { Check, CheckCheck } from 'lucide-react'

interface JobCard {
  id: string
  jobCode: string
  workType: string
  description: string | null
  teamCode: string | null
  plannedQty: number | null
  actualQty: number | null
  unit: string | null
  workDate: string
  manpower: number | null
  status: string
  notes: string | null
  workOrder: {
    woCode: string
    description: string | null
    pieceMark: string | null
    plannedWeight: number | null
  } | null
}

type Toast = { kind: 'ok' | 'err'; text: string } | null

export default function MobileJobCardDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [jc, setJc] = useState<JobCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [qty, setQty] = useState(0)
  const [men, setMen] = useState(0)
  const [toast, setToast] = useState<Toast>(null)
  const [confirmDone, setConfirmDone] = useState(false)

  useEffect(() => {
    apiFetch(`/api/production/job-cards/${id}`).then((res) => {
      if (res.ok) {
        const card: JobCard = res.jobCard
        setJc(card)
        setQty(card.actualQty || 0)
        setMen(card.manpower || 0)
      }
      setLoading(false)
    })
  }, [id])

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true)
    setToast(null)
    const body: Record<string, unknown> = { actualQty: qty, ...extra }
    // manpower phải là số nguyên dương — không gửi khi chưa nhập.
    if (men > 0) body.manpower = men

    const res = await apiFetch(`/api/production/job-cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    setSaving(false)

    if (res.ok) {
      setJc(res.jobCard)
      setToast({ kind: 'ok', text: res.message || 'Đã lưu' })
      return true
    }
    setToast({ kind: 'err', text: res.error || 'Không lưu được' })
    return false
  }

  if (loading) {
    return (
      <>
        <MAppBar title="Phiếu công đoạn" backHref="/m/prod/job-cards" />
        <div className="m-spinner" />
      </>
    )
  }

  if (!jc) {
    return (
      <>
        <MAppBar title="Phiếu công đoạn" backHref="/m/prod/job-cards" />
        <main className="m-main">
          <div className="m-empty">
            <strong>Không tìm thấy phiếu</strong>
            <span>Phiếu có thể đã bị hủy hoặc xóa.</span>
          </div>
        </main>
      </>
    )
  }

  const planned = jc.plannedQty || 0
  const unit = jc.unit || 'kg'
  const pct = planned > 0 ? Math.round((qty / planned) * 100) : 0
  const done = jc.status === 'COMPLETED'
  const locked = done || jc.status === 'CANCELLED'

  return (
    <>
      <MAppBar
        title={jc.description || jc.workType}
        subtitle={`${jc.jobCode} · ${jc.workOrder?.woCode || '—'}`}
        backHref="/m/prod/job-cards"
      />

      <main className="m-main">
        <div className="m-card">
          <div className="m-card-head">
            <span className="m-code">{jc.jobCode}</span>
            <StatusBadge category="jobCard" status={jc.status} />
          </div>
          <div className="m-card-title">{jc.description || jc.workType}</div>

          <dl className="m-facts">
            <div className="m-fact">
              <dt>Lệnh SX · Piece-mark</dt>
              <dd className="m-mono">
                {jc.workOrder?.woCode || '—'} · {jc.workOrder?.pieceMark || '—'}
              </dd>
            </div>
            <div className="m-fact">
              <dt>Công đoạn</dt>
              <dd>{jc.workType}</dd>
            </div>
            <div className="m-fact">
              <dt>Định mức</dt>
              <dd className="m-mono">{planned > 0 ? `${planned} ${unit}` : '—'}</dd>
            </div>
            <div className="m-fact">
              <dt>Tổ · Ngày làm</dt>
              <dd>{jc.teamCode || '—'} · {new Date(jc.workDate).toLocaleDateString('vi-VN')}</dd>
            </div>
          </dl>
        </div>

        <div className="m-section-title">Báo sản lượng tại máy</div>

        <div className="m-card">
          <MNumberStepper
            label={`Khối lượng đã làm (${unit})`}
            value={qty}
            onChange={setQty}
            min={0}
            disabled={locked || saving}
          />

          <MNumberStepper
            label="Số thợ trong ca"
            value={men}
            onChange={setMen}
            min={0}
            disabled={locked || saving}
          />

          {planned > 0 && (
            <div className="m-note m-note-warn" style={{ background: 'var(--m-surface-sunken)', color: 'var(--m-ink-2)' }}>
              <span>Lũy kế so định mức</span>
              <span className="m-mono" style={{ fontWeight: 600, color: 'var(--m-ink)' }}>
                {qty} / {planned} {unit} · {pct}%
              </span>
            </div>
          )}
        </div>

        {toast && (
          <div className={`m-note ${toast.kind === 'ok' ? 'm-note-ok' : 'm-note-err'}`}>
            <span>{toast.text}</span>
          </div>
        )}

        {!locked && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <button
              type="button"
              className="m-btn m-btn-go"
              disabled={saving}
              onClick={() => save()}
            >
              <Check size={22} strokeWidth={2.6} /> Báo sản lượng
            </button>

            <button
              type="button"
              className="m-btn m-btn-quiet"
              disabled={saving}
              onClick={() => setConfirmDone(true)}
            >
              <CheckCheck size={20} /> Hoàn thành công đoạn
            </button>
          </div>
        )}

        {done && (
          <div className="m-note m-note-ok">
            <span>Phiếu đã hoàn thành — tiến độ lệnh SX đã được cập nhật.</span>
          </div>
        )}
      </main>

      <MBottomSheet
        open={confirmDone}
        onClose={() => setConfirmDone(false)}
        title="Hoàn thành công đoạn?"
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
          Chốt sản lượng <b className="m-mono">{qty} {unit}</b> cho phiếu{' '}
          <b className="m-mono">{jc.jobCode}</b>. Hệ thống sẽ cộng dồn tiến độ vào lệnh{' '}
          <b className="m-mono">{jc.workOrder?.woCode}</b>. Sau khi chốt thì không sửa được nữa.
        </p>
        <button
          type="button"
          className="m-btn m-btn-go"
          disabled={saving}
          onClick={async () => {
            const ok = await save({ status: 'COMPLETED' })
            setConfirmDone(false)
            if (ok) setTimeout(() => router.push('/m/prod/job-cards'), 900)
          }}
        >
          <CheckCheck size={22} strokeWidth={2.6} /> Chốt hoàn thành
        </button>
        <button type="button" className="m-btn m-btn-quiet" onClick={() => setConfirmDone(false)}>
          Quay lại
        </button>
      </MBottomSheet>
    </>
  )
}
