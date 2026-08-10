'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import TemplateSelector, { type TemplateType } from '@/components/TemplateSelector'
import StepTaskFeatures from '@/components/StepTaskFeatures'

// Card LÀM 1 bước quy trình ở sidebar (Cách A) — dùng chung cho Phase 2+ (P2.1/P2.2/P2.3/P2.4/P2.1A…).
// Bê nguyên form hiện hành: TemplateSelector (biểu mẫu PR/hàn-sơn/BOM/dự toán) + Người nhận/Bằng chứng/
// Trao đổi (StepTaskFeatures) + Hoàn thành/Từ chối + Bổ sung sau DONE. Hoàn thành → completeStepTaskFromSidebar
// đóng bước + chuỗi chạy tiếp. Bước không có biểu mẫu (dòng tiền) → noTemplate: dùng Bằng chứng.
interface ProjInfo { projectCode?: string; projectName?: string; clientName?: string; contractValue?: number }
interface StepTask { id: string; status: string; resultData: Record<string, unknown>; canEdit: boolean; project: ProjInfo | null }
const STATUS_LABEL: Record<string, string> = { OPEN: 'Chờ xử lý', IN_PROGRESS: 'Đang làm', RETURNED: 'Bị trả lại', DONE: 'Hoàn thành' }

export default function StepWorkCard({ projectId, stepCode, title, initialTemplate, noTemplate, nextHint }: {
  projectId: string; stepCode: string; title: string
  initialTemplate?: TemplateType; noTemplate?: boolean; nextHint?: string
}) {
  const [task, setTask] = useState<StepTask | null>(null)
  const [completing, setCompleting] = useState(false)
  const [amendMode, setAmendMode] = useState(false)
  const [rejOpen, setRejOpen] = useState(false)
  const [rejReason, setRejReason] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const loadTask = useCallback(() => {
    if (!projectId) { setTask(null); return }
    apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=${encodeURIComponent(stepCode)}`).then((r) => {
      setTask(r.ok && r.task ? r.task : null)
    })
  }, [projectId, stepCode])
  useEffect(() => { loadTask() }, [loadTask])
  const reloadAll = () => { loadTask(); setReloadKey((k) => k + 1) }

  const handleComplete = async () => {
    if (!task) return
    if (!(await confirmDialog(`Hoàn thành bước "${title}" (${stepCode})?${nextHint ? ' ' + nextHint : ''}`))) return
    setCompleting(true)
    const res = await apiFetch('/api/work/step-task', { method: 'POST', body: JSON.stringify({ projectId, stepCode, action: 'complete' }) })
    setCompleting(false)
    if (res.ok) { notify('Đã hoàn thành bước — quy trình chuyển tiếp', 'success'); reloadAll() }
    else notify(res.error || 'Lỗi hoàn thành', 'error')
  }

  const handleReject = async () => {
    if (!task || !rejReason.trim()) { notify('Nhập lý do trả lại', 'error'); return }
    const res = await apiFetch(`/api/work/tasks/${task.id}/return`, { method: 'POST', body: JSON.stringify({ reason: rejReason.trim() }) })
    if (res.ok) { notify('Đã trả lại người tạo', 'success'); setRejOpen(false); setRejReason(''); reloadAll() }
    else notify(res.error || 'Lỗi trả lại', 'error')
  }

  if (!projectId || !task) return null
  // Chỉ hiện card cho NGƯỜI PHỤ TRÁCH bước (assignee/creator/admin — canEdit từ API).
  // Vd: tab Định mức vật tư có P2.1 (Thiết kế) + P2.2 (PM) → mỗi role chỉ thấy bước của mình.
  if (!task.canEdit) return null
  const isDone = task.status === 'DONE'
  const editable = task.canEdit && (!isDone || amendMode)

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4" style={{ border: '1px solid #6366f140', background: '#f5f3ff' }}>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <h3 className="text-sm font-bold" style={{ color: '#4338ca' }}>{title} ({stepCode})</h3>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: isDone ? '#16a34a20' : '#6366f120', color: isDone ? '#166534' : '#4338ca' }}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
        </div>

        {isDone && task.canEdit && (
          <button onClick={() => setAmendMode((v) => !v)} className="text-xs px-3 py-1.5 rounded-lg font-semibold self-start"
            style={{ background: amendMode ? '#fde68a' : '#fff7ed', color: '#c2410c', border: '1px solid #f59e0b' }}>
            {amendMode ? 'Đóng' : '✎ Bổ sung / Chỉnh sửa (kể cả đã DONE)'}
          </button>
        )}

        {noTemplate ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Đính kèm tài liệu/kết quả ở mục <b>Bằng chứng thực hiện</b> bên dưới rồi bấm &quot;Hoàn thành&quot;.</p>
        ) : (
          <TemplateSelector
            taskId={task.id}
            isEditable={editable}
            projectCode={task.project?.projectCode}
            project={task.project}
            projectId={projectId}
            taskTitle={title}
            lockedTemplate={initialTemplate ?? null}
          />
        )}

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
            <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={2} placeholder="Lý do trả lại…" className="input-field text-sm w-full" />
            <div className="flex justify-end">
              <button onClick={handleReject} className="text-sm px-4 py-2 rounded-lg font-semibold" style={{ background: '#dc2626', color: '#fff' }}>Gửi trả lại</button>
            </div>
          </div>
        )}
      </div>

      <StepTaskFeatures taskId={task.id} reloadKey={reloadKey} />
    </div>
  )
}
