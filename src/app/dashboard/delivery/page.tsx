'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState,
  Pagination,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface Delivery {
  id: string; deliveryCode: string; status: string; shippingMethod: string | null;
  trackingNo: string | null; shippedAt: string | null; deliveredAt: string | null;
  notes: string | null; createdAt: string;
  project: { projectCode: string; projectName: string } | null
  workOrder: { woCode: string; description: string } | null
}

interface ProgressData {
  totalPlannedTons: number; totalPieceMarks: number;
  packed: { weight: number; pieces: number };
  shipped: { weight: number; pieces: number };
  arrived: { weight: number };
  packingListCount: number; shipmentCount: number;
  shipmentsByStatus: { pending: number; inTransit: number; arrived: number; received: number };
}

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'PACKING', label: 'Đóng gói' },
  { value: 'SHIPPED', label: 'Đã ship' },
  { value: 'DELIVERED', label: 'Đã giao' },
  { value: 'RECEIVED', label: 'Đã nhận' },
]

export default function DeliveryPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const canCreate = ['R01', 'R05', 'R05a', 'R06', 'R07'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const [dlRes, progRes] = await Promise.all([
      apiFetch(`/api/delivery?${params}`),
      apiFetch('/api/logistics/progress'),
    ])
    if (dlRes.ok) setDeliveries(dlRes.deliveries || [])
    if (progRes.ok) setProgress(progRes)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const handleTransition = async (id: string, nextStatus: string) => {
    setActionLoading(id)
    const res = await apiFetch('/api/delivery', {
      method: 'PATCH', body: JSON.stringify({ id, status: nextStatus }),
    })
    if (res.ok) loadData()
    else alert(res.error || 'Lỗi')
    setActionLoading(null)
  }

  const nextAction: Record<string, { next: string; label: string }> = {
    PACKING: { next: 'SHIPPED', label: 'Xuất kho' },
    SHIPPED: { next: 'DELIVERED', label: 'Đã giao' },
    DELIVERED: { next: 'RECEIVED', label: 'KH xác nhận' },
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Logistics & Giao hàng"
        subtitle={`${deliveries.length} phiếu giao hàng`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/dashboard/logistics/packing-lists')}>Packing List</Button>
            <Button variant="outline" onClick={() => router.push('/dashboard/logistics/shipments')}>Shipments</Button>
            <Button variant="outline" onClick={() => router.push('/dashboard/logistics/mdr')}>MDR</Button>
          </div>
        }
      />

      {progress && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
          <KPICard label="Kế hoạch" value={`${progress.totalPlannedTons}t`} accentColor={SEMANTIC_COLORS.info.solid} />
          <KPICard label="Đã đóng kiện" value={`${progress.packed.weight}kg / ${progress.packed.pieces}pc`} accentColor={SEMANTIC_COLORS.warning.solid} />
          <KPICard label="Đã xuất" value={`${progress.shipped.weight}kg`} accentColor={SEMANTIC_COLORS.info.solid} />
          <KPICard label="Đã tới site" value={`${progress.arrived.weight}kg`} accentColor={SEMANTIC_COLORS.success.solid} />
          <KPICard label="Chuyến hàng" value={progress.shipmentCount} accentColor="var(--accent)" />
        </div>
      )}

      <FilterBar
        filters={STATUS_FILTERS}
        value={statusFilter}
        onChange={setStatusFilter}
        actions={canCreate ? <Button variant="accent" onClick={() => router.push('/dashboard/logistics/packing-lists')}>+ Tạo kiện</Button> : undefined}
      />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã</th><th>Dự án</th><th>WO</th><th>Trạng thái</th>
              <th>Vận chuyển</th><th>Tracking</th><th>Ngày ship</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon="📦" title="Chưa có phiếu giao hàng" /></td></tr>
            ) : deliveries.map(d => {
              const action = nextAction[d.status]
              return (
                <tr key={d.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{d.deliveryCode}</span></td>
                  <td className="text-xs">{d.project?.projectCode || '—'}</td>
                  <td className="text-xs font-mono" style={{ color: 'var(--primary)' }}>{d.workOrder?.woCode || '—'}</td>
                  <td><StatusBadge category="logistics" status={d.status} /></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.shippingMethod || '—'}</td>
                  <td className="text-xs font-mono">{d.trackingNo || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.shippedAt ? formatDate(d.shippedAt) : '—'}</td>
                  <td>
                    {action && (
                      <button
                        onClick={() => handleTransition(d.id, action.next)}
                        disabled={actionLoading === d.id}
                        className="text-xs px-2 py-1 rounded font-bold"
                        style={{ background: SEMANTIC_COLORS.info.bg, color: SEMANTIC_COLORS.info.solid }}
                      >
                        {actionLoading === d.id ? '...' : action.label}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
