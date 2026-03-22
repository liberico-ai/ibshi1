'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/hooks/useAuth'
import { PRODUCT_TYPES } from '@/lib/constants'
import { formatCurrency, getProgressColor } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quản lý Dự án</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pagination.total} dự án</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-accent">+ Tạo dự án</button>
      </div>

      {/* Stats Overview — Dashboard style */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        {[
          { label: 'Tổng dự án', value: pagination.total, color: '#0a2540', icon: '📋' },
          { label: 'Đang hoạt động', value: activeCount, color: '#0ea5e9', icon: '⚡' },
          { label: 'Hoàn thành', value: completedCountP, color: '#16a34a', icon: '✅' },
          { label: 'Tạm ngưng', value: onHoldCount, color: '#f59e0b', icon: '⏸️' },
        ].map(s => (
          <div key={s.label} className="card p-6 relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: s.color, borderRadius: '16px 16px 0 0' }} />
            <div className="flex items-center justify-between mb-4 pt-1">
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${s.color}10`, fontSize: '20px' }}>
                {s.icon}
              </div>
            </div>
            <p style={{ fontSize: '32px', fontWeight: 800, color: s.color, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</p>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '8px' }}>{s.label}</p>
          </div>
        ))}
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
            <button key={f.value} onClick={() => setStatusFilter(f.value)} className="px-4 py-2 text-sm font-semibold transition-all cursor-pointer" style={{
              background: statusFilter === f.value ? 'var(--primary)' : 'var(--bg-card)',
              color: statusFilter === f.value ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${statusFilter === f.value ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-pill)',
              boxShadow: statusFilter === f.value ? 'var(--shadow-xs)' : 'none',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 stagger-children">
        {projects.map((p) => (
          <Link href={`/dashboard/projects/${p.id}`} key={p.id} className="card p-5 block cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>{p.projectCode}</span>
                <h3 className="text-base font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{p.projectName}</h3>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{p.clientName}</p>
              </div>
              <span className="badge" style={{
                background: p.status === 'ACTIVE' ? '#f0fdf4' : p.status === 'COMPLETED' ? '#eff6ff' : '#f1f5f9',
                color: p.status === 'ACTIVE' ? '#16a34a' : p.status === 'COMPLETED' ? '#2563eb' : '#64748b',
                borderColor: p.status === 'ACTIVE' ? '#bbf7d0' : p.status === 'COMPLETED' ? '#bfdbfe' : '#e2e8f0',
                borderWidth: '1px',
              }}>
                {STATUS_FILTERS.find(f => f.value === p.status)?.label || p.status}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              <span>{PRODUCT_TYPES.find((t) => t.value === p.productType)?.label || p.productType}</span>
              {p.contractValue && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                  {formatCurrency(p.contractValue, p.currency)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 progress-bar">
                <div className={`progress-bar-fill ${getProgressColor(p.progress)}`} style={{ width: `${p.progress}%` }} />
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.progress}%</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({p.completedTasks}/{p.totalTasks})</span>
            </div>
          </Link>
        ))}
        {projects.length === 0 && (
          <div className="col-span-2 card p-12 text-center">
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Chưa có dự án nào</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Nhấn &quot;Tạo dự án&quot; để bắt đầu</p>
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

    // Build FormData if files exist, otherwise JSON
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
    <div className="card p-6 animate-fade-in" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tạo dự án mới</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Basic info */}
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mã dự án *</label>
          <input className="input" placeholder="DA-26-003" value={form.projectCode} onChange={(e) => setForm({ ...form, projectCode: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tên dự án *</label>
          <input className="input" placeholder="Tên dự án" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Khách hàng *</label>
          <input className="input" placeholder="Tên khách hàng" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Loại sản phẩm *</label>
          <select className="input" value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })}>
            {PRODUCT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Giá trị hợp đồng</label>
          <input className="input" type="number" placeholder="0" value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tiền tệ</label>
          <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="VND">VND</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="JPY">JPY</option>
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Ngày bắt đầu</label>
          <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Ngày kết thúc (dự kiến)</label>
          <input className="input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mô tả</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

        {/* Document attachments */}
        <div className="md:col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            📎 Tài liệu đính kèm
            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(tuỳ chọn)</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FILE_SLOTS.map(slot => (
              <div key={slot.key} style={{
                border: `1px dashed ${files[slot.key] ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10, padding: '12px 14px',
                background: files[slot.key] ? 'rgba(var(--accent-rgb, 37,99,235), 0.04)' : 'var(--bg-secondary)',
                transition: 'all 0.2s',
              }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>{slot.icon}</span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{slot.label}</span>
                </div>
                {files[slot.key] ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs truncate flex-1" style={{ color: 'var(--accent)' }}>
                      ✓ {files[slot.key]!.name}
                    </span>
                    <button type="button" onClick={() => handleFileChange(slot.key, null)}
                      className="text-xs px-2 py-0.5" style={{ color: '#dc2626', cursor: 'pointer', background: 'none', border: 'none' }}>
                      ✕
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept={slot.accept}
                    onChange={(e) => handleFileChange(slot.key, e.target.files?.[0] || null)}
                    className="text-xs w-full"
                    style={{ color: 'var(--text-muted)' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-2 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
          <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">{submitting ? 'Đang tạo...' : 'Tạo dự án'}</button>
        </div>
      </form>
    </div>
  )
}
