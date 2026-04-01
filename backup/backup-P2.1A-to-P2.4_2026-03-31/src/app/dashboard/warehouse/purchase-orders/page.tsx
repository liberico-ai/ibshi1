'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface PO {
  id: string; poCode: string; status: string; totalAmount: number | null; orderDate: string | null; deliveryDate: string | null;
  vendor: { vendorCode: string; name: string } | null
  items: { id: string; quantity: number; unitPrice: number }[]
}

const statusLabel: Record<string, string> = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', SENT: 'Đã gửi', CONFIRMED: 'Xác nhận', PARTIAL: 'Nhận 1 phần', RECEIVED: 'Đã nhận', COMPLETED: 'Hoàn thành', REJECTED: 'Từ chối', CANCELLED: 'Hủy' }
const statusColor: Record<string, string> = { DRAFT: '#888', PENDING: '#f59e0b', APPROVED: '#16a34a', SENT: '#0ea5e9', CONFIRMED: '#16a34a', PARTIAL: '#f59e0b', RECEIVED: '#0ea5e9', COMPLETED: '#16a34a', REJECTED: '#dc2626', CANCELLED: '#dc2626' }

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🛒 Đơn đặt hàng (PO)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pos.length} đơn • Tổng {totalValue.toLocaleString('vi-VN')} ₫ • {pos.filter(p => p.status === 'DRAFT' || p.status === 'PENDING').length} chờ duyệt</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã PO</th><th>NCC</th><th>Trạng thái</th><th className="text-right">Giá trị</th><th>Ngày giao</th><th>Items</th><th>Thao tác</th></tr></thead>
          <tbody>
            {pos.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có PO</td></tr>
            ) : pos.map(po => (
              <tr key={po.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{po.poCode}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{po.vendor?.name || '—'}</td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[po.status] || '#888'}20`, color: statusColor[po.status] || '#888' }}>{statusLabel[po.status] || po.status}</span></td>
                <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{(po.totalAmount || 0).toLocaleString('vi-VN')} ₫</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{po.deliveryDate ? new Date(po.deliveryDate).toLocaleDateString('vi-VN') : '—'}</td>
                <td className="text-xs font-bold" style={{ color: '#0ea5e9' }}>{po.items?.length || 0}</td>
                <td>
                  <div className="flex gap-1">
                    {(po.status === 'DRAFT' || po.status === 'PENDING') && (
                      <>
                        <button
                          onClick={() => handleApprove(po.id, 'APPROVE')}
                          disabled={actionLoading === po.id}
                          className="text-xs px-2 py-1 rounded font-bold transition-colors"
                          style={{ background: '#16a34a20', color: '#16a34a' }}
                        >
                          ✓ Duyệt
                        </button>
                        <button
                          onClick={() => handleApprove(po.id, 'REJECT')}
                          disabled={actionLoading === po.id}
                          className="text-xs px-2 py-1 rounded font-bold transition-colors"
                          style={{ background: '#dc262620', color: '#dc2626' }}
                        >
                          ✗ Từ chối
                        </button>
                      </>
                    )}
                    {actionLoading === po.id && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⏳</span>}
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
