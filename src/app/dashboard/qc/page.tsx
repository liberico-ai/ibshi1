'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Button } from '@/components/ui'
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

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  PENDING: { label: 'Chờ kiểm', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  PASSED: { label: 'Đạt', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  FAILED: { label: 'Không đạt', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  CONDITIONAL: { label: 'Đạt ĐK', bg: '#fefce8', color: '#ca8a04', border: '#fde68a' },
}

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

  useEffect(() => { loadProjects() }, [])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { loadData() }, [search, statusFilter, page])

  async function loadProjects() {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects)
  }

  async function loadData() {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/qc?${params}`)
    if (res.ok) { setInspections(res.inspections); setPagination(res.pagination) }
    setLoading(false)
  }

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
        subtitle="Enhanced Inspection Form v2"
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Tạo biên bản</Button>}
      />

      {/* ═══ QC KPI Summary ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
        <StatCard label="Tổng biên bản" value={pagination.total} color="var(--primary)" />
        <StatCard label="Đạt ✓" value={passCount} color="#16a34a" />
        <StatCard label="Không đạt ✗" value={failCount} color="#dc2626" />
        <StatCard label="Chờ / ĐK" value={pendCount + condCount} color="#f59e0b" />
        <StatCard label="Tỷ lệ đạt" value={`${passRate}%`} color={passRate >= 80 ? '#16a34a' : passRate >= 50 ? '#f59e0b' : '#dc2626'} />
      </div>

      {showCreate && <CreateInspectionForm projects={projects} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}

      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã biên bản..." /></div>
        <div className="flex gap-2">
          {[{ value: '', label: 'Tất cả' }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))].map((f) => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`filter-pill ${statusFilter === f.value ? 'active' : ''}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Inspection table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr><th>Mã biên bản</th><th>Loại kiểm tra</th><th>Dự án</th><th>Bước WF</th><th>Kết quả</th><th>Checklist</th><th>Ngày KT</th><th></th></tr>
          </thead>
          <tbody>
            {inspections.map((insp) => {
              const cfg = STATUS_CONFIG[insp.status] || STATUS_CONFIG.PENDING
              const project = projects.find(p => p.id === insp.projectId)
              const qcType = QC_TYPES.find(t => t.value === insp.type)
              return (
                <tr key={insp.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => router.push(`/dashboard/qc/${insp.id}`)}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--primary)' }}>{insp.inspectionCode}</span></td>
                  <td style={{ color: 'var(--text-primary)' }}>{qcType?.label || insp.type}</td>
                  <td><span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{project?.projectCode || '-'}</span></td>
                  <td><span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{insp.stepCode}</span></td>
                  <td><span className="badge" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border, borderWidth: '1px' }}>{cfg.label}</span></td>
                  <td>
                    {insp.totalItems > 0 ? (
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: '#e2e8f0' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${(insp.passedItems / insp.totalItems) * 100}%`,
                            background: insp.failedItems > 0 ? '#dc2626' : '#16a34a',
                          }} />
                        </div>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{insp.passedItems}/{insp.totalItems}</span>
                      </div>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{insp.inspectedAt ? formatDate(insp.inspectedAt) : 'Chưa KT'}</td>
                  <td>
                    {insp.status === 'PENDING' ? (
                      <div className="flex gap-1">
                        <button onClick={(e) => handleVerdict(e, insp.id, 'PASSED')} className="text-xs px-2 py-1 rounded" style={{ background: '#f0fdf4', color: '#16a34a' }}>Đạt</button>
                        <button onClick={(e) => handleVerdict(e, insp.id, 'FAILED')} className="text-xs px-2 py-1 rounded" style={{ background: '#fef2f2', color: '#dc2626' }}>Lỗi</button>
                      </div>
                    ) : (
                      <ChevronRight size={16} stroke="var(--text-muted)" />
                    )}
                  </td>
                </tr>
              )
            })}
            {inspections.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có biên bản QC</td></tr>
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

function CreateInspectionForm({ projects, onClose, onCreated }: { projects: ProjectOption[]; onClose: () => void; onCreated: () => void }) {
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
    <div className="card p-6 animate-fade-in">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tạo biên bản kiểm tra</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mã biên bản *</label>
            <input className="input" value={form.inspectionCode} onChange={(e) => setForm({ ...form, inspectionCode: e.target.value })} placeholder="QC-2026-001" required /></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Dự án *</label>
            <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required>
              <option value="">Chọn dự án</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
            </select></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Loại kiểm tra *</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {QC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></div>
          <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Bước Workflow *</label>
            <input className="input" value={form.stepCode} onChange={(e) => setForm({ ...form, stepCode: e.target.value })} placeholder="P4.3_QC" required /></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Danh mục kiểm tra</label>
            <button type="button" onClick={addCheckItem} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--primary)' }}>+ Thêm</button>
          </div>
          <div className="space-y-2">
            {form.checklistItems.map((ci, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className="input flex-1" placeholder="Nội dung kiểm tra" value={ci.checkItem} onChange={(e) => updateCheckItem(i, 'checkItem', e.target.value)} />
                <input className="input w-48" placeholder="Tiêu chuẩn" value={ci.standard} onChange={(e) => updateCheckItem(i, 'standard', e.target.value)} />
                {form.checklistItems.length > 1 && <button type="button" onClick={() => removeCheckItem(i)} className="text-xs px-2 py-1 rounded" style={{ color: '#dc2626' }}>×</button>}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo'}</Button>
        </div>
      </form>
    </div>
  )
}
