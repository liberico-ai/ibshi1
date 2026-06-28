'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PageHeader, StatusBadge, Button, EmptyState, KPICard } from '@/components/ui'
import { ShoppingCart, ClipboardList, Banknote, Clock, CheckCircle2 } from 'lucide-react'

interface PO {
  id: string; poCode: string; status: string; totalAmount: number | null; orderDate: string | null; deliveryDate: string | null;
  vendor: { vendorCode: string; name: string } | null
  items: { id: string; quantity: number; unitPrice: number }[]
}

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<PO[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = () => {
    setLoading(true)
    apiFetch('/api/purchase-orders').then(res => {
      if (res.ok) setPos(res.purchaseOrders || res.orders || [])
      setLoading(false)
    })
  }

  useEffect(() => { fetchData() }, [])

  const handleApprove = async (id: string, action: 'APPROVE' | 'REJECT') => {
    setActionLoading(id)
    const res = await apiFetch(`/api/purchase-orders/${id}/approve`, {
      method: 'POST', body: JSON.stringify({ action }),
    })
    if (res.ok) fetchData()
    else alert(res.error || 'Lỗi')
    setActionLoading(null)
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalValue = pos.reduce((s, p) => s + (p.totalAmount || 0), 0)
  const pendingCount = pos.filter(p => p.status === 'DRAFT' || p.status === 'PENDING').length
  const approvedCount = pos.filter(p => p.status === 'APPROVED' || p.status === 'COMPLETED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Đơn đặt hàng (PO)"
        subtitle={`${pos.length} đơn hàng`}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard
          label="Tổng đơn"
          value={pos.length}
          icon={<ClipboardList size={20} />}
        />
        <KPICard
          label="Tổng giá trị"
          value={formatCurrency(totalValue)}
          icon={<Banknote size={20} />}
          accentColor="var(--success)"
        />
        <KPICard
          label="Chờ duyệt"
          value={pendingCount}
          icon={<Clock size={20} />}
          accentColor="var(--warning)"
        />
        <KPICard
          label="Đã duyệt"
          value={approvedCount}
          icon={<CheckCircle2 size={20} />}
          accentColor="var(--success)"
        />
      </div>

      {/* Table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã PO</th>
              <th>NCC</th>
              <th>Trạng thái</th>
              <th className="text-right">Giá trị</th>
              <th>Ngày giao</th>
              <th>Items</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {pos.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={<ShoppingCart />} title="Chưa có PO" description="Chưa có đơn đặt hàng nào được tạo" />
                </td>
              </tr>
            ) : pos.map(po => (
              <tr key={po.id}>
                <td>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{po.poCode}</span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{po.vendor?.name || '—'}</td>
                <td>
                  <StatusBadge category="po" status={po.status} />
                </td>
                <td className="text-right">
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--success)' }}>
                    {formatCurrency(po.totalAmount || 0)}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{po.deliveryDate ? formatDate(po.deliveryDate) : '—'}</td>
                <td>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--info)' }}>
                    {po.items?.length || 0}
                  </span>
                </td>
                <td>
                  <div className="flex gap-1">
                    {(po.status === 'DRAFT' || po.status === 'PENDING') && (
                      <>
                        <Button
                          variant="accent"
                          size="sm"
                          onClick={() => handleApprove(po.id, 'APPROVE')}
                          loading={actionLoading === po.id}
                        >
                          Duyệt
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleApprove(po.id, 'REJECT')}
                          loading={actionLoading === po.id}
                        >
                          Từ chối
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
