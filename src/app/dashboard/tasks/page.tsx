'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { getStatusBg, getUrgencyLabel, formatDate } from '@/lib/utils'
import { SearchBar } from '@/components/SearchPagination'

interface Task {
  id: string; stepCode: string; stepName: string; assignedRole: string; status: string;
  deadline: string | null; notes: string | null; urgency: string;
  project: { projectCode: string; projectName: string; clientName: string };
  assignee: { fullName: string; username: string } | null;
}

const STATUS_TABS = [
  { value: '', label: 'Tất cả', dot: '' },
  { value: 'overdue', label: 'Quá hạn', dot: '#e63946' },
  { value: 'today', label: 'Hôm nay', dot: '#d97706' },
  { value: 'this_week', label: 'Tuần này', dot: '#2563eb' },
  { value: 'normal', label: 'Không deadline', dot: '#94a3b8' },
]

export default function TasksPage() {
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState('')

  useEffect(() => { loadTasks() }, [])

  async function loadTasks() {
    const res = await apiFetch('/api/tasks')
    if (res.ok) setAllTasks(res.tasks)
    setLoading(false)
  }

  async function handleComplete(taskId: string) {
    setCompleting(taskId)
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'complete', notes: 'Completed from inbox' }),
    })
    if (res.ok) await loadTasks()
    setCompleting(null)
  }

  // Client-side filter
  const filtered = allTasks.filter((t) => {
    if (urgencyFilter && t.urgency !== urgencyFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return t.stepCode.toLowerCase().includes(q) ||
        t.stepName.toLowerCase().includes(q) ||
        t.project.projectCode.toLowerCase().includes(q) ||
        t.project.projectName.toLowerCase().includes(q)
    }
    return true
  })

  // Group by urgency
  const grouped = {
    overdue: filtered.filter(t => t.urgency === 'overdue'),
    today: filtered.filter(t => t.urgency === 'today'),
    this_week: filtered.filter(t => t.urgency === 'this_week'),
    normal: filtered.filter(t => t.urgency === 'normal'),
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-10 w-56 skeleton rounded-xl" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 skeleton rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Công việc của tôi</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{allTasks.length} task cần xử lý</p>
        </div>
        {/* Quick stats */}
        <div className="flex gap-2 stagger-children">
        {allTasks.filter(t => t.urgency === 'overdue').length > 0 && (
            <div className="px-3.5 py-1.5 rounded-full text-xs font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid #fecaca' }}>
              ⚠️ {allTasks.filter(t => t.urgency === 'overdue').length} quá hạn
            </div>
          )}
          {allTasks.filter(t => t.urgency === 'today').length > 0 && (
            <div className="px-3.5 py-1.5 rounded-full text-xs font-bold" style={{ background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid #fef08a' }}>
              📅 {allTasks.filter(t => t.urgency === 'today').length} hôm nay
            </div>
          )}
        </div>
      </div>

      {/* Search + Urgency filter tabs */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="w-72"><SearchBar value={search} onChange={setSearch} placeholder="Tìm step, mã DA, tên DA..." /></div>
        <div className="flex gap-2">
          {STATUS_TABS.map((tab) => (
            <button key={tab.value} onClick={() => setUrgencyFilter(tab.value)}
              className="px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5" style={{
                background: urgencyFilter === tab.value ? 'var(--primary)' : 'var(--bg-card)',
                color: urgencyFilter === tab.value ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${urgencyFilter === tab.value ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-pill)',
                boxShadow: urgencyFilter === tab.value ? 'var(--shadow-xs)' : 'none',
              }}>
              {tab.dot && <span className="w-2 h-2 rounded-full inline-block" style={{ background: urgencyFilter === tab.value ? 'white' : tab.dot }} />} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task groups */}
      {urgencyFilter ? (
        <TaskList tasks={filtered} onComplete={handleComplete} completing={completing} />
      ) : (
        <>
          {grouped.overdue.length > 0 && <TaskSection title="Quá hạn" tasks={grouped.overdue} onComplete={handleComplete} completing={completing} dotColor="#dc2626" />}
          {grouped.today.length > 0 && <TaskSection title="Hôm nay" tasks={grouped.today} onComplete={handleComplete} completing={completing} dotColor="#eab308" />}
          {grouped.this_week.length > 0 && <TaskSection title="Tuần này" tasks={grouped.this_week} onComplete={handleComplete} completing={completing} dotColor="#0ea5e9" />}
          {grouped.normal.length > 0 && <TaskSection title="Không deadline" tasks={grouped.normal} onComplete={handleComplete} completing={completing} dotColor="#94a3b8" />}
        </>
      )}

      {filtered.length === 0 && (
        <div className="card p-12 text-center">
          <svg className="mx-auto mb-3" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          <p className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
            {search || urgencyFilter ? 'Không tìm thấy task phù hợp' : 'Không có task nào!'}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {search || urgencyFilter ? 'Thử tìm kiếm với từ khóa khác' : 'Bạn đã hoàn thành tất cả công việc'}
          </p>
        </div>
      )}
    </div>
  )
}

function TaskSection({ title, tasks, onComplete, completing, dotColor }: {
  title: string; tasks: Task[]; onComplete: (id: string) => void; completing: string | null; dotColor: string
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: dotColor }} />
        {title} ({tasks.length})
      </h3>
      <TaskList tasks={tasks} onComplete={onComplete} completing={completing} />
    </div>
  )
}

function TaskList({ tasks, onComplete, completing }: {
  tasks: Task[]; onComplete: (id: string) => void; completing: string | null
}) {
  return (
    <div className="space-y-2 stagger-children">
      {tasks.map((task) => {
        const urgencyInfo = getUrgencyLabel(task.urgency)
        return (
          <div key={task.id} className="card p-4 flex items-center gap-4"
            onClick={() => window.location.href = `/dashboard/tasks/${task.id}`}
            style={{ cursor: 'pointer', transition: 'box-shadow 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}
          >
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              task.urgency === 'overdue' ? 'bg-red-500 animate-pulse' :
              task.urgency === 'today' ? 'bg-amber-500' :
              task.urgency === 'this_week' ? 'bg-sky-500' : 'bg-slate-300'
            }`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{task.stepCode}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.stepName}</span>
                {urgencyInfo.label && <span className={`badge ${urgencyInfo.color}`}>{urgencyInfo.label}</span>}
              </div>
              <div className="flex items-center gap-3 text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                <span className="font-mono" style={{ color: 'var(--primary-light)' }}>{task.project.projectCode}</span>
                <span>{task.project.projectName}</span>
                {task.deadline && <span className="flex items-center gap-0.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> {formatDate(task.deadline)}</span>}
              </div>
            </div>
            <span className={`badge ${getStatusBg(task.status)}`} style={{ borderWidth: '1px' }}>
              {task.status === 'IN_PROGRESS' ? 'Đang xử lý' : 'Chờ'}
            </span>
            {task.status === 'IN_PROGRESS' && (
              <button onClick={(e) => { e.stopPropagation(); onComplete(task.id) }} disabled={completing === task.id}
                className="btn-accent text-xs px-3 py-1.5 disabled:opacity-50">
                {completing === task.id ? '...' : '✓ Xong'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
