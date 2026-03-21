'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'

interface Stats {
  totalUsers: number; activeUsers: number; inactiveUsers: number
  totalProjects: number; activeProjects: number
  usersByRole: { roleCode: string; count: number }[]
  usersByDept: { departmentCode: string; departmentName: string; count: number }[]
  recentLogs: { id: string; action: string; entity: string; entityId: string | null; username: string; fullName: string; createdAt: string }[]
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: '#16a34a', UPDATE: '#0ea5e9', DELETE: '#dc2626', LOGIN: '#8b5cf6',
  APPROVE: '#f59e0b', DEACTIVATE: '#ef4444', RESET_PASSWORD: '#d97706',
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/admin/stats').then(res => {
      if (res.ok) setStats(res.stats)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="space-y-6 animate-fade-in">
      <div className="h-10 w-64 skeleton rounded-xl" />
      <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-28 skeleton rounded-2xl" />)}</div>
      <div className="grid grid-cols-2 gap-4">{[1, 2].map(i => <div key={i} className="h-64 skeleton rounded-2xl" />)}</div>
    </div>
  )

  if (!stats) return <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>Không có quyền truy cập</div>

  const maxRoleCount = Math.max(...stats.usersByRole.map(r => r.count), 1)
  const maxDeptCount = Math.max(...stats.usersByDept.map(d => d.count), 1)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Admin Dashboard</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tổng quan hệ thống IBS-ERP</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon="users" label="Tổng Users" value={stats.totalUsers} color="#0a2540" />
        <StatCard icon="check" label="Active" value={stats.activeUsers} color="#16a34a" />
        <StatCard icon="block" label="Inactive" value={stats.inactiveUsers} color="#dc2626" />
        <StatCard icon="folder" label="Dự án Active" value={stats.activeProjects} color="#0ea5e9" sub={`/${stats.totalProjects} tổng`} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Users by Role */}
        <div className="card p-5">
          <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Phân bổ theo Role</h2>
          <div className="space-y-2.5">
            {stats.usersByRole.map(r => (
              <div key={r.roleCode} className="flex items-center gap-3">
                <span className="text-[10px] font-bold w-10 text-right" style={{ color: 'var(--text-muted)' }}>{r.roleCode}</span>
                <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${(r.count / maxRoleCount) * 100}%`, background: 'linear-gradient(90deg, #0a2540, #1e6091)' }} />
                </div>
                <span className="text-xs font-bold w-8" style={{ color: 'var(--text-primary)' }}>{r.count}</span>
                <span className="text-[10px] w-24 truncate" style={{ color: 'var(--text-muted)' }}>
                  {ROLES[r.roleCode as keyof typeof ROLES]?.name || r.roleCode}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Users by Department */}
        <div className="card p-5">
          <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Phân bổ theo Phòng ban</h2>
          <div className="space-y-2.5">
            {stats.usersByDept.map(d => (
              <div key={d.departmentCode} className="flex items-center gap-3">
                <span className="text-[10px] font-bold w-10 text-right" style={{ color: 'var(--text-muted)' }}>{d.departmentCode}</span>
                <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${(d.count / maxDeptCount) * 100}%`, background: 'linear-gradient(90deg, #065f46, #10b981)' }} />
                </div>
                <span className="text-xs font-bold w-8" style={{ color: 'var(--text-primary)' }}>{d.count}</span>
                <span className="text-[10px] w-28 truncate" style={{ color: 'var(--text-muted)' }}>{d.departmentName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card p-5">
        <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Hoạt động gần đây</h2>
        {stats.recentLogs.length === 0 ? (
          <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có hoạt động nào</p>
        ) : (
          <div className="space-y-2">
            {stats.recentLogs.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: 'var(--surface-hover)' }}>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
                  background: `${ACTION_COLORS[l.action] || '#888'}20`,
                  color: ACTION_COLORS[l.action] || '#888',
                }}>{l.action}</span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{l.entity}</span>
                <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-muted)' }}>bởi <strong>{l.fullName}</strong> ({l.username})</span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{new Date(l.createdAt).toLocaleString('vi-VN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color, sub }: { icon: string; label: string; value: number; color: string; sub?: string }) {
  const iconSvg: Record<string, React.ReactNode> = {
    users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    check: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    block: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
    folder: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>,
  }
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ background: `${color}12`, color, boxShadow: `0 0 0 1px ${color}25` }}>
        {iconSvg[icon] || icon}
      </div>
      <div>
        <p className="text-2xl font-black" style={{ color }}>{value}</p>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}{sub && <span className="normal-case tracking-normal"> {sub}</span>}
        </p>
      </div>
    </div>
  )
}
