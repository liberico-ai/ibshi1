'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Delivery {
  id: string; deliveryCode: string; status: string; shippingMethod: string | null;
  trackingNo: string | null; shippedAt: string | null; deliveredAt: string | null;
  notes: string | null; createdAt: string;
  project: { projectCode: string; projectName: string } | null
  workOrder: { woCode: string; description: string } | null
}

const statusCfg: Record<string, { label: string; color: string }> = {
  PACKING: { label: '📦 Đóng gói', color: '#f59e0b' },
  SHIPPED: { label: '🚚 Đang vận chuyển', color: '#0ea5e9' },
  DELIVERED: { label: '📬 Đã giao', color: '#8b5cf6' },
  RECEIVED: { label: '✅ Đã nhận', color: '#16a34a' },
}

export default function DeliveryPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = () => {
    setLoading(true)
    apiFetch('/api/delivery').then(res => {
      if (res.ok) setDeliveries(res.deliveries || [])
      setLoading(false)
    })
  }

  useEffect(() => { fetchData() }, [])

  const handleTransition = async (id: string, nextStatus: string) => {
    setActionLoading(id)
    const res = await apiFetch('/api/delivery', {
      method: 'PATCH', body: JSON.stringify({ id, status: nextStatus }),
    })
    if (res.ok) fetchData()
    else alert(res.error || 'Lỗi')
    setActionLoading(null)
  }

  const nextAction: Record<string, { next: string; label: string }> = {
    PACKING: { next: 'SHIPPED', label: '🚚 Xuất kho' },
    SHIPPED: { next: 'DELIVERED', label: '📬 Đã giao' },
    DELIVERED: { next: 'RECEIVED', label: '✅ KH xác nhận' },
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const packingCount = deliveries.filter(d => d.status === 'PACKING').length
  const shippedCount = deliveries.filter(d => d.status === 'SHIPPED').length
  const deliveredCount = deliveries.filter(d => d.status === 'DELIVERED' || d.status === 'RECEIVED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Giao hàng</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{deliveries.length} phiếu giao hàng</p>
        </div>
      </div>

      {/* Stats Overview — Dashboard style */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        {[
          { label: 'Tổng phiếu', value: deliveries.length, color: '#0a2540', icon: '📋' },
          { label: 'Đang đóng gói', value: packingCount, color: '#f59e0b', icon: '📦' },
          { label: 'Đang vận chuyển', value: shippedCount, color: '#0ea5e9', icon: '🚚' },
          { label: 'Đã giao', value: deliveredCount, color: '#16a34a', icon: '✅' },
        ].map(s => (
          <div key={s.label} className="card p-6 relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: s.color, borderRadius: '16px 16px 0 0' }} />
            <div className="flex items-center justify-between mb-4 pt-1">
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${s.color}10`, fontSize: '20px' }}>
                {s.icon}
              </div>
            </div>
            <p style={{ fontSize: '32px', fontWeight: 800, color: s.color, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</p>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '8px' }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã</th><th>Dự án</th><th>WO</th><th>Trạng thái</th><th>Vận chuyển</th><th>Tracking</th><th>Ngày ship</th><th>Thao tác</th></tr></thead>
          <tbody>
            {deliveries.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có phiếu giao hàng</td></tr>
            ) : deliveries.map(d => {
              const cfg = statusCfg[d.status] || { label: d.status, color: '#888' }
              const action = nextAction[d.status]
              return (
                <tr key={d.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{d.deliveryCode}</span></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.project?.projectCode || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--primary)' }}>{d.workOrder?.woCode || '—'}</td>
                  <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${cfg.color}20`, color: cfg.color }}>{cfg.label}</span></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.shippingMethod || '—'}</td>
                  <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.trackingNo || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.shippedAt ? new Date(d.shippedAt).toLocaleDateString('vi-VN') : '—'}</td>
                  <td>
                    {action && (
                      <button
                        onClick={() => handleTransition(d.id, action.next)}
                        disabled={actionLoading === d.id}
                        className="text-[10px] px-2 py-1 rounded font-bold"
                        style={{ background: `${statusCfg[action.next]?.color || '#888'}20`, color: statusCfg[action.next]?.color || '#888' }}
                      >
                        {action.label}
                      </button>
                    )}
                    {actionLoading === d.id && <span className="text-[10px] ml-1">⏳</span>}
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
