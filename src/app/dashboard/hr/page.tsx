'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Button } from '@/components/ui'

interface Employee {
  id: string; employeeCode: string; fullName: string; phone: string | null;
  email: string | null; position: string | null; employmentType: string;
  status: string; joinDate: string; departmentName: string | null;
  currentSalary: number | null;
}

interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  ACTIVE: { label: 'Đang làm', bg: '#f0fdf4', color: '#16a34a' },
  ON_LEAVE: { label: 'Nghỉ phép', bg: '#fefce8', color: '#ca8a04' },
  RESIGNED: { label: 'Đã nghỉ', bg: '#f1f5f9', color: '#64748b' },
}

const TYPE_MAP: Record<string, string> = {
  FULL_TIME: 'Chính thức',
  CONTRACT: 'Hợp đồng',
  PROBATION: 'Thử việc',
}

export default function HRPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { loadEmployees() }, [search, statusFilter, page])

  async function loadEmployees() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    params.set('page', String(page))
    const res = await apiFetch(`/api/hr/employees?${params}`)
    if (res.ok) { setEmployees(res.employees); setPagination(res.pagination) }
    setLoading(false)
  }

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
    </div>
  )

  const activeCount = employees.filter(e => e.status === 'ACTIVE').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Nhân sự"
        subtitle={`${pagination.total} nhân viên • ${activeCount} đang làm việc`}
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Thêm NV</Button>}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Tổng nhân sự" value={pagination.total} color="#0ea5e9" />
        <StatCard label="Đang làm" value={activeCount} color="#16a34a" />
        <StatCard label="Thử việc" value={employees.filter(e => e.employmentType === 'PROBATION').length} color="#f59e0b" />
        <StatCard label="Đã nghỉ" value={employees.filter(e => e.status === 'RESIGNED').length} color="#64748b" />
      </div>

      {showCreate && <CreateEmployeeForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadEmployees() }} />}

      {/* Search + Status filter */}
      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã NV, tên..." /></div>
        <div className="flex gap-2">
          {[{ value: '', label: 'Tất cả' }, ...Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))].map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`filter-pill ${statusFilter === f.value ? 'active' : ''}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Employees table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã NV</th><th>Họ tên</th><th>Phòng ban</th><th>Vị trí</th>
              <th>Loại HĐ</th><th>Ngày vào</th><th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(e => {
              const st = STATUS_MAP[e.status] || STATUS_MAP.ACTIVE
              return (
                <tr key={e.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.employeeCode}</span></td>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{e.fullName}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.departmentName || '-'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{e.position || '-'}</td>
                  <td><span className="badge" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>{TYPE_MAP[e.employmentType] || e.employmentType}</span></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(e.joinDate).toLocaleDateString('vi-VN')}</td>
                  <td><span className="badge" style={{ background: st.bg, color: st.color }}>{st.label}</span></td>
                </tr>
              )
            })}
            {employees.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có nhân viên nào</td></tr>
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

function CreateEmployeeForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ employeeCode: '', fullName: '', phone: '', email: '', position: '', employmentType: 'FULL_TIME' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch('/api/hr/employees', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  return (
    <div className="card p-6 animate-fade-in">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Thêm nhân viên mới</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mã NV *</label>
          <input className="input" value={form.employeeCode} onChange={e => setForm({ ...form, employeeCode: e.target.value })} placeholder="NV-001" required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Họ tên *</label>
          <input className="input" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>SĐT</label>
          <input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Email</label>
          <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Vị trí</label>
          <input className="input" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Loại hợp đồng</label>
          <select className="input" value={form.employmentType} onChange={e => setForm({ ...form, employmentType: e.target.value })}>
            <option value="FULL_TIME">Chính thức</option>
            <option value="CONTRACT">Hợp đồng</option>
            <option value="PROBATION">Thử việc</option>
          </select></div>
        <div className="col-span-3 flex gap-3 justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Thêm'}</Button>
        </div>
      </form>
    </div>
  )
}
