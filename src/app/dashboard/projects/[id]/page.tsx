'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { ROLES } from '@/lib/constants'
import { getStepFormConfig } from '@/lib/step-form-configs'
import { formatDate, formatCurrency, isTaskOverdue } from '@/lib/utils'

interface Task {
  id: string; stepCode: string; stepName: string; stepNameEn: string;
  assignedRole: string; status: string; deadline: string | null; notes: string | null;
  assignee: { fullName: string; username: string } | null;
  completedAt: string | null;
  revisionRound?: number; revisionId?: string | null;
}

interface ProjectDetail {
  id: string; projectCode: string; projectName: string; clientName: string;
  productType: string; status: string; contractValue: string; currency: string;
  startDate: string; endDate: string; description: string;
  hasTemplateTasks: boolean;
  progress: { total: number; completed: number; inProgress: number; percentage: number; currentPhase: number };
  tasks: Task[];
}

const COLUMNS = [
  { key: 'IN_PROGRESS', label: 'Đang thực hiện', color: '#2563eb', dot: 'bg-blue-500 animate-pulse' },
  { key: 'RETURNED', label: 'Trả lại', color: '#f59e0b', dot: 'bg-amber-500' },
  { key: 'DONE', label: 'Hoàn thành', color: '#16a34a', dot: 'bg-emerald-500' },
] as const

export default function ProjectDetailPage() {
  const params = useParams()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null)
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null)
  const [assigningTask, setAssigningTask] = useState<Task | null>(null)
  const [closing, setClosing] = useState(false)
  const [applyingTpl, setApplyingTpl] = useState(false)
  const { user: currentUser } = useAuthStore()

  async function reload() {
    const res = await apiFetch(`/api/projects/${params.id}`)
    if (res.ok) setProject(res.project)
  }

  useEffect(() => {
    if (params.id) {
      apiFetch(`/api/projects/${params.id}`).then((res) => {
        if (res.ok) setProject(res.project)
        setLoading(false)
      })
    }
  }, [params.id])

  async function handleComplete(taskId: string, resultData?: Record<string, unknown>, notes?: string) {
    setLoadingTaskId(taskId)
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'complete', resultData, notes: notes || 'Completed' }),
    })
    setLoadingTaskId(null)
    if (res.ok) await reload()
    else alert(res.error || 'Lỗi hoàn thành task')
  }

  async function handleCloseProject() {
    if (!confirm('Bạn chắc chắn muốn đóng dự án? Hành động này không thể hoàn tác.')) return
    setClosing(true)
    const res = await apiFetch(`/api/projects/${params.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'CLOSE' }),
    })
    if (res.ok) {
      alert(res.message || 'Dự án đã đóng thành công')
      await reload()
    } else {
      alert(res.error || 'Lỗi đóng dự án')
    }
    setClosing(false)
  }

  async function handleApplyTemplate() {
    if (!project) return
    setApplyingTpl(true)
    const tplRes = await apiFetch('/api/work/templates')
    if (!tplRes.ok) { alert(tplRes.error || 'Lỗi lấy danh sách template'); setApplyingTpl(false); return }
    const templates = tplRes.templates as { code: string; productType: string | null }[]
    const match = templates.find(t => t.productType === project.productType) || templates.find(t => !t.productType)
    if (!match) { alert('Không tìm thấy template phù hợp'); setApplyingTpl(false); return }
    const res = await apiFetch('/api/work/templates/apply', {
      method: 'POST', body: JSON.stringify({ projectId: project.id, templateCode: match.code }),
    })
    if (res.ok) {
      alert(res.message || `Đã áp dụng template, tạo ${res.created} bước`)
      await reload()
    } else {
      alert(res.error || 'Lỗi áp dụng template')
    }
    setApplyingTpl(false)
  }

  function onCompleteClick(task: Task) {
    const stepConfig = getStepFormConfig(task.stepCode)
    if (stepConfig && Object.keys(stepConfig).length > 0) {
      window.location.href = `/dashboard/work/${task.id}`
    } else {
      handleComplete(task.id)
    }
  }

  async function handleReject(taskId: string, reason: string) {
    const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    if (res.ok || res.success) {
      setRejectingTask(null)
      await reload()
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
      await reload()
    } else {
      alert(res.error || 'Lỗi phân công task')
    }
  }

  if (loading) return <div className="h-64 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
  if (!project) return <p style={{ color: 'var(--text-muted)' }}>Dự án không tồn tại</p>

  const currentUserRole = currentUser?.roleCode || ''
  const currentUserLevel = currentUser?.userLevel
  const canAssignLevel = currentUserLevel === 1 || ['R00', 'R01', 'R02'].includes(currentUserRole)
  const isGlobalAdmin = ['R00', 'R01', 'R02', 'R02a'].includes(currentUserRole)

  function hasAssignPerm(task: Task) {
    if (!canAssignLevel) return false
    if (isGlobalAdmin) return true
    const userBase = currentUserRole.replace(/[a-zA-Z]$/, '')
    const taskBase = task.assignedRole.replace(/[a-zA-Z]$/, '')
    return userBase === taskBase
  }

  const tasksByStatus: Record<string, Task[]> = { IN_PROGRESS: [], RETURNED: [], DONE: [] }
  for (const t of project.tasks) {
    const col = t.status === 'DONE' || t.status === 'SKIPPED_NO_IMPACT' ? 'DONE' : t.status === 'RETURNED' || t.status === 'REJECTED' ? 'RETURNED' : 'IN_PROGRESS'
    tasksByStatus[col].push(t)
  }

  const doneTasks = project.progress.completed
  const totalTasks = project.progress.total
  const inProgTasks = project.progress.inProgress

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {rejectingTask && (
        <RejectTaskModal
          task={rejectingTask}
          onClose={() => setRejectingTask(null)}
          onSubmit={(reason) => handleReject(rejectingTask.id, reason)}
        />
      )}
      {assigningTask && (
        <AssignTaskModal
          task={assigningTask}
          onClose={() => setAssigningTask(null)}
          onSubmit={(userId) => handleAssign(assigningTask.id, userId)}
        />
      )}

      {/* Hero Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 28px', borderRadius: '16px',
        background: 'linear-gradient(135deg, #0a2540 0%, #163a5f 100%)',
        color: 'white',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', opacity: 0.6, textTransform: 'uppercase' as const }}>{project.projectCode}</span>
          <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '4px', color: '#ffffff' }}>{project.projectName}</h1>
          <p style={{ fontSize: '14px', opacity: 0.7, marginTop: '4px', color: '#ffffff' }}>{project.clientName}{project.description ? ` — ${project.description}` : ''}</p>
          {project.status === 'CLOSED' && (
            <span style={{ display: 'inline-block', marginTop: '8px', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', background: 'rgba(22,163,74,0.2)', color: '#86efac' }}>ĐÃ ĐÓNG</span>
          )}
        </div>
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

      {/* Control Dashboard link — R01/R02/R03 */}
      {['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10'].includes(currentUserRole) && (
        <a
          href={`/dashboard/projects/${params.id}/control`}
          className="card p-3 flex items-center gap-3 transition-all hover:shadow-md"
          style={{ borderLeft: '4px solid #8b5cf6', textDecoration: 'none' }}
        >
          <span style={{ fontSize: '18px' }}>📊</span>
          <span className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>Bảng điều khiển BLĐ</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>3 đường: Kế hoạch · Hiện hành · Thực hiện</span>
        </a>
      )}

      {/* MCL — theo dõi vật tư per-project (T2) */}
      {['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a', 'R08', 'R08a', 'R10'].includes(currentUserRole) && (
        <a
          href={`/dashboard/projects/${params.id}/mcl`}
          className="card p-3 flex items-center gap-3 transition-all hover:shadow-md"
          style={{ borderLeft: '4px solid #0284c7', textDecoration: 'none' }}
        >
          <span style={{ fontSize: '18px' }}>📦</span>
          <span className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>Theo dõi vật tư (MCL)</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Cần · Đặt · Về · Tồn · Cấp · Còn thiếu</span>
        </a>
      )}

      {/* Hợp đồng mua (T1) — role mua hàng / QLDA / tài chính */}
      {['R01', 'R02', 'R02a', 'R03', 'R03a', 'R07', 'R07a', 'R08', 'R08a', 'R10'].includes(currentUserRole) && (
        <a
          href={`/dashboard/projects/${params.id}/purchase-contracts`}
          className="card p-3 flex items-center gap-3 transition-all hover:shadow-md"
          style={{ borderLeft: '4px solid #d97706', textDecoration: 'none' }}
        >
          <span style={{ fontSize: '18px' }}>📜</span>
          <span className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>Hợp đồng mua</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>HĐMB/HĐKT với NCC · gắn PO · file ký</span>
        </a>
      )}

      {/* Sổ tài liệu dự án (T5) — trang tự RBAC */}
      <a
        href={`/dashboard/projects/${params.id}/documents`}
        className="card p-3 flex items-center gap-3 transition-all hover:shadow-md"
        style={{ borderLeft: '4px solid #16a34a', textDecoration: 'none' }}
      >
        <span style={{ fontSize: '18px' }}>📁</span>
        <span className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>Sổ tài liệu dự án</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Bản vẽ · BOM · HĐ · DTTC · QC — có revision</span>
      </a>

      {/* Apply Template — show when project has no template tasks */}
      {project.status !== 'CLOSED' && !project.hasTemplateTasks && ['R01', 'R02', 'R02a', 'R10'].includes(currentUserRole) && (
        <button
          onClick={handleApplyTemplate}
          disabled={applyingTpl}
          className="card p-4 w-full text-left flex items-center gap-3 transition-all hover:shadow-md"
          style={{ borderLeft: '4px solid #059669', opacity: applyingTpl ? 0.5 : 1 }}
        >
          <span style={{ fontSize: '18px' }}>&#9776;</span>
          <div>
            <span className="text-sm font-bold" style={{ color: 'var(--text-heading)' }}>Khởi tạo quy trình theo mẫu</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Áp template phù hợp loại sản phẩm, sinh công việc chuẩn</p>
          </div>
        </button>
      )}

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }} className="stagger-children">
        {[
          { label: 'Giá trị HĐ', value: formatCurrency(project.contractValue, project.currency), color: 'var(--text-heading)', icon: '$' },
          { label: 'Bắt đầu', value: formatDate(project.startDate) || '—', color: '#0ea5e9', icon: 'S' },
          { label: 'Kết thúc', value: formatDate(project.endDate) || '—', color: '#f59e0b', icon: 'E' },
          { label: 'Giai đoạn', value: `Phase ${project.progress.currentPhase}`, color: '#8b5cf6', icon: 'P' },
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

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', alignItems: 'start' }}>
        {COLUMNS.map(col => {
          const colTasks = tasksByStatus[col.key] || []
          return (
            <div key={col.key} className="card" style={{ borderTop: `3px solid ${col.color}`, minHeight: '200px' }}>
              <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-heading)' }}>{col.label}</span>
                </div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: col.color, background: `${col.color}12`, padding: '2px 8px', borderRadius: '10px' }}>
                  {colTasks.length}
                </span>
              </div>

              <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {colTasks.length === 0 && (
                  <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Không có task
                  </div>
                )}
                {colTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onCompleteClick={onCompleteClick}
                    onRejectClick={(t) => setRejectingTask(t)}
                    onAssignClick={(t) => setAssigningTask(t)}
                    currentUserRole={currentUserRole}
                    hasAssignPerm={hasAssignPerm(task)}
                    loadingTaskId={loadingTaskId}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick Actions */}
      {project.status !== 'CLOSED' && project.progress.percentage >= 90 && (
        <div className="card p-5" style={{ maxWidth: '300px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-heading)', marginBottom: '12px' }}>Hành động</h3>
          <button
            onClick={handleCloseProject}
            disabled={closing}
            className="w-full text-xs px-3 py-2.5 rounded-lg font-semibold transition-all"
            style={{ background: '#dc262615', color: '#dc2626', border: '1px solid #dc262625', opacity: closing ? 0.5 : 1 }}
          >
            Đóng dự án
          </button>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, onCompleteClick, onRejectClick, onAssignClick, currentUserRole, hasAssignPerm, loadingTaskId }: {
  task: Task;
  onCompleteClick: (task: Task) => void;
  onRejectClick: (task: Task) => void;
  onAssignClick: (task: Task) => void;
  currentUserRole: string;
  hasAssignPerm: boolean;
  loadingTaskId: string | null;
}) {
  const rule = WORKFLOW_RULES[task.stepCode]
  const isActive = task.status === 'IN_PROGRESS'
  const canAct = isActive && (currentUserRole === task.assignedRole || currentUserRole === 'R00')
  const isOverdue = isTaskOverdue(task)

  return (
    <div
      className="rounded-lg transition-all hover:shadow-md"
      style={{
        padding: '12px',
        background: 'var(--bg-primary)',
        border: `1px solid ${isOverdue ? '#fca5a5' : 'var(--border-light)'}`,
      }}
    >
      {/* Header: code + role */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px' }}>
            {task.stepCode}
          </span>
          {(task.revisionRound ?? 0) >= 1 && (
            <span title={task.revisionId ? `Nguồn: ${task.revisionId}` : 'Vòng revise'} style={{ fontSize: '10px', fontWeight: 700, color: '#4f46e5', background: '#eef2ff', padding: '1px 6px', borderRadius: '999px' }}>
              Rev.{task.revisionRound}
            </span>
          )}
          {task.status === 'SKIPPED_NO_IMPACT' && (
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '999px' }}>Đã bỏ qua</span>
          )}
        </span>
        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px' }}>
          {(ROLES as Record<string, { name: string }>)[task.assignedRole]?.name || task.assignedRole}
        </span>
      </div>

      {/* Title — clickable to task detail */}
      <a
        href={`/dashboard/work/${task.id}`}
        style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: '8px', display: 'block', textDecoration: 'none' }}
        className="hover:underline"
      >
        {task.stepName}
      </a>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: '11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {task.assignee ? (
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task.assignee.fullName}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa phân công</span>
          )}
          {hasAssignPerm && task.status !== 'DONE' && (
            <button
              onClick={() => onAssignClick(task)}
              className="flex-shrink-0 rounded hover:bg-slate-200 transition"
              style={{ padding: '2px 4px', fontSize: '11px' }}
              title="Phân công"
            >
              Phân công
            </button>
          )}
        </div>

        {task.deadline && (
          <span style={{ color: isOverdue ? '#dc2626' : 'var(--text-muted)', fontWeight: isOverdue ? 600 : 400, flexShrink: 0 }}>
            {formatDate(task.deadline)}
          </span>
        )}
        {task.completedAt && task.status === 'DONE' && (
          <span style={{ color: '#16a34a', flexShrink: 0 }}>
            {formatDate(task.completedAt)}
          </span>
        )}
      </div>

      {/* Action buttons */}
      {canAct && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'flex-end' }}>
          {rule?.rejectTo && (
            <button
              onClick={() => onRejectClick(task)}
              className="text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all hover:opacity-80"
              style={{ background: '#dc262612', color: '#dc2626', border: '1px solid #dc262625' }}
            >
              Từ chối
            </button>
          )}
          <button
            onClick={() => onCompleteClick(task)}
            className="btn-accent text-[11px] px-2.5 py-1"
            disabled={loadingTaskId === task.id}
          >
            {loadingTaskId === task.id ? '...' : 'Hoàn thành'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Reject Task Modal ──
function RejectTaskModal({ task, onClose, onSubmit }: {
  task: Task; onClose: () => void; onSubmit: (reason: string) => void;
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
            <h3 className="text-base font-semibold" style={{ color: '#dc2626' }}>Từ chối: {task.stepName}</h3>
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
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-heading)' }}>Phân công công việc</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-secondary)]" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Bước <strong>{task.stepCode} - {task.stepName}</strong><br/>
          Vai trò: <span className="font-mono bg-[var(--bg-secondary)] px-1 rounded">{task.assignedRole}</span>
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
                  {u.fullName} ({u.username}) {u.userLevel === 1 ? '' : ''}
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
            Giao việc
          </button>
        </div>
      </div>
    </div>
  )
}
