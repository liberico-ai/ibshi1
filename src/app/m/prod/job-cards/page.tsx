'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MListCard } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { ClipboardList } from 'lucide-react'

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
  status: string
  workOrder: { woCode: string; description: string | null } | null
}

const TABS = [
  { value: 'IN_PROGRESS', label: 'Đang làm' },
  { value: 'OPEN', label: 'Chờ' },
  { value: 'COMPLETED', label: 'Xong' },
] as const

export default function MobileJobCards() {
  const [tab, setTab] = useState<string>('IN_PROGRESS')
  const [cards, setCards] = useState<JobCard[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (status: string) => {
    setLoading(true)
    const res = await apiFetch(`/api/production/job-cards?status=${status}&limit=50`)
    setCards(res.ok ? (res.jobCards || []) : [])
    setLoading(false)
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  return (
    <>
      <MAppBar title="Phiếu công đoạn" subtitle="Báo sản lượng tại máy" backHref="/m" />

      <main className="m-main">
        <div className="m-segmented" role="group" aria-label="Lọc theo trạng thái">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tab === t.value}
              onClick={() => setTab(t.value)}
              style={tab === t.value ? { background: 'var(--m-ink)' } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <div className="m-spinner" />}

        {!loading && cards.length === 0 && (
          <div className="m-empty">
            <ClipboardList size={30} />
            <strong>Không có phiếu nào</strong>
            <span>Chưa có phiếu công đoạn ở trạng thái này.</span>
          </div>
        )}

        {!loading && cards.map((jc) => {
          const planned = jc.plannedQty || 0
          const actual = jc.actualQty || 0
          const pct = planned > 0 ? Math.round((actual / planned) * 100) : 0
          const unit = jc.unit || 'kg'

          return (
            <MListCard
              key={jc.id}
              code={jc.jobCode}
              badge={<StatusBadge category="jobCard" status={jc.status} />}
              title={jc.description || jc.workType}
              href={`/m/prod/job-cards/${jc.id}`}
              facts={[
                { label: 'Lệnh SX', value: <span className="m-mono">{jc.workOrder?.woCode || '—'}</span> },
                { label: 'Tổ', value: jc.teamCode || '—' },
                {
                  label: 'Ngày làm',
                  value: new Date(jc.workDate).toLocaleDateString('vi-VN'),
                },
              ]}
              progress={
                planned > 0
                  ? { percent: pct, note: `${actual} / ${planned} ${unit} · ${pct}%` }
                  : undefined
              }
            />
          )
        })}
      </main>
    </>
  )
}
