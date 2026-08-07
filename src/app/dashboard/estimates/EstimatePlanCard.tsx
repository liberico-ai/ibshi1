'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import EstimateUploadUI from '@/components/EstimateUploadUI'
import StepTaskFeatures from '@/components/StepTaskFeatures'

// P1.2 — Lập dự toán thi công (KTKH) ở tab Dự toán (Cách A).
// Bê nguyên bản trong Công việc: DT01 read-only + Import DT02 → 4 tổng (tự re-sync Budget),
// Bằng chứng + Người nhận + Trao đổi & lịch sử (StepTaskFeatures), Từ chối/trả lại, và
// Bổ sung/Chỉnh sửa sau DONE. "Hoàn thành" → đóng P1.2 → chuỗi chuyển tiếp P1.3.
interface ProjInfo { projectCode?: string; projectName?: string; clientName?: string; contractValue?: number }
interface StepTask { id: string; status: string; resultData: Record<string, unknown>; canEdit: boolean; project: ProjInfo | null }
type EstData = { totalMaterial?: number; totalLabor?: number; totalService?: number; totalOverhead?: number; totalEstimate?: number; dt02Detail?: string; estimateFileName?: string }
const STATUS_LABEL: Record<string, string> = { OPEN: 'Chờ lập', IN_PROGRESS: 'Đang lập', RETURNED: 'Bị trả lại', DONE: 'Hoàn thành' }

export default function EstimatePlanCard({ projectId }: { projectId: string }) {
  const [task, setTask] = useState<StepTask | null>(null)
  const [completing, setCompleting] = useState(false)
  const [amendMode, setAmendMode] = useState(false)
  const [rejOpen, setRejOpen] = useState(false)
  const [rejReason, setRejReason] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const loadTask = useCallback(() => {
    if (!projectId) { setTask(null); return }
    apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=P1.2`).then((r) => {
      if (r.ok && r.task) setTask(r.task)
      else setTask(null)
    })
  }, [projectId])
  useEffect(() => { loadTask() }, [loadTask])
  const reloadAll = () => { loadTask(); setReloadKey((k) => k + 1) }

  const onFieldChange = (key: string, value: unknown) => {
    if (!task) return
    setTask((t) => (t ? { ...t, resultData: { ...t.resultData, [key]: value } } : t))
    apiFetch(`/api/work/tasks/${task.id}/result-data`, { method: 'POST', body: JSON.stringify({ key, value }) }).catch(() => {})
  }

  const handleComplete = async () => {
    if (!task) return
    if (!(await confirmDialog('Hoàn thành lập dự toán thi công (P1.2)? Quy trình sẽ tiến tới bước duyệt kế hoạch & dự toán (P1.3).'))) return
    setCompleting(true)
    const res = await apiFetch('/api/work/step-task', {
      method: 'POST',
      body: JSON.stringify({ projectId, stepCode: 'P1.2', action: 'complete' }),
    })
    setCompleting(false)
    if (res.ok) { notify('Đã hoàn thành lập dự toán — chuyển tiếp bước duyệt', 'success'); reloadAll() }
    else notify(res.error || 'Lỗi hoàn thành', 'error')
  }

  const handleReject = async () => {
    if (!task || !rejReason.trim()) { notify('Nhập lý do trả lại', 'error'); return }
    const res = await apiFetch(`/api/work/tasks/${task.id}/return`, { method: 'POST', body: JSON.stringify({ reason: rejReason.trim() }) })
    if (res.ok) { notify('Đã trả lại người tạo', 'success'); setRejOpen(false); setRejReason(''); reloadAll() }
    else notify(res.error || 'Lỗi trả lại', 'error')
  }

  if (!projectId) return null
  if (!task) {
    return (
      <div className="card p-5 text-center" style={{ color: 'var(--text-muted)' }}>
        Dự án này chưa có bước lập dự toán (P1.2).
      </div>
    )
  }

  const isDone = task.status === 'DONE'
  const editable = task.canEdit && (!isDone || amendMode)

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4" style={{ border: '1px solid #f59e0b40', background: '#fffbeb' }}>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <h3 className="text-sm font-bold" style={{ color: '#92400e' }}>Lập dự toán thi công (P1.2)</h3>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: isDone ? '#16a34a20' : '#f59e0b20', color: isDone ? '#166534' : '#92400e' }}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
        </div>

        {/* Sau DONE: toggle mở/đóng phần bổ sung — mở thì hiện upload, đóng thì thu lại (chỉ xem) */}
        {isDone && task.canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setAmendMode((v) => !v)} className="text-xs px-3 py-1.5 rounded-lg font-semibold self-start"
              style={{ background: amendMode ? '#fde68a' : '#fff7ed', color: '#c2410c', border: '1px solid #f59e0b' }}>
              {amendMode ? 'Đóng' : '✎ Bổ sung / Chỉnh sửa dự toán (kể cả đã DONE)'}
            </button>
            {amendMode && (
              <span className="text-xs" style={{ color: '#92400e' }}>
                Đang mở — nạp lại file dự toán; lưu <b>tự đồng bộ Ngân sách/Dòng tiền</b>. Xong bấm &quot;Đóng&quot;.
              </span>
            )}
          </div>
        )}

        {/* DT01 + DT02. Khi DONE & chưa mở bổ sung → chỉ xem (ẩn nút upload). Mở bổ sung → hiện upload */}
        <EstimateUploadUI isEditable={editable} estimateData={task.resultData as EstData} project={task.project} onFieldChange={onFieldChange} />

        {!isDone && task.canEdit && (
          <div className="flex justify-between items-center flex-wrap gap-2">
            <button onClick={() => setRejOpen((v) => !v)} className="text-sm px-3 py-2 rounded-lg font-medium"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              ✕ Từ chối / trả lại
            </button>
            <button onClick={handleComplete} disabled={completing}
              className="text-sm px-4 py-2.5 rounded-lg font-semibold" style={{ background: '#16a34a', color: '#fff', opacity: completing ? 0.5 : 1 }}>
              {completing ? 'Đang xử lý…' : '✓ Hoàn thành & chuyển tiếp'}
            </button>
          </div>
        )}
        {rejOpen && !isDone && (
          <div className="space-y-2">
            <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={2} placeholder="Lý do trả lại…"
              className="input-field text-sm w-full" />
            <div className="flex justify-end">
              <button onClick={handleReject} className="text-sm px-4 py-2 rounded-lg font-semibold" style={{ background: '#dc2626', color: '#fff' }}>Gửi trả lại</button>
            </div>
          </div>
        )}
      </div>

      {/* Người nhận + Bằng chứng + Trao đổi & lịch sử (ngang bản gốc) */}
      <StepTaskFeatures taskId={task.id} reloadKey={reloadKey} />
    </div>
  )
}
