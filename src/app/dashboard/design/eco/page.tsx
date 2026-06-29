'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCurrency, formatDate } from '@/lib/utils'
import { STATUS_COLORS } from '@/lib/design-tokens'
import { RefreshCw } from 'lucide-react'
import {
  PageHeader,
  Button,
  EmptyState,
  Modal,
  InputField,
  SelectField,
  TextareaField,
  FilterBar,
  KPICard,
  StatusBadge,
} from '@/components/ui'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ECO {
  id: string
  ecoCode: string
  title: string
  description: string
  changeType: string
  impactCost: number | null
  impactSchedule: number | null
  status: string
  createdAt: string
  project: { projectCode: string; projectName: string }
  bomVersionId?: string | null
}

interface Project {
  id: string
  projectCode: string
  projectName: string
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TYPE_MAP: Record<string, string> = {
  design: 'Thiết kế',
  material: 'Vật liệu',
  process: 'Quy trình',
  specification: 'Tiêu chuẩn',
}

const TYPE_OPTIONS = Object.entries(TYPE_MAP).map(([value, label]) => ({
  value,
  label,
}))

/** Roles that can create ECOs / submit for review */
const CAN_CREATE_ROLES = ['R01', 'R04', 'R02', 'R06']
/** Roles that can approve or reject */
const CAN_REVIEW_ROLES = ['R01', 'R02', 'R02a']
/** Roles that can mark as implemented */
const CAN_IMPLEMENT_ROLES = ['R01', 'R02']

const ECO_STATUSES = STATUS_COLORS.eco

const FILTER_OPTIONS = [
  { value: '', label: 'Tất cả' },
  ...Object.entries(ECO_STATUSES).map(([key, val]) => ({
    value: key,
    label: val.label,
  })),
]

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ECOPage() {
  const [ecos, setEcos] = useState<ECO[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [transitioning, setTransitioning] = useState<string | null>(null)
  const user = useAuthStore((s) => s.user)
  const roleCode = user?.roleCode || ''

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    const res = await apiFetch(`/api/design/eco?${params}`)
    if (res.ok) setEcos(res.ecos || [])
    setLoading(false)
  }, [filterStatus])

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => {
    loadData()
  }, [loadData])

  /* ---- KPI computation ---- */
  const kpis = useMemo(() => {
    const total = ecos.length
    const submitted = ecos.filter((e) => e.status === 'SUBMITTED').length
    const approved = ecos.filter((e) => e.status === 'APPROVED').length
    const implemented = ecos.filter((e) => e.status === 'IMPLEMENTED').length
    return { total, submitted, approved, implemented }
  }, [ecos])

  /* ---- Status transition handler ---- */
  const handleTransition = async (ecoId: string, newStatus: string) => {
    setTransitioning(ecoId)
    const res = await apiFetch(`/api/design/eco/${ecoId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    })
    setTransitioning(null)
    if (res.ok) {
      loadData()
    } else {
      alert(res.error || 'Lỗi cập nhật trạng thái')
    }
  }

  const canCreate = CAN_CREATE_ROLES.includes(roleCode)

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 skeleton rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        title="Quản lý thay đổi thiết kế (ECO)"
        subtitle="Theo dõi yêu cầu thay đổi kỹ thuật"
        actions={
          canCreate ? (
            <Button variant="primary" onClick={openForm}>
              + Tạo ECO
            </Button>
          ) : undefined
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Tổng ECO"
          value={kpis.total}
          accentColor={ECO_STATUSES.DRAFT.text}
        />
        <KPICard
          label="Chờ duyệt"
          value={kpis.submitted}
          accentColor={ECO_STATUSES.SUBMITTED.text}
        />
        <KPICard
          label="Đã duyệt"
          value={kpis.approved}
          accentColor={ECO_STATUSES.APPROVED.text}
        />
        <KPICard
          label="Đã áp dụng"
          value={kpis.implemented}
          accentColor={ECO_STATUSES.IMPLEMENTED.text}
        />
      </div>

      {/* Filters */}
      <FilterBar
        filters={FILTER_OPTIONS}
        value={filterStatus}
        onChange={setFilterStatus}
      />

      {/* ECO list */}
      <div className="space-y-2">
        {ecos.length === 0 && (
          <EmptyState
            icon={<RefreshCw />}
            title="Chưa có ECO nào"
            description="Tạo ECO mới để theo dõi thay đổi thiết kế"
            action={
              canCreate ? (
                <Button variant="primary" onClick={openForm}>
                  + Tạo ECO
                </Button>
              ) : undefined
            }
          />
        )}

        {ecos.map((eco) => (
          <ECOCard
            key={eco.id}
            eco={eco}
            roleCode={roleCode}
            transitioning={transitioning === eco.id}
            onTransition={handleTransition}
          />
        ))}
      </div>

      {/* Create modal */}
      <CreateECOModal
        open={showForm}
        projects={projects}
        onClose={() => setShowForm(false)}
        onCreated={() => {
          setShowForm(false)
          loadData()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ECO Card                                                           */
/* ------------------------------------------------------------------ */

function ECOCard({
  eco,
  roleCode,
  transitioning,
  onTransition,
}: {
  eco: ECO
  roleCode: string
  transitioning: boolean
  onTransition: (ecoId: string, newStatus: string) => void
}) {
  const canSubmit =
    eco.status === 'DRAFT' && CAN_CREATE_ROLES.includes(roleCode)
  const canReview =
    eco.status === 'SUBMITTED' && CAN_REVIEW_ROLES.includes(roleCode)
  const canImplement =
    eco.status === 'APPROVED' && CAN_IMPLEMENT_ROLES.includes(roleCode)
  const showBomLink = eco.status === 'APPROVED'

  return (
    <div className="card p-4 transition-all hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-sm font-mono font-bold"
              style={{ color: 'var(--accent)' }}
            >
              {eco.ecoCode}
            </span>
            <StatusBadge category="eco" status={eco.status} />
            <span
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              {TYPE_MAP[eco.changeType] || eco.changeType}
            </span>
          </div>

          {/* Title & description */}
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {eco.title}
          </p>
          <p
            className="text-xs mt-0.5 line-clamp-2"
            style={{ color: 'var(--text-muted)' }}
          >
            {eco.description}
          </p>

          {/* Metadata */}
          <div
            className="flex items-center gap-3 mt-2 text-xs flex-wrap"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>DA: {eco.project.projectCode}</span>
            {eco.impactCost != null && eco.impactCost !== 0 && (
              <span
                className="font-semibold"
                style={{ color: '#f59e0b' }}
              >
                Chi phí: {formatCurrency(Number(eco.impactCost))}
              </span>
            )}
            {eco.impactSchedule != null && eco.impactSchedule !== 0 && (
              <span
                className="font-semibold"
                style={{ color: '#dc2626' }}
              >
                +{eco.impactSchedule} ngày
              </span>
            )}
            <span>{formatDate(eco.createdAt)}</span>
          </div>

          {/* BOM link for APPROVED */}
          {showBomLink && (
            <div className="mt-2">
              <span
                className="text-xs font-medium"
                style={{ color: ECO_STATUSES.APPROVED.text }}
              >
                Tạo Rev từ ECO
              </span>
            </div>
          )}

          {/* Action buttons */}
          {(canSubmit || canReview || canImplement) && (
            <div className="flex items-center gap-2 mt-3">
              {canSubmit && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={transitioning}
                  onClick={() => onTransition(eco.id, 'SUBMITTED')}
                >
                  Gửi duyệt
                </Button>
              )}
              {canReview && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={transitioning}
                    onClick={() => onTransition(eco.id, 'APPROVED')}
                  >
                    Duyệt
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={transitioning}
                    onClick={() => onTransition(eco.id, 'REJECTED')}
                  >
                    Từ chối
                  </Button>
                </>
              )}
              {canImplement && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={transitioning}
                  onClick={() => onTransition(eco.id, 'IMPLEMENTED')}
                >
                  Áp dụng
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Create ECO Modal                                                   */
/* ------------------------------------------------------------------ */

function CreateECOModal({
  open,
  projects,
  onClose,
  onCreated,
}: {
  open: boolean
  projects: Project[]
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    description: '',
    changeType: 'design',
    impactCost: '',
    impactSchedule: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.projectCode} — ${p.projectName}`,
  }))

  const submit = async () => {
    if (!form.projectId || !form.title || !form.description) {
      return alert('Điền đầy đủ thông tin')
    }
    setSubmitting(true)
    const res = await apiFetch('/api/design/eco', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        impactCost: form.impactCost ? Number(form.impactCost) : null,
        impactSchedule: form.impactSchedule
          ? Number(form.impactSchedule)
          : null,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo ECO')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo ECO"
      size="lg"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            onClick={submit}
          >
            {submitting ? 'Đang tạo...' : 'Tạo ECO'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Dự án *"
          value={form.projectId}
          onChange={(e) => update('projectId', e.target.value)}
          options={[{ value: '', label: 'Chọn...' }, ...projectOptions]}
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Tiêu đề *"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="Thay đổi..."
          />
          <SelectField
            label="Loại"
            value={form.changeType}
            onChange={(e) => update('changeType', e.target.value)}
            options={TYPE_OPTIONS}
          />
        </div>

        <TextareaField
          label="Mô tả *"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          rows={3}
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Chi phí ảnh hưởng (VNĐ)"
            type="number"
            value={form.impactCost}
            onChange={(e) => update('impactCost', e.target.value)}
            placeholder="0"
          />
          <InputField
            label="Tiến độ ảnh hưởng (ngày)"
            type="number"
            value={form.impactSchedule}
            onChange={(e) => update('impactSchedule', e.target.value)}
            placeholder="0"
          />
        </div>
      </div>
    </Modal>
  )
}
