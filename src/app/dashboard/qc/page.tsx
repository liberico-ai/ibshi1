'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, KPICard, StatusBadge, Button, EmptyState, Modal, InputField, SelectField } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ChevronRight } from 'lucide-react'

interface Inspection {
  id: string; projectId: string; inspectionCode: string;
  type: string; stepCode: string; status: string;
  totalItems: number; passedItems: number; failedItems: number;
  inspectedAt: string | null; remarks: string | null; createdAt: string;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const QC_TYPES = [
  { value: 'material_incoming', label: 'Nghiệm thu vật tư' },
  { value: 'ndt', label: 'Kiểm tra NDT' },
  { value: 'pressure_test', label: 'Thử áp lực' },
  { value: 'dimensional', label: 'Kiểm tra kích thước' },
  { value: 'visual', label: 'Kiểm tra trực quan' },
  { value: 'fat', label: 'FAT' },
  { value: 'sat', label: 'SAT' },
]

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING', label: 'Chờ kiểm' },
  { value: 'PASSED', label: 'Đạt' },
  { value: 'FAILED', label: 'Không đạt' },
  { value: 'CONDITIONAL', label: 'Đạt ĐK' },
]

export default function QCPage() {
  const router = useRouter()
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const loadProjects = useCallback(async () => {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects)
  }, [])

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/qc?${params}`)
    if (res.ok) { setInspections(res.inspections); setPagination(res.pagination) }
    setLoading(false)
  }, [search, statusFilter, page])

  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { loadData() }, [loadData])

  async function handleVerdict(e: React.MouseEvent, id: string, status: string) {
    e.stopPropagation()
    const res = await apiFetch(`/api/qc/${id}`, {
      method: 'PUT', body: JSON.stringify({ status }),
    })
    if (res.ok) loadData()
  }

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
      ))}
    </div>
  )

  const passCount = inspections.filter(i => i.status === 'PASSED').length
  const failCount = inspections.filter(i => i.status === 'FAILED').length
  const condCount = inspections.filter(i => i.status === 'CONDITIONAL').length
  const pendCount = inspections.filter(i => i.status === 'PENDING').length
  const passRate = passCount + failCount > 0 ? Math.round(passCount / (passCount + failCount) * 100) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Chất lượng (QC)"
        subtitle="Biên bản kiểm tra chất lượng"
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Tạo biên bản</Button>}
      />

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
        <KPICard label="Tổng biên bản" value={pagination.total} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đạt" value={passCount} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Không đạt" value={failCount} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard label="Chờ / ĐK" value={pendCount + condCount} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard
          label="Tỷ lệ đạt"
          value={`${passRate}%`}
          accentColor={passRate >= 80 ? SEMANTIC_COLORS.success.solid : passRate >= 50 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.danger.solid}
        />
      </div>

      <CreateInspectionModal
        open={showCreate}
        projects={projects}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadData() }}
      />

      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã biên bản..." /></div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`filter-pill ${statusFilter === f.value ? 'active' : ''}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Inspection table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã biên bản</th>
              <th>Loại kiểm tra</th>
              <th>Dự án</th>
              <th>Bước WF</th>
              <th>Kết quả</th>
              <th>Checklist</th>
              <th>Ngày KT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((insp) => {
              const project = projects.find(p => p.id === insp.projectId)
              const qcType = QC_TYPES.find(t => t.value === insp.type)
              return (
                <tr key={insp.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => router.push(`/dashboard/qc/${insp.id}`)}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--primary)' }}>{insp.inspectionCode}</span></td>
                  <td style={{ color: 'var(--text-primary)' }}>{qcType?.label || insp.type}</td>
                  <td><span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{project?.projectCode || '-'}</span></td>
                  <td><span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{insp.stepCode}</span></td>
                  <td><StatusBadge category="qc" status={insp.status} /></td>
                  <td>
                    {insp.totalItems > 0 ? (
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: SEMANTIC_COLORS.neutral.bg }}>
                          <div className="h-full rounded-full" style={{
                            width: `${(insp.passedItems / insp.totalItems) * 100}%`,
                            background: insp.failedItems > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid,
                          }} />
                        </div>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{insp.passedItems}/{insp.totalItems}</span>
                      </div>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{insp.inspectedAt ? formatDate(insp.inspectedAt) : 'Chưa KT'}</td>
                  <td>
                    {insp.status === 'PENDING' ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={(e) => handleVerdict(e, insp.id, 'PASSED')}
                          style={{ background: SEMANTIC_COLORS.success.bg, color: SEMANTIC_COLORS.success.solid }}>Đạt</Button>
                        <Button size="sm" variant="ghost" onClick={(e) => handleVerdict(e, insp.id, 'FAILED')}
                          style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>Lỗi</Button>
                      </div>
                    ) : (
                      <ChevronRight size={16} stroke="var(--text-muted)" />
                    )}
                  </td>
                </tr>
              )
            })}
            {inspections.length === 0 && (
              <tr><td colSpan={8}><EmptyState icon="📋" title="Chưa có biên bản QC" /></td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
        </div>
      </div>
    </div>
  )
}

function CreateInspectionModal({ open, projects, onClose, onCreated }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    inspectionCode: '', projectId: '', type: 'material_incoming', stepCode: '',
    checklistItems: [{ checkItem: '', standard: '' }],
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function addCheckItem() {
    setForm({ ...form, checklistItems: [...form.checklistItems, { checkItem: '', standard: '' }] })
  }
  function updateCheckItem(index: number, field: string, value: string) {
    const items = [...form.checklistItems]
    items[index] = { ...items[index], [field]: value }
    setForm({ ...form, checklistItems: items })
  }
  function removeCheckItem(index: number) {
    setForm({ ...form, checklistItems: form.checklistItems.filter((_, i) => i !== index) })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const payload = { ...form, checklistItems: form.checklistItems.filter(ci => ci.checkItem.trim()) }
    const res = await apiFetch('/api/qc', { method: 'POST', body: JSON.stringify(payload) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo biên bản kiểm tra" size="lg">
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid, border: `1px solid ${SEMANTIC_COLORS.danger.solid}20` }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Mã biên bản *"
            value={form.inspectionCode}
            onChange={(e) => setForm({ ...form, inspectionCode: e.target.value })}
            placeholder="QC-2026-001"
            required
          />
          <SelectField
            label="Dự án *"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            options={[{ value: '', label: 'Chọn dự án' }, ...projects.map(p => ({ value: p.id, label: p.projectCode }))]}
            required
          />
          <SelectField
            label="Loại kiểm tra *"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={QC_TYPES}
          />
          <InputField
            label="Bước Workflow *"
            value={form.stepCode}
            onChange={(e) => setForm({ ...form, stepCode: e.target.value })}
            placeholder="P4.3_QC"
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="input-label">Danh mục kiểm tra</label>
            <Button type="button" variant="ghost" size="sm" onClick={addCheckItem}>+ Thêm</Button>
          </div>
          <div className="space-y-2">
            {form.checklistItems.map((ci, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className="input flex-1" placeholder="Nội dung kiểm tra" value={ci.checkItem} onChange={(e) => updateCheckItem(i, 'checkItem', e.target.value)} />
                <input className="input w-48" placeholder="Tiêu chuẩn" value={ci.standard} onChange={(e) => updateCheckItem(i, 'standard', e.target.value)} />
                {form.checklistItems.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeCheckItem(i)}
                    style={{ color: SEMANTIC_COLORS.danger.solid }}>x</Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo'}</Button>
        </div>
      </form>
    </Modal>
  )
}
