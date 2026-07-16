'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MListCard } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { Gauge } from 'lucide-react'

interface Inspection {
  id: string
  inspectionCode: string
  type: string
  status: string
  pieceMark?: string | null
  project: { projectCode: string } | null
}

export default function MobileDftList() {
  const [items, setItems] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Bàn đo DFT làm việc trên biên bản đang chờ kiểm.
    apiFetch('/api/qc?status=PENDING&limit=50').then((res) => {
      setItems(res.ok ? (res.inspections || []) : [])
      setLoading(false)
    })
  }, [])

  return (
    <>
      <MAppBar title="Đo NDT / DFT" subtitle="Nhập số đo, so chuẩn" backHref="/m" />

      <main className="m-main">
        {loading && <div className="m-spinner" />}

        {!loading && items.length === 0 && (
          <div className="m-empty">
            <Gauge size={30} />
            <strong>Không có biên bản chờ đo</strong>
            <span>Biên bản kiểm tra được lập trên bản máy tính, sau đó đo trên điện thoại.</span>
          </div>
        )}

        {!loading && items.map((i) => (
          <MListCard
            key={i.id}
            code={i.inspectionCode}
            badge={<StatusBadge category="qc" status={i.status} />}
            title={i.type}
            href={`/m/qc/dft/${i.id}`}
            facts={[
              { label: 'Dự án', value: <span className="m-mono">{i.project?.projectCode || '—'}</span> },
              { label: 'Piece-mark', value: <span className="m-mono">{i.pieceMark || '—'}</span> },
            ]}
          />
        ))}
      </main>
    </>
  )
}
