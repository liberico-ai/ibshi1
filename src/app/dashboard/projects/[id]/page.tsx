'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PHASE_LABELS, WORKFLOW_RULES } from '@/lib/workflow-constants'
import { getStatusBg, formatDate, formatCurrency } from '@/lib/utils'

interface Task {
  id: string; stepCode: string; stepName: string; stepNameEn: string;
  assignedRole: string; status: string; deadline: string | null; notes: string | null;
  assignee: { fullName: string; username: string } | null;
  completedAt: string | null;
}

interface ProjectDetail {
  id: string; projectCode: string; projectName: string; clientName: string;
  productType: string; status: string; contractValue: string; currency: string;
  startDate: string; endDate: string; description: string;
  progress: { total: number; completed: number; inProgress: number; percentage: number; currentPhase: number };
  tasksByPhase: Record<string, Task[]>;
  tasks: Task[];
}

// Steps that need contextual resultData
const STEP_FIELDS: Record<string, { label: string; fields: { key: string; label: string; type: string; placeholder: string; required?: boolean }[] }> = {
  'P3.4A': { label: 'Nghiệm thu vật tư nội bộ', fields: [
    { key: 'materialId', label: 'Mã vật tư (ID)', type: 'text', placeholder: 'ID vật tư từ Kho', required: true },
    { key: 'quantity', label: 'Số lượng', type: 'number', placeholder: '0', required: true },
  ]},
  'P3.4B': { label: 'Nghiệm thu vật tư khách hàng', fields: [
    { key: 'materialId', label: 'Mã vật tư (ID)', type: 'text', placeholder: 'ID vật tư từ Kho', required: true },
    { key: 'quantity', label: 'Số lượng', type: 'number', placeholder: '0', required: true },
  ]},
  'P4.1': { label: 'Phát lệnh sản xuất', fields: [
    { key: 'woCode', label: 'Mã lệnh SX', type: 'text', placeholder: 'WO-2026-001', required: true },
    { key: 'description', label: 'Nội dung SX', type: 'text', placeholder: 'Mô tả lệnh sản xuất' },
    { key: 'teamCode', label: 'Tổ sản xuất', type: 'text', placeholder: 'TO-01', required: true },
  ]},
  'P4.2': { label: 'Cấp vật tư cho SX', fields: [
    { key: 'materialId', label: 'Mã vật tư (ID)', type: 'text', placeholder: 'ID vật tư từ Kho', required: true },
    { key: 'quantity', label: 'Số lượng xuất', type: 'number', placeholder: '0', required: true },
    { key: 'workOrderId', label: 'Mã WO (ID)', type: 'text', placeholder: 'ID lệnh sản xuất' },
  ]},
}

export default function ProjectDetailPage() {
  const params = useParams()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [completingTask, setCompletingTask] = useState<Task | null>(null)
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null)
  const [assigningTask, setAssigningTask] = useState<Task | null>(null)
  const [closing, setClosing] = useState(false)
  const { user: currentUser } = useAuthStore()

  useEffect(() => {
    if (params.id) {
      apiFetch(`/api/projects/${params.id}`).then((res) => {
        if (res.ok) setProject(res.project)
        setLoading(false)
      })
    }
  }, [params.id])

  async function handleComplete(taskId: string, resultData?: Record<string, unknown>, notes?: string) {
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'complete', resultData, notes: notes || 'Completed' }),
    })
    if (res.ok) {
      setCompletingTask(null)
      const updated = await apiFetch(`/api/projects/${params.id}`)
      if (updated.ok) setProject(updated.project)
    } else {
      alert(res.error || 'Lỗi hoàn thành task')
    }
  }

  async function handleCloseProject() {
    if (!confirm('Bạn chắc chắn muốn đóng dự án? Hành động này không thể hoàn tác.')) return
    setClosing(true)
    const res = await apiFetch(`/api/projects/${params.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'CLOSE' }),
    })
    if (res.ok) {
      alert(res.message || 'Dự án đã đóng thành công ✅')
      const updated = await apiFetch(`/api/projects/${params.id}`)
      if (updated.ok) setProject(updated.project)
    } else {
      alert(res.error || 'Lỗi đóng dự án')
    }
    setClosing(false)
  }

  function onCompleteClick(task: Task) {
    const stepConfig = STEP_FIELDS[task.stepCode]
    if (stepConfig) {
      setCompletingTask(task)
    } else {
      handleComplete(task.id)
    }
  }

  async function handleReject(taskId: string, reason: string) {
    const userId = localStorage.getItem('userId') || 'system'
    const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, userId }),
    })
    if (res.ok || res.success) {
      setRejectingTask(null)
      const updated = await apiFetch(`/api/projects/${params.id}`)
      if (updated.ok) setProject(updated.project)
    } else {
      alert(res.error || 'Lỗi từ chối task')
    }
  }

  async function handleAssign(taskId: string, userId: string) {
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'assign', assignToUserId: userId }),
    })
    if (res.ok) {
      setAssigningTask(null)
      const updated = await apiFetch(`/api/projects/${params.id}`)
      if (updated.ok) setProject(updated.project)
    } else {
      alert(res.error || 'Lỗi phân công task')
    }
  }

  if (loading) return <div className="h-64 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
  if (!project) return <p style={{ color: 'var(--text-muted)' }}>Dự án không tồn tại</p>

  const totalTasks = project.progress.total
  const doneTasks = project.progress.completed
  const inProgTasks = project.progress.inProgress
  const pendingTasks = totalTasks - doneTasks - inProgTasks
  const rejectedTasks = project.tasks.filter(t => t.status === 'REJECTED').length

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Complete Task Modal */}
      {completingTask && (
        <CompleteTaskModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onSubmit={(resultData, notes) => handleComplete(completingTask.id, resultData, notes)}
        />
      )}
      {/* Reject Task Modal */}
      {rejectingTask && (
        <RejectTaskModal
          task={rejectingTask}
          onClose={() => setRejectingTask(null)}
          onSubmit={(reason) => handleReject(rejectingTask.id, reason)}
        />
      )}

      {/* Assign Task Modal */}
      {assigningTask && (
        <AssignTaskModal
          task={assigningTask}
          onClose={() => setAssigningTask(null)}
          onSubmit={(userId) => handleAssign(assigningTask.id, userId)}
        />
      )}

      {/* ═══ Hero Header — Gradient bar ═══ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 28px', borderRadius: '16px',
        background: 'linear-gradient(135deg, #0a2540 0%, #163a5f 100%)',
        color: 'white',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', opacity: 0.6, textTransform: 'uppercase' as const }}>{project.projectCode}</span>
          <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '4px' }}>{project.projectName}</h1>
          <p style={{ fontSize: '14px', opacity: 0.7, marginTop: '4px' }}>{project.clientName}{project.description ? ` — ${project.description}` : ''}</p>
          {project.status === 'CLOSED' && (
            <span style={{ display: 'inline-block', marginTop: '8px', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', background: 'rgba(22,163,74,0.2)', color: '#86efac' }}>🔒 ĐÃ ĐÓNG</span>
          )}
        </div>
        {/* Circular Progress */}
        <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: '24px' }}>
          <div style={{ position: 'relative', width: '88px', height: '88px' }}>
            <svg viewBox="0 0 36 36" style={{ width: '88px', height: '88px', transform: 'rotate(-90deg)' }}>
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke={project.progress.percentage >= 90 ? '#22c55e' : project.progress.percentage >= 50 ? '#3b82f6' : '#f59e0b'}
                strokeWidth="3" strokeDasharray={`${project.progress.percentage} ${100 - project.progress.percentage}`} strokeLinecap="round" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em' }}>{project.progress.percentage}%</span>
            </div>
          </div>
          <p style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>{doneTasks}/{totalTasks} tasks</p>
        </div>
      </div>

      {/* ═══ Stats Row — 4 metric cards ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }} className="stagger-children">
        {[
          { label: 'Giá trị HĐ', value: formatCurrency(project.contractValue, project.currency), color: '#0a2540', icon: '💰' },
          { label: 'Bắt đầu', value: formatDate(project.startDate) || '—', color: '#0ea5e9', icon: '📅' },
          { label: 'Kết thúc', value: formatDate(project.endDate) || '—', color: '#f59e0b', icon: '🏁' },
          { label: 'Giai đoạn', value: PHASE_LABELS[project.progress.currentPhase]?.name || `Phase ${project.progress.currentPhase}`, color: '#8b5cf6', icon: '📍' },
        ].map(s => (
          <div key={s.label} className="card p-5 relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: s.color }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', paddingTop: '4px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${s.color}10`, fontSize: '16px' }}>{s.icon}</div>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>{s.label}</span>
            </div>
            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-heading)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ═══ 2-Column Layout: Overview + Workflow ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px' }}>
        {/* Left Sidebar — Overview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Task Breakdown */}
          <div className="card p-5">
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-heading)', marginBottom: '16px' }}>📊 Phân tích Task</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Hoàn thành', count: doneTasks, color: '#16a34a', pct: totalTasks > 0 ? (doneTasks / totalTasks * 100) : 0 },
                { label: 'Đang xử lý', count: inProgTasks, color: '#2563eb', pct: totalTasks > 0 ? (inProgTasks / totalTasks * 100) : 0 },
                { label: 'Chờ xử lý', count: pendingTasks, color: '#94a3b8', pct: totalTasks > 0 ? (pendingTasks / totalTasks * 100) : 0 },
                ...(rejectedTasks > 0 ? [{ label: 'Từ chối', count: rejectedTasks, color: '#dc2626', pct: totalTasks > 0 ? (rejectedTasks / totalTasks * 100) : 0 }] : []),
              ].map(item => (
                <div key={item.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{item.label}</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: item.color }}>{item.count}</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '3px', background: item.color, width: `${item.pct}%`, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Phase Progress */}
          <div className="card p-5">
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-heading)', marginBottom: '14px' }}>📋 Tiến độ Phase</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(project.tasksByPhase).map(([phase, tasks]) => {
                const pTasks = tasks as Task[]
                const pDone = pTasks.filter(t => t.status === 'DONE').length
                const pPct = pTasks.length > 0 ? Math.round((pDone / pTasks.length) * 100) : 0
                const phaseNum = parseInt(phase)
                const isCurrent = phaseNum === project.progress.currentPhase
                return (
                  <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '8px', background: isCurrent ? '#eff6ff' : 'transparent' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, width: '22px', height: '22px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: pPct === 100 ? '#dcfce7' : isCurrent ? '#dbeafe' : 'var(--bg-secondary)',
                      color: pPct === 100 ? '#16a34a' : isCurrent ? '#2563eb' : 'var(--text-muted)',
                    }}>{pPct === 100 ? '✓' : `P${phaseNum}`}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg-secondary)' }}>
                        <div style={{ height: '100%', borderRadius: '2px', background: pPct === 100 ? '#16a34a' : isCurrent ? '#2563eb' : '#94a3b8', width: `${pPct}%` }} />
                      </div>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', minWidth: '28px', textAlign: 'right' }}>{pPct}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick Actions */}
          {project.status !== 'CLOSED' && project.progress.percentage >= 90 && (
            <div className="card p-5">
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-heading)', marginBottom: '12px' }}>⚡ Hành động</h3>
              <button
                onClick={handleCloseProject}
                disabled={closing}
                className="w-full text-xs px-3 py-2.5 rounded-lg font-semibold transition-all"
                style={{ background: '#dc262615', color: '#dc2626', border: '1px solid #dc262625', opacity: closing ? 0.5 : 1 }}
              >
                🔒 Đóng dự án
              </button>
            </div>
          )}
        </div>

        {/* Right — Workflow Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-heading)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            🔄 Quy trình {project.progress.total} bước
          </h2>

          {Object.entries(project.tasksByPhase).map(([phase, tasks]) => {
            const phaseTasks = tasks as Task[]
            const doneCount = phaseTasks.filter(t => t.status === 'DONE').length
            const inProgressCount = phaseTasks.filter(t => t.status === 'IN_PROGRESS').length
            const pct = phaseTasks.length > 0 ? Math.round((doneCount / phaseTasks.length) * 100) : 0
            const isComplete = doneCount === phaseTasks.length
            const isActive = inProgressCount > 0
            const borderColor = isComplete ? '#16a34a' : isActive ? '#2563eb' : 'var(--border)'
            const phaseNum = parseInt(phase)

            return (
              <PhaseCard
                key={phase}
                phaseNum={phaseNum}
                phaseName={PHASE_LABELS[phaseNum]?.name || `Phase ${phase}`}
                tasks={phaseTasks}
                doneCount={doneCount}
                totalCount={phaseTasks.length}
                pct={pct}
                borderColor={borderColor}
                isComplete={isComplete}
                isActive={isActive}
                defaultExpanded={isActive || (!isComplete && phaseNum === project.progress.currentPhase)}
                onCompleteClick={onCompleteClick}
                onRejectClick={(task: Task) => setRejectingTask(task)}
                onAssignClick={(task: Task) => setAssigningTask(task)}
                currentUserRole={currentUser?.roleCode || ''}
                currentUserLevel={currentUser?.userLevel}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PhaseCard({ phaseNum, phaseName, tasks, doneCount, totalCount, pct, borderColor, isComplete, isActive, defaultExpanded, onCompleteClick, onRejectClick, onAssignClick, currentUserRole, currentUserLevel }: {
  phaseNum: number; phaseName: string; tasks: Task[]; doneCount: number; totalCount: number;
  pct: number; borderColor: string; isComplete: boolean; isActive: boolean; defaultExpanded: boolean;
  onCompleteClick: (task: Task) => void; onRejectClick: (task: Task) => void; onAssignClick: (task: Task) => void;
  currentUserRole: string; currentUserLevel?: number;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  
  const canAssignLevel = currentUserLevel === 1 || currentUserRole === 'R00' || currentUserRole === 'R01' || currentUserRole === 'R02'
  const isGlobalAdmin = ['R00', 'R01', 'R02', 'R02a'].includes(currentUserRole)
  const hasAssignPerm = (task: Task) => canAssignLevel && (isGlobalAdmin || currentUserRole === task.assignedRole)

  return (
    <div className="card overflow-hidden" style={{ borderLeft: `4px solid ${borderColor}` }}>
      {/* Phase Header — clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold px-2.5 py-1 rounded-md" style={{
            background: isComplete ? '#dcfce7' : isActive ? '#dbeafe' : 'var(--bg-secondary)',
            color: isComplete ? '#16a34a' : isActive ? '#2563eb' : 'var(--text-muted)',
          }}>
            {isComplete ? '✓' : `P${phaseNum}`}
          </span>
          <div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{phaseName}</span>
            <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
              {doneCount}/{totalCount} hoàn thành
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Mini progress bar */}
          <div className="hidden sm:flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--bg-secondary)' }}>
              <div className="h-full rounded-full transition-all" style={{
                width: `${pct}%`,
                background: isComplete ? '#16a34a' : isActive ? '#2563eb' : '#94a3b8',
              }} />
            </div>
            <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-muted)', minWidth: '32px' }}>{pct}%</span>
          </div>
          {/* Chevron */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            style={{ color: 'var(--text-muted)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Phase Steps — compact table */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-light)' }}>
          {tasks.map((task, i) => (
            <div key={task.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/30"
              style={{ borderBottom: i < tasks.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
              {/* Status dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                task.status === 'DONE' ? 'bg-emerald-500' :
                task.status === 'IN_PROGRESS' ? 'bg-blue-500 animate-pulse' :
                task.status === 'REJECTED' ? 'bg-red-500' :
                'bg-slate-300'
              }`} />

              {/* Step code */}
              <span className="text-xs font-mono w-12 flex-shrink-0" style={{ color: 'var(--accent)' }}>{task.stepCode}</span>

              {/* Step name */}
              <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                {task.stepName}
                {STEP_FIELDS[task.stepCode] && task.status === 'IN_PROGRESS' && (
                  <span className="text-xs ml-1.5 px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92400e' }}>📋 Cần dữ liệu</span>
                )}
              </span>

              <span className="text-xs hidden md:block w-48 truncate flex items-center" style={{ color: 'var(--text-muted)' }} title={task.assignee ? `${task.assignedRole} - ${task.assignee.fullName}` : task.assignedRole}>
                <span className="font-mono text-[10px] mr-1 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800" style={{ color: 'var(--text-primary)' }}>{task.assignedRole}</span>
                
                <span className="truncate flex-1">
                  {task.assignee ? (
                    <span>
                      {task.assignee.fullName} <span className="opacity-60">({task.assignee.username})</span>
                    </span>
                  ) : (
                    <span className="italic opacity-60">Chưa phân công</span>
                  )}
                </span>

                {hasAssignPerm(task) && task.status !== 'DONE' && task.status !== 'REJECTED' && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onAssignClick(task); }}
                    className="ml-2 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                    title="Phân công công việc"
                    style={{ padding: '2px 4px', fontSize: '12px' }}
                  >
                    👤
                  </button>
                )}
              </span>

              {/* Deadline */}
              {task.deadline && (
                <span className="text-xs hidden lg:block" style={{ color: 'var(--text-muted)' }}>
                  ⏱ {formatDate(task.deadline)}
                </span>
              )}

              {/* Status badge */}
              <span className={`badge text-[11px] ${getStatusBg(task.status)}`} style={{ borderWidth: '1px' }}>
                {task.status === 'DONE' ? '✓ Xong' : task.status === 'IN_PROGRESS' ? 'Đang XL' : task.status === 'REJECTED' ? 'Từ chối' : 'Chờ'}
              </span>

              {/* Action buttons — role-checked */}
              {task.status === 'IN_PROGRESS' && (
                currentUserRole && (currentUserRole === task.assignedRole || currentUserRole === 'R00') ? (
                  <div className="flex items-center gap-1">
                    {WORKFLOW_RULES[task.stepCode]?.rejectTo && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRejectClick(task) }}
                        className="text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all hover:opacity-80"
                        style={{ background: '#dc262612', color: '#dc2626', border: '1px solid #dc262625' }}
                      >
                        Từ chối
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onCompleteClick(task) }}
                      className="btn-accent text-[11px] px-2.5 py-1"
                    >
                      ✓ Hoàn thành
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] px-2 py-1 rounded" style={{ background: '#fef3c7', color: '#92400e' }}>
                    🔒 {task.assignedRole}
                  </span>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Complete Task Modal ──

function CompleteTaskModal({ task, onClose, onSubmit }: {
  task: Task;
  onClose: () => void;
  onSubmit: (resultData: Record<string, unknown>, notes: string) => void;
}) {
  const config = STEP_FIELDS[task.stepCode]
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')

  if (!config) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const resultData: Record<string, unknown> = {}
    for (const field of config.fields) {
      const val = formData[field.key] || ''
      resultData[field.key] = field.type === 'number' ? parseFloat(val) || 0 : val
    }
    onSubmit(resultData, notes)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div className="card p-6 w-full max-w-lg mx-4 animate-fade-in" style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Hoàn thành: {config.label}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Bước {task.stepCode} — {task.stepName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {config.fields.map((field) => (
            <div key={field.key}>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                {field.label} {field.required && <span style={{ color: '#dc2626' }}>*</span>}
              </label>
              <input
                className="input"
                type={field.type}
                placeholder={field.placeholder}
                value={formData[field.key] || ''}
                onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                required={field.required}
              />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Ghi chú</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú hoàn thành..." />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
            <button type="submit" className="btn-accent">Xác nhận hoàn thành</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Reject Task Modal ──

function RejectTaskModal({ task, onClose, onSubmit }: {
  task: Task;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const rule = WORKFLOW_RULES[task.stepCode]
  const targetRule = rule?.rejectTo ? WORKFLOW_RULES[rule.rejectTo] : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) return
    setSubmitting(true)
    onSubmit(reason)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div className="card p-6 w-full max-w-lg mx-4 animate-fade-in" style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold" style={{ color: '#dc2626' }}>⚠️ Từ chối: {task.stepName}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Bước {task.stepCode}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {targetRule && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
            Sẽ quay về: <strong>{rule?.rejectTo}</strong> — {targetRule.name}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
              Lý do từ chối <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              className="input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do từ chối..."
              required
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
            <button type="submit" disabled={submitting || !reason.trim()} className="text-xs px-4 py-2 rounded-lg font-medium transition-all" style={{ background: '#dc2626', color: 'white', opacity: submitting || !reason.trim() ? 0.5 : 1 }}>
              {submitting ? 'Đang xử lý...' : 'Xác nhận từ chối'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Assign Task Modal ──

function AssignTaskModal({ task, onClose, onSubmit }: { task: Task; onClose: () => void; onSubmit: (userId: string) => void }) {
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/users').then(res => {
      if (res.ok && res.users) {
        const baseRole = task.assignedRole.replace(/[a-zA-Z]$/, '')
        const relevant = res.users.filter((u: any) => u.roleCode.startsWith(baseRole))
        setUsers(relevant)
      }
      setLoading(false)
    })
  }, [task.assignedRole])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="card w-full max-w-md bg-[var(--bg-card)] rounded-2xl p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-heading)' }}>👤 Phân công công việc</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-secondary)]" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Bước <strong>{task.stepCode} - {task.stepName}</strong><br/>
          Vai trò phụ trách: <span className="font-mono bg-[var(--bg-secondary)] px-1 rounded">{task.assignedRole}</span>
        </p>
        
        {loading ? (
          <div className="py-8 text-center opacity-60">Đang tải danh sách nhân sự...</div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-red-500">
            Không tìm thấy nhân viên nào thuộc {task.assignedRole}.
          </div>
        ) : (
          <div className="mb-6">
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>CHỌN NHÂN SỰ {task.assignedRole}</label>
            <select 
              className="w-full p-2.5 rounded-xl border" 
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)', outline: 'none' }}
              value={selectedUser} 
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="">-- Click để chọn --</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.username}) {u.userLevel === 1 ? '🌟' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 font-semibold rounded-lg hover:opacity-80 transition" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Hủy</button>
          <button 
            onClick={() => { if(selectedUser) onSubmit(selectedUser) }} 
            className="px-5 py-2 font-bold rounded-lg transition hover:opacity-90 disabled:opacity-50"
            style={{ background: '#3b82f6', color: 'white' }}
            disabled={loading || users.length === 0 || !selectedUser}
          >
            Lưu / Giao việc
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}
