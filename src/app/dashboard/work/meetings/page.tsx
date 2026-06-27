'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { DEPT_NAME, ROLE_TO_DEPT, DEPT_PRIMARY_ROLE, DEPARTMENTS_V2 } from '@/lib/org-map'
import MultiFileUpload from '@/components/MultiFileUpload'
import { formatShortDateTime } from '@/lib/utils'

interface Proj { id: string; projectCode: string; projectName: string }
interface Usr { id: string; fullName?: string; username?: string; roleCode: string }
interface MeetingRow {
  id: string; title: string; status: string; startsAt: string; location: string | null
  project: { projectCode: string; projectName: string } | null
  isOrganizer: boolean; myStatus: string | null
  counts: { total: number; accepted: number; declined: number }
}
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', fontSize: '.88rem', background: '#f8fafc', color: 'var(--text-primary)' }
const RSVP: Record<string, { l: string; c: string; b: string }> = {
  ORGANIZER: { l: 'Bạn tổ chức', c: '#1d4ed8', b: '#eff6ff' },
  INVITED: { l: 'Chờ xác nhận', c: '#b45309', b: '#fffbeb' },
  ACCEPTED: { l: 'Đã nhận', c: '#059669', b: '#ecfdf5' },
  DECLINED: { l: 'Từ chối', c: '#e63946', b: '#fef2f2' },
}

function MeetingsInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const taskId = sp.get('task') || undefined            // tạo họp trực tiếp từ 1 công việc
  const [list, setList] = useState<MeetingRow[]>([])
  const [projects, setProjects] = useState<Proj[]>([])
  const [users, setUsers] = useState<Usr[]>([])
  const [draftId] = useState(() => `mdraft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
  const [showForm, setShowForm] = useState(sp.get('new') === '1')
  // form (prefill khi tạo từ công việc)
  const [projectId, setProjectId] = useState(sp.get('project') || '')
  const [title, setTitle] = useState(sp.get('title') || '')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [location, setLocation] = useState('')
  const [agenda, setAgenda] = useState('')
  const [invites, setInvites] = useState<{ id: string; label: string }[]>([])
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('') // role đại diện phòng để KHOANH VÙNG tìm người
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fromProjectName = sp.get('projectName') || ''

  const [taskProjectLabel, setTaskProjectLabel] = useState(fromProjectName)
  const load = () => apiFetch('/api/work/meetings').then((r) => { if (r.ok) setList(r.meetings || []) })
  useEffect(() => {
    load()
    apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) })
    apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) })
    // Mở từ công việc → tự lấy dự án của công việc đó để hiển thị + gắn
    if (taskId) {
      apiFetch(`/api/work/tasks/${taskId}`).then((r) => {
        if (r.ok && r.task) {
          if (r.task.projectId) setProjectId(r.task.projectId)
          if (r.task.project) setTaskProjectLabel(`${r.task.project.projectCode} — ${r.task.project.projectName}`)
        }
      })
    }
  }, [taskId])

  const addUser = (u: Usr) => { if (!invites.some((x) => x.id === u.id)) setInvites([...invites, { id: u.id, label: u.fullName || u.username || u.id }]); setQuery('') }
  // Khoanh vùng theo phòng (nếu chọn) rồi mới gõ tên tìm — không tự bung cả phòng
  const filterDept = deptFilter ? ROLE_TO_DEPT[deptFilter] : ''
  const found = query.trim()
    ? users
        .filter((u) => (u.fullName || u.username || '').toLowerCase().includes(query.toLowerCase()))
        .filter((u) => !filterDept || ROLE_TO_DEPT[u.roleCode] === filterDept)
        .filter((u) => !invites.some((x) => x.id === u.id))
        .slice(0, 8)
    : []

  const submit = async () => {
    setError('')
    if (!title.trim()) { setError('Cần tiêu đề'); return }
    if (!startsAt) { setError('Cần thời gian họp'); return }
    if (invites.length === 0) { setError('Cần mời ít nhất 1 người'); return }
    setBusy(true)
    const res = await apiFetch('/api/work/meetings', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), projectId: projectId || undefined, taskId, agenda: agenda.trim() || undefined, location: location.trim() || undefined, startsAt: new Date(startsAt).toISOString(), endsAt: endsAt ? new Date(endsAt).toISOString() : undefined, inviteUserIds: invites.map((x) => x.id), draftId }),
    })
    setBusy(false)
    if (res.ok) {
      // Tạo từ một công việc → vào thẳng chi tiết họp (từ đó quay lại được công việc nguồn)
      if (taskId && res.meeting?.id) { router.push(`/dashboard/work/meetings/${res.meeting.id}`); return }
      setShowForm(false); setTitle(''); setStartsAt(''); setLocation(''); setAgenda(''); setInvites([]); setProjectId(''); load()
    } else setError(res.error || 'Lỗi tạo họp')
  }

  // Mở từ một công việc → cho quay lại đúng công việc đó
  const backToTask = () => router.push(`/dashboard/work/${taskId}`)

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      {taskId && <a onClick={backToTask} className="text-sm cursor-pointer" style={{ color: 'var(--text-muted)' }}>← Quay lại công việc</a>}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📅 {taskId ? 'Tạo lịch họp cho công việc' : 'Lịch họp'}</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tạo họp, mời người dự, xác nhận tham gia, lưu biên bản</p>
        </div>
        <button onClick={() => { if (showForm && taskId) backToTask(); else setShowForm((s) => !s) }} className="btn-primary text-sm px-4 py-2.5 rounded-lg">{showForm ? (taskId ? '← Công việc' : 'Đóng') : '+ Tạo cuộc họp'}</button>
      </div>

      {showForm && (
        <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-sm font-semibold">Dự án</label>
              {taskId ? (
                // Mở từ công việc → dự án tự khớp, không cho đổi
                <div style={{ ...inp, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>📁 {taskProjectLabel || '(theo công việc)'}</div>
              ) : (
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inp}>
                  <option value="">(Không thuộc dự án)</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
                </select>
              )}</div>
            <div><label className="text-sm font-semibold">Bắt đầu *</label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inp} /></div>
            <div><label className="text-sm font-semibold">Kết thúc (tùy chọn)</label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inp} /></div>
            <div><label className="text-sm font-semibold">Địa điểm</label><input value={location} onChange={(e) => setLocation(e.target.value)} style={inp} placeholder="Phòng họp / link online" /></div>
          </div>
          <div><label className="text-sm font-semibold">Tiêu đề *</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} placeholder="VD: Họp kickoff dự án DA-111" /></div>
          <div><label className="text-sm font-semibold">Nội dung / Chủ đề (Agenda)</label><textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} style={{ ...inp, minHeight: 60 }} /></div>
          <div>
            <label className="text-sm font-semibold">Mời tham gia *</label>
            <div className="mb-2">{invites.map((x, i) => (
              <span key={x.id} className="inline-flex items-center gap-2 text-sm mr-2 mb-2 px-3 py-1.5 rounded-full" style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe' }}>
                👤 {x.label} <span className="cursor-pointer opacity-60" onClick={() => setInvites(invites.filter((_, idx) => idx !== i))}>✕</span>
              </span>
            ))}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} style={inp}>
                <option value="">Lọc theo phòng (tất cả)</option>
                {DEPARTMENTS_V2.map((d) => DEPT_PRIMARY_ROLE[d.code] && <option key={d.code} value={DEPT_PRIMARY_ROLE[d.code]}>{d.name}</option>)}
              </select>
              <input value={query} onChange={(e) => setQuery(e.target.value)} style={inp} placeholder={filterDept ? `Gõ tên (trong ${DEPT_NAME[filterDept]})…` : 'Gõ tên người để mời…'} />
            </div>
            {found.length > 0 && (
              <div className="rounded-lg mt-1" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                {found.map((u) => <div key={u.id} onClick={() => addUser(u)} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">{u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode}</span></div>)}
              </div>
            )}
          </div>
          <div><label className="text-sm font-semibold">Tài liệu họp (agenda, slide, BB họp…)</label>
            <MultiFileUpload label="" entityType="Meeting" entityId={draftId} />
          </div>
          {error && <div className="text-sm" style={{ color: '#e63946' }}>{error}</div>}
          <button onClick={submit} disabled={busy} className="btn-primary text-sm px-5 py-2.5 rounded-lg w-full">{busy ? '...' : '✓ Tạo & gửi lời mời'}</button>
        </div>
      )}

      {(() => {
        const now = Date.now()
        const row = (m: MeetingRow) => {
          const st = RSVP[m.myStatus || ''] || null
          const tag = m.status === 'DONE' ? '· đã kết thúc' : m.status === 'CANCELLED' ? '· đã hủy' : ''
          return (
            <div key={m.id} onClick={() => router.push(`/dashboard/work/meetings/${m.id}`)} className="rounded-xl p-4 cursor-pointer hover:shadow-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: m.status === 'CANCELLED' ? 0.6 : 1 }}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{m.title}{tag && <span className="text-xs ml-2" style={{ color: m.status === 'CANCELLED' ? '#e63946' : '#059669' }}>{tag}</span>}</div>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {m.project && <span className="px-2 py-0.5 rounded" style={{ background: '#eff6ff', color: '#1d4ed8' }}>📁 {m.project.projectCode}</span>}
                    <span>🕒 {formatShortDateTime(m.startsAt)}</span>
                    {m.location && <span>📍 {m.location}</span>}
                    <span>✓ {m.counts.accepted}/{m.counts.total} nhận</span>
                  </div>
                </div>
                {st && <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: st.b, color: st.c }}>{st.l}</span>}
              </div>
            </div>
          )
        }
        const upcoming = list.filter((m) => m.status === 'SCHEDULED' && new Date(m.startsAt).getTime() >= now)
        const past = list.filter((m) => !(m.status === 'SCHEDULED' && new Date(m.startsAt).getTime() >= now))
        if (list.length === 0) return <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Chưa có cuộc họp nào.</div>
        return (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold mb-2" style={{ color: '#1d4ed8' }}>🔜 Sắp diễn ra ({upcoming.length})</div>
              <div className="space-y-2">{upcoming.length ? upcoming.map(row) : <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Không có cuộc họp sắp tới.</div>}</div>
            </div>
            {past.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>📁 Đã qua / đã kết thúc ({past.length})</div>
                <div className="space-y-2">{past.map(row)}</div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

export default function MeetingsPage() {
  return <Suspense fallback={<div className="p-6">Đang tải…</div>}><MeetingsInner /></Suspense>
}
