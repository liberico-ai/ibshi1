'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { DEPARTMENTS_V2, DEPT_NAME, DEPT_PRIMARY_ROLE, ROLE_TO_DEPT } from '@/lib/org-map'

// ── Types ──

interface BriefingTask {
  id: string
  taskType: string
  title: string
  status: string
  priority: string
  blocked: boolean
  escalated: boolean
  needsExecDecision: boolean
  startedAt: string | null
  deadline: string | null
  completedAt: string | null
  daysOverdue: number
  isOverdue: boolean
  isDueSoon: boolean
  isDoneThisWeek: boolean
  isNewThisWeek: boolean
  assigneeNames: string[]
  assignees: { userId: string; name: string }[]
  actionItems: { taskId: string; title: string }[]
  discussedAt: string
  projectCode: string
  criteria: string
  proposal: string
  decision: string
  decisionByName: string
  decisionAt: string
  execReviewedAt: string
  notes: string
}
interface ProjectGroup {
  project: { id: string; projectCode: string; projectName: string } | null
  tasks: BriefingTask[]
  totalTasks: number
  totalOverdue: number
  maxDaysOverdue: number
}
interface KPI {
  total: number
  active: number
  overdue: number
  dueSoon: number
  blocked: number
  execDecision: number
  doneThisWeek: number
  newThisWeek: number
}

interface AssigneeMatch {
  inputName: string
  userId: string | null
  match: 'ok' | 'ambiguous' | 'none'
  matchMethod: string
  candidates: { id: string; fullName: string; roleCode: string }[]
}

interface PreviewRow {
  rowIndex: number
  action: 'update' | 'create' | 'error'
  taskId: string | null
  projectCode: string
  projectNameNew: string
  projectExists: boolean
  willCreateProject: boolean
  title: string
  deptText: string
  roleCode: string | null
  assigneeName: string
  assigneeUserId: string | null
  assignBy: 'user' | 'role' | null
  userMatch: 'ok' | 'ambiguous' | 'none' | null
  assignees: AssigneeMatch[]
  deadlineISO: string
  deadline: string
  hasNoDeadline: boolean
  status: string
  criteria: string
  proposal: string
  decision: string
  notes: string
  detail: string
  titleCollision?: boolean
  collisionTaskId?: string
  collisionInfo?: { assignee: string; deadline: string | null; status: string }
}

interface EditableRow extends PreviewRow {
  include: boolean
  projectMode: 'existing' | 'create' | 'none'
  projectId: string | null
  resolveTo?: 'create' | 'update'
}

interface DBProject { id: string; projectCode: string; projectName: string }
interface DBUser { id: string; fullName: string; roleCode: string; isActive: boolean }

interface ImportResult {
  created: number
  updated: number
  projectsCreated: number
  skipped: number
  errors: { row: number; reason: string }[]
}

// ── Constants ──

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Mới', color: '#475569', bg: '#f1f5f9' },
  IN_PROGRESS: { label: 'Đang xử lý', color: '#1d4ed8', bg: '#eff6ff' },
  AWAITING_REVIEW: { label: 'Chờ kết thúc', color: '#b45309', bg: '#fffbeb' },
  RETURNED: { label: 'Bị trả lại', color: '#e63946', bg: '#fef2f2' },
  DONE: { label: 'Hoàn thành', color: '#059669', bg: '#ecfdf5' },
}

const ACTION_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  create: { label: 'Tạo mới', color: '#059669', bg: '#ecfdf5' },
  update: { label: 'Cập nhật', color: '#1d4ed8', bg: '#eff6ff' },
  error: { label: 'Lỗi', color: '#dc2626', bg: '#fef2f2' },
}

const STATUS_OPTIONS = [
  { value: 'Mới', label: 'Mới' },
  { value: 'Đang xử lý', label: 'Đang xử lý' },
  { value: 'Tắc', label: 'Tắc' },
  { value: 'Bị trả lại', label: 'Bị trả lại' },
  { value: 'Chờ kết thúc', label: 'Chờ kết thúc' },
  { value: 'Xong', label: 'Xong' },
  { value: 'Hủy', label: 'Hủy' },
]

const DEPT_OPTIONS = DEPARTMENTS_V2
  .filter((d) => DEPT_PRIMARY_ROLE[d.code])
  .map((d) => ({ value: DEPT_PRIMARY_ROLE[d.code], label: d.name }))

function overdueSeverity(days: number): { color: string; bg: string } {
  if (days > 14) return { color: '#dc2626', bg: '#fef2f2' }
  if (days > 0) return { color: '#d97706', bg: '#fffbeb' }
  return { color: '#475569', bg: '#f1f5f9' }
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

const rmDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, c => c === 'đ' ? 'd' : 'D')

function getMonday(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff); return d
}
function needsDiscussion(t: BriefingTask): boolean {
  return t.status !== 'DONE' && t.status !== 'CANCELLED' && (t.isOverdue || t.blocked || t.needsExecDecision || t.isDueSoon)
}
function discussedThisWeek(t: BriefingTask): boolean {
  if (!t.discussedAt) return false
  return new Date(t.discussedAt) >= getMonday()
}

// ── UserAutocomplete ──

function UserAutocomplete({ value, users, warning, onChange }: {
  value: string
  users: DBUser[]
  warning: boolean
  onChange: (name: string, userId: string | null) => void
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return users.slice(0, 15)
    const q = rmDiacritics(query.toLowerCase())
    return users.filter((u) => rmDiacritics(u.fullName.toLowerCase()).includes(q)).slice(0, 15)
  }, [query, users])

  return (
    <div ref={ref} className="relative">
      <input
        className="w-full text-xs px-1 py-1 rounded border"
        style={{
          borderColor: warning ? '#f59e0b' : 'var(--border)',
          background: warning ? '#fffbeb' : 'var(--surface)',
        }}
        value={query}
        placeholder="Nhập tên..."
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          if (!e.target.value.trim()) onChange('', null)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-0.5 rounded border shadow-lg max-h-40 overflow-y-auto" style={{ background: 'var(--surface, #fff)', borderColor: 'var(--border)' }}>
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              className="w-full text-left text-xs px-2 py-1.5 hover:bg-blue-50"
              onClick={() => { onChange(u.fullName, u.id); setQuery(u.fullName); setOpen(false) }}
            >
              {u.fullName} <span style={{ color: 'var(--text-muted)' }}>({DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Group rows by project ──

interface RowGroup {
  key: string
  label: string
  isNew: boolean
  rows: { row: EditableRow; idx: number }[]
}

function groupRowsByProject(rows: EditableRow[]): RowGroup[] {
  const map = new Map<string, RowGroup>()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const code = r.projectCode?.trim() || ''
    const key = code || '__general__'
    if (!map.has(key)) {
      const label = code || 'Công việc chung'
      const isNew = r.projectMode === 'create'
      map.set(key, { key, label, isNew, rows: [] })
    }
    map.get(key)!.rows.push({ row: r, idx: i })
    if (r.projectMode === 'create') map.get(key)!.isNew = true
  }
  return Array.from(map.values())
}

// ════════════════════════════════════════
//  COMPONENT
// ════════════════════════════════════════

export default function BriefingPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'import'>('dashboard')
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [kpi, setKpi] = useState<KPI>({ total: 0, active: 0, overdue: 0, dueSoon: 0, blocked: 0, execDecision: 0, doneThisWeek: 0, newThisWeek: 0 })
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  // Dashboard filters
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterBlocked, setFilterBlocked] = useState<string>('')
  const [filterOverdue, setFilterOverdue] = useState<string>('')
  const [filterSearch, setFilterSearch] = useState('')
  const [statusEditing, setStatusEditing] = useState<string | null>(null)
  const [statusSaving, setStatusSaving] = useState(false)
  const [cellEditing, setCellEditing] = useState<string | null>(null)
  const [filterExecOnly, setFilterExecOnly] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false)

  // Meeting mode
  const [meetingMode, setMeetingMode] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('briefing_meeting') === '1'
    return false
  })
  const [meetingIdx, setMeetingIdx] = useState(0)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())

  // Action menu state — portal-style positioning
  const [actionMenu, setActionMenu] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; flipUp: boolean } | null>(null)
  const [actionMode, setActionMode] = useState<{ taskId: string; mode: 'reassign' | 'deadline' | 'action-item' } | null>(null)
  const [actionUsers, setActionUsers] = useState<DBUser[]>([])
  const [actionSaving, setActionSaving] = useState(false)
  const [reassignPicks, setReassignPicks] = useState<string[]>([])
  const [reassignQuery, setReassignQuery] = useState('')
  const [newDeadline, setNewDeadline] = useState('')
  const [actionItemTitle, setActionItemTitle] = useState('')
  const [actionItemDeadline, setActionItemDeadline] = useState('')
  const [actionItemPicks, setActionItemPicks] = useState<string[]>([])
  const [actionItemQuery, setActionItemQuery] = useState('')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewing, setPreviewing] = useState(false)
  const [editRows, setEditRows] = useState<EditableRow[] | null>(null)
  const [dbProjects, setDbProjects] = useState<DBProject[]>([])
  const [dbUsers, setDbUsers] = useState<DBUser[]>([])
  const [applying, setApplying] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // Review / Snapshot state
  interface DoneSincePrevItem { taskId: string; code: string; title: string; assigneeNames: string[]; projectCode: string; completedAt: string }
  interface ReviewData {
    hasSnapshot: boolean
    lastSnapshot: { id: string; weekOf: string; createdAt: string; kpi: Record<string, number> } | null
    followUp: { taskId: string; title: string; decision?: string; byName?: string; type?: string; currentStatus: string; isDone: boolean; isOverdue: boolean; daysOverdue: number }[]
    diff: { new: { taskId: string; title: string; status: string }[]; closed: { taskId: string; title: string; currentStatus: string }[]; slipped: { taskId: string; title: string; oldDeadline: string; newDeadline: string; daysOverdue: number }[] }
    doneSincePrev: DoneSincePrevItem[]
  }
  const [review, setReview] = useState<ReviewData | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewDiffOpen, setReviewDiffOpen] = useState(false)
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [snapshotHistory, setSnapshotHistory] = useState<{ id: string; weekOf: string; createdAt: string; kpi: Record<string, number> }[]>([])
  const [doneSincePrevOpen, setDoneSincePrevOpen] = useState(false)

  // Project task modal
  const [projectTaskModal, setProjectTaskModal] = useState<{ projectId: string; projectCode: string } | null>(null)
  const [ptTitle, setPtTitle] = useState('')
  const [ptDeadline, setPtDeadline] = useState('')
  const [ptDescription, setPtDescription] = useState('')
  const [ptPicks, setPtPicks] = useState<string[]>([])
  const [ptQuery, setPtQuery] = useState('')
  const [ptSaving, setPtSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/work/briefing/agenda').then((r) => {
      if (r.ok) {
        setGroups(r.groups || [])
        setKpi(r.kpi || { total: 0, active: 0, overdue: 0, dueSoon: 0, blocked: 0, execDecision: 0, doneThisWeek: 0, newThisWeek: 0 })
        const autoOpen = new Set<string>()
        for (const g of (r.groups || []) as ProjectGroup[]) {
          const key = g.project?.id || '__general__'
          if (g.tasks.some((t: BriefingTask) => t.blocked || t.needsExecDecision)) autoOpen.add(key)
        }
        setExpanded(autoOpen)
      }
      setLoading(false)
    })
  }, [])

  const loadReview = useCallback(() => {
    apiFetch('/api/work/briefing/review').then(r => {
      if (r.ok) setReview(r as unknown as ReviewData)
    })
  }, [])

  useEffect(() => { load(); loadReview() }, [load, loadReview])

  useEffect(() => {
    if (toast) { const h = setTimeout(() => setToast(null), 3000); return () => clearTimeout(h) }
  }, [toast])

  useEffect(() => {
    if (!actionMenu) return
    const h = () => { setActionMenu(null); setMenuPos(null) }
    const timer = setTimeout(() => document.addEventListener('click', h), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', h) }
  }, [actionMenu])

  useEffect(() => {
    if (!toolsMenuOpen) return
    const h = () => setToolsMenuOpen(false)
    const timer = setTimeout(() => document.addEventListener('click', h), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', h) }
  }, [toolsMenuOpen])

  useEffect(() => {
    localStorage.setItem('briefing_meeting', meetingMode ? '1' : '0')
    if (meetingMode) { setReviewOpen(true); setDoneSincePrevOpen(true) }
  }, [meetingMode])

  const loadUsers = useCallback(async () => {
    if (actionUsers.length > 0) return
    const data = await apiFetch('/api/users')
    if (data.ok) setActionUsers((data.users || []).filter((u: DBUser) => u.isActive))
  }, [actionUsers.length])

  const openAction = async (taskId: string, mode: 'reassign' | 'deadline' | 'action-item') => {
    setActionMenu(null)
    setMenuPos(null)
    setActionSaving(false)
    setReassignPicks([])
    setReassignQuery('')
    setActionItemPicks([])
    setActionItemQuery('')
    setActionItemTitle('')
    setActionItemDeadline('')
    if (mode === 'deadline') {
      const task = groups.flatMap(g => g.tasks).find(t => t.id === taskId)
      setNewDeadline(task?.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : '')
    }
    if (mode === 'action-item') {
      const task = groups.flatMap(g => g.tasks).find(t => t.id === taskId)
      setActionItemTitle(task?.proposal || task?.notes || '')
    }
    if (mode === 'reassign' || mode === 'action-item') await loadUsers()
    setActionMode({ taskId, mode })
  }

  const handleReassign = async () => {
    if (!actionMode || reassignPicks.length === 0) return
    setActionSaving(true)
    const prev = groups.flatMap(g => g.tasks).find(t => t.id === actionMode.taskId)
    const prevNames = prev?.assigneeNames || []
    // Optimistic update
    setGroups(gs => gs.map(g => ({
      ...g,
      tasks: g.tasks.map(t => t.id === actionMode.taskId
        ? { ...t, assigneeNames: reassignPicks.map(uid => actionUsers.find(u => u.id === uid)?.fullName || '?'), assignees: reassignPicks.map(uid => ({ userId: uid, name: actionUsers.find(u => u.id === uid)?.fullName || '?' })) }
        : t),
    })))
    const r = await apiFetch('/api/work/briefing/reassign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: actionMode.taskId, assigneeUserIds: reassignPicks }),
    })
    if (r.ok) {
      setToast({ msg: 'Đã đổi người', ok: true })
      load()
    } else {
      setToast({ msg: r.error || 'Lỗi đổi người', ok: false })
      setGroups(gs => gs.map(g => ({
        ...g,
        tasks: g.tasks.map(t => t.id === actionMode.taskId ? { ...t, assigneeNames: prevNames } : t),
      })))
    }
    setActionSaving(false)
    setActionMode(null)
  }

  const handleDeadlineChange = async () => {
    if (!actionMode) return
    setActionSaving(true)
    const r = await apiFetch('/api/work/briefing/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: actionMode.taskId, deadline: newDeadline || null }),
    })
    if (r.ok) { setToast({ msg: 'Đã đổi hạn', ok: true }); load() }
    else setToast({ msg: r.error || 'Lỗi đổi hạn', ok: false })
    setActionSaving(false)
    setActionMode(null)
  }

  const handleToggleBlocked = async (taskId: string, currentBlocked: boolean) => {
    setActionMenu(null); setMenuPos(null)
    const newBlocked = !currentBlocked
    // Optimistic
    setGroups(gs => gs.map(g => ({ ...g, tasks: g.tasks.map(t => t.id === taskId ? { ...t, blocked: newBlocked } : t) })))
    const r = await apiFetch('/api/work/briefing/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, blocked: newBlocked }),
    })
    if (r.ok) { setToast({ msg: newBlocked ? 'Đã đánh dấu tắc' : 'Đã gỡ tắc', ok: true }); load() }
    else { setToast({ msg: r.error || 'Lỗi', ok: false }); load() }
  }

  const handleCreateActionItem = async () => {
    if (!actionMode || !actionItemTitle.trim() || actionItemPicks.length === 0) return
    setActionSaving(true)
    const r = await apiFetch('/api/work/briefing/action-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceTaskId: actionMode.taskId,
        title: actionItemTitle.trim(),
        assigneeUserIds: actionItemPicks,
        deadline: actionItemDeadline || undefined,
      }),
    })
    if (r.ok) {
      setToast({ msg: 'Đã tạo việc mới', ok: true })
      load()
    } else {
      setToast({ msg: r.error || 'Lỗi tạo việc', ok: false })
    }
    setActionSaving(false)
    setActionMode(null)
  }

  const openProjectTask = async (projectId: string, projectCode: string) => {
    setPtTitle(''); setPtDeadline(''); setPtDescription(''); setPtPicks([]); setPtQuery(''); setPtSaving(false)
    await loadUsers()
    setProjectTaskModal({ projectId, projectCode })
  }

  const handleProjectTask = async () => {
    if (!projectTaskModal || !ptTitle.trim() || ptPicks.length === 0) return
    setPtSaving(true)
    const r = await apiFetch('/api/work/briefing/project-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: projectTaskModal.projectId || undefined,
        title: ptTitle.trim(),
        assigneeUserIds: ptPicks,
        deadline: ptDeadline || undefined,
        description: ptDescription.trim() || undefined,
      }),
    })
    if (r.ok) {
      setToast({ msg: 'Đã tạo việc mới', ok: true })
      load()
    } else {
      setToast({ msg: r.error || 'Lỗi tạo việc', ok: false })
    }
    setPtSaving(false)
    setProjectTaskModal(null)
  }

  const filteredPtUsers = useMemo(() => {
    if (!ptQuery.trim()) return actionUsers.slice(0, 20)
    const q = rmDiacritics(ptQuery.toLowerCase())
    return actionUsers.filter(u => rmDiacritics(u.fullName.toLowerCase()).includes(q)).slice(0, 20)
  }, [actionUsers, ptQuery])

  const filteredActionUsers = useMemo(() => {
    if (!reassignQuery.trim() && !actionItemQuery.trim()) return actionUsers.slice(0, 20)
    const q = rmDiacritics((reassignQuery || actionItemQuery).toLowerCase())
    return actionUsers.filter(u => rmDiacritics(u.fullName.toLowerCase()).includes(q)).slice(0, 20)
  }, [actionUsers, reassignQuery, actionItemQuery])

  const toggleProject = (pid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
      const res = await fetch('/api/work/briefing/export', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      a.download = `Giao_ban_tuan_${dateStr}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Lỗi xuất file. Vui lòng thử lại.')
    }
    setExporting(false)
  }

  // ── Import: upload file -> preview ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportResult(null)
    setPreviewing(true)

    try {
      // Fetch users in parallel with preview
      const [previewData, usersData] = await Promise.all([
        (async () => {
          const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
          const form = new FormData()
          form.append('file', file)
          form.append('mode', 'preview')
          const res = await fetch('/api/work/briefing/import', {
            method: 'POST',
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: form,
          })
          return res.json()
        })(),
        apiFetch('/api/users'),
      ])

      if (usersData.ok) setDbUsers((usersData.users || []).filter((u: DBUser) => u.isActive))

      if (previewData.ok) {
        setDbProjects(previewData.projects || [])
        const rows: PreviewRow[] = previewData.rows || []
        setEditRows(rows.map((r) => toEditable(r, previewData.projects || [])))
      } else {
        alert(previewData.error || 'Lỗi đọc file')
      }
    } catch {
      alert('Lỗi kết nối server')
    }
    setPreviewing(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function toEditable(r: PreviewRow, projects: DBProject[]): EditableRow {
    let projectMode: 'existing' | 'create' | 'none' = 'none'
    let projectId: string | null = null
    if (r.projectExists) {
      projectMode = 'existing'
      const match = projects.find((p) => p.projectCode.replace(/[\s\-_]/g, '').toUpperCase() === r.projectCode.replace(/[\s\-_]/g, '').toUpperCase())
      if (match) projectId = match.id
    } else if (r.willCreateProject) {
      projectMode = 'create'
    }
    return { ...r, include: r.action !== 'error', projectMode, projectId }
  }

  const updateRow = (idx: number, patch: Partial<EditableRow>) => {
    setEditRows((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }

  // ── Apply ──
  const handleApply = async () => {
    if (!editRows || applying) return
    setApplying(true)
    try {
      const finalRows = editRows
        .filter((r) => r.include)
        .map((r) => ({
          include: true,
          action: r.action === 'error' ? 'create' as const : r.action,
          taskId: r.taskId || undefined,
          resolveTo: r.resolveTo || undefined,
          collisionTaskId: r.resolveTo === 'update' ? r.collisionTaskId : undefined,
          projectMode: r.projectMode,
          projectId: r.projectId || undefined,
          projectCode: r.projectCode || undefined,
          projectNameNew: r.projectNameNew || undefined,
          title: r.title,
          roleCode: r.roleCode || undefined,
          assigneeUserIds: (r.assignees || []).filter(a => a.userId).map(a => a.userId!),
          deadlineISO: r.deadlineISO,
          status: r.status,
          criteria: r.criteria,
          proposal: r.proposal,
          decision: r.decision,
          notes: r.notes,
        }))

      const data = await apiFetch('/api/work/briefing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: finalRows }),
      })

      if (data.ok) {
        setImportResult({
          created: data.created || data.summary?.created || 0,
          updated: data.updated || data.summary?.updated || 0,
          projectsCreated: data.projectsCreated || data.summary?.projectsCreated || 0,
          skipped: data.skipped || data.summary?.skipped || 0,
          errors: data.errors || [],
        })
        setEditRows(null)
        load()
      } else {
        alert(data.error || 'Lỗi ghi dữ liệu')
      }
    } catch {
      alert('Lỗi kết nối server')
    }
    setApplying(false)
  }

  const resetImport = () => {
    setEditRows(null)
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Summary computed ──
  const summary = editRows ? {
    total: editRows.length,
    included: editRows.filter((r) => r.include).length,
    toCreate: editRows.filter((r) => r.include && (r.action === 'create' || r.action === 'error')).length,
    toUpdate: editRows.filter((r) => r.include && r.action === 'update').length,
    projectsNew: new Set(editRows.filter((r) => r.include && r.projectMode === 'create').map((r) => r.projectCode)).size,
    errors: editRows.filter((r) => r.action === 'error' && !r.include).length,
    titleCollisions: editRows.filter((r) => r.include && r.titleCollision).length,
  } : null

  // Filtered tasks for dashboard — sorted by urgency, split active/done
  const filteredGroups = useMemo(() => {
    function urgencyRank(t: BriefingTask): number {
      if (t.isOverdue) return 1
      if (t.blocked) return 2
      if (t.isDueSoon) return 3
      if (['RETURNED', 'IN_PROGRESS', 'OPEN', 'AWAITING_REVIEW'].includes(t.status)) return 4
      return 5 // DONE
    }
    function meetingSort(a: BriefingTask, b: BriefingTask): number {
      const ab = a.blocked ? 0 : 1, bb = b.blocked ? 0 : 1
      if (ab !== bb) return ab - bb
      const ae = a.needsExecDecision ? 0 : 1, be = b.needsExecDecision ? 0 : 1
      if (ae !== be) return ae - be
      if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue
      const as = a.isDueSoon ? 0 : 1, bs = b.isDueSoon ? 0 : 1
      return as - bs
    }
    return groups.map((g) => {
      let tasks = g.tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED')
      if (meetingMode) tasks = tasks.filter(needsDiscussion)
      if (filterExecOnly) tasks = tasks.filter((t) => t.needsExecDecision)
      if (filterStatus) tasks = tasks.filter((t) => t.status === filterStatus)
      if (filterBlocked === 'yes') tasks = tasks.filter((t) => t.blocked)
      if (filterBlocked === 'no') tasks = tasks.filter((t) => !t.blocked)
      if (filterOverdue === 'yes') tasks = tasks.filter((t) => t.isOverdue)
      if (filterOverdue === 'due_soon') tasks = tasks.filter((t) => t.isDueSoon)
      if (filterOverdue === 'done_week') tasks = tasks.filter((t) => t.isDoneThisWeek)
      if (filterOverdue === 'new_week') tasks = tasks.filter((t) => t.isNewThisWeek)
      if (filterSearch.trim()) {
        const q = rmDiacritics(filterSearch.toLowerCase())
        tasks = tasks.filter((t) =>
          rmDiacritics(t.title.toLowerCase()).includes(q) ||
          t.assigneeNames.some((n) => rmDiacritics(n.toLowerCase()).includes(q))
        )
      }
      const sorted = meetingMode
        ? [...tasks].sort(meetingSort)
        : [...tasks].sort((a, b) => {
          const ra = urgencyRank(a), rb = urgencyRank(b)
          if (ra !== rb) return ra - rb
          if (ra === 1) return b.daysOverdue - a.daysOverdue
          const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
          const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
          return da - db
        })
      const activeTasks = sorted
      const totalOverdue = sorted.filter(t => t.isOverdue).length
      const maxDaysOverdue = sorted.reduce((max, t) => t.isOverdue ? Math.max(max, t.daysOverdue) : max, 0)
      return { ...g, tasks: sorted, activeTasks, doneTasks: [] as BriefingTask[], totalTasks: sorted.length, totalOverdue, maxDaysOverdue }
    }).filter((g) => g.tasks.length > 0)
  }, [groups, filterStatus, filterBlocked, filterOverdue, filterSearch, filterExecOnly, meetingMode])

  // Meeting mode: flat list of tasks that need discussion, for prev/next navigation
  const meetingTasks = useMemo(() => {
    if (!meetingMode) return []
    return filteredGroups.flatMap(g => g.activeTasks).filter(t => !discussedThisWeek(t))
  }, [filteredGroups, meetingMode])

  const meetingTotal = useMemo(() => filteredGroups.flatMap(g => g.activeTasks).length, [filteredGroups])
  const meetingDiscussed = useMemo(() => filteredGroups.flatMap(g => g.activeTasks).filter(discussedThisWeek).length, [filteredGroups])

  const execTasks = useMemo(() => {
    return groups.flatMap((g) => g.tasks.filter((t) => t.needsExecDecision))
      .sort((a, b) => {
        const aOverdue = a.isOverdue ? 1 : 0
        const bOverdue = b.isOverdue ? 1 : 0
        if (aOverdue !== bOverdue) return bOverdue - aOverdue
        return b.daysOverdue - a.daysOverdue
      })
  }, [groups])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  const handleStatusChange = async (taskId: string, newStatus: string, blocked: boolean) => {
    setStatusSaving(true)
    try {
      const r = await apiFetch('/api/work/briefing/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status: newStatus, blocked }),
      })
      if (r.ok) {
        load()
      } else {
        alert(r.error || 'Lỗi cập nhật trạng thái')
      }
    } catch {
      alert('Lỗi kết nối')
    }
    setStatusSaving(false)
    setStatusEditing(null)
  }

  const handleBriefingPatch = async (taskId: string, field: 'proposal' | 'decision', value: string) => {
    setCellEditing(null)
    const r = await apiFetch('/api/work/briefing/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, briefingPatch: { [field]: value } }),
    })
    if (r.ok) load()
    else alert(r.error || 'Lỗi cập nhật')
  }

  const handleEscalate = async (taskId: string, escalated: boolean) => {
    const r = await apiFetch('/api/work/briefing/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, escalated }),
    })
    if (r.ok) load()
    else alert(r.error || 'Lỗi cập nhật')
  }

  const handleExecReview = async (taskId: string, reviewed: boolean) => {
    const r = await apiFetch('/api/work/briefing/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, execReviewed: reviewed }),
    })
    if (r.ok) load()
    else alert(r.error || 'Lỗi cập nhật')
  }

  const handleDiscussed = async (taskId: string, checked: boolean) => {
    setGroups(prev => prev.map(g => ({
      ...g,
      tasks: g.tasks.map(t => t.id === taskId ? { ...t, discussedAt: checked ? new Date().toISOString() : '' } : t),
    })))
    const r = await apiFetch('/api/work/briefing/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, briefingPatch: { discussedAt: checked ? new Date().toISOString() : '' } }),
    })
    if (r.ok) {
      setToast({ msg: checked ? 'Đã đánh dấu bàn xong' : 'Đã bỏ đánh dấu', ok: true })
      setTimeout(() => setToast(null), 2000)
    } else {
      load()
      setToast({ msg: r.error || 'Lỗi cập nhật', ok: false })
      setTimeout(() => setToast(null), 3000)
    }
  }

  // openActionMenu removed — actions now inline in expandable detail row
  void actionMenu; void menuPos

  const goMeetingTask = (direction: 1 | -1) => {
    if (!meetingTasks.length) return
    const next = meetingIdx + direction
    const idx = next < 0 ? meetingTasks.length - 1 : next >= meetingTasks.length ? 0 : next
    setMeetingIdx(idx)
    const el = rowRefs.current.get(meetingTasks[idx].id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleSnapshot = async () => {
    setSnapshotSaving(true)
    const r = await apiFetch('/api/work/briefing/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    setSnapshotSaving(false)
    if (r.ok) {
      const wk = r.snapshot?.weekOf ? new Date(r.snapshot.weekOf).toLocaleDateString('vi-VN') : ''
      setToast({ msg: `Đã chốt kỳ giao ban tuần ${wk}`, ok: true })
      setTimeout(() => setToast(null), 3000)
      loadReview()
    } else {
      setToast({ msg: r.error || 'Lỗi chốt kỳ', ok: false })
      setTimeout(() => setToast(null), 3000)
    }
  }

  const handlePublish = async (force = false) => {
    setPublishing(true)
    const r = await apiFetch('/api/work/briefing/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
    setPublishing(false)
    if (r.ok && r.alreadyPublished && !force) {
      const again = confirm(`Kỳ này đã phát hành lúc ${new Date(r.publishedAt).toLocaleString('vi-VN')}. Phát hành lại?`)
      if (again) { handlePublish(true); return }
      return
    }
    if (r.ok && r.published) {
      setToast({ msg: `Đã gửi thông báo cho ${r.sentTo} người + nhóm`, ok: true })
      setTimeout(() => setToast(null), 3000)
    } else if (!r.ok) {
      setToast({ msg: r.error || 'Lỗi phát hành', ok: false })
      setTimeout(() => setToast(null), 3000)
    }
  }

  const loadHistory = async () => {
    setHistoryOpen(true)
    const r = await apiFetch('/api/work/briefing/snapshot?list=1')
    if (r.ok) setSnapshotHistory(r.snapshots || [])
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Giao ban tuần</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{kpi.active} việc đang mở · {kpi.overdue} quá hạn · {groups.length} dự án</p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => { setMeetingMode(m => !m); setMeetingIdx(0) }}
            className="text-sm px-4 py-2 rounded-lg font-semibold transition-all"
            style={meetingMode
              ? { background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }
              : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {meetingMode ? '✕ Tắt họp' : '🎯 Chế độ họp'}
          </button>
          <button onClick={load} className="text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>↻</button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setToolsMenuOpen(v => !v) }}
              className="text-sm px-4 py-2 rounded-lg font-semibold"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Thao tác kỳ ⋯
            </button>
            {toolsMenuOpen && (
              <div className="absolute right-0 mt-1 z-30 rounded-lg shadow-lg py-1 min-w-[180px]" style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => { setToolsMenuOpen(false); handleSnapshot() }} disabled={snapshotSaving || kpi.total === 0} className="w-full text-left text-xs px-4 py-2.5 hover:bg-blue-50 disabled:opacity-40">
                  📌 {snapshotSaving ? 'Đang chốt...' : 'Chốt kỳ'}
                </button>
                <button onClick={() => { setToolsMenuOpen(false); handlePublish() }} disabled={publishing} className="w-full text-left text-xs px-4 py-2.5 hover:bg-blue-50 disabled:opacity-40">
                  📣 {publishing ? 'Đang gửi...' : 'Phát hành'}
                </button>
                <button onClick={() => { setToolsMenuOpen(false); handleExport() }} disabled={exporting || kpi.total === 0} className="w-full text-left text-xs px-4 py-2.5 hover:bg-blue-50 disabled:opacity-40">
                  📥 {exporting ? 'Đang xuất...' : 'Xuất biên bản'}
                </button>
                <label className="block text-xs px-4 py-2.5 hover:bg-blue-50 cursor-pointer">
                  📂 Import biên bản
                  <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => { setToolsMenuOpen(false); handleFileSelect(e) }} />
                </label>
                <button onClick={() => { setToolsMenuOpen(false); loadHistory() }} className="w-full text-left text-xs px-4 py-2.5 hover:bg-blue-50">
                  🕘 Lịch sử kỳ
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setActiveTab('dashboard')}
          className="text-sm px-4 py-2 font-semibold border-b-2 -mb-px transition-colors"
          style={{ borderColor: activeTab === 'dashboard' ? '#1d4ed8' : 'transparent', color: activeTab === 'dashboard' ? '#1d4ed8' : 'var(--text-muted)' }}
        >
          Dashboard giao ban
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className="text-sm px-4 py-2 font-semibold border-b-2 -mb-px transition-colors"
          style={{ borderColor: activeTab === 'import' ? '#1d4ed8' : 'transparent', color: activeTab === 'import' ? '#1d4ed8' : 'var(--text-muted)' }}
        >
          Import & Quá hạn
        </button>
      </div>

      {/* ════ Dashboard Tab ════ */}
      {activeTab === 'dashboard' && (
        <>
          {/* KPI Row 1: Action (large) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Cần BGĐ quyết', value: kpi.execDecision, color: '#b91c1c', bg: '#fef2f2', filter: 'exec' },
              { label: 'Quá hạn', value: kpi.overdue, color: '#dc2626', bg: '#fef2f2', filter: 'yes' },
              { label: 'Đến hạn tuần này', value: kpi.dueSoon, color: '#d97706', bg: '#fffbeb', filter: 'due_soon' },
              { label: 'Tắc', value: kpi.blocked, color: '#c2410c', bg: '#fff7ed', filter: 'blocked' },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-xl p-4 text-center cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all ${(card.filter === 'exec' && filterExecOnly) || (card.filter === 'yes' && filterOverdue === 'yes') || (card.filter === 'due_soon' && filterOverdue === 'due_soon') || (card.filter === 'blocked' && filterBlocked === 'yes') ? 'ring-2 ring-offset-1' : ''}`}
                style={{ background: card.bg, border: `1px solid ${card.color}33`, '--tw-ring-color': card.color } as React.CSSProperties}
                onClick={() => {
                  if (card.filter === 'exec') setFilterExecOnly(!filterExecOnly)
                  else if (card.filter === 'blocked') setFilterBlocked(filterBlocked === 'yes' ? '' : 'yes')
                  else if (card.filter) setFilterOverdue(card.filter === filterOverdue ? '' : card.filter)
                }}
              >
                <div className="text-3xl font-extrabold" style={{ color: card.color }}>{card.value}</div>
                <div className="text-xs font-bold mt-1 uppercase tracking-wide" style={{ color: card.color }}>{card.label}</div>
              </div>
            ))}
          </div>
          {/* KPI Row 2: Context (compact single line) */}
          <div className="flex items-center gap-4 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Tổng <b style={{ color: '#475569' }}>{kpi.total}</b></span>
            <span>Đang xử lý <b style={{ color: '#1d4ed8' }}>{kpi.active}</b></span>
            <span className="cursor-pointer hover:underline" style={filterOverdue === 'done_week' ? { color: '#059669', fontWeight: 700 } : undefined} onClick={() => setFilterOverdue(filterOverdue === 'done_week' ? '' : 'done_week')}>Xong tuần <b style={{ color: '#059669' }}>{kpi.doneThisWeek}</b></span>
            <span className="cursor-pointer hover:underline" style={filterOverdue === 'new_week' ? { color: '#7c3aed', fontWeight: 700 } : undefined} onClick={() => setFilterOverdue(filterOverdue === 'new_week' ? '' : 'new_week')}>Mới tuần <b style={{ color: '#7c3aed' }}>{kpi.newThisWeek}</b></span>
          </div>

          {/* Meeting mode bar */}
          {meetingMode && (
            <div className="rounded-xl px-5 py-3 flex items-center justify-between flex-wrap gap-3" style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold" style={{ color: '#991b1b' }}>Đã bàn {meetingDiscussed}/{meetingTotal} việc cần bàn</span>
                  <span className="text-xs font-semibold" style={{ color: '#dc2626' }}>{meetingTotal > 0 ? Math.round(meetingDiscussed / meetingTotal * 100) : 0}%</span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: '#fecaca' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${meetingTotal > 0 ? meetingDiscussed / meetingTotal * 100 : 0}%`, background: '#dc2626' }} />
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => goMeetingTask(-1)}
                  disabled={meetingTasks.length === 0}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-30"
                  style={{ background: '#fff', border: '1px solid #fca5a5', color: '#991b1b' }}
                >
                  ← Trước
                </button>
                <span className="text-xs font-medium" style={{ color: '#991b1b' }}>
                  {meetingTasks.length > 0 ? `${meetingIdx + 1}/${meetingTasks.length} chưa bàn` : 'Đã bàn hết!'}
                </span>
                <button
                  onClick={() => goMeetingTask(1)}
                  disabled={meetingTasks.length === 0}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-30"
                  style={{ background: '#991b1b', color: '#fff', border: '1px solid #991b1b' }}
                >
                  Tiếp theo →
                </button>
              </div>
            </div>
          )}

          {/* ✅ Đã hoàn thành kể từ kỳ trước */}
          {review?.doneSincePrev && review.doneSincePrev.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <button
                onClick={() => setDoneSincePrevOpen(!doneSincePrevOpen)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-opacity-80 transition-colors"
                style={{ background: '#ecfdf5' }}
              >
                <span className="font-bold text-sm" style={{ color: '#059669' }}>
                  {doneSincePrevOpen ? '▾' : '▸'} ✅ Đã hoàn thành kể từ kỳ trước ({review.doneSincePrev.length})
                </span>
                {review.lastSnapshot && <span className="text-xs" style={{ color: '#64748b' }}>từ {new Date(review.lastSnapshot.weekOf).toLocaleDateString('vi-VN')}</span>}
              </button>
              {doneSincePrevOpen && (
                <div className="px-5 py-4 space-y-3 border-t" style={{ borderColor: 'var(--border)' }}>
                  {(() => {
                    const byProject = new Map<string, DoneSincePrevItem[]>()
                    for (const d of review.doneSincePrev) {
                      const key = d.projectCode || '__general__'
                      if (!byProject.has(key)) byProject.set(key, [])
                      byProject.get(key)!.push(d)
                    }
                    return Array.from(byProject.entries()).map(([code, items]) => (
                      <div key={code}>
                        <div className="text-xs font-bold mb-1.5" style={{ color: '#475569' }}>{code === '__general__' ? 'Công việc chung' : code}</div>
                        <div className="space-y-1">
                          {items.map(d => (
                            <div key={d.taskId} className="flex items-center gap-3 text-xs py-1.5 px-3 rounded-lg" style={{ background: '#f0fdf4' }}>
                              <span className="font-mono w-12 shrink-0" style={{ color: '#64748b' }}>{d.code || '—'}</span>
                              <a href={`/dashboard/work/${d.taskId}`} className="hover:underline flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{d.title}</a>
                              <span className="shrink-0 text-[11px]" style={{ color: '#64748b' }}>{d.assigneeNames.join(', ') || '—'}</span>
                              <span className="shrink-0 text-[11px]" style={{ color: '#94a3b8' }}>{fmtDate(d.completedAt)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Đối chiếu kỳ trước */}
          {review && (review.followUp.length > 0 || review.diff.new.length > 0 || review.diff.closed.length > 0 || review.diff.slipped.length > 0) && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <button
                onClick={() => setReviewOpen(!reviewOpen)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-opacity-80 transition-colors"
                style={{ background: '#f0f4ff' }}
              >
                <span className="font-bold text-sm" style={{ color: '#1d4ed8' }}>
                  {reviewOpen ? '▾' : '▸'} Đối chiếu kỳ trước
                  {review.lastSnapshot && <span className="font-normal text-xs ml-2" style={{ color: '#64748b' }}>chốt {new Date(review.lastSnapshot.weekOf).toLocaleDateString('vi-VN')}</span>}
                </span>
                <div className="flex gap-2">
                  {review.diff.new.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#dbeafe', color: '#1d4ed8' }}>{review.diff.new.length} mới</span>}
                  {review.diff.closed.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#dcfce7', color: '#16a34a' }}>{review.diff.closed.length} đóng</span>}
                  {review.diff.slipped.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fef2f2', color: '#dc2626' }}>{review.diff.slipped.length} trượt hạn</span>}
                </div>
              </button>
              {reviewOpen && (
                <div className="px-5 py-4 space-y-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  {review.followUp.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: '#475569' }}>Việc đã giao/quyết kỳ trước → hiện tại</h4>
                      <div className="space-y-1">
                        {review.followUp.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg" style={{ background: f.isDone ? '#f0fdf4' : f.isOverdue ? '#fef2f2' : '#f8fafc' }}>
                            <span className="font-semibold px-2 py-0.5 rounded-full" style={{ background: f.isDone ? '#dcfce7' : f.isOverdue ? '#fecaca' : '#e2e8f0', color: f.isDone ? '#16a34a' : f.isOverdue ? '#dc2626' : '#475569' }}>
                              {f.isDone ? 'Xong' : f.isOverdue ? `Trễ ${f.daysOverdue}d` : f.currentStatus === 'IN_PROGRESS' ? 'Đang làm' : f.currentStatus}
                            </span>
                            <a href={`/dashboard/work/${f.taskId}`} className="hover:underline flex-1" style={{ color: 'var(--text-primary)' }}>{f.title}</a>
                            {f.decision && <span className="text-[10px] truncate max-w-[200px]" style={{ color: '#64748b' }}>QĐ: {f.decision}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(review.diff.new.length > 0 || review.diff.closed.length > 0 || review.diff.slipped.length > 0) && (
                    <div>
                      <button onClick={() => setReviewDiffOpen(!reviewDiffOpen)} className="text-xs font-bold uppercase tracking-wide" style={{ color: '#475569' }}>
                        {reviewDiffOpen ? '▾' : '▸'} Diff so với kỳ trước
                      </button>
                      {reviewDiffOpen && (
                        <div className="mt-2 space-y-2">
                          {review.diff.new.length > 0 && (
                            <div>
                              <span className="text-[11px] font-semibold" style={{ color: '#1d4ed8' }}>Việc mới ({review.diff.new.length}):</span>
                              <div className="ml-3 mt-1 space-y-0.5">
                                {review.diff.new.slice(0, 10).map(t => (
                                  <div key={t.taskId} className="text-xs"><a href={`/dashboard/work/${t.taskId}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>{t.title}</a></div>
                                ))}
                                {review.diff.new.length > 10 && <div className="text-[10px]" style={{ color: '#94a3b8' }}>+{review.diff.new.length - 10} khác</div>}
                              </div>
                            </div>
                          )}
                          {review.diff.closed.length > 0 && (
                            <div>
                              <span className="text-[11px] font-semibold" style={{ color: '#16a34a' }}>Đã đóng ({review.diff.closed.length}):</span>
                              <div className="ml-3 mt-1 space-y-0.5">
                                {review.diff.closed.slice(0, 10).map(t => (
                                  <div key={t.taskId} className="text-xs" style={{ color: '#64748b' }}>{t.title} → {t.currentStatus}</div>
                                ))}
                                {review.diff.closed.length > 10 && <div className="text-[10px]" style={{ color: '#94a3b8' }}>+{review.diff.closed.length - 10} khác</div>}
                              </div>
                            </div>
                          )}
                          {review.diff.slipped.length > 0 && (
                            <div>
                              <span className="text-[11px] font-semibold" style={{ color: '#dc2626' }}>Trượt hạn ({review.diff.slipped.length}):</span>
                              <div className="ml-3 mt-1 space-y-0.5">
                                {review.diff.slipped.map(t => (
                                  <div key={t.taskId} className="text-xs">
                                    <a href={`/dashboard/work/${t.taskId}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>{t.title}</a>
                                    <span className="ml-1 text-[10px]" style={{ color: '#dc2626' }}>trễ {t.daysOverdue}d</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Lịch sử kỳ moved to "Thao tác kỳ" dropdown */}
                </div>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-2 flex-wrap items-center">
            <input
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Tìm theo tiêu đề / người..."
              className="text-sm px-3 py-2 rounded-lg flex-1"
              style={{ border: '1px solid var(--border)', background: '#f8fafc', minWidth: 200 }}
            />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-sm px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
              <option value="">Tất cả trạng thái</option>
              <option value="OPEN">Mới</option>
              <option value="IN_PROGRESS">Đang xử lý</option>
              <option value="AWAITING_REVIEW">Chờ kết thúc</option>
              <option value="RETURNED">Bị trả lại</option>
              <option value="DONE">Hoàn thành</option>
            </select>
            <select value={filterBlocked} onChange={(e) => setFilterBlocked(e.target.value)} className="text-sm px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
              <option value="">Tắc: tất cả</option>
              <option value="yes">Chỉ Tắc</option>
              <option value="no">Không tắc</option>
            </select>
            <select value={filterOverdue} onChange={(e) => setFilterOverdue(e.target.value)} className="text-sm px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
              <option value="">Thời gian: tất cả</option>
              <option value="yes">Quá hạn</option>
              <option value="due_soon">Đến hạn tuần này</option>
              <option value="done_week">Xong tuần này</option>
              <option value="new_week">Mới tuần này</option>
            </select>
            {(filterStatus || filterBlocked || filterOverdue || filterSearch || filterExecOnly) && (
              <button
                onClick={() => { setFilterStatus(''); setFilterBlocked(''); setFilterOverdue(''); setFilterSearch(''); setFilterExecOnly(false) }}
                className="text-xs px-3 py-2 rounded-lg"
                style={{ color: '#dc2626', border: '1px solid #fecaca', background: '#fef2f2' }}
              >
                Xoá bộ lọc
              </button>
            )}
          </div>

          {/* ═══ Executive Decision Section ═══ */}
          {execTasks.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#fef2f2', border: '2px solid #b91c1c33' }}>
              <div className="px-5 py-3 flex items-center gap-2" style={{ background: '#b91c1c11', borderBottom: '1px solid #b91c1c22' }}>
                <span className="text-base">🔺</span>
                <span className="font-bold text-sm" style={{ color: '#b91c1c' }}>Cần BGĐ quyết ({execTasks.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr style={{ background: '#fef2f2' }}>
                      <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 90 }}>Dự án</th>
                      <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#b91c1c' }}>Nội dung</th>
                      <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 120 }}>Người</th>
                      <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 130 }}>Lý do</th>
                      <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 180 }}>Đề xuất</th>
                      <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 180 }}>Quyết định BGĐ</th>
                      <th className="text-center px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 70 }}>Đẩy</th>
                      <th className="text-center px-4 py-2.5 font-semibold" style={{ color: '#b91c1c', width: 80 }}>Đã bàn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execTasks.map((t) => {
                      const isAuto = t.blocked || (t.isOverdue && t.daysOverdue >= 14)
                      const isManual = t.escalated && !isAuto
                      const reason = isAuto
                        ? (t.blocked ? 'Tự: tắc' : `Tự: quá hạn ${t.daysOverdue}d`)
                        : (t.escalated ? 'PM đẩy' : `Quá hạn ${t.daysOverdue}d`)
                      return (
                        <tr key={t.id} className="border-t" style={{ borderColor: '#b91c1c22', background: 'white' }}>
                          <td className="px-4 py-2.5 text-xs font-mono font-semibold" style={{ color: '#475569' }}>{t.projectCode || '—'}</td>
                          <td className="px-4 py-2.5">
                            <a href={`/dashboard/work/${t.id}`} className="hover:underline font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{t.title}</a>
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.assigneeNames.join(', ') || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: isAuto ? '#f1f5f9' : t.escalated ? '#faf5ff' : '#fef2f2', color: isAuto ? '#64748b' : t.escalated ? '#7c3aed' : '#dc2626' }}>
                              {reason}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {cellEditing === `${t.id}:proposal` ? (
                              <textarea
                                autoFocus defaultValue={t.proposal}
                                className="w-full text-xs px-2 py-1 rounded border resize-none"
                                style={{ borderColor: '#3b82f6', background: '#eff6ff', minHeight: 40 }}
                                onBlur={(e) => handleBriefingPatch(t.id, 'proposal', e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setCellEditing(null) }}
                              />
                            ) : (
                              <span className="cursor-pointer block min-h-[20px]" onClick={() => setCellEditing(`${t.id}:proposal`)}>
                                {t.proposal || <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>+ thêm</span>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {cellEditing === `${t.id}:decision` ? (
                              <textarea
                                autoFocus defaultValue={t.decision}
                                className="w-full text-xs px-2 py-1 rounded border resize-none"
                                style={{ borderColor: '#3b82f6', background: '#eff6ff', minHeight: 40 }}
                                onBlur={(e) => handleBriefingPatch(t.id, 'decision', e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setCellEditing(null) }}
                              />
                            ) : (
                              <span className="cursor-pointer block min-h-[20px]" onClick={() => setCellEditing(`${t.id}:decision`)}>
                                {t.decision || <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>+ thêm</span>}
                              </span>
                            )}
                            {t.decision && t.decisionByName && (
                              <span className="block text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                                — {t.decisionByName}, {t.decisionAt ? formatDate(t.decisionAt) : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {isAuto ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#94a3b8' }}>tự động</span>
                            ) : isManual ? (
                              <button
                                onClick={() => handleEscalate(t.id, false)}
                                className="text-[10px] font-semibold px-2 py-1 rounded-full transition-all"
                                style={{ background: '#faf5ff', color: '#7c3aed', border: '1px solid #7c3aed33' }}
                                title="Gỡ khỏi BGĐ"
                              >
                                Gỡ
                              </button>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => handleExecReview(t.id, true)}
                              className="text-[10px] font-semibold px-2 py-1 rounded-full transition-all"
                              style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #05966922' }}
                              title="Đánh dấu đã bàn trong tuần"
                            >
                              ✓ Đã bàn
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tồn đọng cần xử lý */}
          <h2 className="text-base font-bold mt-2" style={{ color: 'var(--text-primary)' }}>Tồn đọng cần xử lý</h2>
          {filteredGroups.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-secondary)' }}>Không có việc tồn đọng</p>
            </div>
          ) : (
            filteredGroups.map((g) => {
              const groupKey = g.project?.id || '__general__'
              const isOpen = expanded.has(groupKey)
              const sev = g.totalOverdue > 0 ? overdueSeverity(g.maxDaysOverdue) : { color: '#059669', bg: '#ecfdf5' }
              const blockedCount = g.tasks.filter(t => t.blocked).length
              const execCount = g.tasks.filter(t => t.needsExecDecision).length

              const renderCompactRow = (t: BriefingTask) => {
                const tsev = t.isOverdue ? overdueSeverity(t.daysOverdue) : { color: '#475569', bg: '#f1f5f9' }
                const statusDisplay = t.blocked
                  ? { label: 'Tắc', color: '#c2410c', bg: '#fff7ed' }
                  : (STATUS_LABELS[t.status] || { label: t.status, color: '#475569', bg: '#f1f5f9' })
                const isEditingThis = statusEditing === t.id
                const isActive = t.status !== 'DONE' && t.status !== 'CANCELLED'
                const isHighlighted = meetingMode && meetingTasks[meetingIdx]?.id === t.id
                const isExpanded = expandedTaskId === t.id
                const colCount = meetingMode ? 5 : 4
                return (
                  <React.Fragment key={t.id}>
                    <tr
                      ref={el => { if (el) rowRefs.current.set(t.id, el); else rowRefs.current.delete(t.id) }}
                      className={`border-t cursor-pointer hover:bg-blue-50/40 transition-colors ${isHighlighted ? 'ring-2 ring-inset ring-red-400' : ''}`}
                      style={{ borderColor: 'var(--border)', background: isHighlighted ? '#fef2f2' : isExpanded ? '#f0f4ff' : undefined }}
                      onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                    >
                      <td className="px-4 py-2.5">
                        {t.needsExecDecision && <span className="mr-1" title="Cần BGĐ quyết">🔺</span>}
                        {t.blocked && <span className="mr-1" title="Tắc">🔴</span>}
                        <a href={`/dashboard/work/${t.id}`} className="hover:underline font-medium" style={{ color: 'var(--text-primary)' }} onClick={e => e.stopPropagation()}>{t.title}</a>
                        {t.isDoneThisWeek && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#ecfdf5', color: '#059669' }}>xong</span>}
                        {t.isNewThisWeek && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#faf5ff', color: '#7c3aed' }}>mới</span>}
                        {t.actionItems.length > 0 && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{t.actionItems.length} việc</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.assigneeNames.join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(t.deadline)}</span>
                        {t.isOverdue ? (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: tsev.bg, color: tsev.color }}>{t.daysOverdue}d</span>
                        ) : t.isDueSoon ? (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#d97706' }}>còn {-t.daysOverdue}d</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isEditingThis ? (
                          <select
                            autoFocus
                            disabled={statusSaving}
                            className="text-xs px-1 py-1 rounded border"
                            style={{ borderColor: '#3b82f6', background: '#eff6ff' }}
                            defaultValue={t.blocked ? 'BLOCKED' : t.status}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === 'BLOCKED') handleStatusChange(t.id, 'IN_PROGRESS', true)
                              else handleStatusChange(t.id, v, false)
                            }}
                            onBlur={() => setStatusEditing(null)}
                            onClick={e => e.stopPropagation()}
                          >
                            <option value="OPEN">Mới</option>
                            <option value="IN_PROGRESS">Đang xử lý</option>
                            <option value="BLOCKED">Tắc</option>
                            <option value="AWAITING_REVIEW">Chờ kết thúc</option>
                            <option value="RETURNED">Bị trả lại</option>
                            <option value="DONE">Hoàn thành</option>
                          </select>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setStatusEditing(t.id) }}
                            className="text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all"
                            style={{ background: statusDisplay.bg, color: statusDisplay.color }}
                            title="Nhấn để đổi trạng thái"
                          >
                            {statusDisplay.label}
                          </button>
                        )}
                      </td>
                      {meetingMode && (
                        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={discussedThisWeek(t)}
                            onChange={(e) => handleDiscussed(t.id, e.target.checked)}
                            className="w-4 h-4 rounded cursor-pointer accent-green-600"
                            title={discussedThisWeek(t) ? 'Đã bàn — bỏ dấu?' : 'Đánh dấu đã bàn'}
                          />
                        </td>
                      )}
                    </tr>
                    {/* Expandable detail row */}
                    {isExpanded && (
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={colCount} className="px-5 py-3 border-t" style={{ borderColor: '#e2e8f0' }}>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <span className="font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Đề xuất / hướng xử lý</span>
                              {cellEditing === `${t.id}:proposal` ? (
                                <textarea
                                  autoFocus
                                  defaultValue={t.proposal}
                                  className="w-full text-xs px-2 py-1 rounded border resize-none"
                                  style={{ borderColor: '#3b82f6', background: '#eff6ff', minHeight: 48 }}
                                  onBlur={(e) => handleBriefingPatch(t.id, 'proposal', e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setCellEditing(null) }}
                                  onClick={e => e.stopPropagation()}
                                />
                              ) : (
                                <span className="cursor-pointer block min-h-[20px]" onClick={(e) => { e.stopPropagation(); setCellEditing(`${t.id}:proposal`) }}>
                                  {t.proposal || <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>+ thêm</span>}
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Quyết định BGĐ</span>
                              {cellEditing === `${t.id}:decision` ? (
                                <textarea
                                  autoFocus
                                  defaultValue={t.decision}
                                  className="w-full text-xs px-2 py-1 rounded border resize-none"
                                  style={{ borderColor: '#3b82f6', background: '#eff6ff', minHeight: 48 }}
                                  onBlur={(e) => handleBriefingPatch(t.id, 'decision', e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setCellEditing(null) }}
                                  onClick={e => e.stopPropagation()}
                                />
                              ) : (
                                <span className="cursor-pointer block min-h-[20px]" onClick={(e) => { e.stopPropagation(); setCellEditing(`${t.id}:decision`) }}>
                                  {t.decision || <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>+ thêm</span>}
                                </span>
                              )}
                              {t.decision && t.decisionByName && (
                                <span className="block text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                                  — {t.decisionByName}, {t.decisionAt ? formatDate(t.decisionAt) : ''}
                                </span>
                              )}
                              {t.execReviewedAt && (
                                <span className="inline-flex items-center gap-1 text-[10px] mt-0.5" style={{ color: '#059669' }}>
                                  ✓ đã bàn
                                  <button onClick={(e) => { e.stopPropagation(); handleExecReview(t.id, false) }} className="underline" style={{ color: '#94a3b8' }}>bỏ</button>
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>Ghi chú</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{t.notes || '—'}</span>
                            </div>
                          </div>
                          {isActive && (
                            <div className="flex gap-2 mt-3 pt-2 border-t flex-wrap" style={{ borderColor: '#e2e8f0' }}>
                              <button onClick={(e) => { e.stopPropagation(); openAction(t.id, 'reassign') }} className="text-[11px] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                👤 Đổi người
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); openAction(t.id, 'deadline') }} className="text-[11px] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                📅 Đổi hạn
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleToggleBlocked(t.id, t.blocked) }} className="text-[11px] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                {t.blocked ? '🟢 Gỡ tắc' : '🔴 Đánh dấu tắc'}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); openAction(t.id, 'action-item') }} className="text-[11px] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                ➕ Tạo việc
                              </button>
                              {!t.needsExecDecision && !t.escalated && (
                                <button onClick={(e) => { e.stopPropagation(); handleEscalate(t.id, true) }} className="text-[11px] px-3 py-1.5 rounded-lg hover:bg-purple-50 transition-colors" style={{ border: '1px solid #7c3aed33', color: '#7c3aed' }}>
                                  ▲ Đẩy BGĐ
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              }

              return (
                <div key={groupKey} className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <button onClick={() => toggleProject(groupKey)} className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-opacity-80 transition-colors" style={{ background: 'var(--surface)' }}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {g.project?.projectCode || 'Công việc chung'}
                        {g.project && <span className="font-normal text-xs ml-1.5" style={{ color: 'var(--text-secondary)' }}>{g.project.projectName}</span>}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center text-xs">
                      <span className="font-medium px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#475569' }}>{g.totalTasks} tồn đọng</span>
                      {g.totalOverdue > 0 && <span className="font-semibold px-2 py-0.5 rounded-full" style={{ background: sev.bg, color: sev.color }}>{g.totalOverdue} quá hạn</span>}
                      {blockedCount > 0 && <span className="font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fff7ed', color: '#c2410c' }}>{blockedCount} tắc</span>}
                      {execCount > 0 && <span className="font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#b91c1c' }}>{execCount} BGĐ</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); openProjectTask(g.project?.id || '', g.project?.projectCode || 'Chung') }}
                        className="font-semibold px-2.5 py-1 rounded-lg hover:ring-1 transition-all"
                        style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #1d4ed822' }}
                      >
                        + Thêm việc
                      </button>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ background: 'var(--surface-alt, #f8fafc)' }}>
                              <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>Nội dung</th>
                              <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--text-muted)', width: 130 }}>Người</th>
                              <th className="text-left px-4 py-2 font-semibold" style={{ color: 'var(--text-muted)', width: 130 }}>Hạn</th>
                              <th className="text-center px-4 py-2 font-semibold" style={{ color: 'var(--text-muted)', width: 110 }}>Trạng thái</th>
                              {meetingMode && <th className="text-center px-2 py-2 font-semibold" style={{ color: 'var(--text-muted)', width: 50 }}>Bàn</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {g.activeTasks.map((t) => renderCompactRow(t))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
          {/* Action dropdown removed — actions now inline in expandable detail row */}
          {/* ═══ Action Modal ═══ */}
          {actionMode && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActionMode(null)}>
              <div className="rounded-xl shadow-xl w-full max-w-md mx-4 p-5 space-y-4" style={{ background: 'var(--surface, #fff)' }} onClick={e => e.stopPropagation()}>
                {actionMode.mode === 'reassign' && (
                  <>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Đổi người thực hiện</h3>
                    <div className="space-y-2">
                      <input
                        className="w-full text-sm px-3 py-2 rounded-lg border"
                        style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                        placeholder="Tìm tên..."
                        value={reassignQuery}
                        onChange={e => setReassignQuery(e.target.value)}
                      />
                      <div className="max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                        {filteredActionUsers.map(u => (
                          <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={reassignPicks.includes(u.id)}
                              onChange={e => {
                                if (e.target.checked) setReassignPicks(p => [...p, u.id])
                                else setReassignPicks(p => p.filter(x => x !== u.id))
                              }}
                            />
                            <span>{u.fullName}</span>
                            <span style={{ color: 'var(--text-muted)' }}>({DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode})</span>
                          </label>
                        ))}
                      </div>
                      {reassignPicks.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {reassignPicks.map(uid => {
                            const u = actionUsers.find(x => x.id === uid)
                            return <span key={uid} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{u?.fullName || uid}</span>
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setActionMode(null)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
                      <button onClick={handleReassign} disabled={actionSaving || reassignPicks.length === 0} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
                        {actionSaving ? 'Đang lưu...' : 'Xác nhận'}
                      </button>
                    </div>
                  </>
                )}

                {actionMode.mode === 'deadline' && (
                  <>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Đổi hạn hoàn thành</h3>
                    <input
                      type="date"
                      className="w-full text-sm px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                      value={newDeadline}
                      onChange={e => setNewDeadline(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setActionMode(null)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
                      <button onClick={handleDeadlineChange} disabled={actionSaving} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
                        {actionSaving ? 'Đang lưu...' : 'Xác nhận'}
                      </button>
                    </div>
                  </>
                )}

                {actionMode.mode === 'action-item' && (
                  <>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Tạo việc từ đề xuất</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Tiêu đề *</label>
                        <input
                          className="w-full text-sm px-3 py-2 rounded-lg border"
                          style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                          value={actionItemTitle}
                          onChange={e => setActionItemTitle(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Người nhận *</label>
                        <input
                          className="w-full text-sm px-3 py-2 rounded-lg border"
                          style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                          placeholder="Tìm tên..."
                          value={actionItemQuery}
                          onChange={e => setActionItemQuery(e.target.value)}
                        />
                        <div className="max-h-36 overflow-y-auto rounded-lg border mt-1" style={{ borderColor: 'var(--border)' }}>
                          {filteredActionUsers.map(u => (
                            <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 cursor-pointer text-xs">
                              <input
                                type="checkbox"
                                checked={actionItemPicks.includes(u.id)}
                                onChange={e => {
                                  if (e.target.checked) setActionItemPicks(p => [...p, u.id])
                                  else setActionItemPicks(p => p.filter(x => x !== u.id))
                                }}
                              />
                              <span>{u.fullName}</span>
                              <span style={{ color: 'var(--text-muted)' }}>({DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode})</span>
                            </label>
                          ))}
                        </div>
                        {actionItemPicks.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {actionItemPicks.map(uid => {
                              const u = actionUsers.find(x => x.id === uid)
                              return <span key={uid} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{u?.fullName || uid}</span>
                            })}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Hạn (tuỳ chọn)</label>
                        <input
                          type="date"
                          className="w-full text-sm px-3 py-2 rounded-lg border"
                          style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                          value={actionItemDeadline}
                          onChange={e => setActionItemDeadline(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setActionMode(null)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
                      <button onClick={handleCreateActionItem} disabled={actionSaving || !actionItemTitle.trim() || actionItemPicks.length === 0} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
                        {actionSaving ? 'Đang tạo...' : 'Tạo việc'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Project task modal */}
          {projectTaskModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setProjectTaskModal(null)}>
              <div className="rounded-xl shadow-xl w-full max-w-md mx-4 p-5 space-y-4" style={{ background: 'var(--surface, #fff)' }} onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Thêm việc — {projectTaskModal.projectCode}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Tiêu đề *</label>
                    <input
                      className="w-full text-sm px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                      value={ptTitle}
                      onChange={e => setPtTitle(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Người nhận *</label>
                    <input
                      className="w-full text-sm px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                      placeholder="Tìm tên..."
                      value={ptQuery}
                      onChange={e => setPtQuery(e.target.value)}
                    />
                    <div className="max-h-36 overflow-y-auto rounded-lg border mt-1" style={{ borderColor: 'var(--border)' }}>
                      {filteredPtUsers.map(u => (
                        <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={ptPicks.includes(u.id)}
                            onChange={e => {
                              if (e.target.checked) setPtPicks(p => [...p, u.id])
                              else setPtPicks(p => p.filter(x => x !== u.id))
                            }}
                          />
                          <span>{u.fullName}</span>
                          <span style={{ color: 'var(--text-muted)' }}>({DEPT_NAME[ROLE_TO_DEPT[u.roleCode]] || u.roleCode})</span>
                        </label>
                      ))}
                    </div>
                    {ptPicks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ptPicks.map(uid => {
                          const u = actionUsers.find(x => x.id === uid)
                          return <span key={uid} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{u?.fullName || uid}</span>
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Hạn (tuỳ chọn)</label>
                    <input
                      type="date"
                      className="w-full text-sm px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border)', background: '#f8fafc' }}
                      value={ptDeadline}
                      onChange={e => setPtDeadline(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Mô tả (tuỳ chọn)</label>
                    <textarea
                      className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
                      style={{ borderColor: 'var(--border)', background: '#f8fafc', minHeight: 60 }}
                      value={ptDescription}
                      onChange={e => setPtDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setProjectTaskModal(null)} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Hủy</button>
                  <button onClick={handleProjectTask} disabled={ptSaving || !ptTitle.trim() || ptPicks.length === 0} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
                    {ptSaving ? 'Đang tạo...' : 'Tạo việc'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* History modal */}
          {historyOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setHistoryOpen(false)}>
              <div className="rounded-xl shadow-xl w-full max-w-lg mx-4 p-5 space-y-3" style={{ background: 'var(--surface, #fff)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Lịch sử kỳ giao ban</h3>
                  <button onClick={() => setHistoryOpen(false)} className="text-lg" style={{ color: 'var(--text-muted)' }}>✕</button>
                </div>
                {snapshotHistory.length === 0 ? (
                  <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có kỳ nào được chốt.</p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {snapshotHistory.map(s => (
                      <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-lg" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
                        <div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Tuần {new Date(s.weekOf).toLocaleDateString('vi-VN')}</div>
                          <div className="text-[11px]" style={{ color: '#64748b' }}>Chốt lúc {new Date(s.createdAt).toLocaleString('vi-VN')}</div>
                        </div>
                        <div className="flex gap-2 text-[11px]">
                          {s.kpi && (
                            <>
                              <span className="px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{(s.kpi as Record<string, number>).active || 0} active</span>
                              <span className="px-2 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#dc2626' }}>{(s.kpi as Record<string, number>).overdue || 0} quá hạn</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Toast */}
          {toast && (
            <div className="fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 shadow-lg text-sm font-medium animate-fade-in"
              style={{ background: toast.ok ? '#ecfdf5' : '#fef2f2', color: toast.ok ? '#065f46' : '#991b1b', border: `1px solid ${toast.ok ? '#a7f3d0' : '#fecaca'}` }}>
              {toast.msg}
            </div>
          )}
        </>
      )}

      {/* ════ Import Tab ════ */}
      {activeTab === 'import' && (<>

      {/* ════ Import: Editable Preview ════ */}
      {previewing && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '2px solid var(--border)' }}>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-6 w-6 border-4 border-blue-500 border-t-transparent rounded-full" />
            <span className="ml-3 text-sm" style={{ color: 'var(--text-muted)' }}>Đang đọc file...</span>
          </div>
        </div>
      )}

      {editRows && summary && (
        <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '2px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Xem trước & sửa import</h2>
            <button onClick={resetImport} className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-muted)' }}>Hủy</button>
          </div>

          {/* Summary */}
          <div className="flex gap-4 text-sm flex-wrap">
            <span style={{ color: 'var(--text-muted)' }}>Tổng: {summary.total}</span>
            <span style={{ color: '#059669' }}>Tạo mới: {summary.toCreate}</span>
            <span style={{ color: '#1d4ed8' }}>Cập nhật: {summary.toUpdate}</span>
            {summary.projectsNew > 0 && <span style={{ color: '#7c3aed' }}>DA mới: {summary.projectsNew}</span>}
            {summary.titleCollisions > 0 && <span style={{ color: '#b45309' }}>Trùng tiêu đề: {summary.titleCollisions}</span>}
            {summary.errors > 0 && <span style={{ color: '#dc2626' }}>Lỗi: {summary.errors}</span>}
          </div>

          {/* Editable Table — grouped by project */}
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-xs" style={{ minWidth: 1100 }}>
              <thead className="sticky top-0 z-10">
                <tr style={{ background: 'var(--surface-alt, #f8fafc)' }}>
                  <th className="px-2 py-2 text-center" style={{ width: 36 }}>
                    <input type="checkbox" checked={editRows.every((r) => r.include)} onChange={(e) => setEditRows((prev) => prev!.map((r) => ({ ...r, include: e.target.checked })))} />
                  </th>
                  <th className="px-2 py-2 text-center font-semibold" style={{ color: 'var(--text-muted)', width: 70 }}>Hành động</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', minWidth: 200 }}>Nội dung</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', width: 120 }}>Phòng xử lý</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', width: 170 }}>Người thực hiện</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', width: 120 }}>Hạn</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', width: 110 }}>Trạng thái</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', width: 140 }}>Ghi chú</th>
                  <th className="px-2 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)', width: 160 }}>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {groupRowsByProject(editRows).map((grp) => (
                  <GroupSection key={grp.key} grp={grp} dbUsers={dbUsers} updateRow={updateRow} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Action bar */}
          <div className="flex gap-3 justify-end items-center">
            <button onClick={resetImport} className="text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              Hủy
            </button>
            <button
              onClick={handleApply}
              disabled={applying || summary.included === 0}
              className="btn-primary text-sm px-5 py-2 rounded-lg disabled:opacity-50"
            >
              {applying ? 'Đang ghi...' : `Xác nhận & tạo task (${summary.included} dòng)`}
            </button>
          </div>
        </div>
      )}

      {/* Import result banner */}
      {importResult && (
        <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <div className="text-sm" style={{ color: '#065f46' }}>
            Import hoàn tất: tạo {importResult.created}, cập nhật {importResult.updated}
            {importResult.projectsCreated > 0 && <span>, {importResult.projectsCreated} DA mới</span>}
            {importResult.skipped > 0 && <span>, bỏ qua {importResult.skipped}</span>}
            {importResult.errors.length > 0 && <span style={{ color: '#dc2626' }}>, {importResult.errors.length} lỗi</span>}
          </div>
          <button onClick={resetImport} className="text-xs px-3 py-1 rounded" style={{ color: '#065f46' }}>Đóng</button>
        </div>
      )}

      {/* Empty state */}
      {kpi.overdue === 0 && !editRows && !importResult && (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-lg font-semibold" style={{ color: 'var(--text-secondary)' }}>Không có việc quá hạn</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Tất cả công việc đều đang đúng tiến độ.</p>
        </div>
      )}

      {/* ════ Overdue Project Accordions ════ */}
      {groups.filter((g) => g.totalOverdue > 0).map((g) => {
        const groupKey = g.project?.id || '__general__'
        const isOpen = expanded.has(groupKey)
        const sev = overdueSeverity(g.maxDaysOverdue)
        return (
          <div key={groupKey} className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <button onClick={() => toggleProject(groupKey)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-opacity-80 transition-colors" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center gap-3">
                <span className="text-lg font-mono" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                <div>
                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{g.project?.projectCode || 'Công việc chung'}</span>
                  {g.project && <span className="text-sm ml-2" style={{ color: 'var(--text-secondary)' }}>{g.project.projectName}</span>}
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: sev.bg, color: sev.color }}>
                {g.totalOverdue} quá hạn · max {g.maxDaysOverdue} ngày
              </span>
            </button>

            {isOpen && (
              <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--surface-alt, #f8fafc)' }}>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 70 }}>Mã</th>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Nội dung</th>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 140 }}>Người thực hiện</th>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 90 }}>Hạn</th>
                        <th className="text-center px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 80 }}>Quá hạn</th>
                        <th className="text-center px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 100 }}>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.tasks.filter((t) => t.isOverdue).map((t) => {
                        const tsev = overdueSeverity(t.daysOverdue)
                        const tst = t.blocked
                          ? { label: 'Tắc', color: '#c2410c', bg: '#fff7ed' }
                          : (STATUS_LABELS[t.status] || { label: t.status, color: '#475569', bg: '#f1f5f9' })
                        return (
                          <tr key={t.id} className="border-t hover:bg-opacity-50" style={{ borderColor: 'var(--border)' }}>
                            <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{t.taskType !== 'FREE' ? t.taskType : '—'}</td>
                            <td className="px-4 py-2.5">
                              <a href={`/dashboard/work/${t.id}`} className="hover:underline font-medium" style={{ color: 'var(--text-primary)' }}>{t.title}</a>
                            </td>
                            <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.assigneeNames.join(', ') || '—'}</td>
                            <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtDate(t.deadline)}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: tsev.bg, color: tsev.color }}>{t.daysOverdue}d</span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: tst.bg, color: tst.color }}>{tst.label}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}

      </>)}
    </div>
  )
}

// ════════════════════════════════════════
//  GroupSection — project group in import preview
// ════════════════════════════════════════

function GroupSection({ grp, dbUsers, updateRow }: {
  grp: RowGroup
  dbUsers: DBUser[]
  updateRow: (idx: number, patch: Partial<EditableRow>) => void
}) {
  return (
    <>
      {/* Project header row */}
      <tr>
        <td colSpan={9} className="px-3 py-2 font-semibold text-xs" style={{
          background: grp.isNew ? '#faf5ff' : '#f0f9ff',
          borderBottom: '2px solid',
          borderColor: grp.isNew ? '#c4b5fd' : '#93c5fd',
          color: grp.isNew ? '#6d28d9' : '#1e40af',
        }}>
          {grp.isNew ? '🆕 ' : '📁 '}{grp.label}
          {grp.isNew && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded-full" style={{ background: '#ede9fe', color: '#7c3aed' }}>DA mới</span>}
          <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>({grp.rows.length} dòng)</span>
        </td>
      </tr>
      {grp.rows.map(({ row: r, idx }) => {
        const isError = r.action === 'error' && !r.include
        const noOkAssignee = !(r.assignees || []).some(a => a.match === 'ok' && a.userId)
        const hasWarning = r.action === 'create' && r.include && noOkAssignee && !r.roleCode
        const rowBg = isError ? '#fef2f2' : hasWarning ? '#fffbeb' : undefined
        const st = ACTION_STYLE[r.action] || ACTION_STYLE.error

        return (
          <tr key={idx} className="border-t" style={{ borderColor: 'var(--border)', background: rowBg }}>
            {/* Include */}
            <td className="px-2 py-1.5 text-center">
              <input type="checkbox" checked={r.include} onChange={(e) => updateRow(idx, { include: e.target.checked })} />
            </td>

            {/* Action badge */}
            <td className="px-2 py-1.5 text-center">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: st.bg, color: st.color }}>{st.label}</span>
            </td>

            {/* Title */}
            <td className="px-2 py-1.5">
              <input
                className="w-full text-xs px-1 py-1 rounded border"
                style={{ borderColor: r.titleCollision ? '#f59e0b' : 'var(--border)', background: r.titleCollision ? '#fffbeb' : 'var(--surface)' }}
                value={r.title}
                onChange={(e) => updateRow(idx, { title: e.target.value })}
              />
              {r.titleCollision && r.collisionInfo && (
                <div className="mt-1">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                      Trùng tiêu đề
                    </span>
                  </div>
                  <select
                    className="w-full text-[10px] px-1 py-0.5 rounded border mt-0.5"
                    style={{ borderColor: '#f59e0b', background: '#fffbeb' }}
                    value={r.resolveTo || 'create'}
                    onChange={(e) => updateRow(idx, { resolveTo: e.target.value as 'create' | 'update' })}
                  >
                    <option value="create">Tạo việc mới</option>
                    <option value="update">
                      {`Cập nhật: ${r.collisionInfo.assignee} · hạn ${r.collisionInfo.deadline || 'chưa có'}`}
                    </option>
                  </select>
                </div>
              )}
            </td>

            {/* Dept */}
            <td className="px-2 py-1.5">
              <select
                className="w-full text-xs px-1 py-1 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                value={r.roleCode || ''}
                onChange={(e) => {
                  const rc = e.target.value || null
                  updateRow(idx, { roleCode: rc, deptText: (rc ? DEPT_NAME[ROLE_TO_DEPT[rc]] : '') || '' })
                }}
              >
                <option value="">—</option>
                {DEPT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </td>

            {/* Assignee — multi-person autocomplete */}
            <td className="px-2 py-1.5">
              {(r.assignees && r.assignees.length > 0) ? r.assignees.map((a, ai) => (
                <div key={ai} className="flex items-center gap-1 mb-0.5">
                  <div className="flex-1">
                    <UserAutocomplete
                      value={a.match === 'ok' && a.userId ? (dbUsers.find(u => u.id === a.userId)?.fullName || a.inputName) : a.inputName}
                      users={a.match === 'ambiguous' ? a.candidates.map(c => ({ ...c, isActive: true })) : dbUsers}
                      warning={a.match !== 'ok'}
                      onChange={(name, userId) => {
                        const next = [...(r.assignees || [])]
                        next[ai] = { ...next[ai], userId, match: userId ? 'ok' : 'none', inputName: name, candidates: userId ? [] : next[ai].candidates }
                        updateRow(idx, { assignees: next })
                      }}
                    />
                  </div>
                  {a.match === 'ok' && <span style={{ color: '#059669', fontSize: '0.6rem', flexShrink: 0 }}>✓</span>}
                </div>
              )) : (
                <UserAutocomplete
                  value=""
                  users={dbUsers}
                  warning={false}
                  onChange={(name, userId) => {
                    updateRow(idx, { assignees: [{ inputName: name, userId, match: userId ? 'ok' : 'none', matchMethod: '', candidates: [] }] })
                  }}
                />
              )}
            </td>

            {/* Deadline */}
            <td className="px-2 py-1.5">
              <input
                type="date"
                className="w-full text-xs px-1 py-1 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                value={r.deadlineISO}
                onChange={(e) => updateRow(idx, { deadlineISO: e.target.value, deadline: e.target.value, hasNoDeadline: !e.target.value })}
              />
              {!r.deadlineISO && r.action === 'create' && r.include && (
                <span className="text-[10px] mt-0.5 inline-block" style={{ color: '#b45309' }}>chưa có hạn</span>
              )}
            </td>

            {/* Status */}
            <td className="px-2 py-1.5">
              <select
                className="w-full text-xs px-1 py-1 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                value={r.status}
                onChange={(e) => updateRow(idx, { status: e.target.value })}
              >
                <option value="">—</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </td>

            {/* Notes */}
            <td className="px-2 py-1.5">
              <input
                className="w-full text-xs px-1 py-1 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                value={r.notes}
                onChange={(e) => updateRow(idx, { notes: e.target.value })}
              />
            </td>

            {/* Detail */}
            <td className="px-2 py-1.5 text-xs" style={{ color: r.detail ? '#dc2626' : 'var(--text-muted)' }}>
              {r.detail || ''}
            </td>
          </tr>
        )
      })}
    </>
  )
}
