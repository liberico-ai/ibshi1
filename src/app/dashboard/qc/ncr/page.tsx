'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { OriginPrSection } from '@/components/OriginPrSection'
import { PageHeader, StatusBadge, KPICard, Button, EmptyState, Modal, SelectField, TextareaField, InputField, FilterBar } from '@/components/ui'
import { STATUS_COLORS, SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ClipboardList } from 'lucide-react'

interface NcrAction {
  id: string; actionType: string; description: string; assignedTo: string;
  status: string; dueDate: string | null; completedAt: string | null; evidence: string | null;
  createdAt: string;
}

interface NCR {
  id: string; ncrCode: string; projectId: string; category: string; severity: string;
  description: string; rootCause: string | null; disposition: string | null; status: string;
  reworkCount: number; createdAt: string; closedAt: string | null;
  project: { projectCode: string; projectName: string };
  actions: NcrAction[];
}

interface Project { id: string; projectCode: string; projectName: string }

const SEVERITY_MAP: Record<string, { label: string; color: string; bg: string }> = {
  MINOR:    { label: 'Nhẹ',              color: SEMANTIC_COLORS.warning.solid, bg: SEMANTIC_COLORS.warning.bg },
  MAJOR:    { label: 'Nghiêm trọng',     color: '#ea580c',                    bg: '#fff7ed' },
  CRITICAL: { label: 'Nghiêm trọng cao', color: SEMANTIC_COLORS.danger.solid,  bg: SEMANTIC_COLORS.danger.bg },
}

const CATEGORY_MAP: Record<string, string> = {
  material: 'Vật liệu', welding: 'Hàn', dimensional: 'Kích thước',
  painting: 'Sơn', process: 'Quy trình',
}

const DISPOSITION_OPTIONS = [
  { value: '', label: 'Chọn...' },
  { value: 'USE_AS_IS', label: 'Dùng nguyên trạng' },
  { value: 'REWORK', label: 'Sửa chữa' },
  { value: 'REJECT', label: 'Loại bỏ' },
  { value: 'RETURN_TO_VENDOR', label: 'Trả NCC' },
]

const NCR_STATUS_KEYS = Object.keys(STATUS_COLORS.ncr) as Array<keyof typeof STATUS_COLORS.ncr>
const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tất cả' },
  ...NCR_STATUS_KEYS.map(k => ({ value: k, label: STATUS_COLORS.ncr[k].label })),
]
const SEVERITY_FILTER_OPTIONS = [
  { value: '', label: 'Tất cả' },
  ...Object.entries(SEVERITY_MAP).map(([k, v]) => ({ value: k, label: v.label })),
]
const CATEGORY_OPTIONS = Object.entries(CATEGORY_MAP).map(([k, v]) => ({ value: k, label: v }))
const SEVERITY_OPTIONS = Object.entries(SEVERITY_MAP).map(([k, v]) => ({ value: k, label: v.label }))

const NCR_STEPS = ['OPEN', 'INVESTIGATING', 'ACTION_TAKEN', 'CLOSED'] as const

export default function NCRPage() {
  const [ncrs, setNcrs] = useState<NCR[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedNcr, setSelectedNcr] = useState<NCR | null>(null)
  const [filterSev, setFilterSev] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSev) params.set('severity', filterSev)
    if (filterStatus) params.set('status', filterStatus)
    const res = await apiFetch(`/api/qc/ncr?${params}`)
    if (res.ok) setNcrs(res.ncrs || [])
    setLoading(false)
  }, [filterSev, filterStatus])

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  const openDetail = async (ncr: NCR) => {
    const res = await apiFetch(`/api/qc/ncr/${ncr.id}`)
    if (res.ok) setSelectedNcr(res.ncr)
    else setSelectedNcr(ncr)
  }

  useEffect(() => { loadData() }, [loadData])

  const canCreate = ['R01', 'R09', 'R09a', 'R06'].includes(user?.roleCode || '')

  const openCount = ncrs.filter(n => n.status === 'OPEN').length
  const criticalCount = ncrs.filter(n => n.severity === 'CRITICAL' && n.status !== 'CLOSED').length

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Báo cáo không phù hợp (NCR)"
        subtitle="Quản lý sự cố chất lượng sản phẩm"
        actions={canCreate ? <Button variant="primary" onClick={openForm}>+ Tạo NCR</Button> : undefined}
      />

      <div className="grid grid-cols-3 gap-4 stagger-children">
        <KPICard label="Tổng NCR" value={ncrs.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đang mở" value={openCount} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard
          label="Critical"
          value={criticalCount}
          accentColor={criticalCount > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}
        />
      </div>

      <div className="flex gap-4 flex-wrap">
        <FilterBar filters={SEVERITY_FILTER_OPTIONS} value={filterSev} onChange={setFilterSev} />
        <FilterBar filters={STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} />
      </div>

      <div className="space-y-2">
        {ncrs.length === 0 && (
          <EmptyState icon={<ClipboardList />} title="Không có NCR nào" description="Tất cả sản phẩm đạt yêu cầu chất lượng" />
        )}
        {ncrs.map(ncr => {
          const sev = SEVERITY_MAP[ncr.severity] || SEVERITY_MAP.MINOR
          const stepIdx = NCR_STEPS.indexOf(ncr.status as typeof NCR_STEPS[number])
          return (
            <div key={ncr.id} className="card p-4 transition-all hover:shadow-md cursor-pointer" style={{ borderLeft: `4px solid ${sev.color}` }} onClick={() => openDetail(ncr)}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{ncr.ncrCode}</span>
                    <span className="badge" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
                    <StatusBadge category="ncr" status={ncr.status} />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{CATEGORY_MAP[ncr.category] || ncr.category}</span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{ncr.description}</p>
                  {/* Mini stepper */}
                  <div className="flex items-center gap-1 mt-2">
                    {NCR_STEPS.map((step, i) => (
                      <div key={step} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{
                          background: i <= stepIdx ? SEMANTIC_COLORS.success.solid : 'var(--border-light)',
                        }} />
                        {i < NCR_STEPS.length - 1 && <div className="w-4 h-0.5" style={{
                          background: i < stepIdx ? SEMANTIC_COLORS.success.solid : 'var(--border-light)',
                        }} />}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>DA: <span className="font-mono">{ncr.project.projectCode}</span></span>
                    {ncr.disposition && <span>Xử lý: {DISPOSITION_OPTIONS.find(d => d.value === ncr.disposition)?.label || ncr.disposition}</span>}
                    {ncr.reworkCount > 0 && <span className="font-semibold" style={{ color: SEMANTIC_COLORS.warning.solid }}>Sửa lại: {ncr.reworkCount}x</span>}
                    <span>{formatDate(ncr.createdAt)}</span>
                  </div>
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                  <p>Actions: <span className="font-mono">{ncr.actions.length}</span></p>
                  {ncr.actions.filter(a => a.status === 'OPEN').length > 0 && (
                    <p style={{ color: SEMANTIC_COLORS.warning.solid }}>{ncr.actions.filter(a => a.status === 'OPEN').length} chưa xong</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <CreateNCRModal
        open={showForm}
        projects={projects}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); loadData() }}
      />

      {selectedNcr && (
        <NCRDetailModal
          ncr={selectedNcr}
          onClose={() => setSelectedNcr(null)}
          onUpdated={() => { setSelectedNcr(null); loadData() }}
        />
      )}
    </div>
  )
}

// Disposition cần mua bù vật tư → cho phép tạo PR bổ sung có truy vết (Đợt 2D)
const PR_DISPOSITIONS = ['REWORK', 'REJECT', 'SCRAP']

function NCRDetailModal({ ncr, onClose, onUpdated }: { ncr: NCR; onClose: () => void; onUpdated: () => void }) {
  const router = useRouter()
  const [data, setData] = useState(ncr)
  const [showActionForm, setShowActionForm] = useState(false)
  const [updating, setUpdating] = useState(false)
  const user = useAuthStore(s => s.user)
  const canEdit = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')
  const canAddAction = ['R01', 'R09', 'R09a', 'R06'].includes(user?.roleCode || '')
  // Quyền tạo PR theo API /api/purchase-requests (R01, R02, R03, R05)
  const canCreatePr = ['R01', 'R02', 'R03', 'R05'].includes(user?.roleCode || '')
  const needsPr = PR_DISPOSITIONS.includes(data.disposition || '')

  const goCreatePr = () => {
    const params = new URLSearchParams({
      originType: 'NCR',
      originId: data.id,
      originLabel: data.ncrCode,
      projectId: data.projectId,
    })
    router.push(`/dashboard/warehouse/purchase-requests/new?${params.toString()}`)
  }

  const stepIdx = NCR_STEPS.indexOf(data.status as typeof NCR_STEPS[number])
  const openActions = data.actions.filter(a => a.status === 'OPEN').length
  const sev = SEVERITY_MAP[data.severity] || SEVERITY_MAP.MINOR

  const refreshDetail = async () => {
    const res = await apiFetch(`/api/qc/ncr/${data.id}`)
    if (res.ok) setData(res.ncr)
  }

  const updateStatus = async (status: string, disposition?: string) => {
    setUpdating(true)
    const body: Record<string, string> = { status }
    if (disposition) body.disposition = disposition
    const res = await apiFetch(`/api/qc/ncr/${data.id}`, { method: 'PUT', body: JSON.stringify(body) })
    setUpdating(false)
    if (res.ok) { setData(res.ncr); if (status === 'CLOSED') onUpdated() }
    else alert(res.error || 'Lỗi cập nhật')
  }

  const updateDisposition = async (disposition: string) => {
    const body: Record<string, string> = { disposition }
    if (data.status === 'OPEN' || data.status === 'INVESTIGATING') body.status = 'INVESTIGATING'
    const res = await apiFetch(`/api/qc/ncr/${data.id}`, { method: 'PUT', body: JSON.stringify(body) })
    if (res.ok) setData(res.ncr)
    else alert(res.error || 'Lỗi cập nhật')
  }

  const updateRootCause = async (rootCause: string) => {
    const res = await apiFetch(`/api/qc/ncr/${data.id}`, { method: 'PUT', body: JSON.stringify({ rootCause }) })
    if (res.ok) setData(res.ncr)
  }

  const completeAction = async (actionId: string) => {
    const res = await apiFetch(`/api/qc/ncr/${data.id}/actions/${actionId}`, {
      method: 'PUT', body: JSON.stringify({ status: 'COMPLETED' }),
    })
    if (res.ok) refreshDetail()
    else alert(res.error || 'Lỗi')
  }

  const stepLabels = ['Mở', 'Điều tra', 'Đã XL', 'Đóng']

  return (
    <Modal open={true} onClose={onClose} title={`${data.ncrCode} — Chi tiết`} size="lg">
      <div className="space-y-5">
        {/* Stepper */}
        <div className="flex items-center justify-between px-2">
          {NCR_STEPS.map((step, i) => {
            const isActive = i === stepIdx
            const isDone = i < stepIdx || data.status === 'CLOSED'
            const isCancelled = data.status === 'CANCELLED'
            return (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2"
                    style={{
                      background: isDone ? SEMANTIC_COLORS.success.solid : isActive ? 'var(--accent)' : isCancelled ? SEMANTIC_COLORS.neutral.bg : 'transparent',
                      borderColor: isDone ? SEMANTIC_COLORS.success.solid : isActive ? 'var(--accent)' : 'var(--border-light)',
                      color: isDone || isActive ? '#fff' : 'var(--text-muted)',
                    }}>
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span className="text-[10px] mt-1 whitespace-nowrap" style={{
                    color: isActive ? 'var(--accent)' : isDone ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)',
                    fontWeight: isActive ? 700 : 400,
                  }}>{stepLabels[i]}</span>
                </div>
                {i < NCR_STEPS.length - 1 && (
                  <div className="flex-1 h-0.5 mx-2 mt-[-16px]" style={{
                    background: i < stepIdx ? SEMANTIC_COLORS.success.solid : 'var(--border-light)',
                  }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Info */}
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="badge" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
            <StatusBadge category="ncr" status={data.status} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{CATEGORY_MAP[data.category] || data.category}</span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{formatDate(data.createdAt)}</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{data.description}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>DA: {data.project.projectCode} — {data.project.projectName}</p>
        </div>

        {/* Root Cause + Disposition */}
        {canEdit && data.status !== 'CLOSED' && data.status !== 'CANCELLED' && (
          <div className="grid grid-cols-2 gap-3">
            <TextareaField
              label="Nguyên nhân gốc"
              value={data.rootCause || ''}
              onChange={e => setData({ ...data, rootCause: e.target.value })}
              onBlur={e => updateRootCause(e.target.value)}
              rows={2}
              placeholder="Phân tích..."
            />
            <SelectField
              label="Disposition"
              value={data.disposition || ''}
              onChange={e => updateDisposition(e.target.value)}
              options={DISPOSITION_OPTIONS}
            />
          </div>
        )}

        {/* Sửa chữa / loại bỏ → cần mua bù vật tư: tạo PR bổ sung có truy vết NCR (Đợt 2D) */}
        {needsPr && canCreatePr && (
          <div
            className="flex items-center justify-between p-3 rounded-lg"
            style={{ background: SEMANTIC_COLORS.warning.bg, border: `1px solid ${SEMANTIC_COLORS.warning.solid}30` }}
          >
            <p className="text-xs" style={{ color: 'var(--text-primary)', margin: 0 }}>
              Disposition <b>{DISPOSITION_OPTIONS.find(d => d.value === data.disposition)?.label || data.disposition}</b>
              {' '}— nếu cần mua bù vật tư, tạo PR gắn nguồn {data.ncrCode}
            </p>
            <Button variant="primary" size="sm" onClick={goCreatePr}>Tạo PR bổ sung</Button>
          </div>
        )}

        {/* Truy vết ngược: PR đã phát sinh từ NCR này */}
        <OriginPrSection originType="NCR" originId={data.id} />

        {/* Actions list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="input-label">Actions ({data.actions.length})</label>
            {canAddAction && data.status !== 'CLOSED' && data.status !== 'CANCELLED' && (
              <Button variant="ghost" size="sm" onClick={() => setShowActionForm(true)}>+ Thêm</Button>
            )}
          </div>
          {data.actions.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có action nào</p>}
          <div className="space-y-1.5">
            {data.actions.map(action => {
              const isDone = action.status === 'COMPLETED'
              const typeLabel = action.actionType === 'corrective' ? 'Khắc phục' : action.actionType === 'preventive' ? 'Phòng ngừa' : 'Khẩn cấp'
              return (
                <div key={action.id} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: 'var(--bg-primary)' }}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                    style={{
                      background: isDone ? SEMANTIC_COLORS.success.solid : 'var(--border-light)',
                      color: isDone ? '#fff' : 'var(--text-muted)',
                    }}>
                    {isDone ? '✓' : '○'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: SEMANTIC_COLORS.info.bg, color: SEMANTIC_COLORS.info.solid }}>{typeLabel}</span>
                      <span className="text-xs" style={{ color: isDone ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: isDone ? 'line-through' : 'none' }}>{action.description}</span>
                    </div>
                    {action.dueDate && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Hạn: {formatDate(action.dueDate)}</span>}
                  </div>
                  {!isDone && canEdit && (
                    <button
                      className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                      style={{ background: SEMANTIC_COLORS.success.solid }}
                      onClick={() => completeAction(action.id)}
                    >Xong</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Status actions */}
        {canEdit && data.status !== 'CLOSED' && data.status !== 'CANCELLED' && (
          <div className="flex gap-2 border-t pt-3" style={{ borderColor: 'var(--border-light)' }}>
            {data.status === 'OPEN' && (
              <Button variant="outline" size="sm" onClick={() => updateStatus('INVESTIGATING')} loading={updating}>Bắt đầu điều tra</Button>
            )}
            {data.status === 'ACTION_TAKEN' && (
              <Button
                variant="primary" size="sm"
                onClick={() => updateStatus('CLOSED')}
                loading={updating}
                disabled={openActions > 0}
              >
                {openActions > 0 ? `Còn ${openActions} action chưa xong` : 'Đóng NCR'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => updateStatus('CANCELLED')} loading={updating}>Hủy NCR</Button>
          </div>
        )}
      </div>

      {showActionForm && (
        <AddActionModal
          ncrId={data.id}
          onClose={() => setShowActionForm(false)}
          onCreated={() => { setShowActionForm(false); refreshDetail() }}
        />
      )}
    </Modal>
  )
}

function AddActionModal({ ncrId, onClose, onCreated }: { ncrId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ actionType: 'corrective', description: '', assignedTo: '', dueDate: '' })
  const [users, setUsers] = useState<Array<{ id: string; fullName: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/employees').then(res => { if (res.ok) setUsers(res.employees || []) })
  }, [])

  const submit = async () => {
    if (!form.description || !form.assignedTo) return alert('Nhập mô tả và chọn người phụ trách')
    setSubmitting(true)
    const res = await apiFetch(`/api/qc/ncr/${ncrId}`, {
      method: 'POST',
      body: JSON.stringify(form),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Thêm Action" size="md">
      <div className="space-y-4">
        <SelectField
          label="Loại"
          value={form.actionType}
          onChange={e => update('actionType', e.target.value)}
          options={[
            { value: 'corrective', label: 'Khắc phục' },
            { value: 'preventive', label: 'Phòng ngừa' },
            { value: 'containment', label: 'Khẩn cấp' },
          ]}
        />
        <TextareaField label="Mô tả *" value={form.description} onChange={e => update('description', e.target.value)} rows={2} />
        <SelectField
          label="Người phụ trách *"
          value={form.assignedTo}
          onChange={e => update('assignedTo', e.target.value)}
          options={[{ value: '', label: 'Chọn...' }, ...users.map(u => ({ value: u.id, label: u.fullName }))]}
        />
        <InputField label="Hạn (tùy chọn)" type="date" value={form.dueDate} onChange={e => update('dueDate', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Thêm</Button>
      </div>
    </Modal>
  )
}

function CreateNCRModal({ open, projects, onClose, onCreated }: {
  open: boolean; projects: Project[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({ projectId: '', category: 'welding', severity: 'MINOR', description: '', rootCause: '' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.projectId || !form.description) return alert('Chọn dự án và nhập mô tả')
    setSubmitting(true)
    const res = await apiFetch('/api/qc/ncr', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo NCR')
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo NCR" size="md">
      <div className="space-y-4">
        <SelectField
          label="Dự án *"
          value={form.projectId}
          onChange={e => update('projectId', e.target.value)}
          options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]}
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Loại" value={form.category} onChange={e => update('category', e.target.value)} options={CATEGORY_OPTIONS} />
          <SelectField label="Mức độ" value={form.severity} onChange={e => update('severity', e.target.value)} options={SEVERITY_OPTIONS} />
        </div>
        <TextareaField label="Mô tả *" value={form.description} onChange={e => update('description', e.target.value)} rows={3} placeholder="Mô tả vấn đề..." />
        <TextareaField label="Nguyên nhân gốc" value={form.rootCause} onChange={e => update('rootCause', e.target.value)} rows={2} placeholder="Phân tích nguyên nhân..." />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo NCR'}</Button>
      </div>
    </Modal>
  )
}
