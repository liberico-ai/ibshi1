'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SearchBar } from '@/components/SearchPagination'
import {
  PageHeader, Button, FilterBar, StatusBadge,
  EmptyState, KPICard, Modal, InputField, SelectField, TextareaField,
  Pagination,
} from '@/components/ui'
import { Clock } from 'lucide-react'

interface WorkOrder {
  id: string; woCode: string; projectId: string; description: string;
  teamCode: string; status: string; plannedStart: string | null;
  plannedEnd: string | null; actualStart: string | null;
  actualEnd: string | null; materialIssueCount: number; createdAt: string;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'OPEN', label: 'Chờ' },
  { value: 'IN_PROGRESS', label: 'Đang chạy' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
  { value: 'CANCELLED', label: 'Đã hủy' },
]

export default function ProductionPage() {
  const router = useRouter()
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const loadProjects = async () => {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects)
  }

  const loadData = async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/production?${params}`)
    if (res.ok) { setWorkOrders(res.workOrders); setPagination(res.pagination) }
    setLoading(false)
  }

  const handleAction = async (e: React.MouseEvent, id: string, action: string) => {
    e.stopPropagation()
    const res = await apiFetch(`/api/production/${id}`, {
      method: 'PUT', body: JSON.stringify({ action }),
    })
    if (res.ok) loadData()
  }

  useEffect(() => { loadProjects() }, [])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData() }, [search, statusFilter, page])

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-xl skeleton" />
      ))}
    </div>
  )

  const openCount = workOrders.filter(w => w.status === 'OPEN').length
  const inProgressCount = workOrders.filter(w => w.status === 'IN_PROGRESS').length
  const completedCount = workOrders.filter(w => w.status === 'COMPLETED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Sản xuất"
        subtitle={`${pagination.total} lệnh sản xuất`}
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Tạo WO</Button>}
      />

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng WO" value={pagination.total} accentColor="var(--ink)" icon={<span style={{ fontSize: 20 }}>🏭</span>} />
        <KPICard label="Chờ bắt đầu" value={openCount} accentColor="var(--warning, #C97A0E)" icon={<span style={{ fontSize: 20 }}>⏳</span>} />
        <KPICard label="Đang chạy" value={inProgressCount} accentColor="var(--info, #2D6CB5)" icon={<span style={{ fontSize: 20 }}>⚡</span>} />
        <KPICard label="Hoàn thành" value={completedCount} accentColor="var(--success, #1E8E5A)" icon={<span style={{ fontSize: 20 }}>✅</span>} />
      </div>

      <CreateWOModal
        open={showCreate}
        projects={projects}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadData() }}
      />

      <FilterBar
        filters={STATUS_FILTERS}
        value={statusFilter}
        onChange={setStatusFilter}
        actions={
          <div className="w-96">
            <SearchBar value={search} onChange={setSearch} placeholder="Tìm mã WO, mô tả..." />
          </div>
        }
      />

      {/* WO Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workOrders.map((wo) => {
          const project = projects.find(p => p.id === wo.projectId)
          return (
            <div
              key={wo.id}
              className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/dashboard/production/${wo.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--primary)' }}>{wo.woCode}</span>
                  <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{wo.description}</p>
                </div>
                <StatusBadge category="production" status={wo.status} />
              </div>
              <div className="space-y-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {project && <div>Dự án: <span style={{ color: 'var(--text-secondary)' }}>{project.projectCode}</span></div>}
                <div>Tổ SX: <span style={{ color: 'var(--text-secondary)' }}>{wo.teamCode}</span></div>
                {wo.plannedStart && <div className="flex items-center gap-1">
                  <Clock size={10} />
                  {formatDate(wo.plannedStart)} → {wo.plannedEnd ? formatDate(wo.plannedEnd) : '?'}
                </div>}
                <div>Vật tư: <span className="font-mono font-semibold" style={{ color: 'var(--primary)' }}>{wo.materialIssueCount}</span> lượt</div>
              </div>
              <div className="flex gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                {wo.status === 'OPEN' && <Button variant="outline" size="sm" onClick={(e) => handleAction(e, wo.id, 'start')}>Bắt đầu</Button>}
                {wo.status === 'IN_PROGRESS' && <Button variant="accent" size="sm" onClick={(e) => handleAction(e, wo.id, 'complete')}>Hoàn thành</Button>}
                {wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && <Button variant="danger" size="sm" onClick={(e) => handleAction(e, wo.id, 'cancel')}>Hủy</Button>}
              </div>
            </div>
          )
        })}
        {workOrders.length === 0 && (
          <div className="col-span-3">
            <EmptyState icon="🏭" title="Chưa có lệnh sản xuất" description="Tạo lệnh sản xuất mới để bắt đầu" />
          </div>
        )}
      </div>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={setPage} />
    </div>
  )
}

function CreateWOModal({ open, projects, onClose, onCreated }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({ woCode: '', projectId: '', description: '', teamCode: 'TO-01', plannedStart: '', plannedEnd: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch('/api/production', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo lệnh sản xuất" size="lg"
      actions={
        <form onSubmit={handleSubmit} className="flex gap-3 w-full justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo WO'}</Button>
        </form>
      }
    >
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: 'var(--danger-bg, #fef2f2)', color: 'var(--danger, #dc2626)', border: '1px solid var(--danger-border, #fecaca)' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <InputField
          label="Mã WO *"
          value={form.woCode}
          onChange={(e) => setForm({ ...form, woCode: e.target.value })}
          placeholder="WO-2026-001"
          required
        />
        <SelectField
          label="Dự án *"
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          options={[
            { value: '', label: 'Chọn dự án' },
            ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))
          ]}
          required
        />
        <InputField
          label="Tổ SX *"
          value={form.teamCode}
          onChange={(e) => setForm({ ...form, teamCode: e.target.value })}
          required
        />
        <div className="col-span-3">
          <TextareaField
            label="Mô tả *"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required
          />
        </div>
        <InputField
          label="Ngày bắt đầu"
          type="date"
          value={form.plannedStart}
          onChange={(e) => setForm({ ...form, plannedStart: e.target.value })}
        />
        <InputField
          label="Ngày kết thúc"
          type="date"
          value={form.plannedEnd}
          onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })}
        />
      </form>
    </Modal>
  )
}
