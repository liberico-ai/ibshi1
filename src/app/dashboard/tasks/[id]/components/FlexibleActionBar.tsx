'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME, DEPARTMENTS_V2, DEPT_PRIMARY_ROLE } from '@/lib/org-map'
import MultiFileUpload, { type UploadedFile } from '@/components/MultiFileUpload'

interface Usr { id: string; fullName?: string; username?: string; roleCode: string }
interface FwdDoc { kind: string; label: string; fileAttachmentId?: string; fileName?: string; selected?: boolean }
const TASK_TYPES = [
  { v: 'FREE', l: 'Việc khác' },
  { v: 'P2.1', l: 'Đề xuất / yêu cầu vật tư (Thiết kế)' },
  { v: 'P3.5', l: 'Tìm nhà cung cấp / mua hàng' },
  { v: 'P1.1B', l: 'Yêu cầu phê duyệt' },
  { v: 'P4.3', l: 'Nghiệm thu chất lượng' },
]
const roleLabel = (r: string) => (ROLES as Record<string, { name: string }>)[r]?.name || r
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: '.84rem', background: '#f8fafc' }

export default function FlexibleActionBar({ taskId, isActive, onComplete, onReject }: {
  taskId: string
  isActive: boolean
  onComplete: () => void
  onReject: () => void
}) {
  const router = useRouter()
  const { user } = useAuthStore()
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }

  // AWAITING_REVIEW: creator can finalize or create follow-up
  const [workTaskStatus, setWorkTaskStatus] = useState('')
  const [workTaskCreatedBy, setWorkTaskCreatedBy] = useState('')
  const [workTaskProjectId, setWorkTaskProjectId] = useState('')
  useEffect(() => {
    apiFetch(`/api/work/tasks/${taskId}`).then((r) => {
      if (r.ok && r.task) {
        setWorkTaskStatus(r.task.status || '')
        setWorkTaskCreatedBy(r.task.createdBy || '')
        setWorkTaskProjectId(r.task.projectId || '')
      }
    }).catch(() => {})
  }, [taskId])
  const isAwaitingReview = workTaskStatus === 'AWAITING_REVIEW'
  const isReturned = workTaskStatus === 'RETURNED'
  const isCreator = !!(user?.id && user.id === workTaskCreatedBy)

  // Forward state
  const [fwdOpen, setFwdOpen] = useState(false)
  const [fwdType, setFwdType] = useState('FREE')
  const [fwdTitle, setFwdTitle] = useState('')
  const [fwdNote, setFwdNote] = useState('')
  const [fwdPicks, setFwdPicks] = useState<{ role?: string; userId?: string; label: string }[]>([])
  const [fwdQuery, setFwdQuery] = useState('')

  // Delegate state
  const [delOpen, setDelOpen] = useState(false)
  const [delDept, setDelDept] = useState('')
  const [delQuery, setDelQuery] = useState('')

  // Reject state
  const [rejOpen, setRejOpen] = useState(false)
  const [rejReason, setRejReason] = useState('')

  // Forward deadline
  const [fwdDeadline, setFwdDeadline] = useState('')

  // Forward docs state
  const [fwdDocs, setFwdDocs] = useState<FwdDoc[]>([])
  const [newDocLabel, setNewDocLabel] = useState('')
  const [newDocKind, setNewDocKind] = useState<'MUST_READ' | 'MUST_RETURN'>('MUST_READ')
  const [newDocFileId, setNewDocFileId] = useState('')
  const [newDocFileName, setNewDocFileName] = useState('')

  const [users, setUsers] = useState<Usr[]>([])
  useEffect(() => { apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) }) }, [])

  const loadSourceDocs = () => {
    apiFetch(`/api/work/tasks/${taskId}`).then((r) => {
      if (r.ok && r.task?.docs?.length) {
        setFwdDocs(r.task.docs.map((d: { kind: string; label: string; fileAttachmentId?: string; file?: { fileName: string } }) => ({
          kind: d.kind, label: d.label, fileAttachmentId: d.fileAttachmentId || undefined,
          fileName: d.file?.fileName, selected: true,
        })))
      }
    }).catch(() => {})
  }

  const addNewDoc = () => {
    if (!newDocLabel.trim()) return
    setFwdDocs((prev) => [...prev, { kind: newDocKind, label: newDocLabel.trim(), fileAttachmentId: newDocFileId || undefined, fileName: newDocFileName || undefined, selected: true }])
    setNewDocLabel(''); setNewDocFileId(''); setNewDocFileName('')
  }

  if (!isActive && !(isAwaitingReview && isCreator) && !(isReturned && isCreator)) return null

  const addFwdRole = async (r: string) => {
    if (fwdPicks.some((p) => p.role === r)) return
    const res = await apiFetch(`/api/work/dept-head?role=${r}`)
    const headName = res.ok && res.head ? res.head.fullName : null
    setFwdPicks((prev) => [...prev, { role: r, label: headName ? `🏢 ${DEPT_NAME[ROLE_TO_DEPT[r]] || roleLabel(r)} → ${headName}` : `🏢 ${DEPT_NAME[ROLE_TO_DEPT[r]] || roleLabel(r)}` }])
  }
  const addFwdUser = (u: Usr) => {
    if (fwdPicks.some((p) => p.userId === u.id)) { setFwdQuery(''); return }
    const userDept = ROLE_TO_DEPT[u.roleCode]
    setFwdPicks((prev) => [...prev.filter((p) => !(p.role && ROLE_TO_DEPT[p.role] === userDept)), { userId: u.id, label: `👤 ${u.fullName || u.username}` }])
    setFwdQuery('')
  }
  const fwdUsers = fwdQuery.trim()
    ? users.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(fwdQuery.toLowerCase())).filter((u) => !fwdPicks.some((p) => p.userId === u.id)).slice(0, 8)
    : []

  const doForward = async () => {
    if (fwdPicks.length === 0) { showToast('Chọn nơi nhận để chuyển tiếp'); return }
    setBusy(true)
    const selectedDocs = fwdDocs.filter((d) => d.selected).map((d) => ({
      kind: d.kind, label: d.label, fileAttachmentId: d.fileAttachmentId || undefined,
    }))
    const res = await apiFetch(`/api/work/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        mode: 'FORWARD',
        forward: {
          title: fwdTitle.trim() || undefined,
          taskType: fwdType, note: fwdNote.trim() || undefined,
          deadline: fwdDeadline || undefined,
          assignees: fwdPicks.map((p, i) => ({ role: p.role, userId: p.userId, isPrimary: i === 0 })),
          docs: selectedDocs.length ? selectedDocs : undefined,
        },
        acknowledgedDocIds: [], returnedDocs: [],
      }),
    })
    setBusy(false)
    if (res.ok) { setFwdOpen(false); showToast('Đã hoàn thành & chuyển tiếp'); setTimeout(() => router.push('/dashboard/tasks'), 1500) }
    else showToast(res.error || 'Lỗi')
  }

  const doReturnCreator = async () => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'RETURN_CREATOR', acknowledgedDocIds: [], returnedDocs: [] }),
    })
    setBusy(false)
    if (res.ok) {
      if (res.allDone) showToast('Tất cả đã hoàn thành — đã trả người tạo')
      else showToast('Đã ghi nhận hoàn thành phần của bạn')
      setTimeout(() => window.location.reload(), 1500)
    } else showToast(res.error || 'Lỗi')
  }

  const doDelegate = async (userId: string, label: string) => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${taskId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ assignees: [{ userId, isPrimary: true }], note: `Chuyển giao cho ${label}` }),
    })
    setBusy(false)
    if (res.ok) { setDelOpen(false); setDelQuery(''); setDelDept(''); showToast('Đã chuyển giao'); setTimeout(() => window.location.reload(), 1200) }
    else showToast(res.error || 'Lỗi')
  }

  const delUsers = () => {
    const qd = delQuery.trim().toLowerCase()
    if (!qd) return []
    const dept = delDept ? ROLE_TO_DEPT[delDept] : ''
    return users.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(qd)).filter((u) => !dept || ROLE_TO_DEPT[u.roleCode] === dept).slice(0, 8)
  }

  const doFinalize = async () => {
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${taskId}/finalize`, { method: 'POST' })
    setBusy(false)
    if (res.ok) { showToast('Đã kết thúc công việc'); setTimeout(() => window.location.reload(), 1500) }
    else showToast(res.error || 'Lỗi')
  }

  const goCreateNext = () => {
    router.push(`/dashboard/work/create?from=${taskId}${workTaskProjectId ? `&project=${workTaskProjectId}` : ''}`)
  }

  const submitReject = async () => {
    if (!rejReason.trim()) { showToast('Nhập lý do trả lại'); return }
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${taskId}/return`, {
      method: 'POST',
      body: JSON.stringify({ reason: rejReason.trim() }),
    })
    setBusy(false)
    if (res.ok) { setRejOpen(false); setRejReason(''); showToast('Đã trả lại'); setTimeout(() => router.push('/dashboard/tasks'), 1500) }
    else showToast(res.error || 'Lỗi')
  }

  return (
    <>
      {/* Forward dialog */}
      {fwdOpen && (
        <div style={{ borderRadius: 12, padding: '1.25rem', marginTop: '1rem', background: '#fffbeb', border: '1px solid #fcd34d' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10, color: '#b45309' }}>↗ Hoàn thành & chuyển tiếp sang bộ phận khác</div>
          <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Loại việc chuyển tiếp</label>
          <select value={fwdType} onChange={(e) => setFwdType(e.target.value)} style={inp}>{TASK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Tên công việc</label>
            <input value={fwdTitle} onChange={(e) => setFwdTitle(e.target.value)} placeholder="Nhập tên công việc chuyển tiếp…" style={inp} />
          </div>
          <div style={{ margin: '8px 0' }}>{fwdPicks.map((p, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', marginRight: 8, marginBottom: 6, padding: '5px 12px', borderRadius: 20, background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe' }}>
              {p.label} <span style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setFwdPicks(fwdPicks.filter((_, idx) => idx !== i))}>✕</span>
            </span>
          ))}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Phòng/role</label>
              <select onChange={(e) => { if (e.target.value) addFwdRole(e.target.value); e.target.value = '' }} style={inp}>
                <option value="">— Chọn phòng —</option>
                {Object.entries(ROLES).map(([code, r]) => <option key={code} value={code}>{(r as { name: string }).name} ({DEPT_NAME[ROLE_TO_DEPT[code]] || code})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Nhân sự</label>
              <input value={fwdQuery} onChange={(e) => setFwdQuery(e.target.value)} style={inp} placeholder="Gõ tên nhân sự…" />
              {fwdUsers.length > 0 && (
                <div style={{ borderRadius: 8, marginTop: 4, border: '1px solid var(--border)', background: 'var(--surface, #fff)' }}>
                  {fwdUsers.map((u) => <div key={u.id} onClick={() => addFwdUser(u)} style={{ padding: '6px 10px', fontSize: '0.82rem', cursor: 'pointer' }} className="hover:bg-blue-50">{u.fullName || u.username} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· {DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode}</span></div>)}
                </div>
              )}
            </div>
          </div>
          <textarea value={fwdNote} onChange={(e) => setFwdNote(e.target.value)} placeholder="Ghi chú chuyển tiếp (tùy chọn)…" rows={2} style={{ ...inp, marginTop: 8 }} />

          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Deadline cho người nhận</label>
            <input type="date" value={fwdDeadline} onChange={(e) => setFwdDeadline(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 180 }} />
          </div>

          {/* ── Tài liệu bắt buộc chuyển tiếp ── */}
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 6, color: '#92400e' }}>📖 Tài liệu bắt buộc (chuyển kèm)</div>
            {fwdDocs.length === 0 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>Không có tài liệu từ task gốc.</div>
            )}
            {fwdDocs.map((d, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '3px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!d.selected} onChange={(e) => setFwdDocs((prev) => prev.map((dd, idx) => idx === i ? { ...dd, selected: e.target.checked } : dd))} />
                <span style={{ color: d.kind === 'MUST_READ' ? '#92400e' : '#1e40af' }}>{d.kind === 'MUST_READ' ? '📄 Phải đọc' : '📤 Phải trả lại'}</span>
                <span style={{ flex: 1 }}>{d.label}</span>
                {d.fileName && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({d.fileName})</span>}
              </label>
            ))}
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Thêm tài liệu mới</label>
                <input value={newDocLabel} onChange={(e) => setNewDocLabel(e.target.value)} placeholder="Tên tài liệu…" style={{ ...inp, fontSize: '0.78rem', padding: '6px 8px' }} />
              </div>
              <select value={newDocKind} onChange={(e) => setNewDocKind(e.target.value as 'MUST_READ' | 'MUST_RETURN')} style={{ ...inp, width: 'auto', fontSize: '0.78rem', padding: '6px 8px' }}>
                <option value="MUST_READ">Phải đọc</option>
                <option value="MUST_RETURN">Phải trả lại</option>
              </select>
              <button onClick={addNewDoc} disabled={!newDocLabel.trim()} style={{ fontSize: '0.78rem', padding: '6px 12px', borderRadius: 6, background: '#d97706', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, opacity: newDocLabel.trim() ? 1 : 0.5 }}>+ Thêm</button>
            </div>
            {newDocLabel.trim() && (
              <div style={{ marginTop: 4 }}>
                <MultiFileUpload label="" entityType="TaskDoc" entityId={`draft_fwd_${taskId}`} compact
                  onUploaded={(f: UploadedFile) => { setNewDocFileId(f.id); setNewDocFileName(f.fileName) }} />
                {newDocFileName && <span style={{ fontSize: '0.72rem', color: '#059669' }}>✓ {newDocFileName}</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={doForward} disabled={busy} style={{ flex: 1, padding: '10px', fontSize: '0.88rem', borderRadius: 10, fontWeight: 700, background: fwdPicks.length > 0 ? '#d97706' : '#9ca3af', color: '#fff', border: 'none', cursor: 'pointer' }}>↗ Xác nhận chuyển tiếp</button>
            <button onClick={() => setFwdOpen(false)} style={{ padding: '10px 20px', fontSize: '0.88rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer' }}>Hủy</button>
          </div>
        </div>
      )}

      {/* Delegate dialog */}
      {delOpen && (
        <div style={{ borderRadius: 12, padding: '1.25rem', marginTop: '1rem', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10, color: '#1d4ed8' }}>↪ Chuyển giao việc cho người khác</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Phòng (lọc)</label>
              <select value={delDept} onChange={(e) => { setDelDept(e.target.value); setDelQuery('') }} style={inp}>
                <option value="">Tất cả phòng</option>
                {DEPARTMENTS_V2.map((d) => DEPT_PRIMARY_ROLE[d.code] && <option key={d.code} value={DEPT_PRIMARY_ROLE[d.code]}>{d.name}</option>)}
              </select>
            </div>
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Nhân sự nhận</label>
              <input value={delQuery} onChange={(e) => setDelQuery(e.target.value)} placeholder={delDept ? `Gõ tên (trong ${DEPT_NAME[ROLE_TO_DEPT[delDept]]})…` : 'Gõ tên nhân sự…'} style={inp} />
              {delUsers().length > 0 && (
                <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, #fff)', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
                  {delUsers().map((u) => <div key={u.id} onClick={() => doDelegate(u.id, u.fullName || u.username || '')} style={{ padding: '6px 10px', fontSize: '0.82rem', cursor: 'pointer' }} className="hover:bg-blue-50">{u.fullName || u.username} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· {DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode}</span></div>)}
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>Chọn người để chuyển giao — việc sẽ chuyển sang họ.</div>
          <button onClick={() => setDelOpen(false)} style={{ marginTop: 8, padding: '8px 20px', fontSize: '0.84rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer' }}>Hủy</button>
        </div>
      )}

      {/* Reject dialog */}
      {rejOpen && (
        <div style={{ borderRadius: 12, padding: '1.25rem', marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 10, color: '#e63946' }}>✕ Từ chối / trả lại</div>
          <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={3} style={{ ...inp, background: '#fff' }} placeholder="Lý do trả lại…" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={submitReject} disabled={busy} style={{ padding: '10px 20px', fontSize: '0.88rem', borderRadius: 10, fontWeight: 700, background: '#e63946', color: '#fff', border: 'none', cursor: 'pointer' }}>Gửi trả lại</button>
            <button onClick={() => setRejOpen(false)} style={{ padding: '10px 20px', fontSize: '0.88rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer' }}>Hủy</button>
          </div>
        </div>
      )}

      {/* RETURNED: creator sees re-assign + create-next */}
      {isReturned && isCreator && !delOpen && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, paddingBottom: 12, background: 'var(--bg, #f1f5f9)', zIndex: 10, marginTop: '1rem' }}>
          <div style={{ fontSize: '0.82rem', padding: '8px 12px', marginBottom: 8, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
            Người nhận đã trả lại công việc này. Bạn có thể giao lại cho người khác hoặc tạo việc mới.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => { setDelOpen(true); setFwdOpen(false); setRejOpen(false) }} disabled={busy} style={{ flex: 1, minWidth: 150, padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 700, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
              ↪ Giao lại cho người khác
            </button>
            <button onClick={goCreateNext} style={{ flex: 1, minWidth: 150, padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 700, background: 'var(--navy, #0a2540)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              + Tạo việc mới
            </button>
          </div>
        </div>
      )}

      {/* AWAITING_REVIEW: creator sees finalize + create-next */}
      {isAwaitingReview && isCreator && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, paddingBottom: 12, background: 'var(--bg, #f1f5f9)', zIndex: 10, marginTop: '1rem' }}>
          <div style={{ fontSize: '0.82rem', padding: '8px 12px', marginBottom: 8, borderRadius: 8, background: '#fffbeb', border: '1px solid #fcd34d', color: '#b45309' }}>
            Người nhận đã hoàn thành và trả lại. Bạn có thể kết thúc, hoặc tạo việc tiếp theo.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={doFinalize} disabled={busy} style={{ flex: 1, minWidth: 150, padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 700, background: '#059669', color: '#fff', border: 'none', cursor: 'pointer' }}>
              ✓ Hoàn thành & kết thúc
            </button>
            <button onClick={goCreateNext} style={{ flex: 1, minWidth: 150, padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 700, background: 'var(--navy, #0a2540)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              + Tạo việc tiếp theo
            </button>
          </div>
        </div>
      )}

      {/* Sticky bottom action bar (normal assignee actions) */}
      {!fwdOpen && !isAwaitingReview && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, paddingBottom: 12, background: 'var(--bg, #f1f5f9)', zIndex: 10, marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={doReturnCreator} disabled={busy} style={{ flex: 1, minWidth: 150, padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 700, background: '#059669', color: '#fff', border: 'none', cursor: 'pointer' }}>
              ✓ Hoàn thành & trả người tạo
            </button>
            <button onClick={() => { setFwdOpen(true); setDelOpen(false); setRejOpen(false); loadSourceDocs() }} disabled={busy} style={{ padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 700, background: '#d97706', color: '#fff', border: 'none', cursor: 'pointer' }}>
              ↗ Hoàn thành & chuyển tiếp
            </button>
            <button onClick={() => { setDelOpen(true); setFwdOpen(false); setRejOpen(false) }} disabled={busy} style={{ padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 600, background: 'var(--surface, #fff)', color: '#1d4ed8', border: '1px solid #bfdbfe', cursor: 'pointer' }}>
              ↪ Chuyển giao
            </button>
            <button onClick={() => router.push(`/dashboard/work/create?parent=${taskId}${workTaskProjectId ? `&project=${workTaskProjectId}` : ''}`)} style={{ padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 600, background: 'var(--navy, #0a2540)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              + Việc con
            </button>
            <button onClick={() => { setRejOpen(true); setFwdOpen(false); setDelOpen(false) }} disabled={busy} style={{ padding: '12px 16px', fontSize: '0.88rem', borderRadius: 12, fontWeight: 600, background: 'var(--surface, #fff)', color: '#e63946', border: '1px solid #fecaca', cursor: 'pointer' }}>
              ✕ Từ chối / trả lại
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 24, zIndex: 50, padding: '10px 20px', borderRadius: 10, fontSize: '0.88rem', fontWeight: 700, boxShadow: '0 4px 12px rgba(0,0,0,.15)', background: 'var(--navy, #0a2540)', color: '#fff' }}>{toast}</div>
      )}
    </>
  )
}
