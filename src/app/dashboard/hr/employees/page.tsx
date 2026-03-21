'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Employee {
  id: string; employeeCode: string; fullName: string; position: string; phone: string | null; email: string | null;
  status: string; joinDate: string | null;
  department: { name: string } | null
}

const statusLabel: Record<string, string> = { ACTIVE: 'Đang LV', INACTIVE: 'Nghỉ việc', ON_LEAVE: 'Nghỉ phép' }
const statusColor: Record<string, string> = { ACTIVE: '#16a34a', INACTIVE: '#888', ON_LEAVE: '#f59e0b' }

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    apiFetch('/api/employees').then(res => {
      if (res.ok) setEmployees(res.employees || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const filtered = search
    ? employees.filter(e => e.fullName.toLowerCase().includes(search.toLowerCase()) || e.employeeCode.toLowerCase().includes(search.toLowerCase()))
    : employees

  const activeCount = employees.filter(e => e.status === 'ACTIVE').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>👥 Danh sách nhân viên</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{employees.length} nhân viên • {activeCount} đang làm việc</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Tìm kiếm..." className="input-field text-sm w-60" />
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã NV</th><th>Họ tên</th><th>Chức vụ</th><th>Phòng ban</th><th>SĐT</th><th>Email</th><th>Ngày vào</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Không tìm thấy</td></tr>
            ) : filtered.map(e => (
              <tr key={e.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.employeeCode}</span></td>
                <td className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{e.fullName}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.position}</td>
                <td className="text-xs" style={{ color: '#0ea5e9' }}>{e.department?.name || '—'}</td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{e.phone || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.email || '—'}</td>
                <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{e.joinDate ? new Date(e.joinDate).toLocaleDateString('vi-VN') : '—'}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[e.status] || '#888'}20`, color: statusColor[e.status] || '#888' }}>{statusLabel[e.status] || e.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
