'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { Shield, Search, Save, Layers, UserCog, ChevronDown, UserPlus } from 'lucide-react'

interface Cap { key: string; label: string; module: string; kind: string }
interface ModuleGroup { module: string; caps: Cap[] }
interface RoleMeta { code: string; name: string }
type Effect = 'ALLOW' | 'DENY'
interface Matrix {
  modules: ModuleGroup[]
  roles: RoleMeta[]
  grants: Record<string, string[]>
  configured: Record<string, boolean>
  levels: Record<string, { minLevel?: 1 | 2; requiresApproval?: boolean; approverLevel?: 1 | 2 }>
  overrides: Record<string, Record<string, Effect>>
  designations: Record<string, string>
}
interface UserRow { id: string; fullName: string; username: string; roleCode: string; userLevel: number; isActive: boolean }
interface ProjectRow { id: string; projectCode: string; projectName: string }

type Tab = 'roles' | 'levels' | 'users' | 'designations'

export default function PermissionsPage() {
  const [tab, setTab] = useState<Tab>('roles')
  const [data, setData] = useState<Matrix | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/admin/permissions')
    if (res.ok) setData(res)
    else if (res.error) setDenied(true)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) })
    apiFetch('/api/projects?limit=200').then((r) => { if (r.ok) setProjects(r.projects || []) })
  }, [load])

  const flash = (ok: boolean, text: string) => { setToast({ ok, text }); setTimeout(() => setToast(null), 3000) }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>
  if (denied || !data) return (
    <div className="p-8"><div className="card" style={{ padding: 24, maxWidth: 480 }}>
      <Shield size={28} style={{ color: 'var(--text-muted)' }} />
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '10px 0 4px' }}>Không có quyền</h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Chỉ Quản trị hệ thống (R10) được vào trang phân quyền.</p>
    </div></div>
  )

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 4px 64px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <Shield size={24} style={{ color: 'var(--ibs-red)' }} />
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Phân quyền</h1>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 18 }}>
        Cấp/thu quyền theo vai trò, theo cấp bậc trong bước, hoặc riêng từng người — không cần sửa code.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {([['roles', 'Theo vai trò', Layers], ['levels', 'Cấp bậc theo bước', Shield], ['designations', 'Chỉ định cá nhân', UserPlus], ['users', 'Quyền riêng user', UserCog]] as const).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)}
            className={tab === t ? 'btn-primary' : 'btn-outline'}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 50, padding: '10px 16px', borderRadius: 8,
          fontSize: 14, fontWeight: 500, color: '#fff', background: toast.ok ? '#1e8e5a' : '#c8372b' }}>
          {toast.text}
        </div>
      )}

      {tab === 'roles' && <RolesTab data={data} onSaved={(msg) => { flash(true, msg); load() }} onError={(m) => flash(false, m)} />}
      {tab === 'levels' && <LevelsTab data={data} onSaved={(msg) => { flash(true, msg); load() }} onError={(m) => flash(false, m)} />}
      {tab === 'designations' && <DesignationsTab data={data} users={users} projects={projects} onSaved={(msg) => { flash(true, msg); load() }} onError={(m) => flash(false, m)} />}
      {tab === 'users' && <UsersTab data={data} users={users} onSaved={(msg) => { flash(true, msg); load() }} onError={(m) => flash(false, m)} />}
    </div>
  )
}

// ── Tab 1: theo vai trò ──
function RolesTab({ data, onSaved, onError }: { data: Matrix; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [role, setRole] = useState(data.roles[0]?.code || '')
  const [sel, setSel] = useState<Set<string>>(new Set(data.grants[role] || []))
  const [saving, setSaving] = useState(false)

  useEffect(() => { setSel(new Set(data.grants[role] || [])) }, [role, data.grants])

  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const save = async () => {
    setSaving(true)
    const res = await apiFetch('/api/admin/permissions/roles', {
      method: 'PUT', body: JSON.stringify({ roleCode: role, capabilities: [...sel] }),
    })
    setSaving(false)
    res.ok ? onSaved(res.message || 'Đã lưu') : onError(res.error || 'Lỗi lưu')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Vai trò:</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} style={{ maxWidth: 320 }}>
          {data.roles.map((r) => (
            <option key={r.code} value={r.code}>{r.code} — {r.name}{data.configured[r.code] ? ' ✎' : ''}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {data.configured[role] ? 'Đã chỉnh riêng' : 'Đang theo mặc định (luật gốc)'} · {sel.size} quyền
        </span>
        <button className="btn-primary" onClick={save} disabled={saving} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Save size={15} /> Lưu vai trò
        </button>
      </div>
      <CapabilityGrid modules={data.modules} isOn={(k) => sel.has(k)} onToggle={toggle} />
    </div>
  )
}

// ── Tab 2: cấp bậc theo bước ──
function LevelsTab({ data, onSaved, onError }: { data: Matrix; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [rows, setRows] = useState<{ step: string; minLevel: 0 | 1 | 2 }[]>(
    Object.entries(data.levels).map(([step, r]) => ({ step, minLevel: (r.minLevel || 0) as 0 | 1 | 2 }))
  )
  const [saving, setSaving] = useState(false)

  const add = () => setRows((r) => [...r, { step: '', minLevel: 1 }])
  const upd = (i: number, patch: Partial<{ step: string; minLevel: 0 | 1 | 2 }>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const del = (i: number) => setRows((r) => r.filter((_, j) => j !== i))

  const save = async () => {
    setSaving(true)
    const levels: Record<string, { minLevel?: 1 | 2 }> = {}
    for (const r of rows) { if (r.step.trim() && (r.minLevel === 1 || r.minLevel === 2)) levels[r.step.trim()] = { minLevel: r.minLevel } }
    const res = await apiFetch('/api/admin/permissions/levels', { method: 'PUT', body: JSON.stringify({ levels }) })
    setSaving(false)
    res.ok ? onSaved(res.message || 'Đã lưu') : onError(res.error || 'Lỗi lưu')
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Với một bước (theo mã bước, vd <code>P5.4</code>): chỉ cấp bậc từ mức này trở lên mới được thao tác.
        L1 = Trưởng/Phó, L2 = Nhân viên. Bỏ trống = không giới hạn cấp bậc.
      </p>
      <div className="card" style={{ padding: 16 }}>
        {rows.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Chưa có quy tắc nào. Bấm “Thêm quy tắc”.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input className="input" placeholder="Mã bước (vd P5.4)" value={r.step}
                onChange={(e) => upd(i, { step: e.target.value })} style={{ maxWidth: 200 }} />
              <select className="input" value={r.minLevel} onChange={(e) => upd(i, { minLevel: parseInt(e.target.value) as 0 | 1 | 2 })} style={{ maxWidth: 220 }}>
                <option value={1}>Chỉ L1 trở lên (Trưởng/Phó)</option>
                <option value={2}>L2 trở lên (mọi nhân viên)</option>
              </select>
              <button className="btn-ghost" onClick={() => del(i)} style={{ color: '#c8372b' }}>Xoá</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-outline" onClick={add}>+ Thêm quy tắc</button>
          <button className="btn-primary" onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={15} /> Lưu quy tắc
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tab: chỉ định cá nhân theo bước ──
function DesignationsTab({ data, users, projects, onSaved, onError }: {
  data: Matrix; users: UserRow[]; projects: ProjectRow[]; onSaved: (m: string) => void; onError: (m: string) => void
}) {
  const [rows, setRows] = useState<{ projectId: string; step: string; userId: string }[]>(
    Object.entries(data.designations).map(([k, userId]) => {
      const idx = k.indexOf(':')
      return { projectId: k.slice(0, idx), step: k.slice(idx + 1), userId }
    })
  )
  const [saving, setSaving] = useState(false)

  const add = () => setRows((r) => [...r, { projectId: projects[0]?.id || '', step: '', userId: '' }])
  const upd = (i: number, patch: Partial<{ projectId: string; step: string; userId: string }>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const del = (i: number) => setRows((r) => r.filter((_, j) => j !== i))

  const save = async () => {
    setSaving(true)
    const designations: Record<string, string> = {}
    for (const r of rows) { if (r.projectId && r.step.trim() && r.userId) designations[`${r.projectId}:${r.step.trim()}`] = r.userId }
    const res = await apiFetch('/api/admin/permissions/designations', { method: 'PUT', body: JSON.stringify({ designations }) })
    setSaving(false)
    res.ok ? onSaved(res.message || 'Đã lưu') : onError(res.error || 'Lỗi lưu')
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Chỉ định người phụ trách một bước của một dự án cụ thể (kể cả một nhân viên L2). Khi bước đó
        sinh việc, hệ sẽ giao đúng người này thay vì tự chọn trưởng phòng. Người đã nghỉ → tự về mặc định.
      </p>
      <div className="card" style={{ padding: 16 }}>
        {rows.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Chưa có chỉ định nào.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="input" value={r.projectId} onChange={(e) => upd(i, { projectId: e.target.value })} style={{ maxWidth: 240 }}>
                <option value="">— Dự án —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
              </select>
              <input className="input" placeholder="Mã bước (vd P4.3)" value={r.step} onChange={(e) => upd(i, { step: e.target.value })} style={{ maxWidth: 160 }} />
              <select className="input" value={r.userId} onChange={(e) => upd(i, { userId: e.target.value })} style={{ maxWidth: 260 }}>
                <option value="">— Người phụ trách —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.roleCode}·L{u.userLevel})</option>)}
              </select>
              <button className="btn-ghost" onClick={() => del(i)} style={{ color: '#c8372b' }}>Xoá</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn-outline" onClick={add}>+ Thêm chỉ định</button>
          <button className="btn-primary" onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={15} /> Lưu chỉ định
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tab 3: quyền riêng theo user ──
function UsersTab({ data, users, onSaved, onError }: { data: Matrix; users: UserRow[]; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [q, setQ] = useState('')
  const [uid, setUid] = useState('')
  const [ov, setOv] = useState<Record<string, Effect>>({})
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return users.slice(0, 30)
    return users.filter((u) => u.fullName.toLowerCase().includes(s) || u.username.includes(s)).slice(0, 30)
  }, [q, users])

  const pick = (u: UserRow) => { setUid(u.id); setOv({ ...(data.overrides[u.id] || {}) }) }
  const current = users.find((u) => u.id === uid)
  const roleGrants = current ? new Set(data.grants[current.roleCode] || []) : new Set<string>()

  const setEff = (cap: string, eff: Effect | null) => setOv((o) => {
    const n = { ...o }; if (eff === null) delete n[cap]; else n[cap] = eff; return n
  })
  const save = async () => {
    setSaving(true)
    const res = await apiFetch('/api/admin/permissions/overrides', { method: 'PUT', body: JSON.stringify({ userId: uid, overrides: ov }) })
    setSaving(false)
    res.ok ? onSaved(res.message || 'Đã lưu') : onError(res.error || 'Lỗi lưu')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
      <div className="card" style={{ padding: 14, alignSelf: 'start' }}>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Tìm người dùng…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 460, overflowY: 'auto' }}>
          {filtered.map((u) => (
            <button key={u.id} onClick={() => pick(u)}
              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: uid === u.id ? 'var(--ibs-red-50)' : 'transparent' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.fullName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{u.roleCode} · L{u.userLevel} · {u.username}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        {!current ? (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Chọn một người dùng để chỉnh quyền riêng.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{current.fullName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{current.roleCode} · L{current.userLevel} — quyền nền theo vai trò, dưới đây cấp thêm/thu hồi riêng</div>
              </div>
              <button className="btn-primary" onClick={save} disabled={saving} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Save size={15} /> Lưu quyền riêng
              </button>
            </div>
            <OverrideGrid modules={data.modules} roleGrants={roleGrants} ov={ov} setEff={setEff} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Lưới capability (checkbox) cho tab vai trò ──
function CapabilityGrid({ modules, isOn, onToggle }: { modules: ModuleGroup[]; isOn: (k: string) => boolean; onToggle: (k: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set(modules.map((m) => m.module)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {modules.map((mod) => (
        <div key={mod.module} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <button onClick={() => setOpen((s) => { const n = new Set(s); n.has(mod.module) ? n.delete(mod.module) : n.add(mod.module); return n })}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', border: 'none', background: 'var(--bg-secondary)', cursor: 'pointer' }}>
            <ChevronDown size={15} style={{ transform: open.has(mod.module) ? 'none' : 'rotate(-90deg)', transition: '.15s' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{mod.module}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{mod.caps.filter((c) => isOn(c.key)).length}/{mod.caps.length}</span>
          </button>
          {open.has(mod.module) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2, padding: 8 }}>
              {mod.caps.map((c) => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={isOn(c.key)} onChange={() => onToggle(c.key)} style={{ width: 16, height: 16, flexShrink: 0 }} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Lưới override tri-state cho tab user ──
function OverrideGrid({ modules, roleGrants, ov, setEff }: {
  modules: ModuleGroup[]; roleGrants: Set<string>; ov: Record<string, Effect>; setEff: (cap: string, eff: Effect | null) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {modules.map((mod) => (
        <div key={mod.module} className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>{mod.module}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {mod.caps.map((c) => {
              const eff = ov[c.key]
              const base = roleGrants.has(c.key)
              return (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {c.label}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      {base ? '(vai trò có)' : '(vai trò không)'}
                    </span>
                  </span>
                  {([['Mặc định', null], ['Cho', 'ALLOW'], ['Cấm', 'DENY']] as const).map(([label, val]) => {
                    const active = (val === null && !eff) || eff === val
                    const color = val === 'ALLOW' ? '#1e8e5a' : val === 'DENY' ? '#c8372b' : '#64748b'
                    return (
                      <button key={label} onClick={() => setEff(c.key, val)}
                        style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                          border: `1px solid ${active ? color : 'var(--border)'}`,
                          background: active ? color : 'transparent', color: active ? '#fff' : 'var(--text-muted)' }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
