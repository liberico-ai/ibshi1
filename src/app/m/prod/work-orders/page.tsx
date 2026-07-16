'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MListCard, MBottomSheet } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { Factory } from 'lucide-react'

interface WorkOrder {
  id: string
  woCode: string
  description: string | null
  teamCode: string | null
  status: string
  pieceMark: string | null
  plannedWeight: number | null
  completedQty: number | null
  plannedEnd: string | null
  project: { projectCode: string; projectName: string } | null
}

/**
 * Bước chuyển tiếp mà Xưởng được phép làm.
 * Bám đúng VALID_TRANSITIONS của api/production/[id]/transition —
 * các nhánh QC_PASSED / QC_FAILED là của QC nên không hiện ở đây.
 */
const NEXT_ACTIONS: Record<string, { status: string; label: string; primary?: boolean }[]> = {
  OPEN: [{ status: 'IN_PROGRESS', label: 'Nhận lệnh', primary: true }],
  IN_PROGRESS: [
    { status: 'QC_PENDING', label: 'Gửi QC nghiệm thu', primary: true },
    { status: 'ON_HOLD', label: 'Tạm dừng' },
  ],
  ON_HOLD: [{ status: 'IN_PROGRESS', label: 'Tiếp tục làm', primary: true }],
  QC_FAILED: [{ status: 'IN_PROGRESS', label: 'Làm lại', primary: true }],
  QC_PASSED: [{ status: 'COMPLETED', label: 'Hoàn thành lệnh', primary: true }],
}

const TABS = [
  { value: '', label: 'Tất cả' },
  { value: 'IN_PROGRESS', label: 'Đang chạy' },
  { value: 'OPEN', label: 'Chờ nhận' },
] as const

export default function MobileWorkOrders() {
  const [tab, setTab] = useState<string>('')
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, setPending] = useState<{ wo: WorkOrder; status: string; label: string } | null>(null)

  const load = useCallback(async (status: string) => {
    setLoading(true)
    const q = status ? `?status=${status}&limit=50` : '?limit=50'
    const res = await apiFetch(`/api/production${q}`)
    setOrders(res.ok ? (res.workOrders || []) : [])
    setLoading(false)
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  const transition = async (wo: WorkOrder, nextStatus: string) => {
    setBusy(wo.id)
    setToast(null)
    const res = await apiFetch(`/api/production/${wo.id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ nextStatus }),
    })
    setBusy(null)
    setPending(null)

    if (res.ok) {
      setToast({ kind: 'ok', text: res.message || `Đã chuyển ${wo.woCode}` })
      load(tab)
    } else {
      // API trả lý do cụ thể khi gate QC chặn — hiện nguyên văn cho thợ biết vướng gì.
      setToast({ kind: 'err', text: res.error || 'Không chuyển được trạng thái' })
    }
  }

  return (
    <>
      <MAppBar title="Lệnh sản xuất" subtitle="Nhận lệnh, theo dõi tiến độ" backHref="/m" />

      <main className="m-main">
        <div className="m-segmented" role="group" aria-label="Lọc theo trạng thái">
          {TABS.map((t) => (
            <button
              key={t.value || 'all'}
              type="button"
              aria-pressed={tab === t.value}
              onClick={() => setTab(t.value)}
              style={tab === t.value ? { background: 'var(--m-ink)' } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {toast && (
          <div className={`m-note ${toast.kind === 'ok' ? 'm-note-ok' : 'm-note-err'}`}>
            <span>{toast.text}</span>
          </div>
        )}

        {loading && <div className="m-spinner" />}

        {!loading && orders.length === 0 && (
          <div className="m-empty">
            <Factory size={30} />
            <strong>Không có lệnh nào</strong>
            <span>Chưa có lệnh sản xuất ở trạng thái này.</span>
          </div>
        )}

        {!loading && orders.map((wo) => {
          const planned = wo.plannedWeight || 0
          const done = wo.completedQty || 0
          const pct = planned > 0 ? Math.round((done / planned) * 100) : 0
          const actions = NEXT_ACTIONS[wo.status] || []

          return (
            <MListCard
              key={wo.id}
              code={wo.woCode}
              badge={<StatusBadge category="production" status={wo.status} />}
              title={wo.description || 'Lệnh sản xuất'}
              facts={[
                { label: 'Piece-mark', value: <span className="m-mono">{wo.pieceMark || '—'}</span> },
                { label: 'Tổ', value: wo.teamCode || '—' },
                {
                  label: 'Hạn',
                  value: wo.plannedEnd
                    ? new Date(wo.plannedEnd).toLocaleDateString('vi-VN')
                    : '—',
                },
              ]}
              progress={
                planned > 0
                  ? { percent: pct, note: `${done} / ${planned} kg · ${pct}%` }
                  : undefined
              }
            >
              {actions.length > 0 && (
                <div className="m-btn-row">
                  {actions.map((a) => (
                    <button
                      key={a.status}
                      type="button"
                      className={`m-btn ${a.primary ? 'm-btn-dark' : 'm-btn-quiet'}`}
                      disabled={busy === wo.id}
                      onClick={() => setPending({ wo, status: a.status, label: a.label })}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </MListCard>
          )
        })}
      </main>

      <MBottomSheet
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `${pending.label}?` : ''}
      >
        {pending && (
          <>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
              Lệnh <b className="m-mono">{pending.wo.woCode}</b> — {pending.wo.description || '—'}.
              {pending.status === 'QC_PENDING' &&
                ' Lệnh sẽ chuyển sang chờ QC nghiệm thu, tổ không sửa được nữa cho tới khi QC trả kết quả.'}
            </p>
            <button
              type="button"
              className="m-btn m-btn-go"
              disabled={busy === pending.wo.id}
              onClick={() => transition(pending.wo, pending.status)}
            >
              {pending.label}
            </button>
            <button type="button" className="m-btn m-btn-quiet" onClick={() => setPending(null)}>
              Quay lại
            </button>
          </>
        )}
      </MBottomSheet>
    </>
  )
}
