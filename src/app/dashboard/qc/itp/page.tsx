'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, StatusBadge, Button, EmptyState, Modal, InputField, SelectField, KPICard } from '@/components/ui'
import { STATUS_COLORS, SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ClipboardList } from 'lucide-react'

interface Checkpoint {
  id: string; checkpointNo: number; activity: string; description: string;
  inspectionType: string; status: string; remarks: string | null; ncrId: string | null;
}

interface ITP {
  id: string; itpCode: string; projectId: string; name: string; revision: string;
  status: string; createdAt: string; totalCheckpoints: number;
  passedCheckpoints: number; failedCheckpoints: number;
  project: { projectCode: string; projectName: string };
  checkpoints: Checkpoint[];
}

interface Project { id: string; projectCode: string; projectName: string }

const INSP_TYPE: Record<string, { label: string; color: string }> = {
  HOLD:    { label: 'H', color: SEMANTIC_COLORS.danger.solid },
  WITNESS: { label: 'W', color: SEMANTIC_COLORS.warning.solid },
  MONITOR: { label: 'M', color: SEMANTIC_COLORS.info.solid },
  REVIEW:  { label: 'R', color: SEMANTIC_COLORS.neutral.solid },
}

const ACTIVITY_OPTIONS = [
  { value: 'welding', label: 'Hàn' },
  { value: 'ndt', label: 'NDT' },
  { value: 'pressure_test', label: 'Thử áp' },
  { value: 'dimensional', label: 'Kích thước' },
  { value: 'painting', label: 'Sơn' },
  { value: 'visual', label: 'Ngoại quan' },
]

const INSP_TYPE_OPTIONS = [
  { value: 'HOLD', label: 'Hold (H)' },
  { value: 'WITNESS', label: 'Witness (W)' },
  { value: 'MONITOR', label: 'Monitor (M)' },
  { value: 'REVIEW', label: 'Review (R)' },
]

export default function ITPPage() {
  const [itps, setItps] = useState<ITP[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)

  const loadData = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/qc/itp')
    if (res.ok) setItps(res.itps || [])
    setLoading(false)
  }, [])

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [loadData])

  const canInspect = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')
  const canCreate = canInspect

  const updateCheckpoint = async (itpId: string, cpId: string, status: 'PASSED' | 'FAILED', createNcr?: boolean) => {
    const remarks = status === 'FAILED' ? prompt('Ghi chú lỗi:') : null
    if (status === 'FAILED' && remarks === null) return

    const res = await apiFetch(`/api/qc/itp/${itpId}/checkpoints/${cpId}`, {
      method: 'PUT',
      body: JSON.stringify({ status, remarks: remarks || undefined, createNcr }),
    })
    if (res.ok) {
      loadData()
      if (res.ncrId) alert(`Đã tạo NCR tự động (${res.ncrId.slice(0, 8)}…)`)
    } else {
      alert(res.error || 'Lỗi cập nhật')
    }
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  const totalCheckpoints = itps.reduce((s, i) => s + i.totalCheckpoints, 0)
  const totalPassed = itps.reduce((s, i) => s + i.passedCheckpoints, 0)
  const totalFailed = itps.reduce((s, i) => s + i.failedCheckpoints, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kế hoạch Kiểm tra (ITP)"
        subtitle="Lập và theo dõi kế hoạch kiểm tra"
        actions={canCreate ? <Button variant="primary" onClick={openForm}>+ Tạo ITP</Button> : undefined}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng ITP" value={itps.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Tổng điểm kiểm" value={totalCheckpoints} accentColor={SEMANTIC_COLORS.neutral.solid} />
        <KPICard label="Đạt" value={totalPassed} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard
          label="Lỗi"
          value={totalFailed}
          accentColor={totalFailed > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}
        />
      </div>

      <div className="space-y-3">
        {itps.length === 0 && (
          <EmptyState icon={<ClipboardList />} title="Chưa có ITP nào" description="Tạo ITP đầu tiên để bắt đầu quản lý kiểm tra" />
        )}
        {itps.map(itp => {
          const progress = itp.totalCheckpoints ? Math.round((itp.passedCheckpoints / itp.totalCheckpoints) * 100) : 0
          const isExpanded = expanded === itp.id
          const itpColors = STATUS_COLORS.itp[itp.status as keyof typeof STATUS_COLORS.itp]
          return (
            <div key={itp.id} className="card overflow-hidden transition-all hover:shadow-md">
              <div className="p-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : itp.id)}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-lg"
                    style={{
                      background: itpColors?.bg || SEMANTIC_COLORS.neutral.bg,
                      color: itpColors?.text || SEMANTIC_COLORS.neutral.solid,
                    }}>
                    {progress}%
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{itp.itpCode}</span>
                      <StatusBadge category="itp" status={itp.status} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>Rev {itp.revision}</span>
                    </div>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{itp.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>DA: <span className="font-mono">{itp.project.projectCode}</span></p>
                  </div>
                  <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    <p><span className="font-mono">{itp.totalCheckpoints}</span> điểm kiểm</p>
                    <p className="font-semibold" style={{ color: SEMANTIC_COLORS.success.solid }}>&#10003; {itp.passedCheckpoints}</p>
                    {itp.failedCheckpoints > 0 && <p className="font-semibold" style={{ color: SEMANTIC_COLORS.danger.solid }}>&#10007; {itp.failedCheckpoints}</p>}
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</span>
                </div>
              </div>
              {isExpanded && itp.checkpoints.length > 0 && (
                <div className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <div className="p-3 space-y-1">
                    {itp.checkpoints.map(cp => {
                      const ins = INSP_TYPE[cp.inspectionType] || INSP_TYPE.MONITOR
                      const isPending = cp.status === 'PENDING'
                      return (
                        <div key={cp.id} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: 'var(--bg-primary)' }}>
                          <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold text-white" style={{ background: ins.color }}>{ins.label}</span>
                          <span className="font-mono text-xs w-6" style={{ color: 'var(--text-muted)' }}>#{cp.checkpointNo}</span>
                          <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
                            {cp.description}
                            {cp.remarks && <span className="ml-2 italic" style={{ color: 'var(--text-muted)' }}>— {cp.remarks}</span>}
                          </span>
                          {cp.ncrId && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>NCR</span>}
                          <StatusBadge category="qc" status={cp.status === 'PENDING' ? 'PENDING' : cp.status === 'PASSED' ? 'PASSED' : 'FAILED'} />
                          {isPending && canInspect && (
                            <div className="flex gap-1">
                              <button
                                className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                style={{ background: SEMANTIC_COLORS.success.solid }}
                                onClick={(e) => { e.stopPropagation(); updateCheckpoint(itp.id, cp.id, 'PASSED') }}
                              >Đạt</button>
                              <button
                                className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                style={{ background: SEMANTIC_COLORS.danger.solid }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const wantNcr = (cp.inspectionType === 'HOLD' || cp.inspectionType === 'WITNESS')
                                    ? confirm('Tạo NCR tự động cho lỗi này?')
                                    : false
                                  updateCheckpoint(itp.id, cp.id, 'FAILED', wantNcr)
                                }}
                              >Lỗi</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <CreateITPModal
        open={showForm}
        projects={projects}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); loadData() }}
      />
    </div>
  )
}

interface WOOption { id: string; woCode: string; pieceMark: string | null; status: string }

const WO_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Mở', IN_PROGRESS: 'Đang SX', QC_PENDING: 'Chờ QC', QC_PASSED: 'QC Đạt',
  QC_FAILED: 'QC Lỗi', COMPLETED: 'Xong', ON_HOLD: 'Tạm dừng', PENDING_MATERIAL: 'Chờ VT',
}

interface CPForm {
  activity: string; description: string; standard: string; inspectionType: string;
  workOrderId: string; pieceMark: string;
}

function CreateITPModal({ open, projects, onClose, onCreated }: {
  open: boolean; projects: Project[]; onClose: () => void; onCreated: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [defaultWoId, setDefaultWoId] = useState('')
  const [workOrders, setWorkOrders] = useState<WOOption[]>([])
  const [loadingWO, setLoadingWO] = useState(false)
  const [checkpoints, setCheckpoints] = useState<CPForm[]>([
    { activity: 'welding', description: '', standard: '', inspectionType: 'MONITOR', workOrderId: '', pieceMark: '' },
  ])
  const [submitting, setSubmitting] = useState(false)

  async function onProjectChange(pid: string) {
    setProjectId(pid)
    setDefaultWoId('')
    setWorkOrders([])
    setCheckpoints(cps => cps.map(cp => ({ ...cp, workOrderId: '', pieceMark: '' })))
    if (!pid) return
    setLoadingWO(true)
    const res = await apiFetch(`/api/production?projectId=${pid}&limit=500`)
    if (res.ok) setWorkOrders((res.workOrders || []).map((wo: { id: string; woCode: string; pieceMark: string | null; status: string }) => ({
      id: wo.id, woCode: wo.woCode, pieceMark: wo.pieceMark, status: wo.status,
    })))
    setLoadingWO(false)
  }

  function onDefaultWoChange(woId: string) {
    setDefaultWoId(woId)
    const wo = workOrders.find(w => w.id === woId)
    setCheckpoints(cps => cps.map(cp =>
      !cp.workOrderId ? { ...cp, workOrderId: woId, pieceMark: wo?.pieceMark || '' } : cp
    ))
  }

  function onCpWoChange(index: number, woId: string) {
    const wo = workOrders.find(w => w.id === woId)
    const n = [...checkpoints]
    n[index] = { ...n[index], workOrderId: woId, pieceMark: wo?.pieceMark || '' }
    setCheckpoints(n)
  }

  const addCheckpoint = () => {
    const wo = workOrders.find(w => w.id === defaultWoId)
    setCheckpoints([...checkpoints, {
      activity: 'welding', description: '', standard: '', inspectionType: 'MONITOR',
      workOrderId: defaultWoId, pieceMark: wo?.pieceMark || '',
    }])
  }

  const woOptions = [
    { value: '', label: projectId ? 'Không gắn WO' : 'Chọn dự án trước' },
    ...workOrders.map(wo => ({
      value: wo.id,
      label: `${wo.woCode}${wo.pieceMark ? ` — ${wo.pieceMark}` : ''} [${WO_STATUS_LABEL[wo.status] || wo.status}]`,
    })),
  ]

  const submit = async () => {
    if (!projectId || !name) return alert('Chọn dự án và nhập tên ITP')
    const validCPs = checkpoints
      .filter(c => c.description)
      .map(c => ({
        activity: c.activity,
        description: c.description,
        standard: c.standard || undefined,
        inspectionType: c.inspectionType,
        workOrderId: c.workOrderId || undefined,
        pieceMark: c.pieceMark || undefined,
      }))
    setSubmitting(true)
    const res = await apiFetch('/api/qc/itp', {
      method: 'POST',
      body: JSON.stringify({ projectId, name, checkpoints: validCPs.length > 0 ? validCPs : undefined }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo ITP')
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo ITP mới" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Dự án *"
            value={projectId}
            onChange={e => onProjectChange(e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]}
          />
          <InputField
            label="Tên ITP *"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VD: Pressure Vessel ITP"
          />
        </div>

        <SelectField
          label={`Work Order mặc định${loadingWO ? ' (đang tải...)' : ''}`}
          value={defaultWoId}
          onChange={e => onDefaultWoChange(e.target.value)}
          options={woOptions}
        />
        {defaultWoId && (
          <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: -8 }}>
            Checkpoint mới sẽ kế thừa WO này. Có thể đổi riêng mỗi checkpoint.
          </p>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="input-label">Điểm kiểm tra</label>
            <Button type="button" variant="ghost" size="sm" onClick={addCheckpoint}>+ Thêm</Button>
          </div>
          {checkpoints.map((cp, i) => (
            <div key={i} className="mb-2 p-2 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
              <div className="grid grid-cols-4 gap-2">
                <SelectField
                  value={cp.activity}
                  onChange={e => { const n = [...checkpoints]; n[i].activity = e.target.value; setCheckpoints(n) }}
                  options={ACTIVITY_OPTIONS}
                />
                <div className="col-span-2">
                  <input
                    className="input w-full"
                    value={cp.description}
                    onChange={e => { const n = [...checkpoints]; n[i].description = e.target.value; setCheckpoints(n) }}
                    placeholder="Mô tả..."
                  />
                </div>
                <SelectField
                  value={cp.inspectionType}
                  onChange={e => { const n = [...checkpoints]; n[i].inspectionType = e.target.value; setCheckpoints(n) }}
                  options={INSP_TYPE_OPTIONS}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <SelectField
                  value={cp.workOrderId}
                  onChange={e => onCpWoChange(i, e.target.value)}
                  options={woOptions}
                />
                <input
                  className="input w-full"
                  value={cp.pieceMark}
                  readOnly={!!cp.workOrderId}
                  placeholder="Piece Mark"
                  onChange={e => { if (!cp.workOrderId) { const n = [...checkpoints]; n[i].pieceMark = e.target.value; setCheckpoints(n) } }}
                  style={cp.workOrderId ? { background: 'var(--bg-primary)', cursor: 'not-allowed', opacity: 0.7 } : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>
          {submitting ? 'Đang tạo...' : 'Tạo ITP'}
        </Button>
      </div>
    </Modal>
  )
}
