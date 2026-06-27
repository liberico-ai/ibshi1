'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore, openAuthedFile } from '@/hooks/useAuth'
import MultiFileUpload from '@/components/MultiFileUpload'
import { ROLE_TO_DEPT, DEPT_NAME, DEPARTMENTS_V2, DEPT_PRIMARY_ROLE } from '@/lib/org-map'
import { formatShortDateTime } from '@/lib/utils'

interface Invite { id: string; userId: string; status: string; userName: string | null; deptName: string | null; note: string | null }
interface MFile { id: string; fileName: string; fileUrl: string }
interface Usr { id: string; fullName?: string; username?: string; roleCode: string }
interface MomItem { stt?: string; noiDung?: string; actionBy?: string; dueDate?: string; remark?: string; role?: string | null; deptName?: string | null; actionable?: boolean }
interface MinutesData { preparedBy?: string; place?: string; items?: MomItem[] }
interface Meeting {
  id: string; title: string; status: string; startsAt: string; endsAt: string | null; location: string | null
  agenda: string | null; momNumber: string | null; minutesNote: string | null; minutesData: MinutesData | null; createdBy: string; createdByName: string | null
  taskId: string | null; projectId: string | null
  project: { projectCode: string; projectName: string } | null
  invites: Invite[]; files: MFile[]
}
const RSVP: Record<string, { l: string; c: string }> = {
  INVITED: { l: '○ Chờ xác nhận', c: '#b45309' },
  ACCEPTED: { l: '✓ Đã nhận', c: '#059669' },
  DECLINED: { l: '✗ Từ chối', c: '#e63946' },
}
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', fontSize: '.86rem', background: '#f8fafc' }

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const [m, setM] = useState<Meeting | null>(null)
  const [busy, setBusy] = useState(false)
  const [momNumber, setMomNumber] = useState('')
  const [minutesNote, setMinutesNote] = useState('')
  const [preparedBy, setPreparedBy] = useState('')
  const [place, setPlace] = useState('')
  const [items, setItems] = useState<MomItem[]>([{ noiDung: '', actionBy: '', dueDate: '', remark: '' }])
  // Giao task từ mục hành động
  const [users, setUsers] = useState<Usr[]>([])
  const [rowDept, setRowDept] = useState<Record<number, string>>({})
  const [rowPick, setRowPick] = useState<Record<number, { userId: string; label: string }>>({})
  const [rowQuery, setRowQuery] = useState<Record<number, string>>({})
  const [rowDone, setRowDone] = useState<Record<number, string>>({}) // idx → taskId đã tạo

  const load = useCallback(() => { apiFetch(`/api/work/meetings/${id}`).then((r) => { if (r.ok) setM(r.meeting) }) }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) }) }, [])

  if (!m) return <div className="p-6" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>

  const isOrganizer = m.createdBy === user?.id
  const myInvite = m.invites.find((i) => i.userId === user?.id)
  const isDone = m.status === 'DONE'
  const isCancelled = m.status === 'CANCELLED'
  const isClosed = isDone || isCancelled

  const respond = async (status: 'ACCEPTED' | 'DECLINED') => {
    setBusy(true)
    const res = await apiFetch(`/api/work/meetings/${id}/respond`, { method: 'POST', body: JSON.stringify({ status }) })
    setBusy(false)
    if (res.ok) load(); else alert(res.error || 'Lỗi')
  }
  const saveMinutes = async () => {
    setBusy(true)
    const res = await apiFetch(`/api/work/meetings/${id}/minutes`, {
      method: 'POST',
      body: JSON.stringify({
        momNumber: momNumber.trim() || undefined,
        minutesNote: minutesNote.trim() || undefined,
        preparedBy: preparedBy.trim() || undefined,
        place: place.trim() || undefined,
        items: items.filter((it) => it.noiDung?.trim() || it.actionBy?.trim()),
      }),
    })
    setBusy(false)
    if (res.ok) load(); else alert(res.error || 'Lỗi')
  }
  const setItem = (i: number, k: keyof MomItem, v: string) => setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  // Tạo task từ 1 mục hành động (gắn deadline + người/phòng đã chọn)
  const createTaskFromItem = async (i: number) => {
    const it = items[i]
    if (!it.noiDung?.trim()) { alert('Mục chưa có nội dung'); return }
    const role = rowDept[i] || it.role || undefined
    const pick = rowPick[i]
    if (!pick && !role) { alert('Chọn phòng hoặc nhân sự để giao'); return }
    setBusy(true)
    const res = await apiFetch('/api/work/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: it.noiDung.trim(),
        description: `Từ biên bản họp: ${m?.title || ''}`,
        projectId: m?.projectId || undefined,
        taskType: 'FREE',
        deadline: it.dueDate ? new Date(it.dueDate).toISOString() : undefined,
        assignees: pick ? [{ userId: pick.userId, isPrimary: true }] : [{ role, isPrimary: true }],
      }),
    })
    setBusy(false)
    if (res.ok && res.task?.id) setRowDone((s) => ({ ...s, [i]: res.task.id }))
    else alert(res.error || 'Lỗi tạo task')
  }
  const rowUsers = (i: number) => {
    const q = (rowQuery[i] || '').trim().toLowerCase()
    if (!q) return []
    const roleSel = rowDept[i] || items[i]?.role || ''
    const dept = roleSel ? ROLE_TO_DEPT[roleSel] : ''
    return users.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(q)).filter((u) => !dept || ROLE_TO_DEPT[u.roleCode] === dept).slice(0, 6)
  }
  // Đọc tự động biên bản từ file Excel (mẫu MOM IBS) → điền sẵn các trường + bảng mục hành động
  const parseFile = async (file: File) => {
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    try {
      const res = await fetch('/api/work/meetings/parse-minutes', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} }).then((r) => r.json())
      if (res.ok && res.parsed) {
        const p = res.parsed as { momNumber: string; place: string; preparedBy: string; subject: string; items: (MomItem & { stt?: string; dueISO?: string; actionable?: boolean })[] }
        if (p.momNumber) setMomNumber(p.momNumber)
        if (p.place) setPlace(p.place)
        if (p.preparedBy) setPreparedBy(p.preparedBy)
        if (p.subject) setMinutesNote(p.subject)
        if (p.items?.length) {
          setItems(p.items.map((it) => ({
            noiDung: (it.stt && it.stt !== '-') ? `${it.stt}. ${it.noiDung}` : it.noiDung,
            actionBy: it.actionBy,
            dueDate: it.dueISO || '',               // điền cột deadline (ISO)
            remark: it.remark,
            role: it.role, deptName: it.deptName,    // gợi ý phòng
            actionable: it.actionable !== false,     // dòng đề mục/mở đầu → không phải việc
          })))
          setRowDept({}); setRowPick({}); setRowQuery({}); setRowDone({})
        }
        // Lưu file BBH thành tài liệu của cuộc họp/dự án (xem & tải về được)
        const fd2 = new FormData(); fd2.append('file', file); fd2.append('entityType', 'Meeting'); fd2.append('entityId', id)
        await fetch('/api/upload', { method: 'POST', body: fd2, headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {})
        load()
      } else alert(res.error || 'Không đọc được file')
    } catch { alert('Lỗi đọc file') }
    setBusy(false)
  }
  const doCancel = async () => {
    if (!confirm('Hủy cuộc họp này? Người dự sẽ được thông báo.')) return
    setBusy(true)
    const res = await apiFetch(`/api/work/meetings/${id}/cancel`, { method: 'POST', body: '{}' })
    setBusy(false)
    if (res.ok) load(); else alert(res.error || 'Lỗi')
  }

  const stColor = isCancelled ? '#e63946' : isDone ? '#059669' : '#1d4ed8'

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl">
      <a onClick={() => router.push(m.taskId ? `/dashboard/work/${m.taskId}` : '/dashboard/work/meetings')} className="text-sm cursor-pointer" style={{ color: 'var(--text-muted)' }}>{m.taskId ? '← Công việc nguồn' : '← Lịch họp'}</a>

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${stColor}` }}>
        <div className="flex items-start gap-3">
          <h1 className="text-xl font-bold flex-1" style={{ color: 'var(--text-primary)' }}>{m.title}</h1>
          <span className="text-xs px-2.5 py-1 rounded-full font-bold" style={{ background: stColor, color: '#fff' }}>{isCancelled ? 'Đã hủy' : isDone ? 'Đã kết thúc' : 'Đã lên lịch'}</span>
        </div>
        {m.endsAt && <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Kết thúc dự kiến: {formatShortDateTime(m.endsAt)}</div>}
        <div className="flex flex-wrap gap-3 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {m.project && <span className="px-2 py-0.5 rounded font-semibold" style={{ background: '#eff6ff', color: '#1d4ed8' }}>📁 {m.project.projectCode} — {m.project.projectName}</span>}
          <span>🕒 {formatShortDateTime(m.startsAt)}</span>
          {m.location && <span>📍 {m.location}</span>}
          <span>Người tổ chức: <b>{m.createdByName}</b></span>
        </div>
        {m.agenda && <div className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}><b>Nội dung:</b> {m.agenda}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      {/* ══ CỘT CHÍNH: tài liệu + biên bản ══ */}
      <div className="lg:col-span-2 space-y-4">
        {/* Tài liệu họp */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2">📎 Tài liệu họp</div>
          {m.files.length === 0 && <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Chưa có tài liệu.</div>}
          {m.files.map((f) => (
            <a key={f.id} href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(f.id, f.fileName) }} className="block text-sm py-1" style={{ color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer' }}>📄 {f.fileName} ↗</a>
          ))}
          {isOrganizer && !isClosed && <div className="mt-2"><MultiFileUpload label="" entityType="Meeting" entityId={id} compact onUploaded={() => load()} /></div>}
        </div>

        {/* Biên bản họp (MOM — theo mẫu hệ cũ) */}
        {isCancelled ? (
          <div className="rounded-xl p-4 text-sm" style={{ background: '#fef2f2', color: '#e63946', border: '1px solid #fecaca' }}>Cuộc họp đã bị hủy.</div>
        ) : isDone ? (
          (m.momNumber || m.minutesNote || m.minutesData) && (
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-sm font-semibold mb-2">📝 Biên bản họp (MOM){m.momNumber ? ` · Số: ${m.momNumber}` : ''}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                {m.minutesData?.preparedBy && <span>Người lập: <b>{m.minutesData.preparedBy}</b></span>}
                {m.minutesData?.place && <span>Địa điểm: <b>{m.minutesData.place}</b></span>}
              </div>
              {m.minutesNote && <p className="text-sm whitespace-pre-wrap mb-2" style={{ color: 'var(--text-secondary)' }}>{m.minutesNote}</p>}
              {m.minutesData?.items && m.minutesData.items.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr style={{ background: '#f1f5f9' }}>
                      {['STT', 'Nội dung', 'Người thực hiện', 'Hạn', 'Ghi chú'].map((h) => <th key={h} className="text-left px-2 py-1 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {m.minutesData.items.map((it, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-2 py-1">{it.stt || i + 1}</td>
                          <td className="px-2 py-1">{it.noiDung}</td>
                          <td className="px-2 py-1">{it.actionBy}</td>
                          <td className="px-2 py-1">{it.dueDate}</td>
                          <td className="px-2 py-1">{it.remark}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        ) : isOrganizer && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
            <div className="text-sm font-semibold" style={{ color: '#b45309' }}>📝 Biên bản họp (MOM) & kết thúc</div>
            <label className="block text-xs rounded-lg p-2 cursor-pointer text-center" style={{ border: '1px dashed #d97706', color: '#b45309', background: '#fffdf5' }}>
              📥 Đọc tự động từ file biên bản (.xls/.xlsx) — điền sẵn theo mẫu
              <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = '' }} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input value={momNumber} onChange={(e) => setMomNumber(e.target.value)} style={inp} placeholder="Số biên bản (MOM No.)" />
              <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} style={inp} placeholder="Người lập" />
              <input value={place} onChange={(e) => setPlace(e.target.value)} style={inp} placeholder="Địa điểm" />
            </div>
            <textarea value={minutesNote} onChange={(e) => setMinutesNote(e.target.value)} style={{ ...inp, minHeight: 70 }} placeholder="Nội dung / kết luận cuộc họp…" />
            {/* Bảng mục hành động (Nội dung · Người thực hiện · Hạn · Ghi chú) + Gợi ý giao task */}
            <div className="text-xs font-semibold" style={{ color: '#b45309' }}>Mục hành động (Action items) — tự điền hạn & gợi ý phòng giao việc</div>
            {items.map((it, i) => {
              const sel = rowDept[i] || it.role || ''
              const us = rowUsers(i)
              const fld: React.CSSProperties = { ...inp, padding: '7px 10px', fontSize: '.82rem' }
              const lbl = 'text-xs font-semibold block mb-1'
              // Dòng đề mục / mở đầu (không phải việc) → hiển thị gọn dạng tiêu đề
              if (it.actionable === false) {
                return (
                  <div key={i} className="flex items-center gap-2 pt-1">
                    <input value={it.noiDung || ''} onChange={(e) => setItem(i, 'noiDung', e.target.value)} className="flex-1 font-semibold" style={{ ...fld, background: 'transparent', border: 'none', color: '#475569', padding: '2px 0' }} placeholder="Đề mục" />
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#f1f5f9', color: '#94a3b8' }}>đề mục</span>
                    <button onClick={() => setItems(items.filter((_, idx) => idx !== i))} title="Xoá" className="text-sm" style={{ color: '#e63946' }}>✕</button>
                  </div>
                )
              }
              return (
                <div key={i} className="rounded-xl p-3 space-y-2.5" style={{ background: '#fff', border: '1px solid #fde68a' }}>
                  {/* Nội dung — dòng rộng */}
                  <div className="flex gap-2 items-start">
                    <span className="flex-shrink-0 text-xs font-bold mt-2" style={{ color: '#b45309', minWidth: 20 }}>{i + 1}.</span>
                    <textarea value={it.noiDung || ''} onChange={(e) => setItem(i, 'noiDung', e.target.value)} rows={2} style={{ ...fld, flex: 1, minHeight: 44 }} placeholder="Nội dung công việc" />
                    <button onClick={() => setItems(items.filter((_, idx) => idx !== i))} title="Xoá mục" className="flex-shrink-0 text-sm mt-1" style={{ color: '#e63946' }}>✕</button>
                  </div>
                  {/* Người thực hiện · Hạn · Ghi chú — có nhãn */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div><label className={lbl} style={{ color: 'var(--text-muted)' }}>Người thực hiện</label><input value={it.actionBy || ''} onChange={(e) => setItem(i, 'actionBy', e.target.value)} style={fld} placeholder="—" /></div>
                    <div><label className={lbl} style={{ color: 'var(--text-muted)' }}>Hạn (deadline)</label><input type="date" value={it.dueDate || ''} onChange={(e) => setItem(i, 'dueDate', e.target.value)} style={fld} /></div>
                    <div><label className={lbl} style={{ color: 'var(--text-muted)' }}>Ghi chú</label><input value={it.remark || ''} onChange={(e) => setItem(i, 'remark', e.target.value)} style={fld} placeholder="—" /></div>
                  </div>
                  {/* Giao việc — khu riêng */}
                  {rowDone[i] ? (
                    <div className="rounded-lg px-3 py-2 text-sm flex items-center gap-2" style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>
                      ✓ Đã tạo task <span className="underline cursor-pointer font-semibold" onClick={() => router.push(`/dashboard/work/${rowDone[i]}`)}>Mở task ↗</span>
                    </div>
                  ) : (
                    <div className="rounded-lg p-2.5" style={{ background: '#f8fafc', border: '1px dashed var(--border)' }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold" style={{ color: '#1d4ed8' }}>🎯 Giao việc</span>
                        {it.deptName && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>Gợi ý: {it.deptName}</span>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                        <div>
                          <label className={lbl} style={{ color: 'var(--text-muted)' }}>Phòng</label>
                          <select value={sel} onChange={(e) => { setRowDept((s) => ({ ...s, [i]: e.target.value })); setRowPick((s) => { const n = { ...s }; delete n[i]; return n }); setRowQuery((s) => ({ ...s, [i]: '' })) }} style={fld}>
                            <option value="">— Chọn phòng —</option>
                            {DEPARTMENTS_V2.map((d) => DEPT_PRIMARY_ROLE[d.code] && <option key={d.code} value={DEPT_PRIMARY_ROLE[d.code]}>{d.name}</option>)}
                          </select>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <label className={lbl} style={{ color: 'var(--text-muted)' }}>Nhân sự (tùy chọn)</label>
                          <input value={rowPick[i]?.label || rowQuery[i] || ''} onChange={(e) => { setRowQuery((s) => ({ ...s, [i]: e.target.value })); setRowPick((s) => { const n = { ...s }; delete n[i]; return n }) }} placeholder="Gõ tên…" style={fld} />
                          {us.length > 0 && !rowPick[i] && (
                            <div className="rounded-lg" style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
                              {us.map((u) => <div key={u.id} onClick={() => { setRowPick((s) => ({ ...s, [i]: { userId: u.id, label: u.fullName || u.username || '' } })); setRowQuery((s) => ({ ...s, [i]: '' })) }} className="px-2.5 py-1.5 text-xs cursor-pointer hover:bg-blue-50">{u.fullName || u.username} <span style={{ color: 'var(--text-muted)' }}>· {DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode}</span></div>)}
                            </div>
                          )}
                        </div>
                        <button onClick={() => createTaskFromItem(i)} disabled={busy} className="text-sm px-3 py-2 rounded-lg font-semibold" style={{ background: '#1d4ed8', color: '#fff' }}>+ Tạo task{it.dueDate ? ' (có hạn)' : ''}</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            <button onClick={() => setItems([...items, { noiDung: '', actionBy: '', dueDate: '', remark: '' }])} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>+ Thêm mục hành động</button>
            <div className="flex gap-2 pt-1">
              <button onClick={saveMinutes} disabled={busy} className="text-sm px-4 py-2.5 rounded-lg font-semibold" style={{ background: '#059669', color: '#fff' }}>✓ Lưu biên bản & kết thúc</button>
              <button onClick={doCancel} disabled={busy} className="text-sm px-4 py-2.5 rounded-lg font-semibold" style={{ background: 'var(--surface)', color: '#e63946', border: '1px solid #fecaca' }}>✕ Hủy cuộc họp</button>
            </div>
          </div>
        )}
      </div>

      {/* ══ CỘT PHỤ: người dự ══ */}
      <div className="space-y-4">
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2">👥 Người dự ({m.invites.filter((i) => i.status === 'ACCEPTED').length}/{m.invites.length} đã nhận)</div>
          <div className="space-y-1.5">
            {m.invites.map((i) => {
              const r = RSVP[i.status] || RSVP.INVITED
              return (
                <div key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{i.userName} {i.deptName && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {i.deptName}</span>}</span>
                  <span className="text-xs font-semibold" style={{ color: r.c }}>{r.l}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>{/* /grid 2 cột */}

      {/* RSVP cho người được mời */}
      {myInvite && !isClosed && (
        <div className="sticky bottom-0 py-3" style={{ background: 'var(--bg,#f1f5f9)' }}>
          <div className="text-xs px-1 mb-1.5" style={{ color: 'var(--text-muted)' }}>Phản hồi của bạn: <b style={{ color: (RSVP[myInvite.status] || RSVP.INVITED).c }}>{(RSVP[myInvite.status] || RSVP.INVITED).l}</b></div>
          <div className="flex gap-2">
            <button onClick={() => respond('ACCEPTED')} disabled={busy} className="text-sm px-5 py-3 rounded-xl font-semibold flex-1" style={{ background: '#059669', color: '#fff' }}>✓ Nhận tham gia</button>
            <button onClick={() => respond('DECLINED')} disabled={busy} className="text-sm px-5 py-3 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: '#e63946', border: '1px solid #fecaca' }}>✗ Từ chối</button>
          </div>
        </div>
      )}
    </div>
  )
}
