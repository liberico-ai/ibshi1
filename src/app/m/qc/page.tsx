'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MListCard } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { ClipboardCheck } from 'lucide-react'

interface Inspection {
  id: string
  inspectionCode: string
  type: string
  stepCode: string | null
  status: string
  pieceMark?: string | null
  totalItems: number
  passedItems: number
  failedItems: number
  project: { projectCode: string } | null
}

const TABS = [
  { value: 'PENDING', label: 'Chờ kiểm' },
  { value: 'PASSED', label: 'Đạt' },
  { value: 'FAILED', label: 'Lỗi' },
] as const

export default function MobileQcList() {
  const [tab, setTab] = useState<string>('PENDING')
  const [items, setItems] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (status: string) => {
    setLoading(true)
    const res = await apiFetch(`/api/qc?status=${status}&limit=50`)
    setItems(res.ok ? (res.inspections || []) : [])
    setLoading(false)
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  return (
    <>
      <MAppBar title="Nghiệm thu" subtitle="Ghi kết quả kiểm tra" backHref="/m" />

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

        {!loading && items.length === 0 && (
          <div className="m-empty">
            <ClipboardCheck size={30} />
            <strong>Không có biên bản nào</strong>
            <span>Chưa có biên bản kiểm tra ở trạng thái này.</span>
          </div>
        )}

        {!loading && items.map((i) => (
          <MListCard
            key={i.id}
            code={i.inspectionCode}
            badge={<StatusBadge category="qc" status={i.status} />}
            title={i.type}
            href={`/m/qc/${i.id}`}
            facts={[
              { label: 'Dự án', value: <span className="m-mono">{i.project?.projectCode || '—'}</span> },
              { label: 'Piece-mark', value: <span className="m-mono">{i.pieceMark || '—'}</span> },
              {
                label: 'Hạng mục kiểm',
                value: i.totalItems > 0 ? `${i.passedItems}/${i.totalItems} đạt` : '—',
              },
            ]}
          />
        ))}
      </main>
    </>
  )
}
