'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { DEPARTMENTS_V2, DEPT_PRIMARY_ROLE, DEPT_NAME, ROLE_TO_DEPT } from '@/lib/org-map'
import { userDistinguisher } from '@/lib/user-display'

// Chuyển giao việc cho người khác — bê nguyên thao tác của màn Hộp việc (work/[id]) ra thành
// component dùng chung, để các card bước ở SIDEBAR (Cách A) cũng giao việc được.
//
// Trước đây các bước bị đẩy ra tab riêng thì mất luôn nút này: người nhận muốn giao lại phải
// mò về Hộp việc. Dùng ĐÚNG API /api/work/tasks/[id]/reassign nên lịch sử, thông báo và
// quyền hạn giữ nguyên như cũ, không viết lại nghiệp vụ.

interface UserLite { id: string; fullName?: string | null; username?: string | null; roleCode?: string | null }

export default function TaskHandoff({ taskId, onDone, label = '↪ Chuyển giao cho người khác' }: {
  taskId: string
  onDone?: () => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<UserLite[]>([])
  const [dept, setDept] = useState('')     // lọc theo role trưởng phòng của phòng đó
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || users.length) return
    apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) })
  }, [open, users.length])

  const candidates = () => {
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => !dept || ROLE_TO_DEPT[u.roleCode || ''] === ROLE_TO_DEPT[dept])
      .filter((u) => !q || `${u.fullName || ''} ${u.username || ''}`.toLowerCase().includes(q))
      .slice(0, 8)
  }

  const handoff = async (u: UserLite) => {
    if (busy) return
    const name = u.fullName || u.username || ''
    setBusy(true)
    setOpen(false); setQuery(''); setDept('')
    const res = await apiFetch(`/api/work/tasks/${taskId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ assignees: [{ userId: u.id, isPrimary: true }], note: `Chuyển giao cho ${name}` }),
    })
    setBusy(false)
    if (res.ok) { notify(`Đã chuyển giao cho ${name}`, 'success'); onDone?.() }
    else notify(res.error || 'Lỗi chuyển giao', 'error')
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy}
        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
        style={{ border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8' }}>
        {label}
      </button>
    )
  }

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>↪ Chuyển giao việc cho người khác</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Phòng (lọc)</label>
          <select value={dept} onChange={(e) => { setDept(e.target.value); setQuery('') }} className="input text-sm w-full">
            <option value="">Tất cả phòng</option>
            {DEPARTMENTS_V2.map((d) => DEPT_PRIMARY_ROLE[d.code] && (
              <option key={d.code} value={DEPT_PRIMARY_ROLE[d.code]}>{d.name}</option>
            ))}
          </select>
        </div>
        <div style={{ position: 'relative' }}>
          <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Nhân sự nhận</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input text-sm w-full"
            placeholder={dept ? `Gõ tên (trong ${DEPT_NAME[ROLE_TO_DEPT[dept]] || ''})…` : 'Gõ tên nhân sự…'} />
          {candidates().length > 0 && (
            <div className="rounded-lg" style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
              {candidates().map((u) => (
                <div key={u.id} onClick={() => handoff(u)} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">
                  {u.fullName || u.username}
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}> · {userDistinguisher(u)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Chọn người để chuyển giao — việc sẽ chuyển sang họ, bạn không còn là người nhận.
      </div>
      <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg"
        style={{ border: '1px solid var(--border)' }}>Hủy</button>
    </div>
  )
}
