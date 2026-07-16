'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MListCard } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { Flame } from 'lucide-react'

interface WorkOrder {
  id: string
  woCode: string
  description: string | null
  status: string
  pieceMark: string | null
  teamCode: string | null
}

export default function MobileWeldMapWO() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Mối hàn gắn theo WO — chọn WO trước.
    apiFetch('/api/production?limit=50').then((res) => {
      setOrders(res.ok ? (res.workOrders || []) : [])
      setLoading(false)
    })
  }, [])

  return (
    <>
      <MAppBar title="Weld map" subtitle="Chọn lệnh sản xuất" backHref="/m" />

      <main className="m-main">
        {loading && <div className="m-spinner" />}

        {!loading && orders.length === 0 && (
          <div className="m-empty">
            <Flame size={30} />
            <strong>Không có lệnh nào</strong>
            <span>Chưa có lệnh sản xuất để tra mối hàn.</span>
          </div>
        )}

        {!loading && orders.map((wo) => (
          <MListCard
            key={wo.id}
            code={wo.woCode}
            badge={<StatusBadge category="production" status={wo.status} />}
            title={wo.description || 'Lệnh sản xuất'}
            href={`/m/prod/weld-map/${wo.id}`}
            facts={[
              { label: 'Piece-mark', value: <span className="m-mono">{wo.pieceMark || '—'}</span> },
              { label: 'Tổ', value: wo.teamCode || '—' },
            ]}
          />
        ))}
      </main>
    </>
  )
}
