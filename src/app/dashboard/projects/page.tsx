'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/hooks/useAuth'
import { PRODUCT_TYPES } from '@/lib/constants'
import { formatCurrency, getProgressColor } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Card, Badge, Button } from '@/components/ui'
import MultiFileUpload from '@/components/MultiFileUpload'

interface Project {
  id: string; projectCode: string; projectName: string; clientName: string;
  productType: string; status: string; contractValue?: string; currency: string;
  startDate: string; endDate: string; progress: number; totalTasks: number; completedTasks: number;
}

interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'ACTIVE', label: 'Đang hoạt động' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
  { value: 'CANCELLED', label: 'Đã hủy' },
  { value: 'ON_HOLD', label: 'Tạm ngưng' },
]

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { loadProjects() }, [search, statusFilter, page])

  async function loadProjects() {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/projects?${params}`)
    if (res.ok) { setProjects(res.projects); setPagination(res.pagination) }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-10 w-48 skeleton rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 skeleton rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  const activeCount = projects.filter(p => p.status === 'ACTIVE').length
  const completedCountP = projects.filter(p => p.status === 'COMPLETED').length
  const onHoldCount = projects.filter(p => p.status === 'ON_HOLD').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Dự án"
        subtitle={`${pagination.total} dự án`}
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Tạo dự án</Button>}
      />

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Tổng dự án" value={pagination.total} color="#0a2540" icon={<span style={{ fontSize: 20 }}>📋</span>} />
        <StatCard label="Đang hoạt động" value={activeCount} color="#0ea5e9" icon={<span style={{ fontSize: 20 }}>⚡</span>} />
        <StatCard label="Hoàn thành" value={completedCountP} color="#16a34a" icon={<span style={{ fontSize: 20 }}>✅</span>} />
        <StatCard label="Tạm ngưng" value={onHoldCount} color="#f59e0b" icon={<span style={{ fontSize: 20 }}>⏸️</span>} />
      </div>

      {showCreate && <CreateProjectForm onClose={() => setShowCreate(false)} onCreated={(p: Project) => {
        setProjects([p, ...projects])
        setShowCreate(false)
      }} />}

      {/* Search + Status filter */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã DA, tên, khách hàng..." /></div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`filter-pill ${statusFilter === f.value ? 'active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 stagger-children">
        {projects.map((p) => (
          <Link href={`/dashboard/projects/${p.id}`} key={p.id} className="card card-default block cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className="mono-label" style={{ color: 'var(--accent)' }}>{p.projectCode}</span>
                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginTop: 4, color: 'var(--text-primary)' }}>{p.projectName}</h3>
                <p style={{ fontSize: 'var(--text-sm)', marginTop: 2, color: 'var(--text-secondary)' }}>{p.clientName}</p>
              </div>
              <Badge variant={p.status === 'ACTIVE' ? 'success' : p.status === 'COMPLETED' ? 'info' : 'default'}>
                {STATUS_FILTERS.find(f => f.value === p.status)?.label || p.status}
              </Badge>
            </div>

            <div className="flex items-center gap-4 text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              <span>{PRODUCT_TYPES.find((t) => t.value === p.productType)?.label || p.productType}</span>
              {p.contractValue && (
                <span className="flex items-center gap-1" suppressHydrationWarning>
                  💰 {formatCurrency(p.contractValue, p.currency)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 progress-bar">
                <div className={`progress-bar-fill ${getProgressColor(p.progress)}`} style={{ width: `${p.progress}%` }} />
              </div>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{p.progress}%</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>({p.completedTasks}/{p.totalTasks})</span>
            </div>
          </Link>
        ))}
        {projects.length === 0 && (
          <div className="col-span-2 card card-spacious text-center">
            <p style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Chưa có dự án nào</p>
            <p style={{ fontSize: 'var(--text-sm)', marginTop: 4, color: 'var(--text-muted)' }}>Nhấn &quot;Tạo dự án&quot; để bắt đầu</p>
          </div>
        )}
      </div>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
    </div>
  )
}

function CreateProjectForm({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [form, setForm] = useState({
    projectCode: '', projectName: '', clientName: '', productType: 'pressure_vessel',
    contractValue: '', currency: 'VND', description: '', startDate: '', endDate: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [draftId] = useState(() => crypto.randomUUID())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)

    const res = await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ ...form, draftId }),
    })
    setSubmitting(false)
    if (res.ok) {
      onCreated(res.project)
      onClose()
    } else {
      setError(res.error || 'Lỗi tạo dự án')
    }
  }

  return (
    <Card padding="default" className="animate-fade-in" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-md)', color: 'var(--text-primary)' }}>Tạo dự án mới</h3>
      {error && <div className="mb-3 p-2 rounded" style={{ fontSize: 'var(--text-sm)', background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-border)' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="input-field"><label className="input-label">Mã dự án *</label>
          <input className="input" placeholder="DA-26-003" value={form.projectCode} onChange={(e) => setForm({ ...form, projectCode: e.target.value })} required /></div>
        <div className="input-field"><label className="input-label">Tên dự án *</label>
          <input className="input" placeholder="Tên dự án" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} required /></div>
        <div className="input-field"><label className="input-label">Khách hàng *</label>
          <input className="input" placeholder="Tên khách hàng" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required /></div>
        <div className="input-field"><label className="input-label">Loại sản phẩm *</label>
          <select className="input" value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })}>
            {PRODUCT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></div>
        <div className="input-field"><label className="input-label">Giá trị hợp đồng</label>
          <input className="input" type="text" inputMode="numeric" placeholder="0"
            value={form.contractValue ? form.contractValue.replace(/,/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
            onChange={(e) => setForm({ ...form, contractValue: e.target.value.replace(/,/g, '') })} /></div>
        <div className="input-field"><label className="input-label">Tiền tệ</label>
          <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="VND">VND</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="JPY">JPY</option>
          </select></div>
        <div className="input-field"><label className="input-label">Ngày bắt đầu</label>
          <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
        <div className="input-field"><label className="input-label">Ngày kết thúc (dự kiến)</label>
          <input className="input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
        <div className="md:col-span-2 input-field"><label className="input-label">Mô tả</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

        {/* ── Đính kèm tài liệu (upload ngay vào temp, link khi tạo DA) ── */}
        <div className="md:col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)', marginTop: 4 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
            📎 Đính kèm tài liệu <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(tuỳ chọn — không giới hạn định dạng)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <MultiFileUpload label="RFQ / Inquiry" entityType="ProjectDraft" entityId={`${draftId}_rfq`} compact />
            <MultiFileUpload label="PO khách hàng" entityType="ProjectDraft" entityId={`${draftId}_po`} compact />
            <MultiFileUpload label="Hợp đồng / Phụ lục" entityType="ProjectDraft" entityId={`${draftId}_contract`} compact />
            <MultiFileUpload label="Spec / Bản vẽ kỹ thuật" entityType="ProjectDraft" entityId={`${draftId}_spec`} compact />
          </div>
        </div>

        <div className="md:col-span-2 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
          <Button variant="outline" onClick={onClose} type="button">Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo dự án →'}</Button>
        </div>
      </form>
    </Card>
  )
}
