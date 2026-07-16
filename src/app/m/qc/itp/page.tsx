'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MListCard } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { FileCheck } from 'lucide-react'

interface Itp {
  id: string
  itpCode: string
  name: string
  status: string
  project: { projectCode: string } | null
  totalCheckpoints: number
  passedCheckpoints: number
  failedCheckpoints: number
}

export default function MobileItpList() {
  const [itps, setItps] = useState<Itp[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/qc/itp').then((res) => {
      setItps(res.ok ? (res.itps || []) : [])
      setLoading(false)
    })
  }, [])

  return (
    <>
      <MAppBar title="Kế hoạch kiểm tra" subtitle="Điểm Hold / Witness" backHref="/m" />

      <main className="m-main">
        {loading && <div className="m-spinner" />}

        {!loading && itps.length === 0 && (
          <div className="m-empty">
            <FileCheck size={30} />
            <strong>Chưa có ITP nào</strong>
            <span>Chưa có kế hoạch kiểm tra cho các dự án của bạn.</span>
          </div>
        )}

        {!loading && itps.map((itp) => {
          const pending = itp.totalCheckpoints - itp.passedCheckpoints - itp.failedCheckpoints
          return (
            <MListCard
              key={itp.id}
              code={itp.itpCode}
              badge={<StatusBadge category="itp" status={itp.status} />}
              title={itp.name}
              href={`/m/qc/itp/${itp.id}`}
              facts={[
                { label: 'Dự án', value: <span className="m-mono">{itp.project?.projectCode || '—'}</span> },
                { label: 'Điểm kiểm', value: `${itp.totalCheckpoints}` },
                { label: 'Còn chờ', value: pending > 0 ? `${pending} điểm` : 'Đã xong' },
              ]}
              progress={
                itp.totalCheckpoints > 0
                  ? {
                      percent: Math.round((itp.passedCheckpoints / itp.totalCheckpoints) * 100),
                      note: `${itp.passedCheckpoints}/${itp.totalCheckpoints} đạt${itp.failedCheckpoints ? ` · ${itp.failedCheckpoints} lỗi` : ''}`,
                    }
                  : undefined
              }
            />
          )
        })}
      </main>
    </>
  )
}
