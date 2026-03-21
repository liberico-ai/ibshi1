'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { getStepFormConfig, type FormField } from '@/lib/step-form-configs'
import { WORKFLOW_RULES, PHASE_LABELS } from '@/lib/workflow-constants'
import * as XLSX from 'xlsx'

interface TaskData {
  id: string
  stepCode: string
  stepName: string
  status: string
  assignedRole: string
  notes: string | null
  resultData: Record<string, unknown> | null
  deadline: string | null
  startedAt: string | null
  completedAt: string | null
  project: {
    projectCode: string; projectName: string; clientName: string;
    productType?: string; contractValue?: string | number; currency?: string;
    startDate?: string; endDate?: string; description?: string;
  }
  assignee: { id: string; fullName: string; username: string } | null
}

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string

  const [task, setTask] = useState<TaskData | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState<Record<string, string | number>>({})
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({})
  const [submitNotes, setSubmitNotes] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [siblingFiles, setSiblingFiles] = useState<Record<string, string> | null>(null)
  const [rejectionInfo, setRejectionInfo] = useState<{ reason: string; rejectedBy: string; rejectedAt: string } | null>(null)
  const [milestones, setMilestones] = useState<{ name: string; startDate: string; endDate: string; assigneeId: string }[]>([])
  const emptyBomItem = { name: '', code: '', spec: '', quantity: '', unit: '' }
  const [bomItems, setBomItems] = useState<{ name: string; code: string; spec: string; quantity: string; unit: string }[]>([{ ...emptyBomItem }, { ...emptyBomItem }, { ...emptyBomItem }])
  const emptyWoItem = { costCode: '', content: '', jobCode: '', typeCode: '', unit: '', qty1: '', qty2: '', totalQty: '', startDate: '', endDate: '' }
  const [woItems, setWoItems] = useState<{ costCode: string; content: string; jobCode: string; typeCode: string; unit: string; qty1: string; qty2: string; totalQty: string; startDate: string; endDate: string }[]>([{ ...emptyWoItem }])
  const [userList, setUserList] = useState<{ id: string; fullName: string; roleCode: string }[]>([])
  const [inventoryMaterials, setInventoryMaterials] = useState<{ id: string; materialCode: string; name: string; unit: string; category: string; specification: string | null; currentStock: number }[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [previousStepData, setPreviousStepData] = useState<{ plan?: any; estimate?: any; bom?: any; bomMain?: any; bomWeldPaint?: any; bomSupply?: any } | null>(null)
  const [planDecision, setPlanDecision] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [estimateDecision, setEstimateDecision] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [planRejectReason, setPlanRejectReason] = useState('')
  const [estimateRejectReason, setEstimateRejectReason] = useState('')
  const [showPlanReject, setShowPlanReject] = useState(false)
  const [showEstimateReject, setShowEstimateReject] = useState(false)

  useEffect(() => { loadTask(); loadUsers() }, [taskId])

  async function loadUsers() {
    const res = await apiFetch('/api/users')
    if (res.ok && res.users) setUserList(res.users)
  }

  async function loadInventory() {
    setInventoryLoading(true)
    try {
      let res = await apiFetch('/api/materials')
      // Auto-seed if no materials exist
      if (res.ok && res.materials && res.materials.length === 0) {
        await apiFetch('/api/materials/seed', { method: 'POST' })
        res = await apiFetch('/api/materials')
      }
      if (res.ok && res.materials) setInventoryMaterials(res.materials)
    } catch (err) { console.error('Load inventory error:', err) }
    setInventoryLoading(false)
  }

  async function loadTask() {
    const res = await apiFetch(`/api/tasks/${taskId}`)
    if (res.ok) {
      setTask(res.task)
      // Pre-fill form with existing resultData
      if (res.task.resultData) {
        setFormData(res.task.resultData as Record<string, string | number>)
        // Restore bomItems for P2.1/P2.2/P2.3 reopened tasks
        const rd = res.task.resultData as Record<string, unknown>
        if (rd.bomItems && Array.isArray(rd.bomItems)) {
          setBomItems(rd.bomItems as { name: string; code: string; spec: string; quantity: string; unit: string }[])
        }
        // Restore woItems for P3.4 reopened tasks
        if (rd.woItems && Array.isArray(rd.woItems)) {
          setWoItems(rd.woItems as typeof woItems)
        }
        // Restore milestones for P1.2A reopened tasks
        if (rd.milestones && Array.isArray(rd.milestones)) {
          setMilestones(rd.milestones as { name: string; startDate: string; endDate: string; assigneeId: string }[])
        }
      }
      // Load inventory for P2.3 (always, not just when resultData exists)
      if (res.task.stepCode === 'P2.3') {
        loadInventory()
      }
      // Auto-generate WO number for P3.4
      if (res.task.stepCode === 'P3.4' && !res.task.resultData?.woNumber) {
        const pCode = res.task.project?.projectCode || 'LSX'
        const woNum = `${pCode}-${String(Math.floor(Math.random() * 99) + 1).padStart(2, '0')}`
        setFormData(prev => ({ ...prev, woNumber: woNum }))
      }
      if (res.previousStepData) {
        setPreviousStepData(res.previousStepData)
      }
      // For P1.3: restore previous approval decisions
      if (res.task.stepCode === 'P1.3' && res.task.resultData) {
        const rd = res.task.resultData as Record<string, unknown>
        if (rd.planApproved) setPlanDecision('approved')
        if (rd.estimateApproved) setEstimateDecision('approved')
      }
      // For P1.1B: auto-fill project data into readonly form fields
      if (res.task.stepCode === 'P1.1B' && res.task.project) {
        const p = res.task.project
        setFormData(prev => ({
          ...prev,
          projectCode: p.projectCode || '',
          projectName: p.projectName || '',
          clientName: p.clientName || '',
          productType: p.productType || '',
          contractValue: p.contractValue ? String(p.contractValue) : '',
          currency: p.currency || '',
          startDate: p.startDate ? new Date(p.startDate).toLocaleDateString('vi-VN') : '',
          endDate: p.endDate ? new Date(p.endDate).toLocaleDateString('vi-VN') : '',
          description: (p.description || '').replace(/\n?<!--FILES:.*?-->/g, '').trim(),
        }))
      }
      // Load sibling files for P1.1B (files from P1.1)
      if (res.siblingFiles) {
        setSiblingFiles(res.siblingFiles)
      }
      // Load rejection info for P1.1 (from P1.1B)
      if (res.rejectionInfo) {
        setRejectionInfo(res.rejectionInfo)
      }
      // For P1.1 reopened: pre-fill form with existing project data
      if (res.task.stepCode === 'P1.1' && res.task.project) {
        const p = res.task.project
        setFormData(prev => ({
          ...prev,
          projectCode: prev.projectCode || p.projectCode || '',
          projectName: prev.projectName || p.projectName || '',
          clientName: prev.clientName || p.clientName || '',
          productType: prev.productType || p.productType || '',
          contractValue: prev.contractValue || (p.contractValue ? String(p.contractValue) : ''),
          currency: prev.currency || p.currency || '',
          startDate: prev.startDate || (p.startDate ? new Date(p.startDate).toISOString().split('T')[0] : ''),
          endDate: prev.endDate || (p.endDate ? new Date(p.endDate).toISOString().split('T')[0] : ''),
          description: prev.description || (p.description || '').replace(/\n?<!--FILES:.*?-->/g, '').trim(),
        }))
      }
      // For P2.4: auto-fill BOM summary and budget comparison (KTKH reviews data from P2.1/P2.2/P2.3)
      if (res.task.stepCode === 'P2.4' && res.previousStepData) {
        const bomData = res.previousStepData.bom
        const estimateData = res.previousStepData.estimate
        let bomSummary = '—'
        let budgetComparison = '—'
        if (bomData?.bomItems) {
          const items = bomData.bomItems as Array<{ quantity: string }>
          const totalQty = items.reduce((sum: number, item: { quantity: string }) => sum + (Number(item.quantity) || 0), 0)
          bomSummary = `${items.length} mục VT — Tổng SL: ${totalQty.toLocaleString('vi-VN')}`
        }
        if (estimateData?.totalEstimate) {
          const totalEstimate = Number(estimateData.totalEstimate) || 0
          budgetComparison = `Dự toán: ${totalEstimate.toLocaleString('vi-VN')} VNĐ`
        }
        setFormData(prev => ({ ...prev, bomSummary, budgetComparison }))
      }
    }
    setLoading(false)
  }

  const config = task ? getStepFormConfig(task.stepCode) : undefined
  const rule = task ? WORKFLOW_RULES[task.stepCode] : undefined
  const phaseName = rule ? PHASE_LABELS[rule.phase]?.name : ''

  function handleFieldChange(key: string, value: string | number) {
    setFormData(prev => {
      const next = { ...prev, [key]: value }
      // Auto-calculate total for P1.2 estimate
      if (config && config.fields.some(f => f.key === 'totalEstimate')) {
        const currencyKeys = config.fields.filter(f => f.type === 'currency').map(f => f.key)
        const total = currencyKeys.reduce((sum, k) => sum + (Number(next[k]) || 0), 0)
        next.totalEstimate = total
      }
      return next
    })
  }

  function handleChecklistToggle(key: string) {
    setChecklistState(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function addMilestone() {
    setMilestones(prev => [...prev, { name: '', startDate: '', endDate: '', assigneeId: '' }])
  }
  function removeMilestone(idx: number) {
    setMilestones(prev => prev.filter((_, i) => i !== idx))
  }
  function updateMilestone(idx: number, field: string, value: string) {
    setMilestones(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  function addBomItem() {
    setBomItems(prev => [...prev, { name: '', code: '', spec: '', quantity: '', unit: '' }])
  }
  function removeBomItem(idx: number) {
    setBomItems(prev => prev.filter((_, i) => i !== idx))
  }
  function updateBomItem(idx: number, field: string, value: string) {
    setBomItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  async function handleSubmit(action: 'complete' | 'reject') {
    if (!task || !config) return
    setSubmitting(true)
    setError('')

    // Validate required fields
    const missingFields = config.fields
      .filter(f => f.required && !formData[f.key] && f.type !== 'readonly')
      .map(f => f.label)

    if (missingFields.length > 0 && action === 'complete') {
      setError(`Vui lòng nhập: ${missingFields.join(', ')}`)
      setSubmitting(false)
      return
    }

    // Validate milestones for P1.2A
    if (task.stepCode === 'P1.2A' && action === 'complete') {
      if (milestones.length === 0) {
        setError('Vui lòng thêm ít nhất 1 milestone')
        setSubmitting(false)
        return
      }
      const incompleteMilestones = milestones.some(m => !m.name.trim())
      if (incompleteMilestones) {
        setError('Vui lòng nhập tên cho tất cả milestone')
        setSubmitting(false)
        return
      }
    }

    // Validate BOM items for P2.1 (VT chính) — P2.2 is optional
    if (task.stepCode === 'P2.1' && action === 'complete') {
      const filledBomItems = bomItems.filter(b => b.name.trim() && b.code.trim())
      if (filledBomItems.length < 3) {
        setError('Danh sách vật tư phải có tối thiểu 3 mục (đã nhập tên + mã VT)')
        setSubmitting(false)
        return
      }
    }

    // Validate required checklist items
    const missingChecklist = config.checklist
      .filter(c => c.required && !checklistState[c.key])
      .map(c => c.label)

    if (missingChecklist.length > 0 && action === 'complete') {
      setError(`Vui lòng xác nhận: ${missingChecklist.join(', ')}`)
      setSubmitting(false)
      return
    }

    // Check if this is a reject action
    if (action === 'reject') {
      const reason = formData.rejectReason as string || submitNotes
      if (!reason) {
        setError('Vui lòng nhập lý do từ chối')
        setSubmitting(false)
        return
      }
      const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (res.success) {
        setSuccessMsg(`✅ Đã từ chối. Quay về bước ${res.returnedTo}: ${res.returnedToName || ''}`)
        setTimeout(() => router.push('/dashboard/tasks'), 2000)
      } else {
        setError(res.error || 'Lỗi khi từ chối')
      }
      setSubmitting(false)
      return
    }

    // Complete action
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({
        action: 'complete',
        resultData: {
          ...formData,
          checklist: checklistState,
          ...(siblingFiles ? { attachedFiles: siblingFiles } : {}),
          ...(milestones.length > 0 ? { milestones } : {}),
          ...(bomItems.filter(b => b.name.trim()).length > 0 ? { bomItems: bomItems.filter(b => b.name.trim()) } : {}),
          ...(woItems.filter(w => w.content.trim()).length > 0 ? { woItems: woItems.filter(w => w.content.trim()) } : {}),
        },
        notes: submitNotes || `Completed: ${task.stepName}`,
      }),
    })

    if (res.ok) {
      setSuccessMsg(`✅ Hoàn thành! Bước tiếp: ${res.nextSteps?.join(', ') || 'Không có'}`)
      setTimeout(() => router.push('/dashboard/tasks'), 2000)
    } else {
      setError(res.error || 'Lỗi khi hoàn thành')
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
      <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>⏳ Đang tải...</div>
    </div>
  )

  if (!task) return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>❌ Task không tồn tại</h2>
      <button onClick={() => router.push('/dashboard/tasks')} className="btn-accent" style={{ marginTop: '1rem' }}>
        ← Quay lại danh sách
      </button>
    </div>
  )

  const isActive = task.status === 'IN_PROGRESS'
  const isDone = task.status === 'DONE'

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
        borderRadius: 16, padding: '1.5rem 2rem', marginBottom: '1.5rem', color: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, opacity: 0.85, fontSize: '0.85rem' }}>
          <span>Phase {rule?.phase}: {phaseName}</span>
          <span>•</span>
          <span>{task.project.projectCode}</span>
          <span>•</span>
          <span>{task.project.projectName}</span>
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
          {task.stepCode} — {task.stepName}
        </h1>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: '0.9rem', opacity: 0.9 }}>
          <span>{isDone ? '✅ Hoàn thành' : isActive ? '🔄 Đang thực hiện' : `📋 ${task.status}`}</span>
          {task.deadline && <span>⏰ Deadline: {new Date(task.deadline).toLocaleDateString('vi-VN')}</span>}
          {task.assignee && <span>👤 {task.assignee.fullName}</span>}
        </div>
      </div>

      {successMsg && (
        <div style={{ background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 8, padding: '1rem', marginBottom: '1rem', color: '#155724', fontWeight: 600 }}>
          {successMsg}
        </div>
      )}

      {/* Rejection reason banner for P1.1 reopened */}
      {rejectionInfo && (
        <div style={{
          background: '#fef2f2', border: '2px solid #fecaca', borderRadius: 10, padding: '1.25rem',
          marginBottom: '1rem', color: '#991b1b',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <strong style={{ fontSize: '1rem' }}>BGĐ đã từ chối phê duyệt dự án này</strong>
          </div>
          <div style={{ fontSize: '0.9rem', marginBottom: 6 }}>
            <strong>Lý do:</strong> {rejectionInfo.reason}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#b91c1c' }}>
            Người từ chối: {rejectionInfo.rejectedBy}
            {rejectionInfo.rejectedAt && ` — ${new Date(rejectionInfo.rejectedAt).toLocaleString('vi-VN')}`}
          </div>
          <div style={{ marginTop: 10, fontSize: '0.85rem', color: '#dc2626', fontWeight: 500 }}>
            📝 Vui lòng chỉnh sửa thông tin dự án theo yêu cầu và hoàn thành lại bước này.
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 8, padding: '1rem', marginBottom: '1rem', color: '#721c24' }}>
          ⚠️ {error}
        </div>
      )}

      {config ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>
          {/* Main Form */}
          <div>
            {/* Description */}
            <div className="card" style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                ℹ️ {config.description}
              </p>
            </div>

            {/* P1.3 Dual Approval UI */}
            {task.stepCode === 'P1.3' && previousStepData ? (
              <>
                {/* Section 1: PM Plan */}
                <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', border: planDecision === 'approved' ? '2px solid #16a34a' : planDecision === 'rejected' ? '2px solid #dc2626' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8 }}>
                      📋 Kế hoạch Kickoff / WBS / Milestones <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>(PM - P1.2A)</span>
                    </h3>
                    {planDecision !== 'pending' && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: planDecision === 'approved' ? '#16a34a' : '#dc2626' }}>
                        {planDecision === 'approved' ? '✅ Đã duyệt' : '❌ Đã từ chối'}
                      </span>
                    )}
                  </div>
                  {previousStepData.plan ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {previousStepData.plan.wbsStructure && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Cấu trúc WBS</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', whiteSpace: 'pre-wrap', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.wbsStructure}</div>
                        </div>
                      )}
                      {previousStepData.plan.kickoffDate && (
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ngày Kickoff</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.kickoffDate}</div>
                        </div>
                      )}
                      {previousStepData.plan.kickoffAgenda && (
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Nội dung Kickoff</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.kickoffAgenda}</div>
                        </div>
                      )}
                      {previousStepData.plan.milestones && previousStepData.plan.milestones.length > 0 && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Milestones ({previousStepData.plan.milestones.length})</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {previousStepData.plan.milestones.map((ms: { name: string; startDate: string; endDate: string; assigneeId: string }, i: number) => (
                              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', border: '1px solid var(--border)' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>#{i+1} {ms.name}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                                  {ms.startDate && `Bắt đầu: ${ms.startDate}`}{ms.endDate && ` — Kết thúc: ${ms.endDate}`}
                                  {ms.assigneeId && ` | Phụ trách: ${userList.find(u => u.id === ms.assigneeId)?.fullName || ms.assigneeId}`}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu kế hoạch</div>
                  )}
                  {/* Plan approve/reject buttons */}
                  {isActive && planDecision === 'pending' && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => { setShowPlanReject(false); setPlanDecision('approved') }}
                          style={{ padding: '8px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ✅ Duyệt kế hoạch
                        </button>
                        <button onClick={() => setShowPlanReject(!showPlanReject)}
                          style={{ padding: '8px 20px', background: 'transparent', color: '#dc2626', border: '1px solid #dc2626', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ❌ Từ chối / Yêu cầu chỉnh sửa
                        </button>
                      </div>
                      {showPlanReject && (
                        <div style={{ marginTop: 10 }}>
                          <textarea value={planRejectReason} onChange={e => setPlanRejectReason(e.target.value)}
                            placeholder="Nhập lý do từ chối kế hoạch..." rows={2}
                            style={{ width: '100%', borderRadius: 8, border: '1px solid #dc2626', padding: '0.5rem', fontSize: '0.85rem', resize: 'vertical', background: 'var(--bg-secondary)' }} />
                          <button onClick={() => { if (!planRejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return; } setPlanDecision('rejected') }}
                            style={{ marginTop: 6, padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            ⚠️ Xác nhận từ chối kế hoạch
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Plan pre-approved from previous round */}
                  {planDecision === 'approved' && task?.resultData && (task.resultData as Record<string, unknown>).planApproved && (
                    <div style={{ marginTop: 12, padding: '8px 16px', background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                      ✅ Đã được phê duyệt từ lần xét duyệt trước
                    </div>
                  )}
                </div>

                {/* Section 2: KTKH Estimate */}
                <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', border: estimateDecision === 'approved' ? '2px solid #16a34a' : estimateDecision === 'rejected' ? '2px solid #dc2626' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8 }}>
                      💰 Dự toán thi công <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>(KTKH - P1.2)</span>
                    </h3>
                    {estimateDecision !== 'pending' && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: estimateDecision === 'approved' ? '#16a34a' : '#dc2626' }}>
                        {estimateDecision === 'approved' ? '✅ Đã duyệt' : '❌ Đã từ chối'}
                      </span>
                    )}
                  </div>
                  {previousStepData.estimate ? (() => {
                    const est = previousStepData.estimate
                    const costGroups = [
                      { title: '1. Chi phí vật tư', keys: ['mat_main','mat_accessory','mat_packing','mat_method','mat_consumable','mat_paint','mat_reserve'] },
                      { title: '2. Chi phí nhân công', keys: ['lab_cutting','lab_machining','lab_fabrication','lab_framing','lab_assembly_product','lab_erection','lab_cleaning_alloy','lab_surface_paint','lab_insulation','lab_equip_install','lab_packing','lab_delivery','lab_reserve'] },
                      { title: '3. Dịch vụ thuê ngoài', keys: ['out_transport','out_ndt','out_galvanize','out_other','out_reserve'] },
                      { title: '4. Chi phí chung', keys: ['ovh_production','ovh_financial','ovh_management'] },
                    ]
                    const labelMap: Record<string,string> = {
                      mat_main:'Vật tư chính', mat_accessory:'Phụ kiện, bu lông', mat_packing:'Đóng kiện', mat_method:'Biện pháp',
                      mat_consumable:'Tiêu hao', mat_paint:'Sơn', mat_reserve:'VT dự phòng',
                      lab_cutting:'Pha cắt', lab_machining:'Gia công', lab_fabrication:'Chế tạo', lab_framing:'Khung kiện',
                      lab_assembly_product:'Tổ hợp SP', lab_erection:'Lắp dựng+NT', lab_cleaning_alloy:'Vệ sinh hợp kim',
                      lab_surface_paint:'Làm sạch, Sơn', lab_insulation:'Bảo ôn', lab_equip_install:'Lắp TB trước đóng kiện',
                      lab_packing:'Đóng kiện', lab_delivery:'Giao hàng', lab_reserve:'NC dự phòng',
                      out_transport:'Vận tải', out_ndt:'NDT/Thí nghiệm', out_galvanize:'Mạ kẽm', out_other:'Khác', out_reserve:'DV dự phòng',
                      ovh_production:'Phục vụ SX', ovh_financial:'Tài chính', ovh_management:'Quản lý',
                    }
                    return (
                      <div>
                        {costGroups.map(g => {
                          const groupTotal = g.keys.reduce((s, k) => s + (Number(est[k]) || 0), 0)
                          if (groupTotal === 0) return null
                          return (
                            <div key={g.title} style={{ marginBottom: 12 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent)', marginBottom: 6, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{g.title}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', paddingLeft: 12 }}>
                                {g.keys.filter(k => Number(est[k]) > 0).map(k => (
                                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{labelMap[k] || k}</span>
                                    <span style={{ fontWeight: 500 }}>{Number(est[k]).toLocaleString('vi-VN')}</span>
                                  </div>
                                ))}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', fontWeight: 600, fontSize: '0.85rem', marginTop: 4, color: 'var(--accent)' }}>Subtotal: {groupTotal.toLocaleString('vi-VN')}</div>
                            </div>
                          )
                        })}
                        {est.totalEstimate && (
                          <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--accent)', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                            <span>TỔNG CHI PHÍ DỰ TOÁN</span>
                            <span>{Number(est.totalEstimate).toLocaleString('vi-VN')} VND</span>
                          </div>
                        )}
                      </div>
                    )
                  })() : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu dự toán</div>
                  )}
                  {/* Estimate approve/reject buttons */}
                  {isActive && estimateDecision === 'pending' && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => { setShowEstimateReject(false); setEstimateDecision('approved') }}
                          style={{ padding: '8px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ✅ Duyệt dự toán
                        </button>
                        <button onClick={() => setShowEstimateReject(!showEstimateReject)}
                          style={{ padding: '8px 20px', background: 'transparent', color: '#dc2626', border: '1px solid #dc2626', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ❌ Từ chối / Yêu cầu chỉnh sửa
                        </button>
                      </div>
                      {showEstimateReject && (
                        <div style={{ marginTop: 10 }}>
                          <textarea value={estimateRejectReason} onChange={e => setEstimateRejectReason(e.target.value)}
                            placeholder="Nhập lý do từ chối dự toán..." rows={2}
                            style={{ width: '100%', borderRadius: 8, border: '1px solid #dc2626', padding: '0.5rem', fontSize: '0.85rem', resize: 'vertical', background: 'var(--bg-secondary)' }} />
                          <button onClick={() => { if (!estimateRejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return; } setEstimateDecision('rejected') }}
                            style={{ marginTop: 6, padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            ⚠️ Xác nhận từ chối dự toán
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
            {/* Form Fields */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, marginBottom: 16 }}>
                📝 Thông tin nhập liệu
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {config.fields.map(field => (
                  field.type === 'section' ? (
                    <div key={field.key} style={{
                      gridColumn: '1 / -1', marginTop: 12, paddingBottom: 6,
                      borderBottom: '2px solid var(--accent-light, #c7d2fe)',
                    }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)' }}>
                        {field.label}
                      </span>
                    </div>
                  ) : (
                    <div key={field.key} style={{ gridColumn: field.fullWidth ? '1 / -1' : undefined }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>
                        {field.label} {field.required && <span style={{ color: '#e74c3c' }}>*</span>}
                      </label>
                      {renderField(field, formData[field.key] ?? '', (v) => handleFieldChange(field.key, v), isActive)}
                    </div>
                  )
                ))}
              </div>
            </div>

            {/* P2.4: Aggregated BOM + Estimate from previous steps */}
            {task.stepCode === 'P2.4' && previousStepData && (
              <>
                {/* Estimate from P1.2 */}
                {previousStepData.estimate && (
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>💰 Dự toán thi công (từ P1.2)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.9rem' }}>
                      {previousStepData.estimate.estimatedBudget && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Ngân sách dự kiến:</span> <strong style={{ color: '#16a34a' }}>{Number(previousStepData.estimate.estimatedBudget).toLocaleString()} {previousStepData.estimate.currency || 'VND'}</strong></div>
                      )}
                      {previousStepData.estimate.materialCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí vật tư:</span> <strong>{Number(previousStepData.estimate.materialCost).toLocaleString()}</strong></div>
                      )}
                      {previousStepData.estimate.laborCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí nhân công:</span> <strong>{Number(previousStepData.estimate.laborCost).toLocaleString()}</strong></div>
                      )}
                      {previousStepData.estimate.overheadCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí chung:</span> <strong>{Number(previousStepData.estimate.overheadCost).toLocaleString()}</strong></div>
                      )}
                    </div>
                    {previousStepData.estimate.estimateNotes && (
                      <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        📝 {previousStepData.estimate.estimateNotes}
                      </div>
                    )}
                  </div>
                )}

                {/* BOM sections from P2.1, P2.2, P2.3 */}
                {[{ key: 'bomMain', label: '📦 VT chính — Thiết kế (P2.1)', color: '#3b82f6' },
                  { key: 'bomWeldPaint', label: '🔥 VT hàn & sơn — PM (P2.2)', color: '#ef4444' },
                  { key: 'bomSupply', label: '📋 VT phụ — Kho (P2.3)', color: '#10b981' },
                ].map(section => {
                  const data = previousStepData[section.key as keyof typeof previousStepData] as Record<string, unknown> | null
                  const items = (data?.bomItems as { name: string; code: string; spec: string; quantity: string; unit: string }[]) || []
                  const filledItems = items.filter(b => b.name?.trim())
                  return (
                    <div key={section.key} className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: `4px solid ${section.color}` }}>
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: section.color }}>{section.label}</h3>
                      {filledItems.length === 0 ? (
                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 8, fontSize: '0.85rem' }}>
                          Chưa có dữ liệu
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1.2fr 0.7fr 0.6fr', gap: 6, padding: '6px 4px', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên VT</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>SL</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                          </div>
                          {filledItems.map((item, idx) => (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1.2fr 0.7fr 0.6fr', gap: 6, padding: '5px 4px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 4, fontSize: '0.82rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                              <span style={{ fontWeight: 600 }}>{item.name}</span>
                              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{item.code}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{item.spec || '—'}</span>
                              <span style={{ fontWeight: 700 }}>{item.quantity || '—'}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{item.unit || '—'}</span>
                            </div>
                          ))}
                          <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                            Tổng: <strong>{filledItems.length}</strong> mục
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* P2.5: Show P2.4 data (KH SX + dự toán điều chỉnh) + BOM summary for BGĐ review */}
            {task.stepCode === 'P2.5' && previousStepData && (
              <>
                {/* KH SX + Dự toán điều chỉnh from P2.4 */}
                {previousStepData.plan && (
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #8b5cf6' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#8b5cf6' }}>📋 Kế hoạch SX & Dự toán điều chỉnh (từ KTKH — P2.4)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.9rem' }}>
                      {previousStepData.plan.adjustedBudget && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Dự toán điều chỉnh:</span>{' '}
                          <strong style={{ color: '#16a34a', fontSize: '1.1rem' }}>{Number(previousStepData.plan.adjustedBudget).toLocaleString()} VND</strong>
                        </div>
                      )}
                    </div>
                    {previousStepData.plan.productionPlan && (
                      <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>KH sản xuất tổng thể:</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(previousStepData.plan.productionPlan)}</div>
                      </div>
                    )}
                    {previousStepData.plan.budgetImpact && (
                      <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Tác động WBS budget:</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(previousStepData.plan.budgetImpact)}</div>
                      </div>
                    )}
                    {previousStepData.plan.workshopTimeline && (
                      <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Timeline phân xưởng:</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(previousStepData.plan.workshopTimeline)}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Dự toán gốc from P1.2 for comparison */}
                {previousStepData.estimate && (
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>💰 Dự toán gốc (từ P1.2 — tham khảo)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.9rem' }}>
                      {previousStepData.estimate.estimatedBudget && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Ngân sách dự kiến:</span> <strong>{Number(previousStepData.estimate.estimatedBudget).toLocaleString()} {previousStepData.estimate.currency || 'VND'}</strong></div>
                      )}
                      {previousStepData.estimate.materialCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí vật tư:</span> <strong>{Number(previousStepData.estimate.materialCost).toLocaleString()}</strong></div>
                      )}
                      {previousStepData.estimate.laborCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí nhân công:</span> <strong>{Number(previousStepData.estimate.laborCost).toLocaleString()}</strong></div>
                      )}
                    </div>
                  </div>
                )}

                {/* BOM summary from P2.1/P2.2/P2.3 */}
                {[{ key: 'bomMain', label: '📦 VT chính — Thiết kế (P2.1)', color: '#3b82f6' },
                  { key: 'bomWeldPaint', label: '🔥 VT hàn & sơn — PM (P2.2)', color: '#ef4444' },
                  { key: 'bomSupply', label: '📋 VT phụ — Kho (P2.3)', color: '#10b981' },
                ].map(section => {
                  const data = previousStepData[section.key as keyof typeof previousStepData] as Record<string, unknown> | null
                  const items = (data?.bomItems as { name: string; code: string; spec: string; quantity: string; unit: string }[]) || []
                  const filledItems = items.filter(b => b.name?.trim())
                  if (filledItems.length === 0) return null
                  return (
                    <div key={section.key} className="card" style={{ padding: '1.25rem', marginTop: '0.75rem', borderLeft: `4px solid ${section.color}` }}>
                      <h3 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', color: section.color }}>{section.label}</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '35px 1.5fr 1fr 1.2fr 0.6fr 0.5fr', gap: 4, padding: '4px 2px', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
                        {['#', 'Tên VT', 'Mã VT', 'Quy chuẩn', 'SL', 'ĐVT'].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {filledItems.map((item, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '35px 1.5fr 1fr 1.2fr 0.6fr 0.5fr', gap: 4, padding: '3px 2px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 3, fontSize: '0.78rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                          <span style={{ fontWeight: 600 }}>{item.name}</span>
                          <span style={{ color: 'var(--accent)' }}>{item.code}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.spec || '—'}</span>
                          <span style={{ fontWeight: 700 }}>{item.quantity || '—'}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.unit || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </>
            )}

            {task.stepCode === 'P2.3' && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8 }}>
                  📋 Vật tư tồn kho hiện có
                </h3>
                {inventoryLoading ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>⏳ Đang tải dữ liệu tồn kho...</div>
                ) : inventoryMaterials.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 10 }}>Chưa có vật tư nào trong kho.</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr 1.2fr 0.8fr 0.6fr', gap: 8, padding: '8px 4px', marginTop: 12, borderBottom: '2px solid var(--border)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên vật tư</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tồn kho</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                    </div>
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                      {inventoryMaterials.map((m, idx) => (
                        <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr 1.2fr 0.8fr 0.6fr', gap: 8, padding: '8px 4px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 4, fontSize: '0.85rem' }}>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{idx + 1}</span>
                          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{m.materialCode}</span>
                          <span>{m.name}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{m.specification || '—'}</span>
                          <span style={{ fontWeight: 700, color: m.currentStock > 100 ? '#16a34a' : '#dc2626' }}>{m.currentStock.toLocaleString()}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{m.unit}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      Tổng: <strong>{inventoryMaterials.length}</strong> mục vật tư có tồn kho
                    </div>
                  </>
                )}
              </div>
            )}

            {/* BOM Table — Editable for P2.1 (VT chính), P2.2 (VT hàn & sơn), P2.3 (VT phụ) */}
            {(task.stepCode === 'P2.1' || task.stepCode === 'P2.2' || task.stepCode === 'P2.3') && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, flex: 1 }}>
                    📦 {task.stepCode === 'P2.3' ? 'Đề xuất vật tư phụ' : `Danh sách vật tư ${task.stepCode === 'P2.1' ? '(BOM)' : '(Hàn & Sơn)'}`} {task.stepCode === 'P2.1' ? <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>* (tối thiểu 3 mục)</span> : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>(không bắt buộc)</span>}
                  </h3>
                  {isActive && (
                    <button type="button" onClick={addBomItem}
                      style={{
                        background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                        padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                      ➕ Thêm VT
                    </button>
                  )}
                </div>
                {/* Table Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr 40px', gap: 8, marginBottom: 6, padding: '0 4px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên VT *</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT *</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Số lượng</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                  <span></span>
                </div>
                {/* Table Rows */}
                {bomItems.map((item, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr 40px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{idx + 1}</span>
                    <input className="input" placeholder="Tên vật tư" value={item.name} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'name', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    <input className="input" placeholder="Mã VT" value={item.code} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'code', e.target.value)} style={{ fontSize: '0.85rem', fontFamily: 'monospace' }} />
                    <input className="input" placeholder="Quy chuẩn" value={item.spec} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'spec', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    <input className="input" type="number" placeholder="0" value={item.quantity} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'quantity', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    <input className="input" placeholder="kg/m/cái" value={item.unit} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'unit', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    {isActive && (
                      <button type="button" onClick={() => removeBomItem(idx)}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, padding: 0 }}
                        title="Xóa dòng">−</button>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  Đã nhập: <strong>{bomItems.filter(b => b.name.trim()).length}</strong> / {bomItems.length} mục
                  {task.stepCode === 'P2.1' && bomItems.filter(b => b.name.trim() && b.code.trim()).length < 3 && (
                    <span style={{ color: '#dc2626', marginLeft: 10 }}>⚠️ Cần ít nhất 3 mục có tên + mã VT</span>
                  )}
                </div>
              </div>
            )}

            {/* P2.4: Show read-only BOM data from P2.1 */}
            {task.stepCode === 'P2.4' && previousStepData?.bom && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, marginBottom: 16 }}>
                  📦 Danh sách vật tư BOM <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>(từ P2.1 - Thiết kế)</span>
                </h3>
                {previousStepData.bom.bomNotes && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                    <strong>Ghi chú BOM:</strong> {String(previousStepData.bom.bomNotes)}
                  </div>
                )}
                {previousStepData.bom.bomItems && (previousStepData.bom.bomItems as Array<{name: string; code: string; spec: string; quantity: string; unit: string}>).length > 0 ? (
                  <>
                    {/* Table Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr', gap: 8, marginBottom: 6, padding: '0 4px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên VT</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Số lượng</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                    </div>
                    {/* Table Rows */}
                    {(previousStepData.bom.bomItems as Array<{name: string; code: string; spec: string; quantity: string; unit: string}>).map((item: {name: string; code: string; spec: string; quantity: string; unit: string}, idx: number) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr', gap: 8, padding: '8px 4px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 6, fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{idx + 1}</span>
                        <span>{item.name}</span>
                        <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{item.code}</span>
                        <span>{item.spec || '—'}</span>
                        <span style={{ fontWeight: 600 }}>{item.quantity || '—'}</span>
                        <span>{item.unit || '—'}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      Tổng: <strong>{(previousStepData.bom.bomItems as Array<{name: string}>).length}</strong> mục vật tư
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu BOM</div>
                )}
              </div>
            )}

            {/* P3.4: Production Order Items Table */}
            {task.stepCode === 'P3.4' && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid #f59e0b', paddingBottom: 8, flex: 1 }}>
                    📋 Nội dung Lệnh sản xuất
                  </h3>
                  {isActive && (
                    <button type="button" onClick={() => setWoItems(prev => [...prev, { ...emptyWoItem }])}
                      style={{
                        background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8,
                        padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                      }}>
                      ➕ Thêm dòng
                    </button>
                  )}
                </div>
                {/* Table Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '30px 0.7fr 1.5fr 0.6fr 0.6fr 0.5fr 0.6fr 0.6fr 0.6fr 0.8fr 0.8fr 30px', gap: 4, padding: '4px 2px', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
                  {['#', 'Mã CP', 'Nội dung CV', 'Mã CV', 'Mã CL', 'ĐVT', 'KL lần 1', 'KL lần 2', 'Tổng KL', 'Ngày BĐ', 'Ngày KT', ''].map(h => (
                    <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                  ))}
                </div>
                {/* Table Rows */}
                {woItems.map((item, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 0.7fr 1.5fr 0.6fr 0.6fr 0.5fr 0.6fr 0.6fr 0.6fr 0.8fr 0.8fr 30px', gap: 4, padding: '3px 2px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{idx + 1}</span>
                    <input className="input" placeholder="Mã CP" value={item.costCode} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, costCode: e.target.value } : it))}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" placeholder="Nội dung công việc" value={item.content} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, content: e.target.value } : it))}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" placeholder="Mã CV" value={item.jobCode} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, jobCode: e.target.value } : it))}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" placeholder="Mã CL" value={item.typeCode} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, typeCode: e.target.value } : it))}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" placeholder="ĐVT" value={item.unit} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" type="number" placeholder="0" value={item.qty1} disabled={!isActive}
                      onChange={e => {
                        const qty1 = e.target.value
                        setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, qty1, totalQty: String(Number(qty1 || 0) + Number(it.qty2 || 0)) } : it))
                      }}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" type="number" placeholder="0" value={item.qty2} disabled={!isActive}
                      onChange={e => {
                        const qty2 = e.target.value
                        setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, qty2, totalQty: String(Number(it.qty1 || 0) + Number(qty2 || 0)) } : it))
                      }}
                      style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                    <input className="input" type="number" value={item.totalQty} disabled
                      style={{ fontSize: '0.8rem', padding: '4px 6px', fontWeight: 700, background: 'var(--bg-secondary)' }} />
                    <input className="input" type="date" value={item.startDate} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, startDate: e.target.value } : it))}
                      style={{ fontSize: '0.75rem', padding: '4px 4px' }} />
                    <input className="input" type="date" value={item.endDate} disabled={!isActive}
                      onChange={e => setWoItems(prev => prev.map((it, i) => i === idx ? { ...it, endDate: e.target.value } : it))}
                      style={{ fontSize: '0.75rem', padding: '4px 4px' }} />
                    {isActive && (
                      <button type="button" onClick={() => setWoItems(prev => prev.filter((_, i) => i !== idx))}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1rem', fontWeight: 700, padding: 0 }}
                        title="Xóa dòng">−</button>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  Tổng: <strong>{woItems.filter(w => w.content.trim()).length}</strong> nội dung công việc
                </div>
              </div>
            )}

            {/* Milestones Section — only for P1.2A */}
            {task.stepCode === 'P1.2A' && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, flex: 1 }}>
                    🎯 Milestones <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>* (ít nhất 1)</span>
                  </h3>
                  {isActive && (
                    <button type="button" onClick={addMilestone}
                      style={{
                        background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                        padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                      ➕ Thêm Milestone
                    </button>
                  )}
                </div>
                {milestones.length === 0 && (
                  <div style={{
                    padding: '2rem', textAlign: 'center', border: '2px dashed var(--border)',
                    borderRadius: 10, color: 'var(--text-muted)', fontSize: '0.9rem',
                  }}>
                    Chưa có milestone nào. Nhấn &quot;Thêm Milestone&quot; để bắt đầu.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {milestones.map((ms, idx) => (
                    <div key={idx} style={{
                      border: '1px solid var(--border)', borderRadius: 10, padding: '1rem',
                      background: 'var(--bg-secondary)', position: 'relative',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent)' }}>Milestone #{idx + 1}</span>
                        {isActive && (
                          <button type="button" onClick={() => removeMilestone(idx)}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>
                            ✕ Xóa
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Nội dung <span style={{ color: '#e74c3c' }}>*</span></label>
                          <input className="input" value={ms.name} disabled={!isActive}
                            onChange={e => updateMilestone(idx, 'name', e.target.value)}
                            placeholder="Ví dụ: Hoàn thành bản vẽ chi tiết" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Ngày bắt đầu</label>
                            <input className="input" type="date" value={ms.startDate} disabled={!isActive}
                              onChange={e => updateMilestone(idx, 'startDate', e.target.value)} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Ngày kết thúc</label>
                            <input className="input" type="date" value={ms.endDate} disabled={!isActive}
                              onChange={e => updateMilestone(idx, 'endDate', e.target.value)} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Người chịu trách nhiệm</label>
                            <select className="input" value={ms.assigneeId} disabled={!isActive}
                              onChange={e => updateMilestone(idx, 'assigneeId', e.target.value)}>
                              <option value="">-- Chọn --</option>
                              {userList.map(u => (
                                <option key={u.id} value={u.id}>{u.fullName} ({u.roleCode})</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>💬 Ghi chú bổ sung</h3>
              <textarea
                value={submitNotes}
                onChange={e => setSubmitNotes(e.target.value)}
                disabled={!isActive}
                placeholder="Nhập ghi chú thêm nếu cần..."
                style={{
                  width: '100%', minHeight: 80, borderRadius: 8, border: '1px solid var(--border)',
                  padding: '0.75rem', fontSize: '0.9rem', resize: 'vertical',
                  background: 'var(--bg-secondary)',
                }}
              />
            </div>

            </>
            )}

            {/* P1.3: Custom action buttons for selective reject */}
            {task.stepCode === 'P1.3' && isActive && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>🚀 Hành động</h3>
                {(planDecision === 'pending' || estimateDecision === 'pending') ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Vui lòng duyệt hoặc từ chối {planDecision === 'pending' && estimateDecision === 'pending' ? 'cả 2 mục' : planDecision === 'pending' ? 'kế hoạch' : 'dự toán'} trên trước khi hoàn thành.
                  </p>
                ) : planDecision === 'rejected' || estimateDecision === 'rejected' ? (
                  <button
                    className="btn-accent"
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitting(true)
                      setError('')
                      try {
                        // Save partial approval state to resultData BEFORE rejecting
                        await apiFetch(`/api/tasks/${taskId}`, {
                          method: 'PUT',
                          body: JSON.stringify({
                            action: 'save',
                            resultData: {
                              planApproved: planDecision === 'approved',
                              estimateApproved: estimateDecision === 'approved',
                              planRejectReason: planDecision === 'rejected' ? planRejectReason : null,
                              estimateRejectReason: estimateDecision === 'rejected' ? estimateRejectReason : null,
                            },
                          }),
                        })
                        // Reject plan → P1.2A
                        if (planDecision === 'rejected') {
                          await apiFetch(`/api/tasks/${taskId}/reject`, {
                            method: 'POST',
                            body: JSON.stringify({ reason: planRejectReason, overrideRejectTo: 'P1.2A' }),
                          })
                        }
                        // Reject estimate → P1.2
                        if (estimateDecision === 'rejected') {
                          await apiFetch(`/api/tasks/${taskId}/reject`, {
                            method: 'POST',
                            body: JSON.stringify({ reason: estimateRejectReason, overrideRejectTo: 'P1.2' }),
                          })
                        }
                        setSuccessMsg('✅ Đã từ chối và đẩy lại task về bước trước')
                        setTimeout(() => router.push('/dashboard/tasks'), 2000)
                      } catch {
                        setError('Lỗi khi từ chối')
                      }
                      setSubmitting(false)
                    }}
                    style={{ width: '100%', padding: '10px', fontSize: '0.95rem', background: '#dc2626' }}
                  >
                    {submitting ? '⏳ Đang xử lý...' : `⚠️ Xác nhận từ chối ${planDecision === 'rejected' ? 'Kế hoạch → PM' : ''}${planDecision === 'rejected' && estimateDecision === 'rejected' ? ' + ' : ''}${estimateDecision === 'rejected' ? 'Dự toán → KTKH' : ''}`}
                  </button>
                ) : (
                  <button
                    className="btn-accent"
                    onClick={() => handleSubmit('complete')}
                    disabled={submitting}
                    style={{ width: '100%', padding: '10px', fontSize: '0.95rem' }}
                  >
                    {submitting ? '⏳ Đang xử lý...' : planDecision === 'approved' && estimateDecision === 'approved' ? '✅ Phê duyệt hoàn thành' : '✅ Phê duyệt'}
                  </button>
                )}
              </div>
            )}

            {/* P1.1B: Inline action buttons */}
            {task.stepCode === 'P1.1B' && isActive && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>🚀 Hành động</h3>
                <div style={{ display: 'flex', gap: 12, marginBottom: showRejectForm ? 16 : 0 }}>
                  <button
                    className="btn-accent"
                    onClick={() => handleSubmit('complete')}
                    disabled={submitting}
                    style={{ flex: 1, padding: '12px 20px', fontSize: '1rem' }}
                  >
                    {submitting ? '⏳ Đang xử lý...' : '✅ Phê duyệt triển khai'}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(!showRejectForm)}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: '12px 20px', fontSize: '1rem',
                      border: '2px solid #e74c3c', borderRadius: 10, background: showRejectForm ? '#fef2f2' : 'transparent',
                      color: '#e74c3c', cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    ❌ Từ chối / Yêu cầu chỉnh sửa
                  </button>
                </div>
                {showRejectForm && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '1.25rem', animation: 'fadeIn 0.3s ease' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: 8, color: '#991b1b' }}>
                      📝 Lý do từ chối / Yêu cầu chỉnh sửa *
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Nhập lý do từ chối hoặc yêu cầu PM chỉnh sửa thông tin dự án..."
                      style={{
                        width: '100%', minHeight: 100, borderRadius: 8, border: '1px solid #fca5a5',
                        padding: '0.75rem', fontSize: '0.9rem', resize: 'vertical',
                        background: '#fff',
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (!rejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return }
                        setSubmitting(true)
                        setError('')
                        const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
                          method: 'POST',
                          body: JSON.stringify({ reason: rejectReason }),
                        })
                        if (res.success) {
                          setSuccessMsg(`✅ Đã từ chối. Quay về bước ${res.returnedTo}: ${res.returnedToName || ''}`)
                          setTimeout(() => router.push('/dashboard/tasks'), 2000)
                        } else {
                          setError(res.error || 'Lỗi khi từ chối')
                        }
                        setSubmitting(false)
                      }}
                      disabled={submitting}
                      style={{
                        marginTop: 12, padding: '10px 24px', fontSize: '0.95rem',
                        border: 'none', borderRadius: 8, background: '#dc2626',
                        color: '#fff', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      {submitting ? '⏳...' : '⚠️ Xác nhận từ chối → Đẩy về PM chỉnh sửa'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div>
            {/* Checklist */}
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                ☑️ Checklist
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                  ({Object.values(checklistState).filter(Boolean).length}/{config.checklist.length})
                </span>
              </h3>
              {config.checklist.map(item => (
                <label key={item.key} style={{
                  display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)',
                  cursor: isActive ? 'pointer' : 'default', fontSize: '0.85rem', alignItems: 'flex-start',
                }}>
                  <input
                    type="checkbox"
                    checked={checklistState[item.key] || false}
                    onChange={() => isActive && handleChecklistToggle(item.key)}
                    disabled={!isActive}
                    style={{ marginTop: 2, accentColor: 'var(--accent)' }}
                  />
                  <span>
                    {item.label}
                    {item.required && <span style={{ color: '#e74c3c', fontSize: '0.75rem' }}> *</span>}
                  </span>
                </label>
              ))}
            </div>

            {/* Attachments */}
            {config.attachments.length > 0 && (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>📎 Tài liệu đính kèm</h3>
                {config.attachments.map(att => {
                  const FILE_KEY_MAP: Record<string, string> = { rfq: 'file_rfq', po: 'file_po', spec: 'file_spec', contract: 'file_contract' }
                  const fileKey = FILE_KEY_MAP[att.key]
                  const fileUrl = siblingFiles && fileKey ? siblingFiles[fileKey] : null
                  return (
                    <div key={att.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: 4 }}>
                        {att.label} {att.required && <span style={{ color: '#e74c3c' }}>*</span>}
                      </div>
                      {fileUrl ? (() => {
                        const fileName = decodeURIComponent(fileUrl.split('/').pop() || '').replace(/^file_(rfq|po|contract|spec)_/, '')
                        return (
                          <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                            borderRadius: 6, background: '#f0fdf4', border: '1px solid #bbf7d0',
                            textDecoration: 'none', color: '#15803d', fontSize: '0.8rem', fontWeight: 500,
                          }}>
                            <span>📄</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
                            <span style={{ marginLeft: 'auto', flexShrink: 0, color: '#166534' }}>↓</span>
                          </a>
                        )
                      })() : (
                        <input
                          type="file"
                          accept={att.accept}
                          disabled={!isActive}
                          style={{ fontSize: '0.8rem', width: '100%' }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Import/Export */}
            {config.excelTemplate && (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>📥 Excel Import/Export</h3>
                <button className="btn-accent" style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem', padding: '8px 12px' }}
                  onClick={() => {
                    const fields = config.fields.filter(f => f.type !== 'section' && f.type !== 'readonly')
                    const headers = fields.map(f => f.label)
                    const keys = fields.map(f => f.key)
                    const values = keys.map(k => formData[k] ?? '')
                    const ws = XLSX.utils.aoa_to_sheet([headers, values])
                    // Auto-size columns
                    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 16) }))
                    const wb = XLSX.utils.book_new()
                    XLSX.utils.book_append_sheet(wb, ws, 'DuToan')
                    XLSX.writeFile(wb, `${config.excelTemplate}_template.xlsx`)
                  }}>
                  ⬇️ Tải template: {config.excelTemplate}
                </button>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Tải template → Nhập dữ liệu → Upload lại
                </div>
                <input type="file" accept=".xlsx,.xls,.csv"
                  disabled={!isActive}
                  style={{ fontSize: '0.8rem', width: '100%' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      const buf = await file.arrayBuffer()
                      const wb = XLSX.read(buf, { type: 'array' })
                      const ws = wb.Sheets[wb.SheetNames[0]]
                      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
                      if (rows.length < 2) { setError('File không có dữ liệu'); return }
                      const headers = rows[0].map(h => String(h).trim())
                      const fields = config.fields.filter(f => f.type !== 'section' && f.type !== 'readonly')
                      const newData: Record<string, string | number> = {}
                      // Try all data rows (not just the first)
                      for (let r = 1; r < rows.length; r++) {
                        const vals = rows[r]
                        if (!vals || vals.length === 0) continue
                        fields.forEach(f => {
                          // Match by label (Vietnamese) or labelEn (English)
                          const colIdx = headers.findIndex(h =>
                            h === f.label || h === f.labelEn || h.toLowerCase() === f.label.toLowerCase()
                          )
                          if (colIdx >= 0 && vals[colIdx] != null && String(vals[colIdx]).trim()) {
                            const raw = String(vals[colIdx]).trim()
                            newData[f.key] = f.type === 'currency' || f.type === 'number'
                              ? Number(raw.replace(/[^\d.-]/g, '')) || raw
                              : raw
                          }
                        })
                      }
                      if (Object.keys(newData).length === 0) {
                        setError('Không tìm thấy trường dữ liệu nào khớp. Kiểm tra tên cột trong Excel.')
                        return
                      }
                      setFormData(prev => {
                        const next = { ...prev, ...newData }
                        // Recalculate total
                        if (config.fields.some(f => f.key === 'totalEstimate')) {
                          const currencyKeys = config.fields.filter(f => f.type === 'currency').map(f => f.key)
                          next.totalEstimate = currencyKeys.reduce((sum, k) => sum + (Number(next[k]) || 0), 0)
                        }
                        return next
                      })
                      setSuccessMsg(`✅ Đã import ${Object.keys(newData).length} trường từ Excel`)
                      setTimeout(() => setSuccessMsg(''), 3000)
                    } catch (err) {
                      setError('Lỗi khi đọc file. Vui lòng kiểm tra định dạng.')
                    }
                  }}
                />
              </div>
            )}

            {/* Actions — hidden for P1.1B and P1.3 since they have inline actions in main area */}
            {isActive && task.stepCode !== 'P1.1B' && task.stepCode !== 'P1.3' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>🚀 Hành động</h3>
                <button
                  className="btn-accent"
                  onClick={() => handleSubmit('complete')}
                  disabled={submitting}
                  style={{ width: '100%', padding: '10px', fontSize: '0.95rem', marginBottom: 8 }}
                >
                  {submitting ? '⏳ Đang xử lý...' : '✅ Hoàn thành bước này'}
                </button>
                {rule?.rejectTo && (
                  <div>
                    <button
                      onClick={() => setShowRejectForm(!showRejectForm)}
                      disabled={submitting}
                      style={{
                        width: '100%', padding: '10px', fontSize: '0.85rem',
                        border: '1px solid #e74c3c', borderRadius: 8, background: showRejectForm ? '#fef2f2' : 'transparent',
                        color: '#e74c3c', cursor: 'pointer',
                      }}
                    >
                      ❌ Từ chối → {rule.rejectTo}
                    </button>
                    {showRejectForm && (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="Nhập lý do từ chối..."
                          rows={2}
                          style={{
                            width: '100%', borderRadius: 8, border: '1px solid #dc2626',
                            padding: '0.5rem', fontSize: '0.85rem', resize: 'vertical',
                            background: 'var(--bg-secondary)',
                          }}
                        />
                        <button
                          disabled={submitting}
                          onClick={async () => {
                            if (!rejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return }
                            setSubmitting(true)
                            setError('')
                            const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: rejectReason }),
                            })
                            if (res.success) {
                              setSuccessMsg(`✅ Đã từ chối → ${rule.rejectTo}`)
                              setTimeout(() => router.push('/dashboard/tasks'), 2000)
                            } else {
                              setError(res.error || 'Lỗi khi từ chối')
                            }
                            setSubmitting(false)
                          }}
                          style={{
                            marginTop: 6, width: '100%', padding: '8px', fontSize: '0.85rem',
                            background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8,
                            cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          {submitting ? '⏳ Đang xử lý...' : '⚠️ Xác nhận từ chối'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Back button */}
            <button
              onClick={() => router.push('/dashboard/tasks')}
              style={{
                width: '100%', padding: '10px', marginTop: 8, fontSize: '0.85rem',
                border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary)',
                cursor: 'pointer', color: 'var(--text-secondary)',
              }}
            >
              ← Quay lại danh sách công việc
            </button>
          </div>
        </div>
      ) : (
        /* Fallback for steps without config */
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>
            Bước <strong>{task.stepCode}</strong> chưa có form chi tiết. Bạn có thể ghi chú và hoàn thành.
          </p>
          <textarea
            value={submitNotes}
            onChange={e => setSubmitNotes(e.target.value)}
            disabled={!isActive}
            placeholder="Nhập ghi chú..."
            style={{
              width: '100%', minHeight: 100, borderRadius: 8, border: '1px solid var(--border)',
              padding: '0.75rem', marginBottom: '1rem',
            }}
          />
          {isActive && (
            <button className="btn-accent" onClick={() => handleSubmit('complete')} disabled={submitting}>
              {submitting ? '⏳...' : '✅ Hoàn thành'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function renderField(
  field: FormField,
  value: string | number,
  onChange: (v: string | number) => void,
  enabled: boolean
) {
  const baseStyle = {
    width: '100%', borderRadius: 8, border: '1px solid var(--border)',
    padding: '0.6rem 0.75rem', fontSize: '0.9rem',
    background: field.type === 'readonly' ? 'var(--bg-tertiary, #f5f5f5)' : 'var(--bg-secondary)',
  }

  switch (field.type) {
    case 'readonly': {
      const display = typeof value === 'number' && value > 0
        ? value.toLocaleString('vi-VN') + (field.unit ? ` ${field.unit}` : '')
        : value || '—'
      const isTotalRow = field.key === 'totalEstimate'
      return <div style={{
        ...baseStyle, color: isTotalRow ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: isTotalRow ? 700 : 400, fontSize: isTotalRow ? '1.1rem' : undefined,
      }}>{display}</div>
    }

    case 'textarea':
      return (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          placeholder={field.placeholder}
          style={{ ...baseStyle, minHeight: 80, resize: 'vertical' }}
        />
      )

    case 'select':
      return (
        <select value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} style={baseStyle}>
          <option value="">-- Chọn --</option>
          {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )

    case 'radio':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '4px 0' }}>
          {field.options?.map(o => (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.9rem', cursor: enabled ? 'pointer' : 'default' }}>
              <input type="radio" name={field.key} value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                disabled={!enabled}
                style={{ accentColor: 'var(--accent)' }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )

    case 'date':
      return <input type="date" value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} style={baseStyle} />

    case 'number':
    case 'currency':
      return (
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          disabled={!enabled}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          style={baseStyle}
        />
      )

    default:
      return (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          placeholder={field.placeholder}
          style={baseStyle}
        />
      )
  }
}
