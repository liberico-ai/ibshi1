'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES, canEditForm, type FormKey } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'
import MultiFileUpload, { type UploadedFile } from '@/components/MultiFileUpload'
import { CheckCircle2 } from 'lucide-react'
import { TEMPLATES, type TemplateType } from '@/components/TemplateSelector'
import TemplateSelector from '@/components/TemplateSelector'
import { REVISE_TYPE_MAP } from '@/lib/revise-map'

const FF_REVISE = process.env.NEXT_PUBLIC_FF_REVISE_FLOW === 'true'
const REVISE_OPTS = Object.entries(REVISE_TYPE_MAP)

interface Proj { id: string; projectCode: string; projectName: string }
interface Usr { id: string; fullName?: string; username?: string; roleCode: string; isActive?: boolean; department?: { code: string; name: string } | null }
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
const sectionStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)' }

// ── Stepper bar ──
function Stepper({ step, hasTemplate }: { step: number; hasTemplate: boolean }) {
  if (!hasTemplate) return null
  const steps = [
    { n: 1, label: 'Nội dung' },
    { n: 2, label: 'Nhập biểu mẫu' },
    { n: 3, label: 'Giao việc' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 8 }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : undefined }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20,
            background: step === s.n ? '#1d4ed8' : step > s.n ? '#059669' : 'var(--bg-secondary)',
            color: step >= s.n ? '#fff' : 'var(--text-muted)',
            fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {step > s.n ? '✓' : s.n}
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, background: step > s.n ? '#059669' : 'var(--border)', margin: '0 4px' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function CreateInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const parentId = sp.get('parent') || undefined
  const fromId = sp.get('from') || undefined
  const fromProject = sp.get('project') || ''
  const [draftId] = useState(() => `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

  const [reviseType, setReviseType] = useState('')
  const [reviseBusy, setReviseBusy] = useState(false)
  const [elig, setElig] = useState<{ eligible: boolean; reason?: string; templateName?: string } | null>(null)
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
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>(null)
  const roleCode = useAuthStore(s => s.user?.roleCode || '')
  const userId = useAuthStore(s => s.user?.id || '')
  const allowedTemplates = TEMPLATES.filter(t => canEditForm(t.value as FormKey, roleCode))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // ── Stepper state (when template selected) ──
  // phase 1 = form fill, phase 2 = upload template, phase 3 = reassign
  const [phase, setPhase] = useState(1)
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null)
  const [savedPicks, setSavedPicks] = useState<Pick[]>([])
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    apiFetch('/api/projects/options').then((r) => { if (r.ok) setProjects(r.projects || []) })
    apiFetch('/api/users').then((r) => { if (r.ok) setUsers(r.users || []) })
  }, [])

  // Guard fork Revise (FF ON): dự án có mở được vòng revise không → tránh throw lỗi kỹ thuật cho user.
  useEffect(() => {
    if (!FF_REVISE || !projectId) { setElig(null); return }
    let alive = true
    apiFetch(`/api/work/revise/eligibility?projectId=${encodeURIComponent(projectId)}`).then((r) => {
      if (alive) setElig(r.ok ? { eligible: !!r.eligible, reason: r.reason, templateName: r.templateName } : { eligible: false, reason: r.error || 'Không kiểm tra được dự án' })
    })
    return () => { alive = false }
  }, [projectId])

  useEffect(() => {
    if (!projectId) { setProjFiles([]); return }
    apiFetch(`/api/work/project-files?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => { if (r.ok) setProjFiles(r.files || []) })
  }, [projectId])

  useEffect(() => {
    const text = `${title} ${description}`.trim()
    if (taskType === 'FREE' && !text) { setSugg([]); return }
    const h = setTimeout(() => {
      apiFetch(`/api/work/suggest-route?context=${encodeURIComponent(taskType)}&text=${encodeURIComponent(text)}`)
        .then((r) => { if (r.ok) setSugg(r.suggestions || []) })
    }, 400)
    return () => clearTimeout(h)
  }, [taskType, title, description])

  // Warn if leaving during phase 2 (uploaded data but not yet assigned)
  useEffect(() => {
    if (phase !== 2) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [phase])

  const addRole = useCallback((r: string) => {
    setPicks((prev) => prev.some((p) => p.role === r) ? prev : [...prev, { role: r, label: `${DEPT_NAME[ROLE_TO_DEPT[r]] || (ROLES as Record<string, { name: string }>)[r]?.name || r}` }])
  }, [])
  const addUser = useCallback((u: Usr) => {
    setPicks((prev) => prev.some((p) => p.userId === u.id) ? prev : [...prev, { userId: u.id, label: `${u.fullName || u.username || u.id} (${u.username}) · ${deptNameOfUser(u)}` }])
    setUserQuery('')
  }, [])
  const addDoc = (kind: DocReq['kind']) => setDocs([...docs, { key: newKey(), kind, label: '' }])

  // ── Submit: no template = 1-step; with template = create assigned to self, then phase 2 ──
  const submit = async () => {
    setError('')
    if (!title.trim()) { setError('Cần nhập tiêu đề'); return }
    if (picks.length === 0) { setError('Cần chọn ít nhất 1 nơi nhận'); return }
    setSubmitting(true)

    const docsPayload = docs.filter((d) => d.label.trim()).map((d) => ({ kind: d.kind, label: d.label.trim(), fileAttachmentId: d.fileAttachmentId, key: d.key }))

    if (!selectedTemplate) {
      // ── 1-step: create and assign directly ──
      const body = {
        title: title.trim(), description: description.trim() || undefined,
        projectId: projectId || undefined, parentId, taskType, priority,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        assignees: picks.map((p, i) => ({ role: p.role, userId: p.userId, isPrimary: i === 0 })),
        docs: docsPayload, draftId, forwardedFromId: fromId,
      }
      const url = parentId ? `/api/work/tasks/${parentId}/subtasks` : '/api/work/tasks'
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) })
      setSubmitting(false)
      if (res.ok) {
        if (fromId) await apiFetch(`/api/work/tasks/${fromId}/finalize`, { method: 'POST', body: '{}' }).catch(() => {})
        router.push(parentId ? `/dashboard/work/${parentId}` : fromId ? `/dashboard/work/${fromId}` : '/dashboard/work')
      } else { setError(res.error || 'Lỗi tạo việc') }
      return
    }

    // ── With template: create assigned to SELF, enter phase 2 ──
    setSavedPicks([...picks])
    const body = {
      title: title.trim(), description: description.trim() || undefined,
      projectId: projectId || undefined, parentId, taskType, priority,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      assignees: [{ userId, isPrimary: true }],
      docs: docsPayload, draftId, forwardedFromId: fromId,
      template: selectedTemplate,
    }
    const url = parentId ? `/api/work/tasks/${parentId}/subtasks` : '/api/work/tasks'
    const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) })
    setSubmitting(false)
    if (res.ok) {
      if (fromId) await apiFetch(`/api/work/tasks/${fromId}/finalize`, { method: 'POST', body: '{}' }).catch(() => {})
      setCreatedTaskId(res.task.id)
      setPhase(2)
    } else { setError(res.error || 'Lỗi tạo việc') }
  }

  // ── Phase 3: reassign to intended recipients ──
  const doReassign = async () => {
    if (!createdTaskId || savedPicks.length === 0) return
    setAssigning(true)
    const res = await apiFetch(`/api/work/tasks/${createdTaskId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({
        assignees: savedPicks.map((p, i) => ({ role: p.role, userId: p.userId, isPrimary: i === 0 })),
        note: 'Giao việc sau khi nhập biểu mẫu',
      }),
    })
    setAssigning(false)
    if (res.ok) {
      setPhase(3)
      setTimeout(() => router.push(`/dashboard/work/${createdTaskId}`), 600)
    } else { setError(res.error || 'Lỗi giao việc') }
  }

  // ── Derived ──
  const selectedDeptCodes = picks.filter((p) => p.role).map((p) => ROLE_TO_DEPT[p.role!]).filter(Boolean)
  const filteredUsers = userQuery.trim()
    ? users
        .filter((u) => u.isActive !== false)
        .filter((u) => (u.fullName || u.username || '').toLowerCase().includes(userQuery.toLowerCase()))
        .filter((u) => selectedDeptCodes.length === 0 || selectedDeptCodes.includes(deptCodeOfUser(u)))
        .filter((u) => !picks.some((p) => p.userId === u.id))
        .slice(0, 8)
    : []
  const selectedProj = projects.find(p => p.id === projectId)

  // ════════════════════════════════════════════════════════
  // PHASE 2: Upload biểu mẫu
  // ════════════════════════════════════════════════════════
  if (phase >= 2 && createdTaskId) {
    const tplInfo = TEMPLATES.find(t => t.value === selectedTemplate)
    return (
      <div className="animate-fade-in" style={{ maxWidth: 920, margin: '0 auto' }}>
        <Stepper step={phase} hasTemplate />

        {phase === 2 && (
          <>
            <div className="rounded-xl p-4 mb-4" style={{ background: '#eff6ff', border: '1px solid #93c5fd' }}>
              <div className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>
                {tplInfo?.icon} Nhập biểu mẫu: {tplInfo?.label}
              </div>
              <div className="text-xs mt-1" style={{ color: '#1e40af' }}>
                Upload và nhập dữ liệu bên dưới. Khi xong, bấm &quot;Giao việc&quot; để chuyển cho người xử lý.
              </div>
            </div>

            <TemplateSelector
              taskId={createdTaskId}
              isEditable
              projectCode={selectedProj?.projectCode}
              project={selectedProj}
              projectId={projectId || undefined}
              taskTitle={title}
              initialTemplate={selectedTemplate}
            />

            {error && <div className="text-sm mt-3" style={{ color: 'var(--danger)' }}>{error}</div>}

            <div className="flex gap-3 mt-4" style={{ position: 'sticky', bottom: 0, padding: '12px 0', background: 'var(--bg-primary)', zIndex: 10 }}>
              <button
                onClick={() => router.push(`/dashboard/work/${createdTaskId}`)}
                className="text-sm px-4 py-2.5 rounded-lg"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                Để sau
              </button>
              <button
                onClick={doReassign}
                disabled={assigning}
                className="btn-primary text-sm px-6 py-2.5 rounded-lg flex-1 font-semibold"
                style={{ opacity: assigning ? 0.6 : 1 }}
              >
                {assigning ? '...Đang giao' : `② Giao việc cho ${savedPicks.map(p => p.label).join(', ')}`}
              </button>
            </div>
          </>
        )}

        {phase === 3 && (
          <div className="rounded-xl p-6 text-center" style={{ ...sectionStyle }}>
            <div style={{ marginBottom: 8 }}><CheckCircle2 size={36} style={{ color: '#16a34a' }} /></div>
            <div className="font-semibold" style={{ color: '#059669' }}>Đã tạo việc và giao thành công!</div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Đang chuyển đến chi tiết công việc…</div>
          </div>
        )}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════
  // PHASE 1: Form tạo việc
  // ════════════════════════════════════════════════════════
  return (
    <div className="animate-fade-in" style={{ maxWidth: 920, margin: '0 auto' }}>
      <h1 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        {parentId ? '+ Tạo việc con' : fromId ? '+ Tạo việc tiếp theo' : '+ Tạo việc mới'}
      </h1>

      {/* Fork Revise Flow36 (khi FF ON): [1] Revise theo 12 loại → mở vòng revise; [2] Việc khác → form dưới. */}
      {FF_REVISE && (
        <div className="rounded-xl p-4 mb-4" style={{ border: '1px solid #c7d2fe', background: '#eef2ff' }}>
          <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 8 }}>Đây là REVISE (đổi thiết kế/BOM/dự toán…)?</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={reviseType} onChange={(e) => setReviseType(e.target.value)} style={{ ...inp, maxWidth: 420 }}>
              <option value="">— Chọn loại revise (12) —</option>
              {REVISE_OPTS.map(([k, v]) => <option key={k} value={k}>{v.label} → vào {v.entryStepCode} ({v.ownerRole})</option>)}
            </select>
            {(() => {
              const ok = !!reviseType && !!projectId && !!elig?.eligible
              return (
                <button
                  disabled={!ok || reviseBusy}
                  onClick={async () => {
                    if (!ok) return
                    setReviseBusy(true)
                    const res = await apiFetch('/api/work/tasks', { method: 'POST', body: JSON.stringify({ reviseType, projectId }) })
                    setReviseBusy(false)
                    if (res.ok) router.push(`/dashboard/work/revise?projectId=${encodeURIComponent(projectId)}&round=${res.revise?.round ?? ''}`)
                    else alert(res.error || 'Không mở được vòng revise')
                  }}
                  style={{ background: ok ? '#4f46e5' : '#c7c7c7', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: '.83rem', fontWeight: 700, cursor: ok && !reviseBusy ? 'pointer' : 'not-allowed' }}
                >{reviseBusy ? 'Đang mở…' : 'Mở vòng revise'}</button>
              )
            })()}
            <span style={{ fontSize: '.75rem', color: 'var(--text-secondary)' }}>{!projectId ? 'Chọn dự án ở dưới trước' : elig === null ? 'Đang kiểm tra dự án…' : ''}</span>
          </div>
          {/* Guard: dự án legacy (không template) → cảnh báo thân thiện, KHÔNG cho mở round */}
          {projectId && elig && !elig.eligible && (
            <div style={{ fontSize: '.78rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
              ⚠ {elig.reason || 'Dự án này chưa mở được vòng revise.'}
            </div>
          )}
          {projectId && elig?.eligible && elig.templateName && (
            <div style={{ fontSize: '.75rem', color: '#15803d', marginTop: 6 }}>✓ Quy trình: <b>{elig.templateName}</b> — mở vòng revise được.</div>
          )}
          <div style={{ fontSize: '.75rem', color: 'var(--text-secondary)', marginTop: 6 }}>Hoặc để tạo <b>việc khác</b> (không theo quy trình), điền form bên dưới.</div>
        </div>
      )}

      <Stepper step={1} hasTemplate={!!selectedTemplate} />

      <div className="space-y-4">
        {/* ── ① Nội dung công việc ── */}
        <div className="rounded-xl p-5" style={sectionStyle}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-heading)' }}>① Nội dung công việc</h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold">Dự án</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inp}>
                <option value="">(Không thuộc dự án)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold">Loại việc</label>
              {/* Việc động (FREE) KHÔNG gắn biểu mẫu → bỏ chọn template ngay khi đổi sang FREE (tránh set-state-in-effect). */}
              <select value={taskType} onChange={(e) => { const v = e.target.value; setTaskType(v); if (v === 'FREE') setSelectedTemplate(null) }} style={inp}>
                {TASK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold">Tiêu đề *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} placeholder="VD: Đề xuất vật tư hàn cho dầm I" />
            </div>
            <div>
              <label className="text-sm font-semibold">Mô tả</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inp, minHeight: 70 }} />
            </div>
          </div>
        </div>

        {/* ── ② Biểu mẫu (tuỳ chọn) — CHỈ hiện cho loại việc bước-cố-định; việc động (FREE/"Việc khác") ẩn ── */}
        {taskType !== 'FREE' && (allowedTemplates.length === 0 ? (
          <div className="rounded-xl p-4" style={sectionStyle}>
            <h3 className="font-semibold mb-1" style={{ color: 'var(--text-heading)', margin: 0 }}>② Biểu mẫu (tuỳ chọn)</h3>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              (Vai trò của bạn không có biểu mẫu để đính kèm — tạo việc thường, người xử lý sẽ chọn biểu mẫu phù hợp)
            </div>
          </div>
        ) : (
          <div className="rounded-xl p-5" style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 className="font-semibold" style={{ color: 'var(--text-heading)', margin: 0 }}>② Biểu mẫu (tuỳ chọn)</h3>
              {selectedTemplate && (
                <button onClick={() => setSelectedTemplate(null)} className="text-xs px-2.5 py-1 rounded-lg"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', background: 'none' }}>
                  ✕ Bỏ chọn
                </button>
              )}
            </div>
            <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Chỉ hiện biểu mẫu bạn được phép điền. Chọn để mở sẵn và upload sau khi tạo việc.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {allowedTemplates.map((t) => {
                const active = selectedTemplate === t.value
                return (
                  <button key={t.value} onClick={() => setSelectedTemplate(active ? null : t.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 10,
                      border: active ? '2px solid #2563eb' : '1px solid var(--border)',
                      background: active ? '#eff6ff' : 'var(--bg-secondary)',
                      cursor: 'pointer', transition: 'all 0.15s',
                      minHeight: 56,
                    }}>
                    <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{t.icon}</span>
                    <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: active ? '#1d4ed8' : 'var(--text-primary)' }}>{t.label}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{t.desc}</div>
                    </div>
                    {active && <span style={{ fontSize: '1rem', color: '#2563eb', flexShrink: 0 }}>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* ── ③ Thời hạn & tài liệu ── */}
        <div className="rounded-xl p-5" style={sectionStyle}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-heading)' }}>{taskType === 'FREE' ? '②' : '③'} Thời hạn & tài liệu</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-sm font-semibold">Deadline</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inp} />
            </div>
            <div>
              <label className="text-sm font-semibold">Ưu tiên</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inp}>
                <option value="NORMAL">Bình thường</option>
                <option value="HIGH">Cao</option>
                <option value="URGENT">Khẩn</option>
              </select>
            </div>
          </div>

          {projectId && projFiles.length > 0 && (
            <div className="mb-3 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px dashed var(--border)' }}>
              <label className="text-xs font-semibold" style={{ color: '#1d4ed8' }}>Thêm tài liệu phải đọc từ dự án (chọn được nhiều)</label>
              <select value="" onChange={(e) => {
                const f = projFiles.find((x) => x.id === e.target.value)
                if (f) setDocs((prev) => prev.some((d) => d.fileAttachmentId === f.id) ? prev : [...prev, { key: newKey(), kind: 'MUST_READ', label: f.fileName, fileAttachmentId: f.id, fileName: f.fileName }])
                e.target.value = ''
              }} style={{ ...inp, marginTop: 4 }}>
                <option value="">— Chọn tài liệu để thêm —</option>
                {projFiles.map((f) => <option key={f.id} value={f.id} disabled={docs.some((d) => d.fileAttachmentId === f.id)}>{f.fileName}{docs.some((d) => d.fileAttachmentId === f.id) ? ' (đã thêm)' : ''}</option>)}
              </select>
            </div>
          )}

          {docs.map((d) => (
            <div key={d.key} className="mb-3 rounded-lg p-2" style={{ border: '1px solid var(--border)' }}>
              <div className="flex gap-2 items-center">
                <span className="text-xs px-2 py-1 rounded" style={{ background: d.kind === 'MUST_READ' ? '#eff6ff' : '#ecfdf5', color: d.kind === 'MUST_READ' ? '#1d4ed8' : '#059669' }}>
                  {d.kind === 'MUST_READ' ? 'Phải đọc' : 'Phải trả'}
                </span>
                <input value={d.label} onChange={(e) => setDocs((prev) => prev.map((x) => x.key === d.key ? { ...x, label: e.target.value } : x))} style={inp} placeholder="Tên tài liệu/thông tin" />
                <span className="cursor-pointer" style={{ color: 'var(--danger)' }} onClick={() => setDocs(docs.filter((x) => x.key !== d.key))}>✕</span>
              </div>
              {d.kind === 'MUST_READ' && (
                <div className="mt-2">
                  {d.fileName && <div className="text-xs mb-1" style={{ color: '#059669' }}>✓ Đã gắn: {d.fileName}</div>}
                  <MultiFileUpload label="" entityType="TaskDoc" entityId={`${draftId}__${d.key}`} compact
                    onUploaded={(f: UploadedFile) => setDocs((prev) => {
                      const idx = prev.findIndex((x) => x.key === d.key)
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

        {/* ── ④ Giao cho ai ── */}
        <div className="rounded-xl p-5" style={sectionStyle}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--text-heading)' }}>{taskType === 'FREE' ? '③' : '④'} Giao cho ai?</h3>
          {sugg.length > 0 && (
            <div className="rounded-lg p-3 mb-3" style={{ background: 'linear-gradient(135deg,#eff6ff,#f5f3ff)', border: '1px dashed #93c5fd' }}>
              <div className="text-xs font-bold mb-2" style={{ color: '#1d4ed8' }}>Gợi ý phòng ban</div>
              {sugg.map((s, i) => s.roleCode && (
                <button key={i} onClick={() => addRole(s.roleCode!)} className="text-xs mr-2 mb-2 px-3 py-1.5 rounded-full font-semibold"
                  style={{ background: '#fff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>
                  + {s.departmentName || (ROLES as Record<string, { name: string }>)[s.roleCode]?.name}
                  <span style={{ opacity: .7, fontWeight: 400 }}> ({s.reason})</span>
                </button>
              ))}
            </div>
          )}
          <div className="mb-2">
            {picks.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-2 text-sm mr-2 mb-2 px-3 py-1.5 rounded-full" style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe' }}>
                {p.label} <span className="cursor-pointer opacity-60" onClick={() => setPicks(picks.filter((_, idx) => idx !== i))}>✕</span>
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Thêm theo phòng/role</label>
              <select onChange={(e) => { if (e.target.value) addRole(e.target.value); e.target.value = '' }} style={inp}>
                <option value="">— Chọn phòng/role —</option>
                {Object.entries(ROLES).map(([code, r]) => <option key={code} value={code}>{(r as { name: string }).name} ({code})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Thêm theo nhân sự{selectedDeptCodes.length > 0 && <span style={{ color: 'var(--ibs-red)' }}> · trong {selectedDeptCodes.map((d) => DEPT_NAME[d] || d).join(', ')}</span>}
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
      </div>

      {/* ── Action bar ── */}
      {error && <div className="text-sm mt-3" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="flex gap-3 mt-4" style={{ position: 'sticky', bottom: 0, padding: '12px 0', background: 'var(--bg-primary)', zIndex: 10 }}>
        <button
          onClick={() => router.push(parentId ? `/dashboard/work/${parentId}` : fromId ? `/dashboard/work/${fromId}` : '/dashboard/work')}
          className="text-sm px-4 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}
        >
          Hủy
        </button>
        <button
          onClick={submit} disabled={submitting}
          className="btn-primary text-sm px-6 py-2.5 rounded-lg flex-1 font-semibold"
          style={{ opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? '...Đang tạo'
            : selectedTemplate
              ? `① Tạo việc & nhập biểu mẫu`
              : '✓ Tạo & Giao việc'}
        </button>
      </div>
    </div>
  )
}

export default function CreateWorkPage() {
  return <Suspense fallback={<div className="p-6">Đang tải…</div>}><CreateInner /></Suspense>
}
