'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { getStatusBg, getUrgencyLabel, formatDate } from '@/lib/utils'
import { getStepFormConfig } from '@/lib/step-form-configs'
import { SearchBar } from '@/components/SearchPagination'
import { PageHeader, Card, Badge, Button } from '@/components/ui'
import { Clock, CheckCircle } from 'lucide-react'

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

  async function handleComplete(task: Task) {
    const stepConfig = getStepFormConfig(task.stepCode)
    if (stepConfig && Object.keys(stepConfig).length > 0) {
      window.location.href = `/dashboard/tasks/${task.id}`
      return
    }
    
    setCompleting(task.id)
    const res = await apiFetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'complete', notes: 'Completed from inbox' }),
    })
    if (res.ok) await loadTasks()
    setCompleting(null)
  }

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
      <PageHeader
        title="Công việc của tôi"
        subtitle={`${allTasks.length} task cần xử lý`}
        actions={
          <div className="flex gap-2 stagger-children">
            {allTasks.filter(t => t.urgency === 'overdue').length > 0 && (
              <Badge variant="danger">⚠️ {allTasks.filter(t => t.urgency === 'overdue').length} quá hạn</Badge>
            )}
            {allTasks.filter(t => t.urgency === 'today').length > 0 && (
              <Badge variant="warning">📅 {allTasks.filter(t => t.urgency === 'today').length} hôm nay</Badge>
            )}
          </div>
        }
      />

      {/* Search + Urgency filter tabs */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm step, mã DA, tên DA..." /></div>
        <div className="flex gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setUrgencyFilter(tab.value)}
              className={`filter-pill ${urgencyFilter === tab.value ? 'active' : ''}`}
            >
              {tab.dot && <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: urgencyFilter === tab.value ? 'white' : tab.dot }} />}
              {tab.label}
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
        <Card padding="spacious" className="text-center">
          <CheckCircle size={48} className="mx-auto mb-3" stroke="#16a34a" strokeWidth={1.5} />
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-primary)' }}>
            {search || urgencyFilter ? 'Không tìm thấy task phù hợp' : 'Không có task nào!'}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {search || urgencyFilter ? 'Thử tìm kiếm với từ khóa khác' : 'Bạn đã hoàn thành tất cả công việc'}
          </p>
        </Card>
      )}
    </div>
  )
}

function TaskSection({ title, tasks, onComplete, completing, dotColor }: {
  title: string; tasks: Task[]; onComplete: (task: Task) => void; completing: string | null; dotColor: string
}) {
  return (
    <div>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--text-secondary)' }}>
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: dotColor }} />
        {title} ({tasks.length})
      </h3>
      <TaskList tasks={tasks} onComplete={onComplete} completing={completing} />
    </div>
  )
}

function TaskList({ tasks, onComplete, completing }: {
  tasks: Task[]; onComplete: (task: Task) => void; completing: string | null
}) {
  return (
    <div className="space-y-2 stagger-children">
      {tasks.map((task) => {
        const urgencyInfo = getUrgencyLabel(task.urgency)
        return (
          <Card
            key={task.id}
            padding="compact"
            hoverable
            className="flex items-center gap-4"
            onClick={() => window.location.href = `/dashboard/tasks/${task.id}`}
          >
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              task.urgency === 'overdue' ? 'bg-red-500 animate-pulse' :
              task.urgency === 'today' ? 'bg-amber-500' :
              task.urgency === 'this_week' ? 'bg-sky-500' : 'bg-slate-300'
            }`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="mono-label" style={{ color: 'var(--accent)' }}>{task.stepCode}</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{task.stepName}</span>
                {urgencyInfo.label && <span className={`badge ${urgencyInfo.color}`}>{urgencyInfo.label}</span>}
              </div>
              <div className="flex items-center gap-3 mt-1" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                <span className="mono-label" style={{ color: 'var(--primary-light)' }}>{task.project.projectCode}</span>
                <span>{task.project.projectName}</span>
                {task.deadline && <span className="flex items-center gap-0.5"><Clock size={10} /> {formatDate(task.deadline)}</span>}
              </div>
            </div>
            <Badge variant={task.status === 'IN_PROGRESS' ? 'info' : 'default'}>
              {task.status === 'IN_PROGRESS' ? 'Đang xử lý' : 'Chờ'}
            </Badge>
            {task.status === 'IN_PROGRESS' && (
              <Button
                variant="accent"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onComplete(task) }}
                loading={completing === task.id}
              >
                ✓ Xong
              </Button>
            )}
          </Card>
        )
      })}
    </div>
  )
}
