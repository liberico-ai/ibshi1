'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { ROLES, DEPARTMENTS } from '@/lib/constants'
import { SearchBar } from '@/components/SearchPagination'

interface UserItem {
  id: string; username: string; fullName: string; roleCode: string;
  userLevel: number; email: string | null; isActive: boolean;
  department: { code: string; name: string } | null;
}

const ROLE_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'R01', label: 'BGĐ' },
  { value: 'R02', label: 'PM' },
  { value: 'R03', label: 'KT-KH' },
  { value: 'R04', label: 'Thiết kế' },
  { value: 'R05', label: 'Kho' },
  { value: 'R06', label: 'SX' },
  { value: 'R07', label: 'TM' },
  { value: 'R08', label: 'Kế toán' },
  { value: 'R09', label: 'QC' },
  { value: 'R10', label: 'Admin' },
]

export default function UsersPage() {
  const [allUsers, setAllUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [editUser, setEditUser] = useState<UserItem | null>(null)
  const [resetUser, setResetUser] = useState<UserItem | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const reload = () => {
    apiFetch('/api/users').then((res) => {
      if (res.ok) setAllUsers(res.users)
    })
  }

  useEffect(() => {
    apiFetch('/api/users').then((res) => {
      if (res.ok) setAllUsers(res.users)
      setLoading(false)
    })
  }, [])

  const toggleActive = async (user: UserItem) => {
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT', body: JSON.stringify({ isActive: !user.isActive }),
    })
    if (res.ok) { reload(); showToast(`${user.username}: ${!user.isActive ? 'Đã kích hoạt' : 'Đã vô hiệu hóa'}`) }
  }

  const filtered = allUsers.filter((u) => {
    if (roleFilter && u.roleCode !== roleFilter && !u.roleCode.startsWith(roleFilter)) return false
    if (search) {
      const q = search.toLowerCase()
      return u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        u.roleCode.toLowerCase().includes(q)
    }
    return true
  })

  if (loading) return (
    <div className="space-y-6 animate-fade-in">
      <div className="h-10 w-56 skeleton rounded-xl" />
      <div className="h-80 skeleton rounded-2xl" />
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-semibold animate-fade-in-scale"
          style={{ background: '#16a34a', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          ✓ {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quản lý Người dùng</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {filtered.length}/{allUsers.length} người dùng
            {' · '}{allUsers.filter(u => u.isActive).length} active
            {' · '}{allUsers.filter(u => !u.isActive).length} inactive
          </p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-accent">+ Thêm người dùng</button>
      </div>

      {showCreate && <CreateUserForm onClose={() => setShowCreate(false)} onCreated={(u) => {
        setAllUsers([...allUsers, u as UserItem])
        setShowCreate(false)
        showToast('Đã tạo người dùng mới')
      }} />}

      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={() => {
        setEditUser(null); reload(); showToast('Đã cập nhật user')
      }} />}

      {resetUser && <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onDone={(msg) => {
        setResetUser(null); showToast(msg)
      }} />}

      <div className="flex gap-3 items-center flex-wrap">
        <div className="w-72"><SearchBar value={search} onChange={setSearch} placeholder="Tìm username, họ tên, email..." /></div>
        <div className="flex gap-2 flex-wrap">
          {ROLE_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setRoleFilter(f.value)}
              className="px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer" style={{
                background: roleFilter === f.value ? 'var(--primary)' : 'var(--bg-card)',
                color: roleFilter === f.value ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${roleFilter === f.value ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-pill)',
                boxShadow: roleFilter === f.value ? 'var(--shadow-xs)' : 'none',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Họ tên</th>
              <th>Role</th>
              <th>Level</th>
              <th>Phòng ban</th>
              <th>Trạng thái</th>
              <th style={{ textAlign: 'center' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.5 }}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ background: 'linear-gradient(135deg, #0a2540, #163a5f)', color: 'white', boxShadow: 'var(--shadow-xs)' }}>
                      {u.fullName.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-mono text-xs font-semibold" style={{ color: 'var(--accent)' }}>{u.username}</span>
                  </div>
                </td>
                <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{u.fullName}</td>
                <td>
                  <span className="badge" style={{ background: 'var(--ibs-navy-50)', color: 'var(--ibs-navy)', borderColor: 'var(--ibs-navy-100)', borderWidth: '1px' }}>
                    {u.roleCode} — {ROLES[u.roleCode as keyof typeof ROLES]?.name || u.roleCode}
                  </span>
                </td>
                <td className="text-center">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${u.userLevel === 1 ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-400'}`}>
                    L{u.userLevel}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{u.department?.name || '—'}</td>
                <td>
                  <button onClick={() => toggleActive(u)} className="badge cursor-pointer transition-all hover:scale-105" style={{
                    background: u.isActive ? '#f0fdf4' : '#fef2f2',
                    color: u.isActive ? '#16a34a' : '#dc2626',
                    borderColor: u.isActive ? '#bbf7d0' : '#fecaca',
                    borderWidth: '1px',
                  }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block mr-1.5" style={{ background: u.isActive ? '#16a34a' : '#dc2626' }} />
                    {u.isActive ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  <div className="flex gap-1.5 justify-center">
                    <button onClick={() => setEditUser(u)} title="Sửa"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer transition-all hover:scale-110"
                      style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>✏️</button>
                    <button onClick={() => setResetUser(u)} title="Reset mật khẩu"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer transition-all hover:scale-110"
                      style={{ background: '#fef3c7', color: '#d97706' }}>🔑</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                Không tìm thấy người dùng phù hợp
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Edit User Modal ── */
function EditUserModal({ user, onClose, onSaved }: { user: UserItem; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fullName: user.fullName,
    email: user.email || '',
    roleCode: user.roleCode,
    userLevel: user.userLevel,
    departmentCode: user.department?.code || '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onSaved()
    else setError(res.error || 'Lỗi cập nhật')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg animate-fade-in-scale" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>✏️ Sửa thông tin: {user.username}</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>ID: {user.id}</p>
        {error && <div className="mb-3 p-2 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Họ tên</label>
            <input className="input" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} required /></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Email</label>
            <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Role</label>
            <select className="input" value={form.roleCode} onChange={e => setForm({ ...form, roleCode: e.target.value })}>
              {Object.values(ROLES).map(r => <option key={r.code} value={r.code}>{r.code} — {r.name}</option>)}
            </select></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Level</label>
            <select className="input" value={form.userLevel} onChange={e => setForm({ ...form, userLevel: parseInt(e.target.value) })}>
              <option value={1}>L1 — Trưởng/Phó</option>
              <option value={2}>L2 — Nhân viên</option>
            </select></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Phòng ban</label>
            <select className="input" value={form.departmentCode} onChange={e => setForm({ ...form, departmentCode: e.target.value })}>
              <option value="">— Chưa phân bổ —</option>
              {DEPARTMENTS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select></div>
          <div className="col-span-2 flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="btn-ghost">Hủy</button>
            <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">
              {submitting ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Reset Password Modal ── */
function ResetPasswordModal({ user, onClose, onDone }: { user: UserItem; onClose: () => void; onDone: (msg: string) => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch(`/api/users/${user.id}/reset-password`, {
      method: 'POST', body: JSON.stringify({ newPassword }),
    })
    setSubmitting(false)
    if (res.ok) onDone(res.message || `Đã reset mật khẩu cho ${user.username}`)
    else setError(res.error || 'Lỗi reset mật khẩu')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-sm animate-fade-in-scale" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>🔑 Reset mật khẩu</h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>User: <strong>{user.username}</strong> ({user.fullName})</p>
        {error && <div className="mb-3 p-2 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mật khẩu mới *</label>
            <input className="input" type="password" placeholder="Nhập mật khẩu mới..." value={newPassword}
              onChange={e => setNewPassword(e.target.value)} required minLength={4} /></div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="btn-ghost">Hủy</button>
            <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">
              {submitting ? 'Đang xử lý...' : 'Reset mật khẩu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Create User Form ── */
function CreateUserForm({ onClose, onCreated }: { onClose: () => void; onCreated: (u: unknown) => void }) {
  const [form, setForm] = useState({
    username: '', password: '', fullName: '', roleCode: 'R06b',
    userLevel: 2, email: '', departmentCode: 'SX',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated(res.user)
    else setError(res.error)
  }

  return (
    <div className="card p-6 animate-fade-in-scale">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Thêm người dùng mới</h3>
      {error && <div className="mb-3 p-2 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Username *</label>
          <input className="input" placeholder="ten.nguoidung" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mật khẩu *</label>
          <input className="input" type="password" placeholder="••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Họ tên *</label>
          <input className="input" placeholder="Nguyễn Văn A" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Role *</label>
          <select className="input" value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
            {Object.values(ROLES).map((r) => <option key={r.code} value={r.code}>{r.code} — {r.name}</option>)}
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Level</label>
          <select className="input" value={form.userLevel} onChange={(e) => setForm({ ...form, userLevel: parseInt(e.target.value) })}>
            <option value={1}>L1 — Trưởng/Phó</option>
            <option value={2}>L2 — Nhân viên</option>
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Phòng ban</label>
          <select className="input" value={form.departmentCode} onChange={(e) => setForm({ ...form, departmentCode: e.target.value })}>
            {DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
          </select></div>
        <div className="col-span-2 flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">Hủy</button>
          <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">
            {submitting ? 'Đang tạo...' : 'Thêm người dùng'}
          </button>
        </div>
      </form>
    </div>
  )
}
