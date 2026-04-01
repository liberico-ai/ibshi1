'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/hooks/useAuth'
import { PRODUCT_TYPES } from '@/lib/constants'
import { formatCurrency, getProgressColor } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Card, Badge, Button } from '@/components/ui'

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

      {showCreate && <CreateProjectForm onClose={() => setShowCreate(false)} onCreated={(p) => {
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
                <span className="flex items-center gap-1">
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
  const [files, setFiles] = useState<Record<string, File | null>>({
    rfq: null, po: null, contract: null, spec: null,
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleFileChange(key: string, file: File | null) {
    setFiles(prev => ({ ...prev, [key]: file }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)

    const hasFiles = Object.values(files).some(f => f !== null)

    if (hasFiles) {
      const formData = new FormData()
      Object.entries(form).forEach(([k, v]) => formData.append(k, v))
      Object.entries(files).forEach(([k, f]) => { if (f) formData.append(`file_${k}`, f) })
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
      const res = await fetch('/api/projects', {
        method: 'POST',
        body: formData,
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      }).then(r => r.json())
      setSubmitting(false)
      if (res.ok) onCreated(res.project)
      else setError(res.error || 'Lỗi tạo dự án')
    } else {
      const res = await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(form) })
      setSubmitting(false)
      if (res.ok) onCreated(res.project)
      else setError(res.error || 'Lỗi tạo dự án')
    }
  }

  const FILE_SLOTS = [
    { key: 'rfq', label: 'RFQ / Inquiry', icon: '📩', accept: '.pdf,.doc,.docx,.xls,.xlsx' },
    { key: 'po', label: 'PO khách hàng', icon: '📋', accept: '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.png' },
    { key: 'contract', label: 'Hợp đồng / Phụ lục', icon: '📄', accept: '.pdf,.doc,.docx' },
    { key: 'spec', label: 'Spec / Bản vẽ kỹ thuật', icon: '📐', accept: '.pdf,.dwg,.dxf,.doc,.docx' },
  ]

  return (
    <Card padding="default" className="animate-fade-in" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
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

        {/* Document attachments */}
        <div className="md:col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)', marginTop: 4 }}>
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)' }}>
            📎 Tài liệu đính kèm
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 400, color: 'var(--text-muted)' }}>(tuỳ chọn)</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FILE_SLOTS.map(slot => (
              <div key={slot.key} style={{
                border: `1px dashed ${files[slot.key] ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', padding: 'var(--space-sm) var(--space-sm)',
                background: files[slot.key] ? 'var(--ibs-navy-50)' : 'var(--bg-secondary)',
                transition: 'all 0.2s',
              }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{slot.icon}</span>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-primary)' }}>{slot.label}</span>
                </div>
                {files[slot.key] ? (
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)' }} className="truncate flex-1">✓ {files[slot.key]!.name}</span>
                    <button type="button" onClick={() => handleFileChange(slot.key, null)}
                      style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
                  </div>
                ) : (
                  <input type="file" accept={slot.accept}
                    onChange={(e) => handleFileChange(slot.key, e.target.files?.[0] || null)}
                    style={{ fontSize: 'var(--text-xs)', width: '100%', color: 'var(--text-muted)' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-2 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
          <Button variant="outline" onClick={onClose} type="button">Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo dự án'}</Button>
        </div>
      </form>
    </Card>
  )
}
