'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate, formatDateTime, formatNumber } from '@/lib/utils'
import { unitLabel } from '@/lib/wo-units'
import { RBAC } from '@/lib/rbac-rules'
import { notify } from '@/components/ui/Toast'

interface WorkOrderDetail {
  id: string; woCode: string; projectId: string; description: string;
  teamCode: string; status: string;
  plannedStart: string | null; plannedEnd: string | null;
  actualStart: string | null; actualEnd: string | null;
  createdAt: string;
  unit?: string;
  materialIssues: { id: string; materialId: string; quantity: number; issuedBy: string; issuedAt: string; notes: string | null }[];
  /** Công đoạn bên trong lệnh — rỗng nghĩa là lệnh chạy nguyên khối */
  stages?: { id: string; stageCode: string; name: string; categoryCode: string | null; category: string | null; qty: number; unit: string; note: string | null }[];
  // Nghiệm thu theo đợt — đã ký bao nhiêu kg, còn bao nhiêu chờ mời nghiệm thu
  acceptance?: {
    unit: string
    plannedQty: number; reportedQty: number; acceptedQty: number
    /** Số công đoạn của lệnh; 0 = lệnh chạy nguyên khối */
    stageCount: number
    /** Nghiệm thu của TỪNG công đoạn — không cộng lại với nhau */
    stages: {
      id: string; stageCode: string; name: string; category: string | null; unit: string
      plannedQty: number; reportedQty: number; acceptedQty: number
      pendingQty: number; availableQty: number; fullyAccepted: boolean
      /** Đã bấm mời, QAQC chưa lập đợt */
      invitedQty: number
      /** Còn phải bấm mời */
      needInviteQty: number
    }[]
    pendingQty: number; availableQty: number; fullyAccepted: boolean
    blockReason: string | null
  } | null;
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
  // Chờ vật tư vẫn bắt đầu SX được — cổng vật tư đang TẮT (ff_wo_require_material).
  // Bật cờ lên thì server trả 422 và nút này báo lỗi, không cần sửa lại giao diện.
  // Vẫn giữ nút "Mở WO" để Kho/SX xác nhận đủ vật tư theo đường cũ.
  PENDING_MATERIAL: [
    { next: 'IN_PROGRESS', label: '▶ Bắt đầu SX', color: '#2563eb', bg: '#eff6ff' },
    { next: 'OPEN', label: 'Đã đủ vật tư', color: '#64748b', bg: '#f1f5f9' },
  ],
  OPEN: [{ next: 'IN_PROGRESS', label: '▶ Bắt đầu SX', color: '#2563eb', bg: '#eff6ff' }],
  // 'Mời nghiệm thu' không nằm ở đây: nó chỉ hiện khi thật sự có khối lượng đã báo mà chưa
  // nghiệm thu, nên dựng riêng bên dưới theo số liệu chứ không theo trạng thái.
  IN_PROGRESS: [{ next: 'ON_HOLD', label: 'Tạm dừng', color: '#7c3aed', bg: '#f5f3ff' }],
  ON_HOLD: [{ next: 'IN_PROGRESS', label: '▶ Tiếp tục', color: '#2563eb', bg: '#eff6ff' }],
  // Không còn bấm Đạt/Không đạt ở đây: kết quả QC do màn Kế hoạch Kiểm tra (ITP) quyết định —
  // đủ chữ ký TP QAQC + PM dự án thì WO tự sang QC_PASSED, có điểm kiểm lỗi thì tự sang QC_FAILED.
  QC_PENDING: [],
  QC_FAILED: [{ next: 'IN_PROGRESS', label: 'Sửa lại', color: '#2563eb', bg: '#eff6ff' }],
  QC_PASSED: [{ next: 'COMPLETED', label: 'Hoàn thành', color: '#16a34a', bg: '#f0fdf4' }],
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

  // Mời nghiệm thu TỪNG công đoạn. Mời ở cấp lệnh thì lệnh vào 'Chờ QC' một lần rồi công đoạn
  // nào báo sau cũng bị coi là đã mời — xưởng báo bảo ôn xong quay ra thấy tự nhiên đã mời.
  async function handleInviteStage(stageId: string) {
    setTransitioning(true)
    const res = await apiFetch(`/api/production/${id}/stages/${stageId}/invite-qc`, { method: 'POST' })
    if (res.ok) { notify(res.message || 'Đã mời nghiệm thu', 'success'); loadWO() }
    else notify(res.error || 'Lỗi mời nghiệm thu')
    setTransitioning(false)
  }

  async function handleTransition(nextStatus: string) {
    setTransitioning(true)
    const res = await apiFetch(`/api/production/${id}/transition`, {
      method: 'POST', body: JSON.stringify({ nextStatus }),
    })
    // Báo rõ đã ăn — trước đây bấm xong im lặng, không biết là chạy hay hỏng.
    if (res.ok) { notify(res.message || 'Đã cập nhật trạng thái', 'success'); loadWO() }
    else notify(res.error || 'Lỗi chuyển trạng thái')
    setTransitioning(false)
  }

  if (loading) return <div className="animate-fade-in"><div className="h-48 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} /></div>
  if (!wo) return <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Không tìm thấy lệnh sản xuất</div>

  const cfg = STATUS_CFG[wo.status] || STATUS_CFG.OPEN
  const transitions = TRANSITIONS[wo.status] || []
  
  // Conditionally show buttons if user role is in RBAC list
  const showActionButtons = RBAC.PRODUCTION_ACTION.includes(roleCode) || RBAC.QC_ACTION.includes(roleCode)

  // Mời nghiệm thu: chỉ có nghĩa khi xưởng đã báo khối lượng mà chưa ai ký. Nghiệm thu theo ĐỢT
  // nên lệnh đang 'QC Đạt' của đợt trước vẫn mời tiếp được cho phần vừa báo thêm.
  const acc = wo.acceptance
  // Lệnh chia công đoạn mời ngay trên dòng công đoạn, không mời ở cấp lệnh nữa.
  const canInvite = !!acc && acc.stageCount === 0 && acc.availableQty > 0
    && wo.status !== 'QC_PENDING' && wo.status !== 'COMPLETED'
  // Đơn vị của lệnh — pha cắt/hàn tính kg, sơn tính m². Không hiện "kg" cứng nữa.
  const dv = unitLabel(acc?.unit || wo.unit)

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
            {/* Xưởng báo xong thì tự mời QAQC + PM vào nghiệm thu ĐỢT đó — không chờ xong cả lệnh */}
            {/* Lệnh chia công đoạn: nhãn nút nói rõ công đoạn nào, vì QAQC ký từng công đoạn một. */}
            {showActionButtons && canInvite && (
              <button
                onClick={() => handleTransition('QC_PENDING')}
                disabled={transitioning}
                className="text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #d9770630', opacity: transitioning ? 0.5 : 1 }}
                title={(acc!.stages.filter(s => s.availableQty > 0).length > 0
                  ? 'Mời nghiệm thu: ' + acc!.stages.filter(s => s.availableQty > 0)
                    .map(s => `${s.stageCode} ${s.name} ${formatNumber(s.availableQty)} ${s.unit}`).join('; ')
                  : `Mời nghiệm thu ${formatNumber(acc!.availableQty)} ${dv} đã báo`)}
              >
                Mời nghiệm thu{' '}
                {acc!.stageCount > 0
                  ? acc!.stages.filter(s => s.availableQty > 0)
                    .map(s => `${s.stageCode} ${formatNumber(s.availableQty)} ${s.unit}`).join(' · ')
                  : `${formatNumber(acc!.availableQty)} ${dv}`}
              </button>
            )}
            {/* Ở trạng thái chờ QC không còn nút bấm tay — nói rõ kết quả đến từ đâu, tránh tưởng là hỏng */}
            {wo.status === 'QC_PENDING' && (
              <span className="text-sm px-4 py-2 rounded-lg text-center" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', maxWidth: 320 }}>
                Chờ nghiệm thu ở <b>Kế hoạch Kiểm tra (ITP)</b> — đủ chữ ký TP QAQC + PM dự án thì WO tự chuyển QC Đạt
              </span>
            )}
            {!showActionButtons && transitions.length > 0 && (
              <span className="text-sm px-4 py-2 flex items-center gap-1 rounded-lg" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
                Chỉ quyền SX/QC
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

        {/* ── Công đoạn của lệnh ──
            Mỗi công đoạn chạy qua TRỌN khối lượng của lệnh và được nghiệm thu RIÊNG — ký xong
            pha cắt không có nghĩa là đã ký bảo ôn. Vì vậy mọi con số đứng theo TỪNG công đoạn;
            cộng lại sẽ ra một khối lượng không có thật (lệnh 24.784 kg hai công đoạn vẫn là
            24.784 kg, không phải 49.568 kg). */}
      {(acc?.stageCount ?? 0) > 0 && (
        <div className="card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-semibold text-sm" style={{ color: 'var(--text-heading)' }}>
              Công đoạn ({acc!.stages.length})
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              mỗi công đoạn chạy qua trọn <span className="font-mono">{formatNumber(acc?.plannedQty || 0)} {dv}</span> của lệnh
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="px-2 py-1 text-left">CÔNG ĐOẠN</th>
                <th className="px-2 py-1 text-left">CHỦNG LOẠI</th>
                <th className="px-2 py-1 text-right">KL GIAO</th>
                <th className="px-2 py-1 text-right">XƯỞNG ĐÃ BÁO</th>
                <th className="px-2 py-1 text-right">ĐÃ NGHIỆM THU</th>
                <th className="px-2 py-1 text-right">CHỜ MỜI NGHIỆM THU</th>
                <th className="px-2 py-1 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {acc!.stages.map(st => (
                <tr key={st.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="px-2 py-1.5 font-medium">
                    <span className="font-mono text-[10px] mr-1" style={{ color: 'var(--text-muted)' }}>{st.stageCode}</span>
                    {st.name}
                    {st.fullyAccepted && <span className="ml-1.5" style={{ color: '#047857' }}>✓</span>}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {st.category || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {formatNumber(st.plannedQty)} <span style={{ color: 'var(--text-muted)' }}>{unitLabel(st.unit)}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono"
                    style={{ color: st.reportedQty > 0 ? '#16a34a' : 'var(--text-muted)' }}>
                    {st.reportedQty > 0 ? formatNumber(st.reportedQty) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono"
                    style={{ color: st.acceptedQty > 0 ? '#2563eb' : 'var(--text-muted)' }}>
                    {st.acceptedQty > 0 ? formatNumber(st.acceptedQty) : '—'}
                    {st.pendingQty > 0 && (
                      <span className="block text-[11px]" style={{ color: '#d97706' }}>
                        {formatNumber(st.pendingQty)} chờ ký
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono"
                    style={{ color: st.needInviteQty > 0 ? '#d97706' : 'var(--text-muted)' }}>
                    {st.needInviteQty > 0 ? formatNumber(st.needInviteQty) : '—'}
                    {st.invitedQty > 0 && (
                      <span className="block text-[11px]" style={{ color: '#2563eb' }}>
                        đã mời {formatNumber(st.invitedQty)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ whiteSpace: 'nowrap' }}>
                    {showActionButtons && st.needInviteQty > 0 && wo.status !== 'COMPLETED' && (
                      <button
                        onClick={() => handleInviteStage(st.id)}
                        disabled={transitioning}
                        className="text-xs px-2.5 py-1 rounded-md font-medium"
                        title={`Mời QAQC + PM nghiệm thu ${formatNumber(st.needInviteQty)} ${unitLabel(st.unit)} của ${st.stageCode} ${st.name}`}
                        style={{
                          background: '#fffbeb', color: '#d97706', border: '1px solid #d9770630',
                          opacity: transitioning ? 0.5 : 1,
                        }}>
                        Mời nghiệm thu
                      </button>
                    )}
                    {st.needInviteQty <= 0 && st.invitedQty > 0 && (
                      <span className="text-[11px]" style={{ color: '#2563eb' }}>chờ QAQC lập đợt</span>
                    )}
                    {st.needInviteQty <= 0 && st.invitedQty <= 0 && st.pendingQty > 0 && (
                      <span className="text-[11px]" style={{ color: '#d97706' }}>chờ hai chữ ký</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
            Mỗi công đoạn nghiệm thu riêng. Xưởng báo xong công đoạn nào là mời nghiệm thu công đoạn đó,
            không phải chờ các công đoạn còn lại.
          </p>
        </div>
      )}

      {/* Nghiệm thu theo ĐỢT: nhìn là biết đã ký bao nhiêu, còn bao nhiêu phải mời tiếp */}
        {/* Lệnh chia công đoạn đã có bảng công đoạn ở trên, đầy đủ hơn — không lặp lại ở đây. */}
        {acc && acc.stageCount === 0 && acc.reportedQty > 0 && (
          <div className="grid grid-cols-4 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Kế hoạch</span>
              <p className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                {acc.plannedQty > 0 ? `${formatNumber(acc.plannedQty)} ${dv}` : '—'}
              </p>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Xưởng đã báo</span>
              <p className="font-mono font-medium" style={{ color: '#16a34a' }}>{formatNumber(acc.reportedQty)} {dv}</p>
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đã nghiệm thu</span>
              <p className="font-mono font-bold" style={{ color: '#2563eb' }}>{formatNumber(acc.acceptedQty)} {dv}</p>
              {acc.pendingQty > 0 && (
                <p className="text-[11px] font-mono" style={{ color: '#d97706' }}>{formatNumber(acc.pendingQty)} {dv} đang chờ ký</p>
              )}
            </div>
            <div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chờ mời nghiệm thu</span>
              <p className="font-mono font-medium" style={{ color: acc.availableQty > 0 ? '#d97706' : 'var(--text-muted)' }}>
                {acc.availableQty > 0 ? `${formatNumber(acc.availableQty)} ${dv}` : '—'}
              </p>
              {acc.blockReason && (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{acc.blockReason}</p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Xưởng</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{wo.teamCode}</p></div>
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
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateTime(mi.issuedAt)}</td>
              </tr>
            ))}
            {wo.materialIssues.length === 0 && <tr><td colSpan={5} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>Chưa có vật tư được cấp</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
