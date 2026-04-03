'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { RBAC } from '@/lib/rbac-rules'

interface PR {
  id: string; prCode: string; status: string; priority: string; requiredDate: string | null; createdAt: string;
  project: { projectCode: string; projectName: string } | null
  items: { id: string; materialId: string; quantity: number }[]
}

const statusLabel: Record<string, string> = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', SUBMITTED: 'Đã gửi', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', ORDERED: 'Đã đặt', CONVERTED: 'Đã chuyển PO' }
const statusColor: Record<string, string> = { DRAFT: '#888', PENDING: '#f59e0b', SUBMITTED: '#0ea5e9', APPROVED: '#16a34a', REJECTED: '#dc2626', ORDERED: '#8b5cf6', CONVERTED: '#6366f1' }

export default function PurchaseRequestsPage() {
  const [prs, setPrs] = useState<PR[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const currentUser = useAuthStore((state) => state.user)
  const roleCode = currentUser?.roleCode || ''
  const hasApprovePermission = RBAC.PR_APPROVAL.includes(roleCode)

  const fetchData = () => {
    setLoading(true)
    apiFetch('/api/purchase-requests').then(res => {
      if (res.ok) setPrs(res.purchaseRequests || res.requests || [])
      setLoading(false)
    })
  }

  useEffect(() => { fetchData() }, [])

  const handleApprove = async (id: string, action: 'approve' | 'reject') => {
    if (action === 'reject') {
      const reason = prompt('Lý do từ chối:')
      if (!reason) return
      setActionLoading(id)
      const res = await apiFetch(`/api/purchase-requests/${id}`, {
        method: 'PUT', body: JSON.stringify({ action, reason }),
      })
      if (res.ok) fetchData()
      else alert(res.error || 'Lỗi')
      setActionLoading(null)
      return
    }
    setActionLoading(id)
    const res = await apiFetch(`/api/purchase-requests/${id}`, {
      method: 'PUT', body: JSON.stringify({ action }),
    })
    if (res.ok) fetchData()
    else alert(res.error || 'Lỗi')
    setActionLoading(null)
  }

  const handleConvert = async (id: string) => {
    const vendorId = prompt('Nhập Vendor ID để tạo PO:')
    if (!vendorId) return
    setActionLoading(id)
    const res = await apiFetch('/api/purchase-orders/convert', {
      method: 'POST', body: JSON.stringify({ purchaseRequestId: id, vendorId }),
    })
    if (res.ok) { alert(`Đã chuyển thành ${res.purchaseOrder?.poCode || 'PO'}`); fetchData() }
    else alert(res.error || 'Lỗi')
    setActionLoading(null)
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📋 Đề nghị mua hàng (PR)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{prs.length} phiếu • {prs.filter(p => p.status === 'PENDING' || p.status === 'DRAFT').length} chờ duyệt</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã PR</th><th>Dự án</th><th>Trạng thái</th><th>Ưu tiên</th><th>Ngày cần</th><th>Items</th><th>Thao tác</th></tr></thead>
          <tbody>
            {prs.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có PR</td></tr>
            ) : prs.map(pr => (
              <tr key={pr.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{pr.prCode}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{pr.project?.projectCode || '—'}</td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[pr.status] || '#888'}20`, color: statusColor[pr.status] || '#888' }}>{statusLabel[pr.status] || pr.status}</span></td>
                <td className="text-xs" style={{ color: pr.priority === 'HIGH' ? '#dc2626' : pr.priority === 'MEDIUM' ? '#f59e0b' : 'var(--text-muted)' }}>{pr.priority}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{pr.requiredDate ? new Date(pr.requiredDate).toLocaleDateString('vi-VN') : '—'}</td>
                <td className="text-xs font-bold" style={{ color: '#0ea5e9' }}>{pr.items?.length || 0}</td>
                <td>
                  <div className="flex gap-1 items-center">
                    {(pr.status === 'PENDING' || pr.status === 'DRAFT' || pr.status === 'SUBMITTED') && hasApprovePermission && (
                      <>
                        <button
                          onClick={() => handleApprove(pr.id, 'approve')}
                          disabled={actionLoading === pr.id}
                          className="text-xs px-2 py-1 rounded font-bold transition-colors"
                          style={{ background: '#16a34a20', color: '#16a34a' }}
                        >
                          ✓ Duyệt
                        </button>
                        <button
                          onClick={() => handleApprove(pr.id, 'reject')}
                          disabled={actionLoading === pr.id}
                          className="text-xs px-2 py-1 rounded font-bold transition-colors"
                          style={{ background: '#dc262620', color: '#dc2626' }}
                        >
                          ✗ Từ chối
                        </button>
                      </>
                    )}
                    {(pr.status === 'PENDING' || pr.status === 'DRAFT' || pr.status === 'SUBMITTED') && !hasApprovePermission && (
                      <span className="text-xs text-slate-400 font-medium">🔒 Chỉ BGĐ/PM</span>
                    )}
                    {pr.status === 'APPROVED' && (
                      <button
                        onClick={() => handleConvert(pr.id)}
                        disabled={actionLoading === pr.id}
                        className="text-xs px-2 py-1 rounded font-bold transition-colors"
                        style={{ background: '#6366f120', color: '#6366f1' }}
                      >
                        ⇒ Chuyển PO
                      </button>
                    )}
                    {actionLoading === pr.id && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⏳</span>}
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
