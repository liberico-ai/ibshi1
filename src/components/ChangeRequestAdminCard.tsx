'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'

interface CrFor { originalTaskId: string; type: string; reason: string; requestedByName: string; originalTitle: string }
interface Asg { userId?: string | null; role?: string | null; done?: boolean; userName?: string | null; roleName?: string | null }
interface Usr { id: string; fullName?: string; username?: string; roleCode: string }

// Card hiển thị trong việc admin (giao R10) để xử lý yêu cầu chỉnh sửa của người tạo.
export default function ChangeRequestAdminCard({ crFor, onDone }: { crFor: CrFor; onDone: () => void }) {
  const router = useRouter()
  const isDelete = crFor.type === 'DELETE'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  // EDIT: recall editor
  const [editAsg, setEditAsg] = useState<{ userId?: string; role?: string; label: string; done: boolean }[]>([])
  const [users, setUsers] = useState<Usr[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    if (isDelete) return
    apiFetch(`/api/work/tasks/${crFor.originalTaskId}`).then((r) => {
      if (r.ok && r.task) {
        setEditAsg((r.task.assignees || []).map((a: Asg) => ({ userId: a.userId || undefined, role: a.role || undefined, label: a.userName || a.roleName || a.role || '—', done: !!a.done })))
      }
    })
    apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) })
  }, [isDelete, crFor.originalTaskId])

  const resolve = async (action: 'EXECUTE' | 'REJECT') => {
    setErr('')
    if (action === 'REJECT' && !note.trim()) { setErr('Nhập lý do từ chối'); return }
    if (action === 'EXECUTE' && !isDelete && editAsg.length === 0) { setErr('Cần ít nhất một người nhận'); return }
    setBusy(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = { action, note: note.trim() || undefined }
    if (action === 'EXECUTE' && !isDelete) body.assignees = editAsg.map((a, i) => ({ userId: a.userId, role: a.role, isPrimary: i === 0 }))
    const res = await apiFetch(`/api/work/tasks/${crFor.originalTaskId}/change-request/resolve`, { method: 'POST', body: JSON.stringify(body) })
    setBusy(false)
    if (res.ok) onDone()
    else setErr(res.error || 'Lỗi')
  }

  return (
    <div className="rounded-xl p-4" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e3a8a', marginBottom: 6 }}>
        Yêu cầu chỉnh sửa — {isDelete ? 'Xóa việc' : 'Sửa người nhận'}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
        Người yêu cầu: <b>{crFor.requestedByName}</b> · Việc: <b>{crFor.originalTitle}</b>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Lý do: {crFor.reason}</div>
      <button onClick={() => router.push(`/dashboard/work/${crFor.originalTaskId}`)}
        className="text-xs font-semibold cursor-pointer" style={{ color: '#1d4ed8', textDecoration: 'underline', marginBottom: 12, display: 'inline-block' }}>
        Mở việc gốc ↗
      </button>

      {/* EDIT: recall editor (chỉ bỏ người CHƯA hoàn thành) */}
      {!isDelete && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Người nhận sau khi sửa</div>
          <div className="flex flex-wrap gap-1.5">
            {editAsg.map((a, i) => (
              <span key={(a.userId || a.role || '') + i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                style={{ background: a.done ? '#ecfdf5' : '#fff', color: a.done ? '#059669' : '#1d4ed8', border: `1px solid ${a.done ? '#a7f3d0' : '#bfdbfe'}` }}>
                {a.done && '✓ '}{a.label}
                {a.done
                  ? <span title="Đã hoàn thành — không thể bỏ" style={{ opacity: 0.6 }}>🔒</span>
                  : <button type="button" onClick={() => setEditAsg(editAsg.filter((_, j) => j !== i))} title="Bỏ" style={{ fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>×</button>}
              </span>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Thêm người nhận — gõ tên…"
            className="input-field" style={{ width: '100%', marginTop: 6, fontSize: 12, padding: '6px 10px' }} />
          {q.trim() && (
            <div className="rounded-lg" style={{ border: '1px solid var(--border)', maxHeight: 150, overflow: 'auto', marginTop: 4, background: '#fff' }}>
              {users.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(q.toLowerCase())).filter((u) => !editAsg.some((a) => a.userId === u.id)).slice(0, 8).map((u) => (
                <div key={u.id} onClick={() => { setEditAsg([...editAsg, { userId: u.id, label: u.fullName || u.username || '', done: false }]); setQ('') }}
                  className="text-sm px-2 py-1.5 cursor-pointer hover:bg-blue-50">{u.fullName || u.username}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (bắt buộc nếu từ chối)"
        className="input-field" style={{ width: '100%', fontSize: 12, padding: '6px 10px', marginBottom: 10 }} />
      {err && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{err}</div>}

      <div className="flex gap-2">
        <button onClick={() => resolve('EXECUTE')} disabled={busy}
          className="text-sm px-4 py-2 rounded-lg font-semibold cursor-pointer" style={{ background: isDelete ? '#dc2626' : '#059669', color: '#fff', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Đang xử lý…' : (isDelete ? 'Thực hiện: Xóa việc gốc' : 'Thực hiện: Cập nhật người nhận')}
        </button>
        <button onClick={() => resolve('REJECT')} disabled={busy}
          className="text-sm px-4 py-2 rounded-lg cursor-pointer" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          Từ chối
        </button>
      </div>
    </div>
  )
}
