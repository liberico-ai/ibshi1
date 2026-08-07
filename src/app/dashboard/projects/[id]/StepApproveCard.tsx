'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import StepTaskFeatures from '@/components/StepTaskFeatures'

// Card duyệt/từ chối 1 BƯỚC quy trình trên trang dự án (Cách A). Dùng chung cho
// P1.3, P2.5, P3.6, P6.5… — gọi action generic APPROVE_STEP/REJECT_STEP.
// Ngang bản gốc: kèm badge trạng thái + Người nhận/Bằng chứng/Trao đổi (StepTaskFeatures).
const STATUS_LABEL: Record<string, string> = { OPEN: 'Chờ duyệt', IN_PROGRESS: 'Chờ duyệt', RETURNED: 'Bị trả lại', DONE: 'Đã duyệt' }

export default function StepApproveCard({ projectId, stepCode, title, hint, onDone, children }: {
  projectId: string; stepCode: string; title: string; hint: string; onDone: () => void; children?: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [stepTask, setStepTask] = useState<{ id: string; status: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const loadStepTask = useCallback(() => {
    apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=${stepCode}`).then((r) => {
      setStepTask(r.ok && r.task ? { id: r.task.id, status: r.task.status } : null)
    })
  }, [projectId, stepCode])
  useEffect(() => { loadStepTask() }, [loadStepTask])

  const afterAction = () => { setReloadKey((k) => k + 1); loadStepTask(); onDone() }

  const approve = async () => {
    setBusy(true)
    const res = await apiFetch(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ action: 'APPROVE_STEP', stepCode }) })
    setBusy(false)
    if (res.ok) { notify(res.message || 'Đã duyệt', 'success'); afterAction() }
    else notify(res.error || 'Lỗi duyệt', 'error')
  }
  const reject = async () => {
    if (!reason.trim()) { notify('Nhập lý do từ chối', 'error'); return }
    setBusy(true)
    const res = await apiFetch(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ action: 'REJECT_STEP', stepCode, reason: reason.trim() }) })
    setBusy(false)
    if (res.ok) { notify(res.message || 'Đã từ chối', 'success'); setRejecting(false); setReason(''); afterAction() }
    else notify(res.error || 'Lỗi từ chối', 'error')
  }

  return (
    <div style={{ marginBottom: 4 }}>
      <div className="card p-6" style={{ border: '1.5px solid #f59e0b', background: '#fffbeb' }}>
        <div className="flex justify-between items-center flex-wrap gap-2" style={{ marginBottom: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#92400e' }}>{title}</h3>
          {stepTask && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#f59e0b20', color: '#92400e' }}>
              {STATUS_LABEL[stepTask.status] || stepTask.status}
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{hint}</p>
        {children}
        {!rejecting ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={approve} disabled={busy} className="flex-1 text-sm px-4 py-3 rounded-lg font-bold" style={{ background: '#16a34a', color: '#fff', opacity: busy ? 0.5 : 1 }}>✓ Duyệt</button>
            <button onClick={() => setRejecting(true)} disabled={busy} className="text-sm px-5 py-3 rounded-lg font-bold" style={{ background: '#fff', color: '#dc2626', border: '1px solid #dc262640' }}>Từ chối</button>
          </div>
        ) : (
          <div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Lý do từ chối…" className="input-field" style={{ width: '100%', fontSize: 13, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRejecting(false); setReason('') }} disabled={busy} className="text-xs px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
              <button onClick={reject} disabled={busy || !reason.trim()} className="text-xs px-3 py-2 rounded-lg font-semibold" style={{ background: '#dc2626', color: '#fff', opacity: (busy || !reason.trim()) ? 0.5 : 1 }}>Xác nhận từ chối</button>
            </div>
          </div>
        )}
      </div>

      {stepTask && (
        <div style={{ marginTop: 12 }}>
          <StepTaskFeatures taskId={stepTask.id} reloadKey={reloadKey} />
        </div>
      )}
    </div>
  )
}
