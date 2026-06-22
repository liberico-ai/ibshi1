'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import MultiFileUpload, { type UploadedFile } from '@/components/MultiFileUpload'
import { formatDateTime, formatShortDateTime } from '@/lib/utils'

interface DocFile { id: string; fileName: string; fileUrl: string }
interface DocAck { userId: string; userName: string | null; createdAt: string }
interface Doc { id: string; kind: string; label: string; fulfilled: boolean; note?: string | null; fileAttachmentId?: string | null; file?: DocFile | null; acks?: DocAck[] }
interface Assignee { id: string; role: string | null; userId: string | null; isPrimary: boolean; done?: boolean; doneAt?: string | null; userName?: string | null; roleName?: string | null }
interface Hist { id: string; action: string; byUserId: string; reason: string | null; createdAt: string; toRole: string | null; toUserId?: string | null; fromUserId?: string | null; byName?: string | null; fromName?: string | null; toName?: string | null; toRoleName?: string | null }
interface LinkTask { id: string; title: string; status: string; taskType?: string }
interface LinkMeeting { id: string; title: string; status: string; startsAt: string }
interface FlexData {
  assignees: Assignee[]
  history: Hist[]
  children: LinkTask[]
  meetings?: LinkMeeting[]
  docs: Doc[]
  progress?: { done: number; total: number }
  projectId?: string | null
  project?: { projectCode: string; projectName: string } | null
  title: string
  status: string
}

const ACT: Record<string, string> = { CREATED: 'Tạo việc', ASSIGNED: 'Giao', STARTED: 'Bắt đầu', ASSIGNEE_DONE: '✓ Hoàn thành', SUBMITTED_TO_CREATOR: '↩ Đã trả', COMPLETED: '✓ Hoàn thành (tất cả)', CLOSED: '🏁 Kết thúc', FORWARDED: '↗ Chuyển tiếp', RETURNED: '↩ Trả lại', REASSIGNED: 'Giao lại', SUBTASK_CREATED: 'Tạo việc con', COMMENT: '💬 Trao đổi' }
const roleLabel = (r: string | null) => (r ? (ROLES as Record<string, { name: string }>)[r]?.name || r : '')

export default function FlexibleFeatures({ taskId }: { taskId: string }) {
  const router = useRouter()
  const { user } = useAuthStore()
  const [data, setData] = useState<FlexData | null>(null)
  const [comment, setComment] = useState('')
  const [acked, setAcked] = useState<Record<string, boolean>>({})
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({})
  const [returnFiles, setReturnFiles] = useState<Record<string, DocFile>>({})

  const load = useCallback(() => {
    apiFetch(`/api/work/tasks/${taskId}`).then((r) => {
      if (r.ok && r.task) {
        setData({
          assignees: r.task.assignees || [],
          history: r.task.history || [],
          children: r.task.children || [],
          meetings: r.task.meetings || [],
          docs: r.task.docs || [],
          progress: r.task.progress,
          projectId: r.task.projectId,
          project: r.task.project,
          title: r.task.title,
          status: r.task.status,
        })
      }
    }).catch(() => {})
  }, [taskId])

  useEffect(() => { load() }, [load])

  const sendComment = async () => {
    if (!comment.trim()) return
    const res = await apiFetch(`/api/work/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content: comment }) })
    if (res.ok) { setComment(''); load() }
  }

  const ackDoc = async (docId: string) => {
    setAcked((s) => ({ ...s, [docId]: true }))
    await apiFetch(`/api/work/tasks/${taskId}/ack-doc`, { method: 'POST', body: JSON.stringify({ docId }) })
  }

  const goCreateMeeting = () => {
    const q = new URLSearchParams({ new: '1', task: taskId })
    if (data?.projectId) q.set('project', data.projectId)
    if (data?.project) q.set('projectName', `${data.project.projectCode} — ${data.project.projectName}`)
    if (data?.title) q.set('title', data.title)
    router.push(`/dashboard/work/meetings?${q}`)
  }

  if (!data) return null

  const mustRead = data.docs.filter((d) => d.kind === 'MUST_READ')
  const mustReturn = data.docs.filter((d) => d.kind === 'MUST_RETURN')
  const hasDocs = mustRead.length > 0 || mustReturn.length > 0
  const ackedByMe = (d: Doc) => !!d.acks?.some((a) => a.userId === user?.id) || !!acked[d.id]
  const isActive = data.status !== 'DONE' && data.status !== 'CANCELLED'
  const isAssignee = data.assignees.some((a) => a.userId === user?.id || a.role === user?.roleCode)
  const myDone = data.assignees.find((a) => a.userId === user?.id || a.role === user?.roleCode)?.done

  const assigneeLabel = (a: Assignee) => a.userName || a.roleName || roleLabel(a.role) || '—'

  return (
    <>
      {/* ── MUST_READ DOCUMENTS ── */}
      {mustRead.length > 0 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', border: '1px solid #fbbf24', background: '#fffbeb' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', marginBottom: 10, color: '#92400e' }}>
            📖 Tài liệu bắt buộc đọc ({mustRead.length})
          </h3>
          {mustRead.map((d) => (
            <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid #fde68a' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{d.label}</div>
                  {d.file ? (
                    <a href={d.file.fileUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '0.78rem', color: '#1d4ed8', textDecoration: 'underline', wordBreak: 'break-all' }}>
                      {d.file.fileName} ↗
                    </a>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>(không có tệp đính kèm)</span>
                  )}
                </div>
              </div>
              {isAssignee && isActive && !myDone && (() => {
                const meAcked = ackedByMe(d)
                return (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.78rem', cursor: 'pointer', color: meAcked ? '#059669' : '#92400e' }}>
                    <input type="checkbox" checked={meAcked} disabled={!!d.acks?.some((a) => a.userId === user?.id)} onChange={() => ackDoc(d.id)} />
                    Tôi đã đọc tài liệu này
                  </label>
                )
              })()}
              {d.acks && d.acks.length > 0 && (
                <div style={{ fontSize: '0.72rem', marginTop: 4, color: '#059669' }}>
                  ✓ Đã đọc: {d.acks.map((a) => `${a.userName || 'Người dùng'} (${formatShortDateTime(a.createdAt)})`).join('; ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── MUST_RETURN DOCUMENTS ── */}
      {mustReturn.length > 0 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', border: '1px solid #93c5fd', background: '#eff6ff' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', marginBottom: 10, color: '#1e40af' }}>
            📤 Tài liệu phải trả lại ({mustReturn.length})
          </h3>
          {mustReturn.map((d) => (
            <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                📌 {d.label} {d.fulfilled && <span style={{ color: '#059669' }}>✓</span>}
              </div>
              {d.fulfilled ? (
                <div style={{ fontSize: '0.78rem', marginTop: 4, color: 'var(--text-secondary)' }}>
                  {d.note && <div>📝 {d.note}</div>}
                  {d.file && <a href={d.file.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>{d.file.fileName} ↗</a>}
                </div>
              ) : isAssignee && isActive && !myDone ? (
                <div style={{ marginTop: 6 }}>
                  <textarea
                    value={returnNotes[d.id] || ''}
                    onChange={(e) => setReturnNotes((s) => ({ ...s, [d.id]: e.target.value }))}
                    placeholder="Nhập nội dung trả lại…"
                    rows={2}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: '0.78rem', background: '#fff' }}
                  />
                  <MultiFileUpload label="" entityType="TaskDoc" entityId={`${taskId}_${d.id}`} compact
                    onUploaded={(f: UploadedFile) => setReturnFiles((s) => ({ ...s, [d.id]: { id: f.id, fileName: f.fileName, fileUrl: f.fileUrl } }))} />
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Cần nhập nội dung <b>hoặc</b> đính kèm tệp.</div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* ── SIDEBAR PANELS ── */}

      {/* Assignees */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            👥 Người nhận
            {data.progress && (
              <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 600, color: data.progress.done === data.progress.total ? '#059669' : '#d97706' }}>
                · {data.progress.done}/{data.progress.total} đã xong
              </span>
            )}
          </h3>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {data.assignees.map((a) => (
            <span key={a.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem',
              padding: '5px 12px', borderRadius: 20,
              background: a.done ? '#ecfdf5' : '#eef2ff',
              color: a.done ? '#059669' : '#3730a3',
              border: `1px solid ${a.done ? '#a7f3d0' : '#c7d2fe'}`,
            }}>
              {a.done ? '✓' : '○'} {assigneeLabel(a)}
              {a.isPrimary && <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>· chính</span>}
            </span>
          ))}
          {data.assignees.length === 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Chưa có người nhận</span>
          )}
        </div>
      </div>

      {/* Meetings */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>📅 Lịch họp ({data.meetings?.length || 0})</h3>
          <button onClick={goCreateMeeting} style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: 8, fontWeight: 600, background: '#1d4ed8', color: '#fff', border: 'none', cursor: 'pointer' }}>+ Tạo</button>
        </div>
        {data.meetings?.map((mt) => (
          <div key={mt.id} onClick={() => router.push(`/dashboard/work/meetings/${mt.id}`)} style={{ fontSize: '0.85rem', padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }} className="hover:bg-blue-50">
            <div>{mt.title}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {formatShortDateTime(mt.startsAt)}
              {' · '}{mt.status === 'DONE' ? 'đã kết thúc' : 'đã lên lịch'}
            </div>
          </div>
        ))}
        {(!data.meetings || data.meetings.length === 0) && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Chưa có lịch họp.</div>
        )}
      </div>

      {/* Sub-tasks */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>↳ Việc con ({data.children.length})</h3>
          <button onClick={() => router.push(`/dashboard/work/create?parent=${taskId}`)} style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-primary)' }}>+ Tạo</button>
        </div>
        {data.children.map((c) => (
          <div key={c.id} onClick={() => router.push(`/dashboard/work/${c.id}`)} style={{ fontSize: '0.85rem', padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }} className="hover:bg-blue-50">
            {c.title} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>· {c.status}</span>
          </div>
        ))}
        {data.children.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Chưa có việc con.</div>
        )}
      </div>

      {/* Comments/History */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', marginBottom: 8 }}>💬 Trao đổi & lịch sử</h3>
        <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10 }}>
          {data.history.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '8px 0' }}>Chưa có lịch sử.</div>
          )}
          {data.history.map((h) => {
            const target = h.toName || h.toRoleName
            return (
              <div key={h.id} style={{ fontSize: '0.82rem', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 600, color: 'var(--navy, #0a2540)' }}>{ACT[h.action] || h.action}</span>
                {h.byName && <span style={{ color: 'var(--text-secondary)' }}> · {h.byName}</span>}
                {(h.action === 'ASSIGNED' || h.action === 'REASSIGNED' || h.action === 'FORWARDED') && target && <span style={{ color: 'var(--text-secondary)' }}> → {target}</span>}
                {h.action === 'RETURNED' && h.fromName && <span style={{ color: 'var(--text-secondary)' }}> → {h.fromName}</span>}
                {h.reason && <span style={{ color: 'var(--text-secondary)' }}> — {h.reason}</span>}
                <span style={{ fontSize: '0.7rem', marginLeft: 6, color: 'var(--text-muted)' }}>{formatDateTime(h.createdAt)}</span>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendComment()}
            placeholder="Nhập trao đổi..."
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: '0.84rem', background: '#f8fafc' }}
          />
          <button onClick={sendComment} style={{ fontSize: '0.84rem', padding: '0 16px', borderRadius: 8, background: 'var(--navy, #0a2540)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Gửi</button>
        </div>
      </div>
    </>
  )
}
