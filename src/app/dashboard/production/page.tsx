'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'

interface WorkOrder {
  id: string; woCode: string; projectId: string; description: string;
  teamCode: string; status: string; plannedStart: string | null;
  plannedEnd: string | null; actualStart: string | null;
  actualEnd: string | null; materialIssueCount: number; createdAt: string;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  OPEN: { label: 'Chờ', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  IN_PROGRESS: { label: 'Đang chạy', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  COMPLETED: { label: 'Hoàn thành', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  CANCELLED: { label: 'Đã hủy', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
}

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
    const res = await apiFetch(`/api/production?${params}`)
    if (res.ok) { setWorkOrders(res.workOrders); setPagination(res.pagination) }
    setLoading(false)
  }

  async function handleAction(e: React.MouseEvent, id: string, action: string) {
    e.stopPropagation()
    const res = await apiFetch(`/api/production/${id}`, {
      method: 'PUT', body: JSON.stringify({ action }),
    })
    if (res.ok) loadData()
  }

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
      ))}
    </div>
  )

  const openCount = workOrders.filter(w => w.status === 'OPEN').length
  const inProgressCount = workOrders.filter(w => w.status === 'IN_PROGRESS').length
  const completedCount = workOrders.filter(w => w.status === 'COMPLETED').length
  const cancelledCount = workOrders.filter(w => w.status === 'CANCELLED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quản lý Sản xuất</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pagination.total} lệnh sản xuất</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-accent">+ Tạo WO</button>
      </div>

      {/* Stats Overview — Dashboard style */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        {[
          { label: 'Tổng WO', value: pagination.total, color: '#0a2540', icon: '🏭' },
          { label: 'Chờ bắt đầu', value: openCount, color: '#f59e0b', icon: '⏳' },
          { label: 'Đang chạy', value: inProgressCount, color: '#2563eb', icon: '⚡' },
          { label: 'Hoàn thành', value: completedCount, color: '#16a34a', icon: '✅' },
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

      {showCreate && <CreateWOForm projects={projects} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}

      {/* Search + Status filter */}
      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã WO, mô tả..." /></div>
        <div className="flex gap-2">
          {[{ value: '', label: 'Tất cả' }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))].map((f) => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)} className="px-3 py-1.5 text-xs rounded-full font-medium transition-colors" style={{
              background: statusFilter === f.value ? 'var(--primary)' : 'var(--bg-card)',
              color: statusFilter === f.value ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${statusFilter === f.value ? 'var(--primary)' : 'var(--border)'}`,
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* WO Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workOrders.map((wo) => {
          const cfg = STATUS_CONFIG[wo.status] || STATUS_CONFIG.OPEN
          const project = projects.find(p => p.id === wo.projectId)
          return (
            <div key={wo.id} className="card p-5 cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: `3px solid ${cfg.border}` }} onClick={() => router.push(`/dashboard/production/${wo.id}`)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--primary)' }}>{wo.woCode}</span>
                  <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{wo.description}</p>
                </div>
                <span className="badge" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border, borderWidth: '1px' }}>{cfg.label}</span>
              </div>
              <div className="space-y-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {project && <div>Dự án: <span style={{ color: 'var(--text-secondary)' }}>{project.projectCode}</span></div>}
                <div>Tổ SX: <span style={{ color: 'var(--text-secondary)' }}>{wo.teamCode}</span></div>
                {wo.plannedStart && <div className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {formatDate(wo.plannedStart)} → {wo.plannedEnd ? formatDate(wo.plannedEnd) : '?'}
                </div>}
                <div>Vật tư: <span className="font-semibold" style={{ color: 'var(--primary)' }}>{wo.materialIssueCount}</span> lượt</div>
              </div>
              <div className="flex gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                {wo.status === 'OPEN' && <button onClick={(e) => handleAction(e, wo.id, 'start')} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>Bắt đầu</button>}
                {wo.status === 'IN_PROGRESS' && <button onClick={(e) => handleAction(e, wo.id, 'complete')} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>Hoàn thành</button>}
                {wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && <button onClick={(e) => handleAction(e, wo.id, 'cancel')} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>Hủy</button>}
              </div>
            </div>
          )
        })}
        {workOrders.length === 0 && (
          <div className="col-span-3 card p-12 text-center">
            <svg className="mx-auto mb-3" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /></svg>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Chưa có lệnh sản xuất</p>
          </div>
        )}
      </div>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
    </div>
  )
}

function CreateWOForm({ projects, onClose, onCreated }: { projects: ProjectOption[]; onClose: () => void; onCreated: () => void }) {
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
    <div className="card p-6 animate-fade-in">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tạo lệnh sản xuất</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mã WO *</label>
          <input className="input" value={form.woCode} onChange={(e) => setForm({ ...form, woCode: e.target.value })} placeholder="WO-2026-001" required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Dự án *</label>
          <select className="input" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required>
            <option value="">Chọn dự án</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tổ SX *</label>
          <input className="input" value={form.teamCode} onChange={(e) => setForm({ ...form, teamCode: e.target.value })} required /></div>
        <div className="col-span-3"><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mô tả *</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Ngày bắt đầu</label>
          <input className="input" type="date" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Ngày kết thúc</label>
          <input className="input" type="date" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} /></div>
        <div className="flex items-end gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
          <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">{submitting ? 'Đang tạo...' : 'Tạo WO'}</button>
        </div>
      </form>
    </div>
  )
}
