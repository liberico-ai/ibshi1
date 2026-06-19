'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import MultiFileUpload, { type UploadedFile } from '@/components/MultiFileUpload'

interface Proj { id: string; projectCode: string; projectName: string }
interface Usr { id: string; fullName?: string; username?: string; roleCode: string; department?: { code: string; name: string } | null }
interface Pick { role?: string; userId?: string; label: string }
const deptCodeOfUser = (u: Usr) => ROLE_TO_DEPT[u.roleCode] || u.department?.code || ''
const deptNameOfUser = (u: Usr) => DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.department?.name || u.roleCode
interface Sugg { roleCode: string | null; departmentName: string | null; reason: string }
interface DocReq { key: string; kind: 'MUST_READ' | 'MUST_RETURN'; label: string; fileAttachmentId?: string; fileName?: string }
interface ProjFile { id: string; fileName: string; fileUrl: string; source: string }
const newKey = () => Math.random().toString(36).slice(2, 10)

const TASK_TYPES = [
  { v: 'FREE', l: 'Việc khác' },
  { v: 'P2.1', l: 'Đề xuất / yêu cầu vật tư (Thiết kế)' },
  { v: 'P3.5', l: 'Tìm nhà cung cấp / mua hàng' },
  { v: 'P1.1B', l: 'Yêu cầu phê duyệt' },
  { v: 'P4.3', l: 'Nghiệm thu chất lượng' },
]
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', fontSize: '.88rem', background: '#f8fafc', color: 'var(--text-primary)' }

function CreateInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const parentId = sp.get('parent') || undefined
  const fromId = sp.get('from') || undefined           // "Tạo việc tiếp theo" từ task nguồn (người giao)
  const fromProject = sp.get('project') || ''
  // id nháp ổn định để gom tệp đính kèm trước khi task có id thật
  const [draftId] = useState(() => `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

  const [projects, setProjects] = useState<Proj[]>([])
  const [users, setUsers] = useState<Usr[]>([])
  const [projectId, setProjectId] = useState(fromProject)
  const [taskType, setTaskType] = useState('FREE')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('NORMAL')
  const [deadline, setDeadline] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [sugg, setSugg] = useState<Sugg[]>([])
  const [docs, setDocs] = useState<DocReq[]>([])
  const [projFiles, setProjFiles] = useState<ProjFile[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) })
    apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) })
  }, [])
  // Tải danh sách tài liệu của dự án (cả thư viện dự án + tệp trong các task) để cho chọn
  useEffect(() => {
    if (!projectId) { setProjFiles([]); return }
    apiFetch(`/api/work/project-files?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => { if (r.ok) setProjFiles(r.files || []) })
  }, [projectId])
  // Gợi ý phòng tự tính theo Loại việc + Tiêu đề + Mô tả (debounce)
  useEffect(() => {
    const text = `${title} ${description}`.trim()
    if (taskType === 'FREE' && !text) { setSugg([]); return }
    const h = setTimeout(() => {
      apiFetch(`/api/work/suggest-route?context=${encodeURIComponent(taskType)}&text=${encodeURIComponent(text)}`)
        .then((r) => { if (r.ok) setSugg(r.suggestions || []) })
    }, 400)
    return () => clearTimeout(h)
  }, [taskType, title, description])

  // Giao cấp phòng: chỉ thêm chip "phòng". Khi tạo việc, hệ thống tự gắn TRƯỞNG PHÒNG
  // — TRỪ KHI phòng đó đã có nhân sự cụ thể được chọn (thì bỏ qua trưởng phòng).
  const addRole = (r: string) => {
    if (picks.some((p) => p.role === r)) return
    setPicks((prev) => [...prev, { role: r, label: `🏢 ${DEPT_NAME[ROLE_TO_DEPT[r]] || (ROLES as Record<string, { name: string }>)[r]?.name || r}` }])
  }
  const addUser = (u: Usr) => { if (!picks.some((p) => p.userId === u.id)) setPicks([...picks, { userId: u.id, label: `👤 ${u.fullName || u.username || u.id} (${u.username}) · ${deptNameOfUser(u)}` }]); setUserQuery('') }
  const addDoc = (kind: DocReq['kind']) => setDocs([...docs, { key: newKey(), kind, label: '' }])

  const submit = async () => {
    setError('')
    if (!title.trim()) { setError('Cần nhập tiêu đề'); return }
    if (picks.length === 0) { setError('Cần chọn ít nhất 1 nơi nhận'); return }
    setSubmitting(true)
    const body = {
      title: title.trim(), description: description.trim() || undefined,
      projectId: projectId || undefined, parentId, taskType, priority,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      assignees: picks.map((p, i) => ({ role: p.role, userId: p.userId, isPrimary: i === 0 })),
      docs: docs.filter((d) => d.label.trim()).map((d) => ({ kind: d.kind, label: d.label.trim(), fileAttachmentId: d.fileAttachmentId, key: d.key })),
      draftId,
      forwardedFromId: fromId, // liên kết truy vết "việc tiếp theo"
    }
    const url = parentId ? `/api/work/tasks/${parentId}/subtasks` : '/api/work/tasks'
    const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) })
    if (res.ok) {
      // Tạo việc tiếp theo từ 1 task đang chờ kết thúc → đồng thời kết thúc task nguồn
      if (fromId) await apiFetch(`/api/work/tasks/${fromId}/finalize`, { method: 'POST', body: '{}' }).catch(() => {})
      setSubmitting(false)
      // Quay về đúng ngữ cảnh: việc con → việc cha; việc tiếp theo → task nguồn; còn lại → hộp việc
      router.push(parentId ? `/dashboard/work/${parentId}` : fromId ? `/dashboard/work/${fromId}` : '/dashboard/work')
    } else { setSubmitting(false); setError(res.error || 'Lỗi tạo việc') }
  }

  // Khoanh vùng tìm nhân sự theo phòng đã chọn (nếu có)
  const selectedDeptCodes = picks.filter((p) => p.role).map((p) => ROLE_TO_DEPT[p.role!]).filter(Boolean)
  const filteredUsers = userQuery.trim()
    ? users
        .filter((u) => (u.fullName || u.username || '').toLowerCase().includes(userQuery.toLowerCase()))
        .filter((u) => selectedDeptCodes.length === 0 || selectedDeptCodes.includes(deptCodeOfUser(u)))
        .filter((u) => !picks.some((p) => p.userId === u.id))
        .slice(0, 8)
    : []

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{parentId ? '+ Tạo việc con' : fromId ? '+ Tạo việc tiếp theo' : '+ Tạo việc mới'}</h1>

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>① Dự án & nội dung</h3>
        <div className="space-y-3">
          <div><label className="text-sm font-semibold">Dự án</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inp}>
              <option value="">(Không thuộc dự án)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold">Loại việc</label>
            <select value={taskType} onChange={(e) => setTaskType(e.target.value)} style={inp}>
              {TASK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select></div>
          <div><label className="text-sm font-semibold">Tiêu đề *</label><input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} placeholder="VD: Đề xuất vật tư hàn cho dầm I" /></div>
          <div><label className="text-sm font-semibold">Mô tả</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inp, minHeight: 70 }} /></div>
        </div>
      </div>

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>② Chuyển việc đến ai?</h3>
        {sugg.length > 0 && (
          <div className="rounded-lg p-3 mb-3" style={{ background: 'linear-gradient(135deg,#eff6ff,#f5f3ff)', border: '1px dashed #93c5fd' }}>
            <div className="text-xs font-bold mb-2" style={{ color: '#1d4ed8' }}>✨ Gợi ý phòng ban (từ quy trình cũ)</div>
            {sugg.map((s, i) => s.roleCode && (
              <button key={i} onClick={() => addRole(s.roleCode!)} className="text-xs mr-2 mb-2 px-3 py-1.5 rounded-full font-semibold"
                style={{ background: '#fff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>
                + {s.departmentName || (ROLES as Record<string, { name: string }>)[s.roleCode]?.name} <span style={{ opacity: .7, fontWeight: 400 }}>({s.reason})</span>
              </button>
            ))}
          </div>
        )}
        <div className="mb-2">{picks.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-2 text-sm mr-2 mb-2 px-3 py-1.5 rounded-full" style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe' }}>
            {p.label} <span className="cursor-pointer opacity-60" onClick={() => setPicks(picks.filter((_, idx) => idx !== i))}>✕</span>
          </span>
        ))}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>Thêm theo phòng/role</label>
            <select onChange={(e) => { if (e.target.value) addRole(e.target.value); e.target.value = '' }} style={inp}>
              <option value="">— Chọn phòng/role —</option>
              {Object.entries(ROLES).map(([code, r]) => <option key={code} value={code}>{(r as { name: string }).name} ({code})</option>)}
            </select></div>
          <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Thêm theo nhân sự{selectedDeptCodes.length > 0 && <span style={{ color: 'var(--accent,#e63946)' }}> · trong {selectedDeptCodes.map((d) => DEPT_NAME[d] || d).join(', ')}</span>}
            </label>
            <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} style={inp}
              placeholder={selectedDeptCodes.length > 0 ? 'Gõ tên (trong phòng đã chọn)…' : 'Gõ tên nhân sự…'} />
            {userQuery.trim() && filteredUsers.length === 0 && (
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Không thấy nhân sự{selectedDeptCodes.length > 0 ? ' trong phòng đã chọn' : ''}.</div>
            )}
            {filteredUsers.length > 0 && (
              <div className="rounded-lg mt-1" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                {filteredUsers.map((u) => (
                  <div key={u.id} onClick={() => addUser(u)} className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50">
                    {u.fullName || u.username} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({u.username}) · {deptNameOfUser(u)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>③ Thời hạn & tài liệu</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div><label className="text-sm font-semibold">Deadline</label><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inp} /></div>
          <div><label className="text-sm font-semibold">Ưu tiên</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inp}><option value="NORMAL">Bình thường</option><option value="HIGH">Cao</option><option value="URGENT">Khẩn</option></select></div>
        </div>
        {/* Thêm nhanh NHIỀU tài liệu phải đọc từ kho tài liệu dự án (chọn lần lượt, mỗi cái thành 1 mục) */}
        {projectId && projFiles.length > 0 && (
          <div className="mb-3 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px dashed var(--border)' }}>
            <label className="text-xs font-semibold" style={{ color: '#1d4ed8' }}>📎 Thêm tài liệu phải đọc từ dự án (chọn được nhiều)</label>
            <select value="" onChange={(e) => {
              const f = projFiles.find((x) => x.id === e.target.value)
              if (f) setDocs((prev) => prev.some((d) => d.fileAttachmentId === f.id) ? prev : [...prev, { key: newKey(), kind: 'MUST_READ', label: f.fileName, fileAttachmentId: f.id, fileName: f.fileName }])
              e.target.value = ''
            }} style={{ ...inp, marginTop: 4 }}>
              <option value="">— Chọn tài liệu để thêm —</option>
              {projFiles.map((f) => <option key={f.id} value={f.id} disabled={docs.some((d) => d.fileAttachmentId === f.id)}>{f.source === 'project' ? '📁' : '📄'} {f.fileName}{docs.some((d) => d.fileAttachmentId === f.id) ? ' (đã thêm)' : ''}</option>)}
            </select>
          </div>
        )}
        {docs.map((d, i) => (
          <div key={d.key} className="mb-3 rounded-lg p-2" style={{ border: '1px solid var(--border)' }}>
            <div className="flex gap-2 items-center">
              <span className="text-xs px-2 py-1 rounded" style={{ background: d.kind === 'MUST_READ' ? '#eff6ff' : '#ecfdf5', color: d.kind === 'MUST_READ' ? '#1d4ed8' : '#059669' }}>{d.kind === 'MUST_READ' ? '📖 Phải đọc' : '📤 Phải trả'}</span>
              <input value={d.label} onChange={(e) => setDocs((prev) => prev.map((x) => x.key === d.key ? { ...x, label: e.target.value } : x))} style={inp} placeholder="Tên tài liệu/thông tin" />
              <span className="cursor-pointer" style={{ color: '#e63946' }} onClick={() => setDocs(docs.filter((x) => x.key !== d.key))}>✕</span>
            </div>
            {d.kind === 'MUST_READ' && (
              <div className="mt-2">
                {d.fileName && <div className="text-xs mb-1" style={{ color: '#059669' }}>✓ Đã gắn: {d.fileName}</div>}
                <MultiFileUpload label="" entityType="TaskDoc" entityId={`${draftId}__${d.key}`} compact
                  onUploaded={(f: UploadedFile) => setDocs((prev) => {
                    const idx = prev.findIndex((x) => x.key === d.key)
                    // Dòng chưa có tệp → gắn vào dòng này; đã có tệp → tách thành mục mới (cho phép nhiều tệp)
                    if (idx >= 0 && !prev[idx].fileAttachmentId) {
                      const n = [...prev]; n[idx] = { ...n[idx], fileAttachmentId: f.id, fileName: f.fileName, label: n[idx].label.trim() || f.fileName }; return n
                    }
                    return [...prev, { key: newKey(), kind: 'MUST_READ', label: f.fileName, fileAttachmentId: f.id, fileName: f.fileName }]
                  })} />
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Tải 1 hoặc nhiều tệp — mỗi tệp thành 1 mục phải đọc.</div>
              </div>
            )}
          </div>
        ))}
        <div className="flex gap-2 mt-1">
          <button onClick={() => addDoc('MUST_READ')} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>+ Tài liệu phải đọc</button>
          <button onClick={() => addDoc('MUST_RETURN')} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>+ Tài liệu phải trả lại</button>
        </div>
      </div>

      {error && <div className="text-sm" style={{ color: '#e63946' }}>{error}</div>}
      <div className="flex gap-2">
        <button onClick={() => router.push(parentId ? `/dashboard/work/${parentId}` : fromId ? `/dashboard/work/${fromId}` : '/dashboard/work')} className="text-sm px-4 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
        <button onClick={submit} disabled={submitting} className="btn-primary text-sm px-5 py-2.5 rounded-lg flex-1" style={{ opacity: submitting ? .6 : 1 }}>{submitting ? '...Đang tạo' : '✓ Tạo & Giao việc'}</button>
      </div>
    </div>
  )
}

export default function CreateWorkPage() {
  return <Suspense fallback={<div className="p-6">Đang tải…</div>}><CreateInner /></Suspense>
}
