'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME, DEPARTMENTS_V2, DEPT_PRIMARY_ROLE } from '@/lib/org-map'
import MultiFileUpload, { type UploadedFile } from '@/components/MultiFileUpload'
import BomPrUploadUI from '@/app/dashboard/tasks/[id]/components/BomPrUploadUI'

interface DocFile { id: string; fileName: string; fileUrl: string }
interface DocAck { userId: string; userName: string | null; createdAt: string }
interface Assignee { id: string; role: string | null; userId: string | null; isPrimary: boolean; done?: boolean; doneAt?: string | null; userName?: string | null; roleName?: string | null; doneByName?: string | null }
interface Doc { id: string; kind: string; label: string; fulfilled: boolean; note?: string | null; file?: DocFile | null; acks?: DocAck[] }
interface Hist {
  id: string; action: string; byUserId: string; reason: string | null; createdAt: string
  toRole: string | null; toUserId?: string | null; fromUserId?: string | null
  byName?: string | null; fromName?: string | null; toName?: string | null; toRoleName?: string | null
}
interface LinkTask { id: string; title: string; status: string; taskType?: string }
interface LinkMeeting { id: string; title: string; status: string; startsAt: string }
interface Usr { id: string; fullName?: string; username?: string; roleCode: string }
interface Task {
  id: string; title: string; description: string | null; status: string; priority: string; deadline: string | null
  createdBy: string; createdByName?: string | null; completedByName?: string | null; returnCount: number; taskType: string
  projectId?: string | null
  project: { projectCode: string; projectName: string } | null
  assignees: Assignee[]; docs: Doc[]; children: LinkTask[]; history: Hist[]
  progress?: { done: number; total: number }
  parent?: LinkTask | null; forwardedFrom?: LinkTask | null; forwards?: LinkTask[]
  meetings?: LinkMeeting[]
  resultData?: { bomPr?: string } | null
}
const roleLabel = (r: string | null) => (r ? (ROLES as Record<string, { name: string }>)[r]?.name || r : '')
const ACT: Record<string, string> = { CREATED: 'Tạo việc', ASSIGNED: 'Giao', STARTED: 'Bắt đầu', ASSIGNEE_DONE: '✓ Một người hoàn thành', SUBMITTED_TO_CREATOR: '↩ Đã trả người giao', COMPLETED: '✓ Hoàn thành (tất cả)', CLOSED: '🏁 Người giao kết thúc', FORWARDED: '↗ Chuyển tiếp', RETURNED: '↩ Trả lại (sai phạm vi)', REASSIGNED: 'Giao lại', SUBTASK_CREATED: 'Tạo việc con', COMMENT: '💬 Trao đổi' }
const STATUS_LABEL: Record<string, string> = { OPEN: 'Mới', IN_PROGRESS: 'Đang xử lý', AWAITING_REVIEW: 'Chờ người giao kết thúc', DONE: 'Hoàn thành', RETURNED: 'Bị trả lại', CANCELLED: 'Đã hủy' }
const TASK_TYPES = [
  { v: 'FREE', l: 'Việc khác' },
  { v: 'P2.1', l: 'Đề xuất / yêu cầu vật tư (Thiết kế)' },
  { v: 'P3.5', l: 'Tìm nhà cung cấp / mua hàng' },
  { v: 'P1.1B', l: 'Yêu cầu phê duyệt' },
  { v: 'P4.3', l: 'Nghiệm thu chất lượng' },
]
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: '.84rem', background: '#f8fafc' }

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  // Hoàn thành: đọc/trả tài liệu
  const [acked, setAcked] = useState<Record<string, boolean>>({})
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({})
  const [returnFiles, setReturnFiles] = useState<Record<string, DocFile>>({})
  // Chuyển tiếp
  const [fwdOpen, setFwdOpen] = useState(false)
  const [fwdType, setFwdType] = useState('FREE')
  const [fwdNote, setFwdNote] = useState('')
  const [fwdPicks, setFwdPicks] = useState<{ role?: string; userId?: string; label: string }[]>([])
  const [users, setUsers] = useState<Usr[]>([])
  const [fwdQuery, setFwdQuery] = useState('')
  // Chuyển giao (giao lại việc này cho người khác trong phòng)
  const [delOpen, setDelOpen] = useState(false)
  const [delDept, setDelDept] = useState('')
  const [delQuery, setDelQuery] = useState('')
  const [prBom, setPrBom] = useState('')
  // Toast + trả lại (inline) + sửa việc
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }
  const [rejOpen, setRejOpen] = useState(false)
  const [rejReason, setRejReason] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState({ title: '', description: '', deadline: '', priority: 'NORMAL' })

  const load = useCallback(() => { apiFetch(`/api/work/tasks/${id}`).then((r) => { if (r.ok) setTask(r.task); setLoading(false) }) }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) }) }, [])
  // Khởi tạo dữ liệu PR từ task (1 lần)
  useEffect(() => { if (task?.resultData?.bomPr != null) setPrBom((p) => p || task.resultData!.bomPr || '') }, [task?.resultData?.bomPr])

  if (loading) return <div className="p-6" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>
  if (!task) return <div className="p-6">Không tìm thấy công việc</div>

  const myRow = task.assignees.find((a) => a.userId === user?.id) || task.assignees.find((a) => a.role === user?.roleCode)
  const isAssignee = !!myRow
  const myDone = !!myRow?.done
  const isCreator = task.createdBy === user?.id
  const awaitingReview = task.status === 'AWAITING_REVIEW'
  const mustRead = task.docs.filter((d) => d.kind === 'MUST_READ')
  const mustReturn = task.docs.filter((d) => d.kind === 'MUST_RETURN')
  // Đã đọc theo TỪNG người: server lưu vết trong d.acks (theo userId), cộng tick tại chỗ.
  const ackedByMe = (d: Doc) => !!d.acks?.some((a) => a.userId === user?.id) || !!acked[d.id]
  const allRead = mustRead.every((d) => ackedByMe(d))
  const allReturned = mustReturn.every((d) => d.fulfilled || (returnNotes[d.id]?.trim() || returnFiles[d.id]))
  const canComplete = allRead && allReturned

  const buildCompleteBody = (mode: 'RETURN_CREATOR' | 'FORWARD', forward?: unknown) => ({
    mode, forward,
    acknowledgedDocIds: mustRead.filter((d) => ackedByMe(d)).map((d) => d.id),
    returnedDocs: mustReturn.map((d) => ({ requirementId: d.id, note: returnNotes[d.id]?.trim() || undefined, fileAttachmentId: returnFiles[d.id]?.id || undefined })),
  })

  const doComplete = async (mode: 'RETURN_CREATOR' | 'FORWARD', forward?: unknown) => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(buildCompleteBody(mode, forward)) })
    setBusy(false)
    if (res.ok) { setFwdOpen(false); showToast(mode === 'FORWARD' ? 'Đã hoàn thành & chuyển tiếp' : 'Đã ghi nhận hoàn thành'); load() } else showToast(res.error || 'Lỗi')
  }
  const doForward = async () => {
    if (fwdPicks.length === 0) { showToast('Chọn nơi nhận để chuyển tiếp'); return }
    await doComplete('FORWARD', {
      taskType: fwdType, note: fwdNote.trim() || undefined,
      assignees: fwdPicks.map((p, i) => ({ role: p.role, userId: p.userId, isPrimary: i === 0 })),
    })
  }
  const doFinalize = async () => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/finalize`, { method: 'POST', body: '{}' })
    setBusy(false)
    if (res.ok) { showToast('Đã kết thúc công việc'); load() } else showToast(res.error || 'Lỗi')
  }
  const goCreateNext = () => router.push(`/dashboard/work/create?from=${id}${task.projectId ? `&project=${task.projectId}` : ''}`)
  const goCreateMeeting = () => router.push(`/dashboard/work/meetings?new=1&task=${id}${task.projectId ? `&project=${task.projectId}` : ''}${task.project ? `&projectName=${encodeURIComponent(`${task.project.projectCode} — ${task.project.projectName}`)}` : ''}&title=${encodeURIComponent(task.title)}`)
  // Chuyển giao việc này cho người khác (giao lại — không hoàn thành)
  const delUsers = () => {
    const qd = delQuery.trim().toLowerCase(); if (!qd) return []
    const dept = delDept ? ROLE_TO_DEPT[delDept] : ''
    return users.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(qd)).filter((u) => !dept || ROLE_TO_DEPT[u.roleCode] === dept).slice(0, 8)
  }
  // Lưu dữ liệu PR (BomPrUploadUI) vào task
  const saveBomPr = (data: string) => {
    setPrBom(data)
    apiFetch(`/api/work/tasks/${id}/bom-pr`, { method: 'POST', body: JSON.stringify({ data }) }).catch(() => {})
  }
  const doDelegate = async (userId: string, label: string) => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/reassign`, { method: 'POST', body: JSON.stringify({ assignees: [{ userId, isPrimary: true }], note: `Chuyển giao cho ${label}` }) })
    setBusy(false)
    if (res.ok) { setDelOpen(false); setDelQuery(''); setDelDept(''); showToast('Đã chuyển giao'); load() } else showToast(res.error || 'Lỗi')
  }
  const openEdit = () => { setEdit({ title: task.title, description: task.description || '', deadline: task.deadline ? task.deadline.slice(0, 10) : '', priority: task.priority }); setEditOpen(true) }
  const saveEdit = async () => {
    if (!edit.title.trim()) { showToast('Cần tiêu đề'); return }
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ title: edit.title.trim(), description: edit.description, deadline: edit.deadline ? new Date(edit.deadline).toISOString() : null, priority: edit.priority }) })
    setBusy(false)
    if (res.ok) { setEditOpen(false); showToast('Đã cập nhật'); load() } else showToast(res.error || 'Lỗi')
  }
  const submitReject = async () => {
    if (!rejReason.trim()) { showToast('Nhập lý do trả lại'); return }
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/return`, { method: 'POST', body: JSON.stringify({ reason: rejReason.trim() }) })
    setBusy(false)
    if (res.ok) { setRejOpen(false); setRejReason(''); showToast('Đã trả lại người giao'); load() } else showToast(res.error || 'Lỗi')
  }
  const sendComment = async () => {
    if (!comment.trim()) return
    const res = await apiFetch(`/api/work/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ content: comment }) })
    if (res.ok) { setComment(''); load() }
  }

  // Chuyển tiếp cấp phòng: thêm chip "phòng"; khi xác nhận, hệ thống tự gắn trưởng phòng
  // (trừ khi phòng đó đã chọn nhân sự cụ thể).
  const addFwdRole = (r: string) => {
    if (fwdPicks.some((p) => p.role === r)) return
    setFwdPicks((prev) => [...prev, { role: r, label: `🏢 ${DEPT_NAME[ROLE_TO_DEPT[r]] || roleLabel(r)}` }])
  }
  const addFwdUser = (u: Usr) => { if (!fwdPicks.some((p) => p.userId === u.id)) setFwdPicks([...fwdPicks, { userId: u.id, label: `👤 ${u.fullName || u.username}` }]); setFwdQuery('') }
  const fwdUsers = fwdQuery.trim()
    ? users.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(fwdQuery.toLowerCase())).filter((u) => !fwdPicks.some((p) => p.userId === u.id)).slice(0, 8)
    : []
  const assigneeLabel = (a: Assignee) => a.userName || a.roleName || roleLabel(a.role) || '—'
  const linkRow = (t: LinkTask, tag: string) => (
    <div key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)} className="text-sm py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50 flex items-center gap-2">
      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#f1f5f9', color: 'var(--text-muted)' }}>{tag}</span>
      <span className="flex-1">{t.title}</span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.status}</span>
    </div>
  )

  const stColor = awaitingReview ? '#b45309' : task.status === 'DONE' ? '#059669' : task.status === 'RETURNED' ? '#e63946' : '#1d4ed8'
  const accent = task.priority === 'URGENT' ? '#e63946' : task.priority === 'HIGH' ? '#d97706' : stColor

  return (
    <div className="space-y-4 animate-fade-in">
      <a onClick={() => router.push('/dashboard/work')} className="text-sm cursor-pointer" style={{ color: 'var(--text-muted)' }}>← Hộp việc</a>

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${accent}` }}>
        <div className="flex items-start gap-3">
          <h1 className="text-xl font-bold flex-1" style={{ color: 'var(--text-primary)' }}>{task.title}</h1>
          {isCreator && task.status !== 'DONE' && <button onClick={openEdit} className="text-xs px-2 py-0.5 rounded-lg" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>✏️ Sửa</button>}
          <span className="text-xs px-2.5 py-1 rounded-full font-bold" style={{ background: stColor, color: '#fff' }}>{STATUS_LABEL[task.status] || task.status}</span>
        </div>
        {editOpen && (
          <div className="mt-3 space-y-2 rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={inp} placeholder="Tiêu đề" />
            <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} style={{ ...inp, minHeight: 56 }} placeholder="Mô tả" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="date" value={edit.deadline} onChange={(e) => setEdit({ ...edit, deadline: e.target.value })} style={inp} />
              <select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} style={inp}><option value="NORMAL">Bình thường</option><option value="HIGH">Cao</option><option value="URGENT">Khẩn</option></select>
            </div>
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={busy} className="text-sm px-4 py-2 rounded-lg font-semibold" style={{ background: '#059669', color: '#fff' }}>Lưu</button>
              <button onClick={() => setEditOpen(false)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
            </div>
          </div>
        )}
        {task.description && <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>}
        <div className="flex flex-wrap gap-3 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {task.project && <span className="px-2 py-0.5 rounded" style={{ background: '#eff6ff', color: '#1d4ed8' }}>📁 {task.project.projectCode}</span>}
          <span>Người tạo: <b>{task.createdByName || '—'}</b></span>
          {task.deadline && <span>⏰ {new Date(task.deadline).toLocaleDateString('vi-VN')}</span>}
          {task.returnCount > 0 && <span style={{ color: '#e63946' }}>↩ đã bị trả {task.returnCount} lần</span>}
        </div>
      </div>

      {/* Đề xuất vật tư (PR) — FULL chiều ngang (bảng rộng): module hệ cũ, tìm kho + chống trùng + tồn kho */}
      {(/\bpr\b|vật tư|đề xuất/i.test(task.title) || (task.taskType || '').startsWith('P2') || prBom) && (
        <BomPrUploadUI
          isEditable={isAssignee && !myDone && task.status !== 'DONE'}
          bomPrData={prBom || undefined}
          onChange={saveBomPr}
          projectCode={task.project?.projectCode}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      {/* ══ CỘT CHÍNH: tài liệu + trao đổi ══ */}
      <div className="lg:col-span-2 space-y-4">
        {task.docs.length === 0 && (
          <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Công việc này không yêu cầu tài liệu đọc / trả lại.</div>
        )}
        {mustRead.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-2">📖 Phải đọc</div>
            {mustRead.map((d) => (
              <div key={d.id} className="text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-2">
                  <span>📄</span>
                  <div className="flex-1">
                    <div>{d.label}</div>
                    {d.file ? (
                      <a href={d.file.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>{d.file.fileName} ↗</a>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(không có tệp đính kèm)</span>}
                  </div>
                </div>
                {isAssignee && !myDone && task.status !== 'DONE' && (() => {
                  const meAcked = !!d.acks?.some((a) => a.userId === user?.id)
                  return (
                    <label className="flex items-center gap-2 mt-1.5 text-xs cursor-pointer" style={{ color: meAcked || acked[d.id] ? '#059669' : 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={meAcked || !!acked[d.id]} disabled={meAcked} onChange={(e) => setAcked((s) => ({ ...s, [d.id]: e.target.checked }))} />
                      Tôi đã đọc tài liệu này
                    </label>
                  )
                })()}
                {/* Lưu vết: ai đã đọc */}
                {d.acks && d.acks.length > 0 && (
                  <div className="text-xs mt-1" style={{ color: '#059669' }}>
                    ✓ Đã đọc: {d.acks.map((a) => `${a.userName || 'Người dùng'} (${new Date(a.createdAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`).join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {mustReturn.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-2">📤 Phải trả lại</div>
            {mustReturn.map((d) => (
              <div key={d.id} className="text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1.5">📌 {d.label} {d.fulfilled && <span style={{ color: '#059669' }}>✓</span>}</div>
                {d.fulfilled ? (
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {d.note && <div>📝 {d.note}</div>}
                    {d.file && <a href={d.file.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', textDecoration: 'underline' }}>{d.file.fileName} ↗</a>}
                  </div>
                ) : isAssignee && !myDone && task.status !== 'DONE' ? (
                  <div className="mt-1.5 space-y-1.5">
                    <textarea value={returnNotes[d.id] || ''} onChange={(e) => setReturnNotes((s) => ({ ...s, [d.id]: e.target.value }))} placeholder="Nhập nội dung trả lại…" rows={2}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: '.78rem', background: '#f8fafc' }} />
                    <MultiFileUpload label="" entityType="TaskDoc" entityId={`${id}_${d.id}`} compact
                      onUploaded={(f: UploadedFile) => setReturnFiles((s) => ({ ...s, [d.id]: { id: f.id, fileName: f.fileName, fileUrl: f.fileUrl } }))} />
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Cần nhập nội dung <b>hoặc</b> đính kèm tệp.</div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Trao đổi & lịch sử (cột chính) */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2">💬 Trao đổi & lịch sử</div>
          <div className="space-y-2 mb-3">
            {task.history.map((h) => {
              const target = h.toName || h.toRoleName
              return (
                <div key={h.id} className="text-sm">
                  <span className="font-semibold" style={{ color: 'var(--navy,#0a2540)' }}>{ACT[h.action] || h.action}</span>
                  {h.byName && <span style={{ color: 'var(--text-secondary)' }}> · {h.byName}</span>}
                  {(h.action === 'ASSIGNED' || h.action === 'REASSIGNED' || h.action === 'FORWARDED') && target && <span style={{ color: 'var(--text-secondary)' }}> → {target}</span>}
                  {h.action === 'RETURNED' && h.fromName && <span style={{ color: 'var(--text-secondary)' }}> → {h.fromName}</span>}
                  {h.reason && <span style={{ color: 'var(--text-secondary)' }}> — {h.reason}</span>}
                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{new Date(h.createdAt).toLocaleString('vi-VN')}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendComment()} placeholder="Nhập trao đổi..." style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: '.86rem', background: '#f8fafc' }} />
            <button onClick={sendComment} className="text-sm px-4 rounded-lg" style={{ background: 'var(--navy,#0a2540)', color: '#fff' }}>Gửi</button>
          </div>
        </div>
      </div>

      {/* ══ CỘT PHỤ: người nhận + liên kết + họp + việc con ══ */}
      <div className="space-y-4">
        {/* Người nhận */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2">
            👥 Người nhận {task.progress && <span style={{ color: task.progress.done === task.progress.total ? '#059669' : '#d97706' }}>· {task.progress.done}/{task.progress.total} đã xong</span>}
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

        {/* Liên kết công việc (cha / chuyển tiếp) */}
        {(task.parent || task.forwardedFrom || (task.forwards && task.forwards.length > 0)) && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-2">🔗 Liên kết công việc</div>
            {task.parent && linkRow(task.parent, 'Việc cha')}
            {task.forwardedFrom && linkRow(task.forwardedFrom, 'Chuyển tiếp từ')}
            {task.forwards?.map((t) => linkRow(t, '↗ Chuyển tiếp tới'))}
          </div>
        )}

        {/* Lịch họp */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-2">
            <div className="text-sm font-semibold">📅 Lịch họp ({task.meetings?.length || 0})</div>
            <button onClick={goCreateMeeting} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#1d4ed8', color: '#fff' }}>+ Tạo</button>
          </div>
          {task.meetings?.map((mt) => (
            <div key={mt.id} onClick={() => router.push(`/dashboard/work/meetings/${mt.id}`)} className="text-sm py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50">
              <div>{mt.title}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(mt.startsAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {mt.status === 'DONE' ? 'đã kết thúc' : 'đã lên lịch'}</div>
            </div>
          ))}
          {(!task.meetings || task.meetings.length === 0) && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có lịch họp.</div>}
        </div>

        {/* Việc con */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-2">
            <div className="text-sm font-semibold">↳ Việc con ({task.children.length})</div>
            <button onClick={() => router.push(`/dashboard/work/create?parent=${id}`)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>+ Tạo</button>
          </div>
          {task.children.map((c) => <div key={c.id} onClick={() => router.push(`/dashboard/work/${c.id}`)} className="text-sm py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50">{c.title} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {c.status}</span></div>)}
          {task.children.length === 0 && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có việc con.</div>}
        </div>
      </div>
      </div>{/* /grid 2 cột */}

      {/* Form chuyển tiếp */}
      {fwdOpen && isAssignee && !myDone && (
        <div className="rounded-xl p-4" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
          <div className="text-sm font-semibold mb-2" style={{ color: '#b45309' }}>↗ Hoàn thành & chuyển tiếp sang bộ phận khác</div>
          <label className="text-xs font-semibold">Loại việc chuyển tiếp</label>
          <select value={fwdType} onChange={(e) => setFwdType(e.target.value)} style={inp}>{TASK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
          <div className="my-2">{fwdPicks.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-2 text-sm mr-2 mb-2 px-3 py-1.5 rounded-full" style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe' }}>
              {p.label} <span className="cursor-pointer opacity-60" onClick={() => setFwdPicks(fwdPicks.filter((_, idx) => idx !== i))}>✕</span>
            </span>
          ))}</div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>Phòng/role</label>
              <select onChange={(e) => { if (e.target.value) addFwdRole(e.target.value); e.target.value = '' }} style={inp}>
                <option value="">— Chọn phòng/role —</option>
                {Object.entries(ROLES).map(([code, r]) => <option key={code} value={code}>{(r as { name: string }).name} ({DEPT_NAME[ROLE_TO_DEPT[code]] || code})</option>)}
              </select></div>
            <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>Nhân sự</label>
              <input value={fwdQuery} onChange={(e) => setFwdQuery(e.target.value)} style={inp} placeholder="Gõ tên nhân sự…" />
              {fwdUsers.length > 0 && (
                <div className="rounded-lg mt-1" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  {fwdUsers.map((u) => <div key={u.id} onClick={() => addFwdUser(u)} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">{u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode}</span></div>)}
                </div>
              )}
            </div>
          </div>
          <textarea value={fwdNote} onChange={(e) => setFwdNote(e.target.value)} placeholder="Ghi chú chuyển tiếp (tùy chọn)…" rows={2} style={{ ...inp, marginTop: 8 }} />
          <div className="flex gap-2 mt-2">
            <button onClick={doForward} disabled={busy || !canComplete} className="text-sm px-4 py-2.5 rounded-lg font-semibold flex-1" style={{ background: canComplete ? '#d97706' : '#9ca3af', color: '#fff' }}>↗ Xác nhận chuyển tiếp</button>
            <button onClick={() => setFwdOpen(false)} className="text-sm px-4 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
          </div>
        </div>
      )}

      {isAssignee && !myDone && task.status !== 'DONE' && !fwdOpen && (
        <div className="sticky bottom-0 py-3 space-y-1.5" style={{ background: 'var(--bg,#f1f5f9)' }}>
          {!canComplete && (
            <div className="text-xs px-1" style={{ color: '#e63946' }}>
              {!allRead && 'Cần tick "đã đọc" tất cả tài liệu phải đọc. '}
              {!allReturned && 'Cần nhập nội dung hoặc đính kèm cho tài liệu phải trả lại.'}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => doComplete('RETURN_CREATOR')} disabled={busy || !canComplete} className="text-sm px-4 py-3 rounded-xl font-semibold flex-1" style={{ background: canComplete ? '#059669' : '#9ca3af', color: '#fff', minWidth: 150 }}>✓ Hoàn thành & trả người tạo</button>
            <button onClick={() => setFwdOpen(true)} disabled={busy || !canComplete} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: canComplete ? '#d97706' : '#9ca3af', color: '#fff' }}>↗ Hoàn thành & chuyển tiếp</button>
            <button onClick={() => setDelOpen(true)} disabled={busy} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>↪ Chuyển giao</button>
            <button onClick={() => router.push(`/dashboard/work/create?parent=${id}`)} className="text-sm px-4 py-3 rounded-xl" style={{ background: 'var(--navy,#0a2540)', color: '#fff' }}>+ Việc con</button>
            <button onClick={() => setRejOpen(true)} disabled={busy} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: '#e63946', border: '1px solid #fecaca' }}>✕ Từ chối / trả lại</button>
          </div>
        </div>
      )}

      {isAssignee && myDone && task.status !== 'DONE' && !awaitingReview && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>✓ Bạn đã hoàn thành phần của mình. Đang chờ những người nhận khác.</div>
      )}

      {/* Chuyển giao (inline) */}
      {delOpen && isAssignee && !myDone && (
        <div className="rounded-xl p-4 space-y-2" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <div className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>↪ Chuyển giao việc cho người khác</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Phòng (lọc)</label>
              <select value={delDept} onChange={(e) => { setDelDept(e.target.value); setDelQuery('') }} style={inp}>
                <option value="">Tất cả phòng</option>
                {DEPARTMENTS_V2.map((d) => DEPT_PRIMARY_ROLE[d.code] && <option key={d.code} value={DEPT_PRIMARY_ROLE[d.code]}>{d.name}</option>)}
              </select>
            </div>
            <div style={{ position: 'relative' }}>
              <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Nhân sự nhận</label>
              <input value={delQuery} onChange={(e) => setDelQuery(e.target.value)} placeholder={delDept ? `Gõ tên (trong ${DEPT_NAME[ROLE_TO_DEPT[delDept]]})…` : 'Gõ tên nhân sự…'} style={inp} />
              {delUsers().length > 0 && (
                <div className="rounded-lg" style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
                  {delUsers().map((u) => <div key={u.id} onClick={() => doDelegate(u.id, u.fullName || u.username || '')} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">{u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode}</span></div>)}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chọn người để chuyển giao — việc sẽ chuyển sang họ (bạn không còn là người nhận).</div>
          <button onClick={() => setDelOpen(false)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
        </div>
      )}

      {/* Trả lại (inline) */}
      {rejOpen && isAssignee && !myDone && (
        <div className="rounded-xl p-4 space-y-2" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div className="text-sm font-semibold" style={{ color: '#e63946' }}>✕ Trả lại người giao (sai phạm vi)</div>
          <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={3} style={{ ...inp, background: '#fff' }} placeholder="Lý do trả lại…" />
          <div className="flex gap-2">
            <button onClick={submitReject} disabled={busy} className="text-sm px-4 py-2.5 rounded-lg font-semibold" style={{ background: '#e63946', color: '#fff' }}>Gửi trả lại</button>
            <button onClick={() => setRejOpen(false)} className="text-sm px-4 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
          </div>
        </div>
      )}

      {/* Người GIAO xem & kết thúc sau khi người nhận trả về */}
      {isCreator && awaitingReview && (
        <div className="sticky bottom-0 py-3 space-y-1.5" style={{ background: 'var(--bg,#f1f5f9)' }}>
          <div className="text-xs px-1" style={{ color: '#b45309' }}>Người nhận đã hoàn thành và trả lại. Bạn có thể kết thúc, hoặc tạo việc tiếp theo.</div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={doFinalize} disabled={busy} className="text-sm px-5 py-3 rounded-xl font-semibold flex-1" style={{ background: '#059669', color: '#fff', minWidth: 160 }}>✓ Hoàn thành &amp; kết thúc</button>
            <button onClick={goCreateNext} className="text-sm px-5 py-3 rounded-xl font-semibold" style={{ background: 'var(--navy,#0a2540)', color: '#fff' }}>+ Tạo việc tiếp theo</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-lg text-sm font-semibold shadow-lg" style={{ background: 'var(--navy,#0a2540)', color: '#fff' }}>{toast}</div>
      )}
    </div>
  )
}
