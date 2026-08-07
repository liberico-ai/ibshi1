'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch, useAuthStore, openAuthedFile } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import MultiFileUpload from '@/components/MultiFileUpload'
import { formatDateTime, formatShortDateTime } from '@/lib/utils'

// Bộ tính năng chung của MỘT task, để nhúng vào các card ở sidebar (Cách A) sao cho
// ngang bằng bản gốc trong Hộp việc: Người nhận + Bằng chứng thực hiện + Trao đổi & lịch sử.
// Thao tác trên CHÍNH task đó qua đúng API mà work/[id] dùng (không viết lại logic).
interface Assignee { id: string; role: string | null; userId: string | null; isPrimary: boolean; done?: boolean; userName?: string | null; roleName?: string | null }
interface Hist {
  id: string; action: string; byUserId: string; reason: string | null; createdAt: string
  fromUserId?: string | null; byName?: string | null; fromName?: string | null; toName?: string | null; toRoleName?: string | null
}
interface EvidenceFile { id: string; fileName: string; fileUrl: string; fileSize: number | null; mimeType: string | null; createdAt: string; uploadedBy?: string; uploadedByName?: string | null }
interface TaskLite {
  id: string; status: string; createdBy: string
  assignees: Assignee[]; history: Hist[]
  progress?: { done: number; total: number }
  evidenceFiles?: EvidenceFile[]
}

const roleLabel = (r: string | null) => (r ? (ROLES as Record<string, { name: string }>)[r]?.name || r : '')
const assigneeLabel = (a: Assignee) => a.userName || a.roleName || roleLabel(a.role) || '—'
const ACT: Record<string, string> = { CREATED: 'Tạo việc', ASSIGNED: 'Giao việc', STARTED: 'Bắt đầu', ASSIGNEE_DONE: '✓ Hoàn thành phần việc', SUBMITTED_TO_CREATOR: '↩ Trả kết quả', COMPLETED: '✓ Hoàn thành tất cả', CLOSED: 'Kết thúc công việc', FORWARDED: '↗ Chuyển tiếp', RETURNED: '↩ Trả lại', REASSIGNED: 'Giao lại', SUBTASK_CREATED: '+ Tạo việc con', COMMENT: 'Trao đổi', EDITED: 'Chỉnh sửa' }
const EVIDENCE_ACCEPT = '.pdf,.doc,.docx,.xlsx,.xls,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.heic,.zip,.rar'

// reloadKey: đổi giá trị để buộc tải lại (vd sau khi card cha hoàn thành / từ chối).
export default function StepTaskFeatures({ taskId, reloadKey = 0 }: { taskId: string; reloadKey?: number }) {
  const { user } = useAuthStore()
  const [task, setTask] = useState<TaskLite | null>(null)
  const [comment, setComment] = useState('')

  const load = useCallback(() => {
    if (!taskId) { setTask(null); return }
    apiFetch(`/api/work/tasks/${taskId}`).then((r) => { if (r.ok && r.task) setTask(r.task); else setTask(null) })
  }, [taskId])
  useEffect(() => { load() }, [load, reloadKey])

  const sendComment = async () => {
    const text = comment.trim()
    if (!text || !task) return
    setComment('')
    const res = await apiFetch(`/api/work/tasks/${task.id}/comments`, { method: 'POST', body: JSON.stringify({ content: text }) })
    if (res.ok) load()
  }

  if (!task) return null

  const myRow = task.assignees.find((a) => a.userId === user?.id) || task.assignees.find((a) => a.role === user?.roleCode)
  const isAssignee = !!myRow
  const myDone = !!myRow?.done
  const canUploadEvidence = isAssignee && !myDone && task.status !== 'DONE'
  const evidence = task.evidenceFiles || []

  return (
    <div className="space-y-4">
      {/* Người nhận */}
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-sm font-semibold mb-2">
          Người nhận {task.progress && <span style={{ color: task.progress.done === task.progress.total ? '#059669' : '#d97706' }}>· {task.progress.done}/{task.progress.total} đã xong</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {task.assignees.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full"
              style={{ background: a.done ? '#ecfdf5' : '#eef2ff', color: a.done ? '#059669' : '#3730a3', border: `1px solid ${a.done ? '#a7f3d0' : '#c7d2fe'}` }}>
              {a.done ? '✓' : '○'} {assigneeLabel(a)}{a.isPrimary && <span className="text-xs opacity-70">· chính</span>}
            </span>
          ))}
        </div>
        <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Việc chỉ hoàn thành khi tất cả người nhận đã xong.</div>
      </div>

      {/* Bằng chứng thực hiện */}
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-sm font-semibold mb-1">Bằng chứng thực hiện</div>
        <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>📎 Tài liệu tham khảo — <b>KHÔNG</b> tự bóc số liệu.</div>
        {canUploadEvidence ? (
          <MultiFileUpload
            label=""
            entityType="TaskEvidence"
            entityId={`${task.id}_evidence`}
            existingFiles={evidence.map((ef) => ({ id: ef.id, fileName: ef.fileName, fileUrl: ef.fileUrl, fileSize: ef.fileSize || 0, mimeType: ef.mimeType, createdAt: ef.createdAt }))}
            accept={EVIDENCE_ACCEPT}
            compact
          />
        ) : evidence.length > 0 ? (
          <div className="space-y-1.5">
            {evidence.map((ef) => (
              <div key={ef.id} className="flex items-center gap-2 text-sm py-1.5 px-3 rounded-lg" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <a href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(ef.id, ef.fileName, ef.mimeType) }} className="flex-1 hover:underline" style={{ color: '#1d4ed8', cursor: 'pointer' }}>{ef.fileName}</a>
                {ef.fileSize != null && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ef.fileSize < 1024 * 1024 ? `${(ef.fileSize / 1024).toFixed(0)} KB` : `${(ef.fileSize / (1024 * 1024)).toFixed(1)} MB`}</span>}
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ef.uploadedByName || '—'}</span>
                <span className="text-xs" style={{ color: '#94a3b8' }}>{formatShortDateTime(ef.createdAt)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có bằng chứng nào.</div>
        )}
      </div>

      {/* Trao đổi & lịch sử */}
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-sm font-semibold mb-2">Trao đổi & lịch sử</div>
        <div className="space-y-1 mb-3">
          {task.history.map((h) => {
            const target = h.toName || h.toRoleName
            const isComment = h.action === 'COMMENT'
            const actionColor = h.action === 'RETURNED' ? '#dc2626' : h.action === 'COMPLETED' || h.action === 'CLOSED' ? '#059669' : h.action === 'FORWARDED' ? '#7c3aed' : 'var(--text-heading)'
            let detail = ''
            if (h.action === 'CREATED') detail = h.byName ? `${h.byName} tạo công việc` : ''
            else if (h.action === 'ASSIGNED') detail = `${h.byName || '?'} → ${target || '?'}`
            else if (h.action === 'ASSIGNEE_DONE') detail = `${h.byName || '?'} hoàn thành` + (target ? ` → trả ${target}` : '')
            else if (h.action === 'SUBMITTED_TO_CREATOR') detail = `${h.byName || '?'} trả kết quả cho ${target || 'người giao'}`
            else if (h.action === 'FORWARDED') detail = `${h.byName || '?'} chuyển tiếp` + (target ? ` cho ${target}` : '')
            else if (h.action === 'RETURNED') detail = `${h.byName || '?'} trả lại cho ${h.fromName || 'người giao'}`
            else if (h.action === 'REASSIGNED') detail = `${h.byName || '?'} giao lại` + (target ? ` cho ${target}` : '')
            else if (h.action === 'CLOSED') detail = `${h.byName || '?'} kết thúc công việc`
            else if (h.action === 'COMPLETED') detail = `${h.byName || '?'} — tất cả đã hoàn thành`
            else if (h.action === 'EDITED') detail = `${h.byName || '?'} chỉnh sửa thông tin`
            else detail = h.byName || ''
            return (
              <div key={h.id} style={{ padding: '4px 0', borderBottom: isComment ? 'none' : '1px solid #f1f5f9' }}>
                {isComment ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 8px', background: '#f8fafc', borderRadius: 6 }}>
                    <span className="text-sm font-semibold" style={{ color: '#1d4ed8', flexShrink: 0 }}>{h.byName || '?'}</span>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{h.reason}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{formatDateTime(h.createdAt)}</span>
                  </div>
                ) : (
                  <div className="text-sm" style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span className="font-semibold" style={{ color: actionColor, flexShrink: 0 }}>{ACT[h.action] || h.action}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{detail}</span>
                    {h.reason && h.action !== 'COMMENT' && <span style={{ color: '#64748b', fontStyle: 'italic' }}>— {h.reason}</span>}
                    <span className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{formatDateTime(h.createdAt)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex gap-2">
          <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendComment()} placeholder="Nhập trao đổi..." style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: '.86rem', background: '#f8fafc' }} />
          <button onClick={sendComment} className="text-sm px-4 rounded-lg" style={{ background: 'var(--text-heading)', color: '#fff' }}>Gửi</button>
        </div>
      </div>
    </div>
  )
}
