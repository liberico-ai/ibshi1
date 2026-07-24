'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore, openAuthedFile } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME, DEPARTMENTS_V2, DEPT_PRIMARY_ROLE } from '@/lib/org-map'
import MultiFileUpload, { type UploadedFile } from '@/components/MultiFileUpload'
import TemplateSelector from '@/components/TemplateSelector'
import ChangeRequestAdminCard from '@/components/ChangeRequestAdminCard'
import { userDistinguisher } from '@/lib/user-display'
import SkipReasonModal from '@/components/SkipReasonModal'
import { formatDate, formatDateTime, formatShortDateTime } from '@/lib/utils'
import { Badge, Button } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'


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
interface EvidenceFile { id: string; fileName: string; fileUrl: string; fileSize: number | null; mimeType: string | null; createdAt: string; uploadedBy: string; uploadedByName?: string | null }
interface Task {
  id: string; title: string; description: string | null; status: string; priority: string; deadline: string | null
  createdBy: string; createdByName?: string | null; completedByName?: string | null; returnCount: number; taskType: string
  projectId?: string | null
  project: { projectCode: string; projectName: string } | null
  assignees: Assignee[]; docs: Doc[]; children: LinkTask[]; history: Hist[]
  progress?: { done: number; total: number }
  parent?: LinkTask | null; forwardedFrom?: LinkTask | null; forwards?: LinkTask[]
  meetings?: LinkMeeting[]
  resultData?: Record<string, unknown> | null
  evidenceFiles?: EvidenceFile[]
  revisionRound?: number
  parentDocs?: { id: string; kind: string; label: string; file: DocFile | null }[]
  templateStepId?: string | null
}
const roleLabel = (r: string | null) => (r ? (ROLES as Record<string, { name: string }>)[r]?.name || r : '')
const ACT: Record<string, string> = { CREATED: 'Tạo việc', ASSIGNED: 'Giao việc', STARTED: 'Bắt đầu', ASSIGNEE_DONE: '✓ Hoàn thành phần việc', SUBMITTED_TO_CREATOR: '↩ Trả kết quả', COMPLETED: '✓ Hoàn thành tất cả', CLOSED: 'Kết thúc công việc', FORWARDED: '↗ Chuyển tiếp', RETURNED: '↩ Trả lại', REASSIGNED: 'Giao lại', SUBTASK_CREATED: '+ Tạo việc con', COMMENT: 'Trao đổi', EDITED: 'Chỉnh sửa' }
const STATUS_LABEL: Record<string, string> = { OPEN: 'Mới', IN_PROGRESS: 'Đang xử lý', AWAITING_REVIEW: 'Chờ người giao kết thúc', DONE: 'Hoàn thành', RETURNED: 'Bị trả lại', CANCELLED: 'Đã hủy' }
const TASK_TYPES = [
  { v: 'FREE', l: 'Việc khác' },
  { v: 'P2.1', l: 'Đề xuất / yêu cầu vật tư (Thiết kế)' },
  { v: 'P3.5', l: 'Tìm nhà cung cấp / mua hàng' },
  { v: 'P1.1B', l: 'Yêu cầu phê duyệt' },
  { v: 'P4.3', l: 'Nghiệm thu chất lượng' },
]
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: '.84rem', background: '#f8fafc' }

// Khóa nhận diện danh sách người nhận (để phát hiện có thay đổi khi lưu).
const asgKey = (list: { userId?: string; role?: string }[]) =>
  list.map((a) => (a.userId ? `u:${a.userId}` : `r:${a.role}`)).sort().join('|')

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
  const [fwdTitle, setFwdTitle] = useState('')
  const [fwdNote, setFwdNote] = useState('')
  const [fwdPicks, setFwdPicks] = useState<{ role?: string; userId?: string; label: string }[]>([])
  const [users, setUsers] = useState<Usr[]>([])
  const [fwdQuery, setFwdQuery] = useState('')
  // Docs chuyển tiếp
  const [fwdDocSel, setFwdDocSel] = useState<Record<string, boolean>>({})
  const [newFwdDocLabel, setNewFwdDocLabel] = useState('')
  const [newFwdDocKind, setNewFwdDocKind] = useState<'MUST_READ' | 'MUST_RETURN'>('MUST_READ')
  const [extraFwdDocs, setExtraFwdDocs] = useState<{ kind: string; label: string }[]>([])
  const [fwdDeadline, setFwdDeadline] = useState('')
  // Chuyển giao (giao lại việc này cho người khác trong phòng)
  const [delOpen, setDelOpen] = useState(false)
  const [delDept, setDelDept] = useState('')
  const [delQuery, setDelQuery] = useState('')
  // Toast + trả lại (inline) + sửa việc
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }
  const [rejOpen, setRejOpen] = useState(false)
  const [rejReason, setRejReason] = useState('')
  const [skipOpen, setSkipOpen] = useState(false)
  const [redoOpen, setRedoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState({ title: '', description: '', deadline: '', priority: 'NORMAL' })
  // Sửa người nhận (trong modal Sửa): chỉ bỏ/đổi được người CHƯA hoàn thành.
  const [editAsg, setEditAsg] = useState<{ userId?: string; role?: string; label: string; done: boolean }[]>([])
  const [editAsgQuery, setEditAsgQuery] = useState('')
  const [origAsgKeys, setOrigAsgKeys] = useState('')

  const load = useCallback(() => { apiFetch(`/api/work/tasks/${id}`).then((r) => { if (r.ok) setTask(r.task); setLoading(false) }) }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) }) }, [])

  // Task migrate (P*.x) giờ chạy trực tiếp trên /work/ — không redirect

  if (loading) return <div className="p-6" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>
  if (!task) return <div className="p-6">Không tìm thấy công việc</div>

  const myRow = task.assignees.find((a) => a.userId === user?.id) || task.assignees.find((a) => a.role === user?.roleCode)
  const isAssignee = !!myRow
  const myDone = !!myRow?.done
  const isCreator = task.createdBy === user?.id
  const isAdmin = user?.roleCode === 'R10' // Quản trị hệ thống — được quyền recall (sửa người nhận)
  // Yêu cầu chỉnh sửa (change request)
  const changeReq = task.resultData?.changeRequest as { status?: string; type?: string; reason?: string } | undefined
  const locked = changeReq?.status === 'PENDING'
  const changeReqFor = task.resultData?.changeRequestFor as { originalTaskId: string; type: string; reason: string; requestedByName: string; originalTitle: string } | undefined
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

  // Revise Flow36: "Không ảnh hưởng — Bỏ qua" checkpoint round≥1 (modal in-app + API skip 1c, validateBody).
  const confirmSkip = async (reason: string) => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/skip`, { method: 'POST', body: JSON.stringify({ skipReason: reason }) })
    setBusy(false)
    setSkipOpen(false)
    if (res.ok) { showToast('Đã bỏ qua (không ảnh hưởng)'); load() }
    else showToast(res.error || 'Lỗi bỏ qua')
  }

  // "Yêu cầu làm lại" — người tạo đánh giá không đạt → đẩy về người nhận (log REDO_REQUESTED).
  const confirmRedo = async (reason: string) => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/request-redo`, { method: 'POST', body: JSON.stringify({ reason }) })
    setBusy(false)
    setRedoOpen(false)
    if (res.ok) { showToast('Đã yêu cầu làm lại'); load() }
    else showToast(res.error || 'Lỗi yêu cầu làm lại')
  }
  // Số lần bị yêu cầu làm lại (log-only, đếm từ lịch sử REDO_REQUESTED) — badge + nguồn KPI.
  const redoCount = task.history.filter((h) => h.action === 'REDO_REQUESTED').length

  const doComplete = async (mode: 'RETURN_CREATOR' | 'FORWARD', forward?: unknown) => {
    if (mode === 'RETURN_CREATOR' && (!task.evidenceFiles || task.evidenceFiles.length === 0)) {
      if (!confirm('Chưa đính kèm bằng chứng thực hiện — vẫn hoàn thành?')) return
    }
    // Mức 1: việc báo giá đã chọn NCC nhưng CHƯA tạo Đơn đặt hàng (PO) → nhắc (không chặn cứng).
    const rd = (task.resultData && typeof task.resultData === 'object') ? task.resultData as Record<string, unknown> : {}
    const rawQuotes = rd.supplierQuotes
    const quotes: unknown[] = Array.isArray(rawQuotes)
      ? rawQuotes
      : typeof rawQuotes === 'string'
        ? (() => { try { const p = JSON.parse(rawQuotes); return Array.isArray(p) ? p : [] } catch { return [] } })()
        : []
    const hasSelectedQuote = quotes.some(q => (q as { selected?: boolean } | null)?.selected === true)
    const hasPo = !!rd.poId
    if (hasSelectedQuote && !hasPo) {
      if (!confirm('Bạn đã chọn nhà cung cấp nhưng CHƯA tạo Đơn đặt hàng (PO). Hoàn thành việc bây giờ sẽ khiến phần mua hàng chưa đi tiếp. Vẫn hoàn thành?')) return
    }
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(buildCompleteBody(mode, forward)) })
    setBusy(false)
    if (res.ok) { setFwdOpen(false); showToast(mode === 'FORWARD' ? 'Đã hoàn thành & chuyển tiếp' : 'Đã ghi nhận hoàn thành'); load() } else showToast(res.error || 'Lỗi')
  }
  const doForward = async () => {
    if (fwdPicks.length === 0) { showToast('Chọn nơi nhận để chuyển tiếp'); return }
    const selectedDocs = [
      ...task.docs.filter((d) => fwdDocSel[d.id] !== false).map((d) => ({
        kind: d.kind, label: d.label, fileAttachmentId: (d.file as DocFile | null | undefined)?.id || undefined,
      })),
      ...extraFwdDocs,
    ]
    await doComplete('FORWARD', {
      title: fwdTitle.trim() || undefined,
      taskType: fwdType, note: fwdNote.trim() || undefined,
      deadline: fwdDeadline || undefined,
      assignees: fwdPicks.map((p, i) => ({ role: p.role, userId: p.userId, isPrimary: i === 0 })),
      docs: selectedDocs.length ? selectedDocs : undefined,
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
  const doDelegate = async (userId: string, label: string) => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${id}/reassign`, { method: 'POST', body: JSON.stringify({ assignees: [{ userId, isPrimary: true }], note: `Chuyển giao cho ${label}` }) })
    setBusy(false)
    if (res.ok) { setDelOpen(false); setDelQuery(''); setDelDept(''); showToast('Đã chuyển giao'); load() } else showToast(res.error || 'Lỗi')
  }
  const openEdit = () => {
    setEdit({ title: task.title, description: task.description || '', deadline: task.deadline ? task.deadline.slice(0, 10) : '', priority: task.priority })
    const asg = task.assignees.map((a) => ({ userId: a.userId || undefined, role: a.role || undefined, label: assigneeLabel(a), done: !!a.done }))
    setEditAsg(asg)
    setOrigAsgKeys(asgKey(asg))
    setEditAsgQuery('')
    setEditOpen(true)
  }
  const saveEdit = async () => {
    const doBasic = isCreator                                    // sửa thông tin việc: chỉ người tạo
    const doAsg = isAdmin && asgKey(editAsg) !== origAsgKeys      // recall người nhận: chỉ admin (R10)
    if (doBasic && !edit.title.trim()) { showToast('Cần tiêu đề'); return }
    if (isAdmin && editAsg.length === 0) { showToast('Cần ít nhất một người nhận'); return }
    if (!doBasic && !doAsg) { setEditOpen(false); return }        // không có gì để lưu
    setBusy(true)
    if (doBasic) {
      const res = await apiFetch(`/api/work/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ title: edit.title.trim(), description: edit.description, deadline: edit.deadline ? new Date(edit.deadline).toISOString() : null, priority: edit.priority }) })
      if (!res.ok) { setBusy(false); showToast(res.error || 'Lỗi'); return }
    }
    if (doAsg) {
      const ares = await apiFetch(`/api/work/tasks/${id}/assignees`, { method: 'PATCH', body: JSON.stringify({ assignees: editAsg.map((a, i) => ({ userId: a.userId, role: a.role, isPrimary: i === 0 })) }) })
      if (!ares.ok) { setBusy(false); showToast(ares.error || 'Lỗi cập nhật người nhận'); return }
    }
    setBusy(false)
    setEditOpen(false); showToast('Đã cập nhật'); load()
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

  const addFwdRole = async (r: string) => {
    if (fwdPicks.some((p) => p.role === r)) return
    const res = await apiFetch(`/api/work/dept-head?role=${r}`)
    const headName = res.ok && res.head ? res.head.fullName : null
    setFwdPicks((prev) => [...prev, { role: r, label: headName ? `${DEPT_NAME[ROLE_TO_DEPT[r]] || roleLabel(r)} → ${headName}` : `${DEPT_NAME[ROLE_TO_DEPT[r]] || roleLabel(r)}` }])
  }
  const addFwdUser = (u: Usr) => {
    if (fwdPicks.some((p) => p.userId === u.id)) { setFwdQuery(''); return }
    const userDept = ROLE_TO_DEPT[u.roleCode]
    setFwdPicks((prev) => [...prev.filter((p) => !(p.role && ROLE_TO_DEPT[p.role] === userDept)), { userId: u.id, label: `${u.fullName || u.username}` }])
    setFwdQuery('')
  }
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

  const stColor = awaitingReview ? '#b45309' : task.status === 'DONE' ? '#059669' : task.status === 'RETURNED' ? 'var(--danger)' : '#1d4ed8'
  const accent = task.priority === 'URGENT' ? 'var(--danger)' : task.priority === 'HIGH' ? '#d97706' : stColor

  return (
    <div className="space-y-4 animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/work')}>← Hộp việc</Button>

      <div className="glass-card p-5" style={{ borderLeft: `5px solid ${accent}` }}>
        <div className="flex items-start gap-3">
          <h1 className="text-xl font-bold flex-1" style={{ color: 'var(--text-primary)' }}>{task.title}</h1>
          {(isCreator || isAdmin) && task.status !== 'DONE' && !locked && <Button variant="outline" size="sm" onClick={openEdit}>Sửa</Button>}
          <Badge variant={task.status === 'DONE' ? 'success' : task.status === 'RETURNED' ? 'danger' : awaitingReview ? 'warning' : 'info'}>
            {STATUS_LABEL[task.status] || task.status}
          </Badge>
        </div>
        {editOpen && (
          <div className="mt-3 space-y-2 rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
            {isCreator && (
              <>
                <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={inp} placeholder="Tiêu đề" />
                <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} style={{ ...inp, minHeight: 56 }} placeholder="Mô tả" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="date" value={edit.deadline} onChange={(e) => setEdit({ ...edit, deadline: e.target.value })} style={inp} />
                  <select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} style={inp}><option value="NORMAL">Bình thường</option><option value="HIGH">Cao</option><option value="URGENT">Khẩn</option></select>
                </div>
              </>
            )}

            {/* RECALL — CHỈ Quản trị hệ thống (R10) được sửa/bỏ người nhận */}
            {isAdmin && (
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Người nhận (recall)</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {editAsg.map((a, i) => (
                  <span key={(a.userId || a.role || '') + i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                    style={{ background: a.done ? '#ecfdf5' : '#eff6ff', color: a.done ? '#059669' : '#1d4ed8', border: `1px solid ${a.done ? '#a7f3d0' : '#bfdbfe'}` }}>
                    {a.done && '✓ '}{a.label}
                    {a.done
                      ? <span title="Đã hoàn thành phần việc — không thể bỏ" style={{ opacity: 0.6 }}>🔒</span>
                      : <button type="button" onClick={() => setEditAsg(editAsg.filter((_, j) => j !== i))} title="Bỏ người nhận này" style={{ fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>×</button>}
                  </span>
                ))}
              </div>
              <input value={editAsgQuery} onChange={(e) => setEditAsgQuery(e.target.value)} placeholder="Thêm người nhận — gõ tên…" style={{ ...inp, marginTop: 6 }} />
              {editAsgQuery.trim() && (
                <div className="mt-1 rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 160, overflow: 'auto' }}>
                  {users
                    .filter((u) => (u.fullName || u.username || '').toLowerCase().includes(editAsgQuery.toLowerCase()))
                    .filter((u) => !editAsg.some((a) => a.userId === u.id))
                    .slice(0, 8)
                    .map((u) => (
                      <div key={u.id} onClick={() => { setEditAsg([...editAsg, { userId: u.id, label: u.fullName || u.username || '', done: false }]); setEditAsgQuery('') }}
                        className="text-sm px-2 py-1.5 cursor-pointer hover:bg-blue-50">
                        {u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {userDistinguisher(u)}</span>
                      </div>
                    ))}
                </div>
              )}
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Recall dành cho Quản trị hệ thống. Chỉ bỏ/đổi được người CHƯA hoàn thành; người đã xong (✓ 🔒) giữ nguyên.</p>
            </div>
            )}

            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={busy} className="text-sm px-4 py-2 rounded-lg font-semibold" style={{ background: '#059669', color: '#fff' }}>Lưu</button>
              <button onClick={() => setEditOpen(false)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
            </div>
          </div>
        )}
        {task.description && <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>}
        <div className="flex flex-wrap gap-2 mt-3 text-xs items-center" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold px-2.5 py-1 rounded-full" style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}40` }}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
          {task.project && <Badge variant="info">{task.project.projectCode}</Badge>}
          <span>Người tạo: <b>{task.createdByName || '—'}</b></span>
          {task.deadline && <Badge variant="warning">Hạn: {formatDate(task.deadline)}</Badge>}
          {task.returnCount > 0 && <Badge variant="danger">↩ trả lại {task.returnCount} lần</Badge>}
          {redoCount > 0 && <Badge variant="warning">↺ làm lại {redoCount} lần</Badge>}
        </div>
      </div>

      {/* Banner khóa khi có yêu cầu đang chờ QTHT */}
      {locked && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>
          ⏳ Việc đang chờ <b>Quản trị hệ thống</b> xử lý yêu cầu <b>{changeReq?.type === 'DELETE' ? 'Xóa việc' : 'Sửa người nhận'}</b> — tạm khóa mọi thao tác.
          {changeReq?.reason && <> Lý do: {changeReq.reason}</>}
        </div>
      )}

      {/* Card xử lý yêu cầu — chỉ hiện trong việc admin (giao R10) khi chưa xử lý xong */}
      {changeReqFor && isAdmin && task.status !== 'DONE' && (
        <ChangeRequestAdminCard crFor={changeReqFor} onDone={load} />
      )}

      {/* Biểu mẫu (Dự toán/WBS/BOM/PR/Báo giá…) hiện khi task GẮN với biểu mẫu:
          - bước cố định (templateStepId != null), HOẶC
          - việc tạo tay có đính biểu mẫu (resultData.templateType != null).
          Việc động THUẦN (không cả hai) KHÔNG hiện — tránh lạc luồng. (Việc yêu cầu admin cũng ẩn.) */}
      {!changeReqFor && !!(task.templateStepId || task.resultData?.templateType) && (
        <TemplateSelector
          taskId={id}
          isEditable={(isAssignee || isCreator) && task.status !== 'DONE' && !locked}
          projectCode={task.project?.projectCode}
          project={task.project}
          projectId={task.projectId || undefined}
          taskTitle={task.title}
          initialTemplate={(task.resultData?.templateType as string) as import('@/components/TemplateSelector').TemplateType || undefined}
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
            <div className="text-sm font-semibold mb-2">Phải đọc</div>
            {mustRead.map((d) => (
              <div key={d.id} className="text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-2">
                  <span></span>
                  <div className="flex-1">
                    <div>{d.label}</div>
                    {d.file ? (
                      <a href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(d.file!.id, d.file!.fileName) }} className="text-xs" style={{ color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer' }}>{d.file.fileName} ↗</a>
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
                    ✓ Đã đọc: {d.acks.map((a) => `${a.userName || 'Người dùng'} (${formatShortDateTime(a.createdAt)})`).join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {mustReturn.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-2">Phải trả lại</div>
            {mustReturn.map((d) => (
              <div key={d.id} className="text-sm py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1.5">{d.label} {d.fulfilled && <span style={{ color: '#059669' }}>✓</span>}</div>
                {d.fulfilled ? (
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {d.note && <div>{d.note}</div>}
                    {d.file && <a href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(d.file!.id, d.file!.fileName) }} style={{ color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer' }}>{d.file.fileName} ↗</a>}
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

        {/* Bằng chứng thực hiện */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2">Bằng chứng thực hiện</div>
          {isAssignee && !myDone && task.status !== 'DONE' ? (
            <MultiFileUpload
              label=""
              entityType="TaskEvidence"
              entityId={`${id}_evidence`}
              existingFiles={(task.evidenceFiles || []).map(ef => ({ id: ef.id, fileName: ef.fileName, fileUrl: ef.fileUrl, fileSize: ef.fileSize || 0, mimeType: ef.mimeType, createdAt: ef.createdAt }))}
              accept=".pdf,.doc,.docx,.xlsx,.xls,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.heic,.zip,.rar"
              compact
            />
          ) : (task.evidenceFiles && task.evidenceFiles.length > 0) ? (
            <div className="space-y-1.5">
              {task.evidenceFiles.map((ef) => (
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

        {/* Trao đổi & lịch sử (cột chính) */}
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
              else if (h.action === 'SUBTASK_CREATED') detail = h.byName || ''
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

      {/* ══ CỘT PHỤ: người nhận + liên kết + họp + việc con ══ */}
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

        {/* Liên kết công việc (cha / chuyển tiếp) */}
        {(task.parent || task.forwardedFrom || (task.forwards && task.forwards.length > 0)) && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-2">Liên kết công việc</div>
            {task.parent && linkRow(task.parent, 'Việc cha')}
            {task.forwardedFrom && linkRow(task.forwardedFrom, 'Chuyển tiếp từ')}
            {task.forwards?.map((t) => linkRow(t, '↗ Chuyển tiếp tới'))}
          </div>
        )}

        {/* Tài liệu từ VIỆC CHA (read-only) — mọi việc con đều xem được tài liệu của việc cha */}
        {task.parentDocs && task.parentDocs.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-2">📎 Tài liệu từ việc cha <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(chỉ xem)</span></div>
            <div className="space-y-1.5">
              {task.parentDocs.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-xs flex-wrap">
                  <span style={{ fontWeight: 700, color: d.kind === 'MUST_READ' ? '#92400e' : d.kind === 'MUST_RETURN' ? '#1e40af' : 'var(--text-muted)' }}>
                    {d.kind === 'MUST_READ' ? 'Phải đọc' : d.kind === 'MUST_RETURN' ? 'Phải trả' : 'Tài liệu'}
                  </span>
                  <span>{d.label}</span>
                  {d.file
                    ? <a href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(d.file!.id, d.file!.fileName) }} style={{ color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer' }}>{d.file.fileName} ↗</a>
                    : <span style={{ color: 'var(--text-muted)' }}>(chưa có tệp)</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lịch họp */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-2">
            <div className="text-sm font-semibold">Lịch họp ({task.meetings?.length || 0})</div>
            <button onClick={goCreateMeeting} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#1d4ed8', color: '#fff' }}>+ Tạo</button>
          </div>
          {task.meetings?.map((mt) => (
            <div key={mt.id} onClick={() => router.push(`/dashboard/work/meetings/${mt.id}`)} className="text-sm py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50">
              <div>{mt.title}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatShortDateTime(mt.startsAt)} · {mt.status === 'DONE' ? 'đã kết thúc' : 'đã lên lịch'}</div>
            </div>
          ))}
          {(!task.meetings || task.meetings.length === 0) && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có lịch họp.</div>}
        </div>

        {/* Việc con */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-2">
            <div className="text-sm font-semibold">↳ Việc con ({task.children.length})</div>
            <button onClick={() => router.push(`/dashboard/work/create?parent=${id}${task.projectId ? `&project=${task.projectId}` : ''}`)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>+ Tạo</button>
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
          <div className="mt-2">
            <label className="text-xs font-semibold">Tên công việc</label>
            <input value={fwdTitle} onChange={(e) => setFwdTitle(e.target.value)} placeholder="Nhập tên công việc chuyển tiếp…" style={inp} />
          </div>
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
                  {fwdUsers.map((u) => <div key={u.id} onClick={() => addFwdUser(u)} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">{u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {userDistinguisher(u)}</span></div>)}
                </div>
              )}
            </div>
          </div>
          <textarea value={fwdNote} onChange={(e) => setFwdNote(e.target.value)} placeholder="Ghi chú chuyển tiếp (tùy chọn)…" rows={2} style={{ ...inp, marginTop: 8 }} />

          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Deadline cho người nhận</label>
            <input type="date" value={fwdDeadline} onChange={(e) => setFwdDeadline(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 180 }} />
          </div>

          {/* Tài liệu bắt buộc chuyển kèm */}
          {(task.docs.length > 0 || extraFwdDocs.length > 0) && (
            <div className="rounded-lg p-3 mt-2" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div className="text-xs font-bold mb-1.5" style={{ color: '#92400e' }}>Tài liệu bắt buộc (chuyển kèm)</div>
              {task.docs.map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer">
                  <input type="checkbox" checked={fwdDocSel[d.id] !== false} onChange={(e) => setFwdDocSel((s) => ({ ...s, [d.id]: e.target.checked }))} />
                  <span style={{ color: d.kind === 'MUST_READ' ? '#92400e' : '#1e40af' }}>{d.kind === 'MUST_READ' ? 'Phải đọc' : 'Phải trả'}</span>
                  <span className="flex-1">{d.label}</span>
                  {d.file && <span style={{ color: 'var(--text-muted)' }}>({d.file.fileName})</span>}
                </label>
              ))}
              {extraFwdDocs.map((d, i) => (
                <div key={`extra-${i}`} className="flex items-center gap-1.5 text-xs py-0.5">
                  <span>✓</span>
                  <span style={{ color: d.kind === 'MUST_READ' ? '#92400e' : '#1e40af' }}>{d.kind === 'MUST_READ' ? 'Phải đọc' : 'Phải trả'}</span>
                  <span className="flex-1">{d.label}</span>
                  <span className="cursor-pointer opacity-60" onClick={() => setExtraFwdDocs((prev) => prev.filter((_, idx) => idx !== i))}>✕</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-1.5 mt-1.5 items-end">
            <input value={newFwdDocLabel} onChange={(e) => setNewFwdDocLabel(e.target.value)} placeholder="Thêm tài liệu mới…" style={{ ...inp, flex: 1, fontSize: '0.78rem', padding: '5px 8px' }} />
            <select value={newFwdDocKind} onChange={(e) => setNewFwdDocKind(e.target.value as 'MUST_READ' | 'MUST_RETURN')} style={{ ...inp, width: 'auto', fontSize: '0.78rem', padding: '5px 8px' }}>
              <option value="MUST_READ">Phải đọc</option>
              <option value="MUST_RETURN">Phải trả lại</option>
            </select>
            <button onClick={() => { if (newFwdDocLabel.trim()) { setExtraFwdDocs((p) => [...p, { kind: newFwdDocKind, label: newFwdDocLabel.trim() }]); setNewFwdDocLabel('') } }} disabled={!newFwdDocLabel.trim()} className="text-xs px-2.5 py-1.5 rounded font-semibold" style={{ background: '#d97706', color: '#fff', border: 'none', cursor: 'pointer', opacity: newFwdDocLabel.trim() ? 1 : 0.5 }}>+ Thêm</button>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={doForward} disabled={busy || !canComplete} className="text-sm px-4 py-2.5 rounded-lg font-semibold flex-1" style={{ background: canComplete ? '#d97706' : '#9ca3af', color: '#fff' }}>↗ Xác nhận chuyển tiếp</button>
            <button onClick={() => setFwdOpen(false)} className="text-sm px-4 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
          </div>
        </div>
      )}

      {isAssignee && !myDone && task.status !== 'DONE' && !fwdOpen && !changeReqFor && (
        <div className="sticky bottom-0 py-3 space-y-1.5" style={{ background: 'var(--bg,#f1f5f9)' }}>
          {!canComplete && (
            <div className="text-xs px-1" style={{ color: 'var(--danger)' }}>
              {!allRead && 'Cần tick "đã đọc" tất cả tài liệu phải đọc. '}
              {!allReturned && 'Cần nhập nội dung hoặc đính kèm cho tài liệu phải trả lại.'}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {(task.revisionRound ?? 0) >= 1 && (
              <button onClick={() => setSkipOpen(true)} disabled={busy} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: '#475569', border: '1px solid #cbd5e1' }} title="Checkpoint vòng revise — nếu bước này không bị ảnh hưởng thì bỏ qua (có log)">⤼ Không ảnh hưởng — Bỏ qua</button>
            )}
            <button onClick={() => doComplete('RETURN_CREATOR')} disabled={busy || !canComplete} className="text-sm px-4 py-3 rounded-xl font-semibold flex-1" style={{ background: canComplete ? '#059669' : '#9ca3af', color: '#fff', minWidth: 150 }}>✓ Hoàn thành & trả người tạo</button>
            <button onClick={() => setFwdOpen(true)} disabled={busy || !canComplete} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: canComplete ? '#d97706' : '#9ca3af', color: '#fff' }}>↗ Hoàn thành & chuyển tiếp</button>
            <button onClick={() => setDelOpen(true)} disabled={busy} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>↪ Chuyển giao</button>
            <button onClick={() => router.push(`/dashboard/work/create?parent=${id}${task.projectId ? `&project=${task.projectId}` : ''}`)} className="text-sm px-4 py-3 rounded-xl" style={{ background: 'var(--text-heading)', color: '#fff' }}>+ Việc con</button>
            <button onClick={() => setRejOpen(true)} disabled={busy} className="text-sm px-4 py-3 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: 'var(--danger)', border: '1px solid #fecaca' }}>✕ Từ chối / trả lại</button>
          </div>
        </div>
      )}

      {isAssignee && myDone && task.status !== 'DONE' && !awaitingReview && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>✓ Bạn đã hoàn thành phần của mình. Đang chờ những người nhận khác.</div>
      )}

      {/* Chuyển giao (inline) — assignee hoặc creator khi task bị trả lại */}
      {delOpen && ((isAssignee && !myDone) || (isCreator && task.status === 'RETURNED')) && (
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
                  {delUsers().map((u) => <div key={u.id} onClick={() => doDelegate(u.id, u.fullName || u.username || '')} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">{u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {userDistinguisher(u)}</span></div>)}
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
          <div className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>✕ Trả lại người giao (sai phạm vi)</div>
          <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={3} style={{ ...inp, background: '#fff' }} placeholder="Lý do trả lại…" />
          <div className="flex gap-2">
            <button onClick={submitReject} disabled={busy} className="text-sm px-4 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--danger)', color: '#fff' }}>Gửi trả lại</button>
            <button onClick={() => setRejOpen(false)} className="text-sm px-4 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
          </div>
        </div>
      )}

      {/* Người GIAO xử lý task BỊ TRẢ LẠI: giao lại hoặc tạo việc mới */}
      {isCreator && task.status === 'RETURNED' && !delOpen && (
        <div className="sticky bottom-0 py-3 space-y-1.5" style={{ background: 'var(--bg,#f1f5f9)' }}>
          <div className="text-xs px-1" style={{ color: 'var(--danger)' }}>Người nhận đã trả lại công việc này. Bạn có thể giao lại cho người khác hoặc tạo việc mới.</div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setDelOpen(true)} disabled={busy} className="text-sm px-5 py-3 rounded-xl font-semibold flex-1" style={{ background: '#2563eb', color: '#fff', minWidth: 160 }}>↪ Giao lại cho người khác</button>
            <button onClick={goCreateNext} className="text-sm px-5 py-3 rounded-xl font-semibold" style={{ background: 'var(--text-heading)', color: '#fff' }}>+ Tạo việc mới</button>
          </div>
        </div>
      )}

      {/* Người GIAO xem & kết thúc sau khi người nhận trả về */}
      {isCreator && awaitingReview && (
        <div className="sticky bottom-0 py-3 space-y-1.5" style={{ background: 'var(--bg,#f1f5f9)' }}>
          <div className="text-xs px-1" style={{ color: '#b45309' }}>Người nhận đã hoàn thành và trả lại. Bạn có thể kết thúc, hoặc tạo việc tiếp theo.</div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={doFinalize} disabled={busy} className="text-sm px-5 py-3 rounded-xl font-semibold flex-1" style={{ background: '#059669', color: '#fff', minWidth: 160 }}>✓ Hoàn thành &amp; kết thúc</button>
            <button onClick={() => setRedoOpen(true)} disabled={busy} className="text-sm px-5 py-3 rounded-xl font-semibold" style={{ background: '#d97706', color: '#fff' }} title="Đánh giá không đạt → đẩy về người nhận làm lại (có log)">↺ Yêu cầu làm lại</button>
            <button onClick={goCreateNext} className="text-sm px-5 py-3 rounded-xl font-semibold" style={{ background: 'var(--text-heading)', color: '#fff' }}>+ Tạo việc tiếp theo</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-lg text-sm font-semibold shadow-lg" style={{ background: 'var(--text-heading)', color: '#fff' }}>{toast}</div>
      )}

      <SkipReasonModal
        open={skipOpen}
        busy={busy}
        title={`Bỏ qua bước ${task.taskType} — không ảnh hưởng`}
        defaultReason="Không ảnh hưởng"
        onCancel={() => setSkipOpen(false)}
        onConfirm={confirmSkip}
      />
      <SkipReasonModal
        open={redoOpen}
        busy={busy}
        title="Yêu cầu làm lại — nêu rõ chưa đạt ở đâu"
        subtitle="Đánh giá không đạt → đẩy về người nhận làm lại (được ghi log, tính KPI). Bắt buộc."
        placeholder="Chưa đạt ở đâu, cần làm lại gì…"
        defaultReason=""
        onCancel={() => setRedoOpen(false)}
        onConfirm={confirmRedo}
      />
    </div>
  )
}
