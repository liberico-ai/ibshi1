'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, Button, Badge, EmptyState, Pagination } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Inbox } from 'lucide-react'

interface Task {
  id: string; title: string; status: string; priority: string; deadline: string | null; taskType: string
  blocked: boolean; submittedAt: string | null
  project: { projectCode: string; projectName: string } | null
  assigneeNames: string[]; createdByName: string; needsMyReview: boolean; _count: { children: number; docs: number }
  createdBy?: string
  assignees?: { done: boolean }[]
  resultData?: { changeRequest?: { status: string; type: string; reason: string } } | null
}
interface Proj { id: string; projectCode: string; projectName: string }

const TABS = [
  { key: 'assigned', label: 'Được giao cho tôi' },
  { key: 'review', label: 'Chờ tôi kết thúc' },
  { key: 'created', label: 'Tôi tạo' },
  { key: 'dept', label: 'Phòng tôi' },
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'done', label: 'Đã xong' },
]
const ST: Record<string, { l: string; variant: 'info' | 'success' | 'warning' | 'danger' | 'default' }> = {
  OPEN: { l: 'Mới', variant: 'default' },
  IN_PROGRESS: { l: 'Đang xử lý', variant: 'info' },
  AWAITING_REVIEW: { l: 'Chờ kết thúc', variant: 'warning' },
  RETURNED: { l: 'Bị trả lại', variant: 'danger' },
  DONE: { l: 'Hoàn thành', variant: 'success' },
}

const DAY_MS = 86400000
const REVIEW_GRACE = 2

function startOfDay(d: Date | string | number): number {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime()
}

function dueInfo(d: string | null, status: string) {
  if (!d || status === 'DONE' || status === 'CANCELLED') return null
  const dlDay = startOfDay(d)
  const todayDay = startOfDay(Date.now())
  const days = Math.round((dlDay - todayDay) / DAY_MS)
  if (days < 0) return { txt: `Quá hạn ${-days} ngày`, over: true }
  if (days === 0) return { txt: 'Hết hạn hôm nay', over: true }
  return { txt: `Còn ${days} ngày`, over: false }
}

function isDoerOverdue(t: Task): boolean {
  if (!t.deadline) return false
  const doerStatuses = ['OPEN', 'IN_PROGRESS', 'RETURNED']
  if (!doerStatuses.includes(t.status)) return false
  return startOfDay(Date.now()) > startOfDay(t.deadline)
}

function reviewDueDateMs(t: Task): number | null {
  if (t.status !== 'AWAITING_REVIEW' || !t.deadline) return null
  const dl = startOfDay(t.deadline)
  const submitted = t.submittedAt ? startOfDay(t.submittedAt) + REVIEW_GRACE * DAY_MS : dl
  return Math.max(dl, submitted)
}

function isReviewLate(t: Task): boolean {
  if (t.status !== 'AWAITING_REVIEW') return false
  const due = reviewDueDateMs(t)
  if (due == null) return false
  return startOfDay(Date.now()) > due
}

function reviewDaysLate(t: Task): number {
  const due = reviewDueDateMs(t)
  if (due == null) return 0
  const diff = startOfDay(Date.now()) - due
  return diff > 0 ? Math.ceil(diff / DAY_MS) : 0
}

type TabKey = 'assigned' | 'review' | 'created' | 'dept' | 'overdue' | 'done'

export default function WorkInboxPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('assigned')
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState<Proj[]>([])
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})

  useEffect(() => { apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) }) }, [])
  const loadCounts = useCallback(() => {
    Promise.all(TABS.map((t) => apiFetch(`/api/work/inbox?tab=${t.key}&page=1`).then((r) => ({ key: t.key, count: r.ok ? r.pagination?.total || 0 : 0 }))))
      .then((results) => { const m: Record<string, number> = {}; results.forEach((r) => { m[r.key] = r.count }); setTabCounts(m) })
  }, [])
  useEffect(() => { loadCounts() }, [loadCounts])
  const load = useCallback(() => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ tab, page: String(page) })
    if (q.trim()) params.set('q', q.trim())
    if (projectId) params.set('projectId', projectId)
    apiFetch(`/api/work/inbox?${params.toString()}`).then((r) => {
      if (r.ok) { setTasks(r.tasks); setTotal(r.pagination.total); setTotalPages(r.pagination.totalPages) }
      else { setTasks([]); setTotal(0); setError(r.error || 'Không tải được danh sách việc') }
      setLoading(false)
    })
  }, [tab, page, q, projectId])
  useEffect(() => { load() }, [load])
  useEffect(() => { const iv = setInterval(load, 30000); return () => clearInterval(iv) }, [load])
  useEffect(() => { setPage(1) }, [tab, q, projectId])

  // Yêu cầu chỉnh sửa (gửi cho Quản trị hệ thống)
  const [crTask, setCrTask] = useState<Task | null>(null)
  const [crType, setCrType] = useState<'DELETE' | 'EDIT_ASSIGNEES'>('EDIT_ASSIGNEES')
  const [crReason, setCrReason] = useState('')
  const [crBusy, setCrBusy] = useState(false)
  const crAnyDone = !!crTask?.assignees?.some((a) => a.done)
  const openCr = (t: Task) => { setCrTask(t); setCrType(t.assignees?.some((a) => a.done) ? 'EDIT_ASSIGNEES' : 'DELETE'); setCrReason('') }
  const submitCr = async () => {
    if (!crTask || !crReason.trim()) return
    setCrBusy(true)
    const res = await apiFetch(`/api/work/tasks/${crTask.id}/change-request`, { method: 'POST', body: JSON.stringify({ type: crType, reason: crReason.trim() }) })
    setCrBusy(false)
    if (res.ok) { setCrTask(null); setCrReason(''); load() } else alert(res.error || 'Lỗi gửi yêu cầu')
  }

  const showCreator = tab === 'assigned' || tab === 'overdue'
  const showAssignees = tab === 'created' || tab === 'dept' || tab === 'review' || tab === 'done'

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Hộp việc của tôi"
        subtitle={`${total} việc`}
        actions={<Button variant="primary" onClick={() => router.push('/dashboard/work/create')}>+ Tạo việc</Button>}
      />

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => {
          const cnt = tabCounts[t.key]
          const active = tab === t.key
          const isOverdueTab = t.key === 'overdue'
          const isReviewTab = t.key === 'review'
          return (
            <button key={t.key} onClick={() => setTab(t.key as TabKey)}
              className={`filter-chip ${active ? 'active' : ''}`}
>
              {t.label}
              {cnt != null && cnt > 0 && (
                <span className="filter-chip-count" style={{
                  background: active ? 'rgba(255,255,255,0.25)' : (isOverdueTab ? SEMANTIC_COLORS.danger.bg : isReviewTab ? SEMANTIC_COLORS.warning.bg : '#f1f5f9'),
                  color: active ? '#fff' : (isOverdueTab ? SEMANTIC_COLORS.danger.solid : isReviewTab ? SEMANTIC_COLORS.warning.solid : '#475569'),
                }}>
                  {cnt > 99 ? '99+' : cnt}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search + project filter */}
      <div className="flex gap-2 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); setQ(qInput) }} className="flex gap-2 flex-1" style={{ minWidth: 200 }}>
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Tìm theo tiêu đề..."
            className="input-field flex-1" />
          <Button variant="outline" type="submit" size="sm">Tìm</Button>
        </form>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input-field text-sm" style={{ minWidth: 140 }}>
          <option value="">Tất cả dự án</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2 stagger-children">{[1, 2, 3].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
      ) : error ? (
        <EmptyState title={error} action={<Button variant="outline" onClick={load}>Thử lại</Button>} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={<Inbox />} title={`Không có việc nào${q || projectId ? ' khớp bộ lọc' : ''}`} />
      ) : (
        <>
          <div className="space-y-2 stagger-children">
            {tasks.map((t, idx) => {
              const st = t.blocked ? { l: 'Tắc', variant: 'warning' as const } : (ST[t.status] || ST.OPEN)
              const due = dueInfo(t.deadline, t.status)
              const doerOver = isDoerOverdue(t)
              const revLate = isReviewLate(t)
              const revDays = reviewDaysLate(t)
              // Màu khung theo mức khẩn: quá hạn → đỏ; ưu tiên; rồi theo trạng thái.
              const overdue = doerOver || revLate
              const accent = overdue ? SEMANTIC_COLORS.danger
                : t.priority === 'URGENT' ? SEMANTIC_COLORS.danger
                : t.priority === 'HIGH' ? SEMANTIC_COLORS.warning
                : t.status === 'RETURNED' ? SEMANTIC_COLORS.danger
                : t.status === 'AWAITING_REVIEW' ? SEMANTIC_COLORS.warning
                : t.status === 'IN_PROGRESS' ? SEMANTIC_COLORS.info
                : SEMANTIC_COLORS.neutral
              const rowNum = (page - 1) * 20 + idx + 1
              // Việc đang chờ QTHT xử lý yêu cầu → xám, không click được (chỉ ở tab "Tôi tạo")
              const pending = tab === 'created' && t.resultData?.changeRequest?.status === 'PENDING'
              return (
                <div key={t.id} onClick={pending ? undefined : () => router.push(`/dashboard/work/${t.id}`)}
                  className={`transition-all shadow-sm ${pending ? '' : 'cursor-pointer hover:shadow-md'}`}
                  style={{
                    background: pending ? '#f1f5f9' : (overdue ? accent.bg : 'var(--surface, #ffffff)'),
                    border: `1px solid ${overdue ? accent.solid + '55' : 'var(--border, #e2e8f0)'}`,
                    borderLeft: `5px solid ${pending ? '#94a3b8' : accent.solid}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    opacity: pending ? 0.6 : 1,
                  }}>
                  <div className="flex items-start gap-2.5 flex-wrap">
                    <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                      style={{ background: accent.bg, color: accent.solid }}>{rowNum}</span>
                    <div className="font-bold flex-1" style={{ color: 'var(--text-primary)', fontSize: 15, minWidth: 180, lineHeight: 1.35 }}>{t.title}</div>
                    {tab === 'review' && !revLate && <Badge variant="warning">Cần kết thúc</Badge>}
                    {revLate && (tab === 'review' || tab === 'overdue') && <Badge variant="danger">Trễ nghiệm thu ({revDays} ngày)</Badge>}
                    <Badge variant={st.variant}>{st.l}</Badge>
                    {pending && <Badge variant="default">⏳ Chờ QTHT xử lý</Badge>}
                    {t.taskType === 'CASCADE' && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{
                        background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24',
                      }}>⚡ Cascade</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.project && <Badge variant="info">{t.project.projectCode}</Badge>}
                    {showCreator && <span>Người giao: <b>{t.createdByName}</b></span>}
                    {showAssignees && t.assigneeNames.length > 0 && <span>Người thực hiện: <b>{t.assigneeNames.join(', ')}</b></span>}
                    {due && (tab === 'assigned' || tab === 'dept' ? doerOver : tab === 'review' ? revLate : true) && (
                      <Badge variant={due.over ? 'danger' : 'warning'}>{due.txt}</Badge>
                    )}
                    {t._count.children > 0 && <span className="font-mono">+{t._count.children} con</span>}
                    {t._count.docs > 0 && <span className="font-mono">{t._count.docs} file</span>}
                  </div>
                  {tab === 'created' && !pending && t.status !== 'DONE' && (
                    <div className="mt-2">
                      <button onClick={(e) => { e.stopPropagation(); openCr(t) }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', background: '#fff' }}>
                        ✎ Yêu cầu chỉnh sửa
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {/* Modal: Yêu cầu chỉnh sửa (gửi cho Quản trị hệ thống) */}
      {crTask && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!crBusy) setCrTask(null) }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, padding: 20, background: '#fff', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>Yêu cầu chỉnh sửa</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>{crTask.title}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, cursor: crAnyDone ? 'not-allowed' : 'pointer', opacity: crAnyDone ? 0.5 : 1 }}>
                <input type="radio" checked={crType === 'DELETE'} disabled={crAnyDone} onChange={() => setCrType('DELETE')} style={{ marginTop: 3 }} />
                <span><b>Xóa công việc</b><br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{crAnyDone ? 'Đã có người hoàn thành — không xóa được' : 'Hủy việc này (chỉ khi chưa ai hoàn thành)'}</span></span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, cursor: 'pointer' }}>
                <input type="radio" checked={crType === 'EDIT_ASSIGNEES'} onChange={() => setCrType('EDIT_ASSIGNEES')} style={{ marginTop: 3 }} />
                <span><b>Chỉnh sửa người nhận</b><br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>QTHT sẽ bỏ/đổi người nhận (chỉ người chưa hoàn thành)</span></span>
              </label>
            </div>

            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Lý do yêu cầu</label>
            <textarea value={crReason} onChange={(e) => setCrReason(e.target.value)} rows={3}
              placeholder="Nhập lý do (vd: nhập nhầm tên người nhận / người nhận đã nghỉ việc…)"
              className="input-field" style={{ width: '100%', marginTop: 4, marginBottom: 14 }} />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCrTask(null)} disabled={crBusy} className="text-sm px-4 py-2 rounded-lg cursor-pointer" style={{ border: '1px solid var(--border)' }}>Hủy</button>
              <button onClick={submitCr} disabled={crBusy || !crReason.trim()} className="text-sm px-4 py-2 rounded-lg font-semibold cursor-pointer" style={{ background: '#dc2626', color: '#fff', opacity: (crBusy || !crReason.trim()) ? 0.6 : 1 }}>{crBusy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10 }}>Sau khi gửi, việc sẽ bị khóa (xám) tới khi Quản trị hệ thống xử lý.</p>
          </div>
        </div>
      )}
    </div>
  )
}
