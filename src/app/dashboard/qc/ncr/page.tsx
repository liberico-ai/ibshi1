'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { PageHeader, StatusBadge, KPICard, Button, EmptyState, Modal, SelectField, TextareaField, FilterBar } from '@/components/ui'
import { STATUS_COLORS, SEMANTIC_COLORS } from '@/lib/design-tokens'

interface NCR {
  id: string; ncrCode: string; projectId: string; category: string; severity: string;
  description: string; rootCause: string | null; disposition: string | null; status: string;
  reworkCount: number; createdAt: string;
  project: { projectCode: string; projectName: string };
  actions: Array<{ id: string; actionType: string; description: string; status: string; dueDate: string | null }>;
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

export default function NCRPage() {
  const [ncrs, setNcrs] = useState<NCR[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
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

  useEffect(() => { loadData() }, [loadData])

  const canCreate = ['R01', 'R09', 'R09a', 'R06'].includes(user?.roleCode || '')

  // Stats
  const openCount = ncrs.filter(n => n.status === 'OPEN').length
  const criticalCount = ncrs.filter(n => n.severity === 'CRITICAL' && n.status !== 'CLOSED').length

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="NCR Tracker"
        subtitle="Non-Conformance Report management"
        actions={canCreate ? <Button variant="accent" onClick={openForm}>+ Tạo NCR</Button> : undefined}
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-children">
        <KPICard label="Tổng NCR" value={ncrs.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đang mở" value={openCount} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard
          label="Critical"
          value={criticalCount}
          accentColor={criticalCount > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <FilterBar
          filters={SEVERITY_FILTER_OPTIONS}
          value={filterSev}
          onChange={setFilterSev}
        />
        <FilterBar
          filters={STATUS_FILTER_OPTIONS}
          value={filterStatus}
          onChange={setFilterStatus}
        />
      </div>

      {/* NCR List */}
      <div className="space-y-2">
        {ncrs.length === 0 && (
          <EmptyState icon="📋" title="Không có NCR nào" description="Tất cả sản phẩm đạt yêu cầu chất lượng" />
        )}
        {ncrs.map(ncr => {
          const sev = SEVERITY_MAP[ncr.severity] || SEVERITY_MAP.MINOR
          return (
            <div key={ncr.id} className="card p-4 transition-all hover:shadow-md" style={{ borderLeft: `4px solid ${sev.color}` }}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{ncr.ncrCode}</span>
                    <span className="badge" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
                    <StatusBadge category="ncr" status={ncr.status} />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{CATEGORY_MAP[ncr.category] || ncr.category}</span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{ncr.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>DA: <span className="font-mono">{ncr.project.projectCode}</span></span>
                    {ncr.disposition && <span>Xử lý: {ncr.disposition}</span>}
                    {ncr.reworkCount > 0 && <span className="font-semibold" style={{ color: SEMANTIC_COLORS.warning.solid }}>Sửa lại: <span className="font-mono">{ncr.reworkCount}x</span></span>}
                    <span>{formatDate(ncr.createdAt)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Actions: <span className="font-mono">{ncr.actions.length}</span></p>
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
    </div>
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
          <SelectField
            label="Loại"
            value={form.category}
            onChange={e => update('category', e.target.value)}
            options={CATEGORY_OPTIONS}
          />
          <SelectField
            label="Mức độ"
            value={form.severity}
            onChange={e => update('severity', e.target.value)}
            options={SEVERITY_OPTIONS}
          />
        </div>

        <TextareaField
          label="Mô tả *"
          value={form.description}
          onChange={e => update('description', e.target.value)}
          rows={3}
          placeholder="Mô tả vấn đề..."
        />

        <TextareaField
          label="Nguyên nhân gốc"
          value={form.rootCause}
          onChange={e => update('rootCause', e.target.value)}
          rows={2}
          placeholder="Phân tích nguyên nhân..."
        />
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>
          {submitting ? 'Đang tạo...' : 'Tạo NCR'}
        </Button>
      </div>
    </Modal>
  )
}
