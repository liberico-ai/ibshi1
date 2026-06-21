'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { apiFetch } from '@/hooks/useAuth'

// ── Types ──

interface BriefingTask {
  id: string
  taskType: string
  title: string
  status: string
  priority: string
  blocked: boolean
  startedAt: string | null
  deadline: string | null
  completedAt: string | null
  daysOverdue: number
  isOverdue: boolean
  isDoneThisWeek: boolean
  isNewThisWeek: boolean
  assigneeNames: string[]
  criteria: string
  proposal: string
  decision: string
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
  blocked: number
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
}

interface EditableRow extends PreviewRow {
  include: boolean
  projectMode: 'existing' | 'create' | 'none'
  projectId: string | null
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

const DEPT_OPTIONS = [
  { value: 'R01', label: 'Ban GĐ' },
  { value: 'R02', label: 'Dự án' },
  { value: 'R03', label: 'Kế hoạch' },
  { value: 'R04', label: 'Thiết kế' },
  { value: 'R05', label: 'Kho' },
  { value: 'R06', label: 'Sản xuất' },
  { value: 'R07', label: 'Thương mại' },
  { value: 'R08', label: 'Kế toán' },
  { value: 'R09', label: 'QC' },
  { value: 'R10', label: 'HCNS' },
]

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
              {u.fullName} <span style={{ color: 'var(--text-muted)' }}>({DEPT_OPTIONS.find((d) => d.value === u.roleCode)?.label || u.roleCode})</span>
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
  const [kpi, setKpi] = useState<KPI>({ total: 0, active: 0, overdue: 0, blocked: 0, doneThisWeek: 0, newThisWeek: 0 })
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

  // Import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewing, setPreviewing] = useState(false)
  const [editRows, setEditRows] = useState<EditableRow[] | null>(null)
  const [dbProjects, setDbProjects] = useState<DBProject[]>([])
  const [dbUsers, setDbUsers] = useState<DBUser[]>([])
  const [applying, setApplying] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/work/briefing/agenda').then((r) => {
      if (r.ok) {
        setGroups(r.groups || [])
        setKpi(r.kpi || { total: 0, active: 0, overdue: 0, blocked: 0, doneThisWeek: 0, newThisWeek: 0 })
        const allIds = new Set<string>((r.groups || []).map((g: ProjectGroup) => g.project?.id || '__general__'))
        setExpanded(allIds)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => { load() }, [load])

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
  } : null

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  // Filtered tasks for dashboard
  const filteredGroups = useMemo(() => {
    return groups.map((g) => {
      let tasks = g.tasks
      if (filterStatus) tasks = tasks.filter((t) => t.status === filterStatus)
      if (filterBlocked === 'yes') tasks = tasks.filter((t) => t.blocked)
      if (filterBlocked === 'no') tasks = tasks.filter((t) => !t.blocked)
      if (filterOverdue === 'yes') tasks = tasks.filter((t) => t.isOverdue)
      if (filterOverdue === 'done_week') tasks = tasks.filter((t) => t.isDoneThisWeek)
      if (filterOverdue === 'new_week') tasks = tasks.filter((t) => t.isNewThisWeek)
      if (filterSearch.trim()) {
        const q = rmDiacritics(filterSearch.toLowerCase())
        tasks = tasks.filter((t) =>
          rmDiacritics(t.title.toLowerCase()).includes(q) ||
          t.assigneeNames.some((n) => rmDiacritics(n.toLowerCase()).includes(q))
        )
      }
      return { ...g, tasks, totalTasks: tasks.length }
    }).filter((g) => g.tasks.length > 0)
  }, [groups, filterStatus, filterBlocked, filterOverdue, filterSearch])

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

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Giao ban tuần</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{kpi.active} việc đang mở · {kpi.overdue} quá hạn · {groups.length} dự án</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Tải lại</button>
          <label className="text-sm px-4 py-2 rounded-lg cursor-pointer" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Import biên bản
            <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={handleFileSelect} />
          </label>
          <button onClick={handleExport} disabled={exporting || kpi.total === 0} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
            {exporting ? 'Đang xuất...' : 'Xuất biên bản'}
          </button>
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
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Tổng task', value: kpi.total, color: '#475569', bg: '#f1f5f9' },
              { label: 'Đang xử lý', value: kpi.active, color: '#1d4ed8', bg: '#eff6ff' },
              { label: 'Quá hạn', value: kpi.overdue, color: '#dc2626', bg: '#fef2f2' },
              { label: 'Tắc', value: kpi.blocked, color: '#c2410c', bg: '#fff7ed' },
              { label: 'Xong tuần này', value: kpi.doneThisWeek, color: '#059669', bg: '#ecfdf5' },
              { label: 'Mới tuần này', value: kpi.newThisWeek, color: '#7c3aed', bg: '#faf5ff' },
            ].map((card) => (
              <div key={card.label} className="rounded-xl p-4 text-center" style={{ background: card.bg, border: `1px solid ${card.color}22` }}>
                <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
                <div className="text-xs font-medium mt-1" style={{ color: card.color }}>{card.label}</div>
              </div>
            ))}
          </div>

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
              <option value="done_week">Xong tuần này</option>
              <option value="new_week">Mới tuần này</option>
            </select>
            {(filterStatus || filterBlocked || filterOverdue || filterSearch) && (
              <button
                onClick={() => { setFilterStatus(''); setFilterBlocked(''); setFilterOverdue(''); setFilterSearch('') }}
                className="text-xs px-3 py-2 rounded-lg"
                style={{ color: '#dc2626', border: '1px solid #fecaca', background: '#fef2f2' }}
              >
                Xoá bộ lọc
              </button>
            )}
          </div>

          {/* Grouped table */}
          {filteredGroups.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-secondary)' }}>Không có việc nào khớp bộ lọc</p>
            </div>
          ) : (
            filteredGroups.map((g) => {
              const groupKey = g.project?.id || '__general__'
              const isOpen = expanded.has(groupKey)
              const sev = g.totalOverdue > 0 ? overdueSeverity(g.maxDaysOverdue) : { color: '#059669', bg: '#ecfdf5' }
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
                    <div className="flex gap-2 items-center">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#475569' }}>{g.totalTasks} việc</span>
                      {g.totalOverdue > 0 && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: sev.bg, color: sev.color }}>
                          {g.totalOverdue} quá hạn
                        </span>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ minWidth: 900 }}>
                          <thead>
                            <tr style={{ background: 'var(--surface-alt, #f8fafc)' }}>
                              <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 70 }}>Mã</th>
                              <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Nội dung</th>
                              <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 140 }}>Người thực hiện</th>
                              <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 90 }}>Hạn</th>
                              <th className="text-center px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 80 }}>Quá hạn</th>
                              <th className="text-center px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 130 }}>Trạng thái</th>
                              <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 150 }}>Ghi chú</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.tasks.map((t) => {
                              const tsev = t.isOverdue ? overdueSeverity(t.daysOverdue) : { color: '#475569', bg: '#f1f5f9' }
                              const statusDisplay = t.blocked
                                ? { label: 'Tắc', color: '#c2410c', bg: '#fff7ed' }
                                : (STATUS_LABELS[t.status] || { label: t.status, color: '#475569', bg: '#f1f5f9' })
                              const isEditingThis = statusEditing === t.id
                              return (
                                <tr key={t.id} className="border-t hover:bg-opacity-50" style={{ borderColor: 'var(--border)' }}>
                                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{t.taskType !== 'FREE' ? t.taskType : '—'}</td>
                                  <td className="px-4 py-2.5">
                                    <a href={`/dashboard/work/${t.id}`} className="hover:underline font-medium" style={{ color: 'var(--text-primary)' }}>{t.title}</a>
                                    {t.isDoneThisWeek && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#ecfdf5', color: '#059669' }}>xong</span>}
                                    {t.isNewThisWeek && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#faf5ff', color: '#7c3aed' }}>mới</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.assigneeNames.join(', ') || '—'}</td>
                                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtDate(t.deadline)}</td>
                                  <td className="px-4 py-2.5 text-center">
                                    {t.isOverdue ? (
                                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: tsev.bg, color: tsev.color }}>{t.daysOverdue}d</span>
                                    ) : t.daysOverdue < 0 ? (
                                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{-t.daysOverdue}d</span>
                                    ) : (
                                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                                    )}
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
                                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.notes || t.decision || '—'}</td>
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
            })
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
                  <GroupSection key={grp.key} grp={grp} dbProjects={dbProjects} dbUsers={dbUsers} updateRow={updateRow} />
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

function GroupSection({ grp, dbProjects, dbUsers, updateRow }: {
  grp: RowGroup
  dbProjects: DBProject[]
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
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                value={r.title}
                onChange={(e) => updateRow(idx, { title: e.target.value })}
              />
            </td>

            {/* Dept */}
            <td className="px-2 py-1.5">
              <select
                className="w-full text-xs px-1 py-1 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                value={r.roleCode || ''}
                onChange={(e) => {
                  const rc = e.target.value || null
                  updateRow(idx, { roleCode: rc, deptText: DEPT_OPTIONS.find((d) => d.value === rc)?.label || '' })
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
