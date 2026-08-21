'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { formatDate, formatNumber } from '@/lib/utils'

// Duyệt phiếu đề nghị cấp vật tư: Xưởng gửi → PM phụ trách dự án → BGĐ → Kho mới thấy để cấp.
// Trang này là "sân" của PM và BGĐ; xưởng vào đây để theo dõi phiếu của mình.

interface Line { materialCode: string; name: string; quantity: number; unit: string; source: string; currentStock: number }
interface WoBlock { id: string; woCode: string; description: string; teamCode: string; pieceMark: string | null; status: string; lines: Line[] }
interface Order {
  id: string; code: string; status: string
  project: { projectCode: string; projectName: string }
  department: { code: string; name: string } | null
  submittedAt: string | null; pmApprovedAt: string | null; bodApprovedAt: string | null
  rejectReason: string | null; rejectedAt: string | null
  workOrderCount: number; lineCount: number; workOrders: WoBlock[]
}

const STATUS: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'danger' }> = {
  DRAFT: { label: 'Nháp', variant: 'default' },
  PENDING_PM: { label: 'Chờ PM duyệt', variant: 'warning' },
  PENDING_BOD: { label: 'Chờ BGĐ duyệt', variant: 'warning' },
  APPROVED: { label: 'Đã duyệt', variant: 'success' },
  REJECTED: { label: 'Bị trả lại', variant: 'danger' },
}

export default function MaterialApprovalPage() {
  const roleCode = useAuthStore(s => s.user?.roleCode) || ''
  const [orders, setOrders] = useState<Order[]>([])
  const [myRole, setMyRole] = useState<string>('VIEWER')
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/production/material-requests/inbox${showAll ? '?all=1' : ''}`)
    if (r.ok) { setOrders(r.items || []); setMyRole(r.myRole || 'VIEWER') }
    else notify(r.error || 'Không tải được danh sách phiếu', 'error')
    setLoading(false)
  }, [showAll])
  useEffect(() => { void load() }, [load])

  // Chỉ hiện nút duyệt đúng chặng của mình
  const canAct = (o: Order) =>
    (o.status === 'PENDING_PM' && ['R02', 'R02a', 'R10'].includes(roleCode)) ||
    (o.status === 'PENDING_BOD' && ['R01', 'R10'].includes(roleCode))

  const act = async (o: Order, action: 'approve' | 'reject') => {
    let reason = ''
    if (action === 'reject') {
      reason = window.prompt(`Lý do trả lại phiếu ${o.code}?`)?.trim() || ''
      if (!reason) { notify('Cần nhập lý do trả lại', 'error'); return }
    } else if (!await confirmDialog(`Duyệt phiếu ${o.code} (${o.lineCount} dòng, ${o.workOrderCount} lệnh)?`)) return

    setBusy(true)
    const r = await apiFetch(`/api/production/material-requests/${o.id}`, {
      method: 'POST', body: JSON.stringify({ action, reason }),
    })
    setBusy(false)
    if (!r.ok) { notify(r.error || 'Lỗi xử lý phiếu', 'error'); return }
    notify(r.message || 'Đã xử lý', 'success')
    await load()
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Duyệt cấp vật tư"
        subtitle={
          myRole === 'PM' ? 'Phiếu chờ bạn duyệt (dự án bạn phụ trách)'
            : myRole === 'BOD' ? 'Phiếu PM đã duyệt, chờ Ban Giám đốc'
              : myRole === 'WORKSHOP' ? 'Phiếu xưởng bạn đã gửi'
                : 'Phiếu đề nghị cấp vật tư'
        }
        actions={
          <Button variant="outline" onClick={() => { setLoading(true); setShowAll(v => !v) }}>
            {showAll ? 'Chỉ phiếu chờ tôi' : 'Xem tất cả phiếu'}
          </Button>
        }
      />

      {orders.length === 0 ? (
        <Card padding="spacious" className="text-center">
          <p style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Không có phiếu nào</p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Phiếu xuất hiện ở đây khi Xưởng gửi đề nghị cấp vật tư từ danh sách lệnh sản xuất.
          </p>
        </Card>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã phiếu</th><th>Dự án</th><th>Xưởng</th>
                <th className="text-right">Lệnh</th><th className="text-right">Dòng VT</th>
                <th>Gửi lúc</th><th>Trạng thái</th><th className="text-right">Xử lý</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const isOpen = openId === o.id
                const st = STATUS[o.status] || { label: o.status, variant: 'default' as const }
                return (
                  <React.Fragment key={o.id}>
                    <tr className={isOpen ? 'bg-sky-50 dark:bg-sky-900/20' : ''} style={{ cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : o.id)}>
                      <td className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{o.code}</td>
                      <td className="text-xs">{o.project.projectCode}</td>
                      <td className="text-xs">{o.department?.code || '—'}</td>
                      <td className="text-right text-xs">{o.workOrderCount}</td>
                      <td className="text-right text-xs">{o.lineCount}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.submittedAt ? formatDate(o.submittedAt) : '—'}</td>
                      <td><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="text-right" onClick={e => e.stopPropagation()}>
                        {canAct(o) ? (
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => act(o, 'reject')}>Trả lại</Button>
                            <Button variant="primary" size="sm" disabled={busy} onClick={() => act(o, 'approve')}>Duyệt</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setOpenId(isOpen ? null : o.id)}>{isOpen ? 'Thu gọn' : 'Xem'}</Button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="p-4 space-y-3" style={{ background: 'var(--bg-secondary)' }}>
                            {o.rejectReason && (
                              <div className="text-xs rounded-lg p-3" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                                Đã trả lại{o.rejectedAt ? ` ngày ${formatDate(o.rejectedAt)}` : ''}: {o.rejectReason}
                              </div>
                            )}
                            {o.workOrders.map(w => (
                              <div key={w.id} className="card overflow-hidden">
                                <div className="p-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
                                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{w.woCode}</span>
                                  <span className="text-xs">{w.description}</span>
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {w.teamCode}</span>
                                </div>
                                <table className="data-table">
                                  <thead><tr><th>Mã VT</th><th>Tên</th><th className="text-right">Đề nghị</th><th className="text-right">Tồn kho</th><th>Nguồn</th></tr></thead>
                                  <tbody>
                                    {w.lines.map((l, i) => (
                                      <tr key={i}>
                                        <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{l.materialCode}</td>
                                        <td className="text-xs">{l.name}</td>
                                        <td className="text-right text-xs">{formatNumber(l.quantity)} {l.unit}</td>
                                        <td className="text-right text-xs" style={{ color: l.currentStock >= l.quantity ? '#16a34a' : '#b45309' }}>
                                          {formatNumber(l.currentStock)}{l.currentStock < l.quantity ? ' (thiếu)' : ''}
                                        </td>
                                        <td className="text-xs">{l.source === 'BOM' ? 'BOM' : 'Thêm tay'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
