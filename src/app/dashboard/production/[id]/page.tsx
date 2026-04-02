'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { RBAC } from '@/lib/rbac-rules'

interface WorkOrderDetail {
  id: string; woCode: string; projectId: string; description: string;
  teamCode: string; status: string;
  plannedStart: string | null; plannedEnd: string | null;
  actualStart: string | null; actualEnd: string | null;
  createdAt: string;
  materialIssues: { id: string; materialId: string; quantity: number; issuedBy: string; issuedAt: string; notes: string | null }[];
}

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  OPEN: { label: 'Chờ', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  IN_PROGRESS: { label: 'Đang chạy', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  QC_PENDING: { label: 'Chờ QC', bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  QC_PASSED: { label: 'QC Đạt', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  QC_FAILED: { label: 'QC Không đạt', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  ON_HOLD: { label: 'Tạm dừng', bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
  COMPLETED: { label: 'Hoàn thành', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  CANCELLED: { label: 'Đã hủy', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
}

// Valid transitions matching the API FSM
const TRANSITIONS: Record<string, { next: string; label: string; color: string; bg: string }[]> = {
  OPEN: [{ next: 'IN_PROGRESS', label: '▶ Bắt đầu SX', color: '#2563eb', bg: '#eff6ff' }],
  IN_PROGRESS: [
    { next: 'QC_PENDING', label: '🔍 Gửi QC', color: '#d97706', bg: '#fffbeb' },
    { next: 'ON_HOLD', label: '⏸ Tạm dừng', color: '#7c3aed', bg: '#f5f3ff' },
  ],
  ON_HOLD: [{ next: 'IN_PROGRESS', label: '▶ Tiếp tục', color: '#2563eb', bg: '#eff6ff' }],
  QC_PENDING: [
    { next: 'QC_PASSED', label: '✓ QC Đạt', color: '#16a34a', bg: '#f0fdf4' },
    { next: 'QC_FAILED', label: '✗ Không đạt', color: '#dc2626', bg: '#fef2f2' },
  ],
  QC_FAILED: [{ next: 'IN_PROGRESS', label: '🔄 Sửa lại', color: '#2563eb', bg: '#eff6ff' }],
  QC_PASSED: [{ next: 'COMPLETED', label: '✅ Hoàn thành', color: '#16a34a', bg: '#f0fdf4' }],
}

export default function ProductionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [wo, setWo] = useState<WorkOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  
  const currentUser = useAuthStore((state) => state.user)
  const roleCode = currentUser?.roleCode || ''

  useEffect(() => { loadWO() }, [id])

  async function loadWO() {
    const res = await apiFetch(`/api/production/${id}`)
    if (res.ok) setWo(res.workOrder)
    setLoading(false)
  }

  async function handleTransition(nextStatus: string) {
    setTransitioning(true)
    const res = await apiFetch(`/api/production/${id}/transition`, {
      method: 'POST', body: JSON.stringify({ nextStatus }),
    })
    if (res.ok) loadWO()
    else alert(res.error || 'Lỗi chuyển trạng thái')
    setTransitioning(false)
  }

  if (loading) return <div className="animate-fade-in"><div className="h-48 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} /></div>
  if (!wo) return <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Không tìm thấy lệnh sản xuất</div>

  const cfg = STATUS_CFG[wo.status] || STATUS_CFG.OPEN
  const transitions = TRANSITIONS[wo.status] || []
  
  // Conditionally show buttons if user role is in RBAC list
  const showActionButtons = RBAC.PRODUCTION_ACTION.includes(roleCode) || RBAC.QC_ACTION.includes(roleCode)

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => router.push('/dashboard/production')} className="text-sm flex items-center gap-1" style={{ color: 'var(--primary)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        Quay lại Sản xuất
      </button>

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-lg font-bold" style={{ color: 'var(--primary)' }}>{wo.woCode}</span>
              <span className="badge" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border, borderWidth: '1px' }}>{cfg.label}</span>
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{wo.description}</h1>
          </div>
          <div className="flex gap-2">
            {!showActionButtons && transitions.length > 0 && (
              <span className="text-sm px-4 py-2 flex items-center gap-1 rounded-lg" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
                🔒 Chỉ quyền SX/QC
              </span>
            )}
            {showActionButtons && transitions.map(t => (
              <button
                key={t.next}
                onClick={() => handleTransition(t.next)}
                disabled={transitioning}
                className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity"
                style={{ background: t.bg, color: t.color, border: `1px solid ${t.color}30`, opacity: transitioning ? 0.5 : 1 }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tổ SX</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{wo.teamCode}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>KH bắt đầu</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{wo.plannedStart ? formatDate(wo.plannedStart) : '—'}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>KH kết thúc</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{wo.plannedEnd ? formatDate(wo.plannedEnd) : '—'}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>TT bắt đầu</span><p className="font-medium" style={{ color: wo.actualStart ? '#16a34a' : 'var(--text-muted)' }}>{wo.actualStart ? formatDate(wo.actualStart) : '—'}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>TT kết thúc</span><p className="font-medium" style={{ color: wo.actualEnd ? '#16a34a' : 'var(--text-muted)' }}>{wo.actualEnd ? formatDate(wo.actualEnd) : '—'}</p></div>
        </div>
      </div>

      {/* Material Issues */}
      <div className="card overflow-hidden">
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Vật tư đã cấp ({wo.materialIssues.length})</h3>
        </div>
        <table className="data-table">
          <thead><tr><th>Material ID</th><th className="text-right">Số lượng</th><th>Người cấp</th><th>Ghi chú</th><th>Thời gian</th></tr></thead>
          <tbody>
            {wo.materialIssues.map((mi) => (
              <tr key={mi.id}>
                <td className="font-mono text-xs" style={{ color: 'var(--primary)' }}>{mi.materialId.slice(0, 8)}...</td>
                <td className="text-right font-semibold" style={{ color: 'var(--text-primary)' }}>{mi.quantity}</td>
                <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{mi.issuedBy.slice(0, 8)}...</td>
                <td style={{ color: 'var(--text-muted)' }}>{mi.notes || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(mi.issuedAt).toLocaleString('vi-VN')}</td>
              </tr>
            ))}
            {wo.materialIssues.length === 0 && <tr><td colSpan={5} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>Chưa có vật tư được cấp</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
