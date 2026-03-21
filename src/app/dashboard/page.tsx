'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { getProgressColor } from '@/lib/utils'

interface DashboardData {
  stats: { totalTasks: number; pendingTasks: number; inProgressTasks: number; completedTasks: number; overdueTasks: number }
  projects: Array<{
    id: string; projectCode: string; projectName: string; clientName: string;
    productType: string; status: string; progress: number; totalTasks: number; completedTasks: number;
    deptBreakdown: Record<string, { done: number; total: number }>;
    volumeProgress: { estimatedKg: number; completedKg: number; completedPercent: number; acceptedKg: number; acceptedPercent: number };
  }>
  bottleneck: Array<{ role: string; pendingCount: number }>
  modules: {
    warehouse: { totalMaterials: number; lowStockCount: number }
    production: { totalWO: number; woInProgress: number; woPendingMaterial: number }
    qc: { totalInspections: number; inspectionsPassed: number; inspectionsPending: number }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoleData = Record<string, any>

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [roleData, setRoleData] = useState<RoleData | null>(null)
  const [loading, setLoading] = useState(true)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/dashboard/role'),
    ]).then(([res, roleRes]) => {
      if (res.ok) setData(res)
      if (roleRes.ok) setRoleData(roleRes)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="space-y-8 animate-fade-in">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 skeleton rounded-2xl" />
          ))}
        </div>
        <div className="h-64 skeleton rounded-2xl" />
      </div>
    )
  }

  if (!data) return <p style={{ color: 'var(--text-muted)', padding: '40px', textAlign: 'center', fontSize: '16px' }}>Không thể tải dữ liệu dashboard</p>

  const { stats, projects, bottleneck, modules } = data
  const maxBottleneck = Math.max(...bottleneck.map(b => b.pendingCount), 1)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* ═══ Welcome Section ═══ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 28px', borderRadius: '16px',
        background: 'linear-gradient(135deg, #0a2540 0%, #163a5f 100%)',
        color: 'white',
      }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '4px' }}>
            Xin chào, {user?.fullName?.replace(/\s*\(.*\)\s*$/, '').split(' ').pop()} 👋
          </h1>
          <p style={{ fontSize: '14px', opacity: 0.7 }}>
            {ROLES[user?.roleCode as keyof typeof ROLES]?.name || user?.roleCode} — Tổng quan hệ thống hôm nay
          </p>
        </div>
        <div style={{ textAlign: 'right' }} className="hidden md:block">
          <p style={{ fontSize: '13px', opacity: 0.6 }}>
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* ═══ Stats Grid — Big, clear numbers ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }} className="stagger-children">
        <StatCard label="Tổng task" value={stats.totalTasks} color="#0a2540" icon="bar-chart" />
        <StatCard label="Đang xử lý" value={stats.inProgressTasks} color="#0ea5e9" icon="zap" />
        <StatCard label="Hoàn thành" value={stats.completedTasks} color="#059669" icon="check-circle" />
        <StatCard label="Quá hạn" value={stats.overdueTasks} color="#dc2626" icon="alert-circle" accent />
      </div>

      {/* ═══ Module Overview — Clickable cards ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }} className="stagger-children">
        {/* Warehouse */}
        <a href="/dashboard/warehouse" style={{
          display: 'block', padding: '24px', borderRadius: '16px', textDecoration: 'none',
          background: 'white', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)', transition: 'all 0.2s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
            </div>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-heading)' }}>Kho vật tư</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Warehouse</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#f8fafc' }}>
              <p style={{ fontSize: '28px', fontWeight: 800, color: '#0ea5e9', letterSpacing: '-0.03em' }}>{modules.warehouse.totalMaterials}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>Loại vật tư</p>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: modules.warehouse.lowStockCount > 0 ? '#fef2f2' : '#f8fafc' }}>
              <p style={{ fontSize: '28px', fontWeight: 800, color: modules.warehouse.lowStockCount > 0 ? '#dc2626' : '#059669', letterSpacing: '-0.03em' }}>{modules.warehouse.lowStockCount}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>Thiếu hàng</p>
            </div>
          </div>
        </a>

        {/* Production */}
        <a href="/dashboard/production" style={{
          display: 'block', padding: '24px', borderRadius: '16px', textDecoration: 'none',
          background: 'white', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)', transition: 'all 0.2s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /></svg>
            </div>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-heading)' }}>Sản xuất</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Production</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#f8fafc', textAlign: 'center' }}>
              <p style={{ fontSize: '24px', fontWeight: 800, color: '#f59e0b', letterSpacing: '-0.03em' }}>{modules.production.totalWO}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>WO</p>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#eff6ff', textAlign: 'center' }}>
              <p style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb', letterSpacing: '-0.03em' }}>{modules.production.woInProgress}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>Đang chạy</p>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: modules.production.woPendingMaterial > 0 ? '#fef2f2' : '#f8fafc', textAlign: 'center' }}>
              <p style={{ fontSize: '24px', fontWeight: 800, color: modules.production.woPendingMaterial > 0 ? '#dc2626' : 'var(--text-muted)', letterSpacing: '-0.03em' }}>{modules.production.woPendingMaterial}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>Chờ VT</p>
            </div>
          </div>
        </a>

        {/* QC */}
        <a href="/dashboard/qc" style={{
          display: 'block', padding: '24px', borderRadius: '16px', textDecoration: 'none',
          background: 'white', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)', transition: 'all 0.2s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-heading)' }}>Chất lượng</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Quality Control</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#f8fafc', textAlign: 'center' }}>
              <p style={{ fontSize: '24px', fontWeight: 800, color: '#059669', letterSpacing: '-0.03em' }}>{modules.qc.totalInspections}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>Biên bản</p>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#f0fdf4', textAlign: 'center' }}>
              <p style={{ fontSize: '24px', fontWeight: 800, color: '#059669', letterSpacing: '-0.03em' }}>{modules.qc.inspectionsPassed}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>Đạt</p>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: modules.qc.inspectionsPending > 0 ? '#fffbeb' : '#f8fafc', textAlign: 'center' }}>
              <p style={{ fontSize: '24px', fontWeight: 800, color: modules.qc.inspectionsPending > 0 ? '#d97706' : 'var(--text-muted)', letterSpacing: '-0.03em' }}>{modules.qc.inspectionsPending}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>Chờ kiểm</p>
            </div>
          </div>
        </a>
      </div>

      {/* ═══ Role-Specific Insights ═══ */}
      {roleData && <RoleInsights data={roleData} role={user?.roleCode || ''} />}

      {/* ═══ Main Content Grid ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        {/* Projects */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-heading)' }}>Dự án đang triển khai</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>{projects.length} dự án hoạt động</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {projects.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                <p style={{ fontSize: '40px', marginBottom: '12px' }}>📋</p>
                <p style={{ fontSize: '15px', color: 'var(--text-muted)', fontWeight: 500 }}>Chưa có dự án nào</p>
              </div>
            )}
            {projects.map((p) => {
              const vol = p.volumeProgress
              const depts = Object.entries(p.deptBreakdown || {}).sort((a, b) => b[1].total - a[1].total)
              const DEPT_COLORS: Record<string, string> = { SX: '#e74c3c', QC: '#2ecc71', KHO: '#f39c12', TK: '#3498db', PM: '#9b59b6', KTKH: '#1abc9c', TM: '#e67e22', KT: '#34495e', 'BGĐ': '#8e44ad', HT: '#95a5a6' }

              return (
                <div key={p.id} style={{
                  padding: '20px', borderRadius: '14px', cursor: 'pointer',
                  background: '#f8fafc', border: '1px solid var(--border-light)',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = 'var(--border-light)' }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                      <span style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent)' }}>
                        {p.projectCode}
                      </span>
                      <h4 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-heading)', marginTop: '4px' }}>
                        {p.projectName}
                      </h4>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{p.clientName}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.03em', color: p.progress > 50 ? 'var(--success)' : 'var(--text-heading)' }}>
                        {p.progress}%
                      </span>
                      <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)', marginTop: '2px' }}>
                        {p.completedTasks}/{p.totalTasks} tasks
                      </p>
                    </div>
                  </div>

                  {/* Task progress bar */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', width: 24 }}>📋</span>
                      <div className="progress-bar" style={{ flex: 1 }}>
                        <div className={`progress-bar-fill ${getProgressColor(p.progress)}`} style={{ width: `${p.progress}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Volume progress bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', width: 24 }}>⚖️</span>
                      {vol.estimatedKg > 0 ? (
                        <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#e8ecf1', position: 'relative', overflow: 'hidden' }}>
                          {/* Completed (lighter) */}
                          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(vol.completedPercent, 100)}%`, background: '#93c5fd', borderRadius: 4, transition: 'width 0.6s ease' }} />
                          {/* Accepted (darker, on top) */}
                          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(vol.acceptedPercent, 100)}%`, background: '#2563eb', borderRadius: 4, transition: 'width 0.6s ease' }} />
                        </div>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu KL</span>
                      )}
                    </div>
                  </div>

                  {/* Summary row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {/* Department tags */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {depts.slice(0, 6).map(([dept, v]) => (
                        <span key={dept} style={{
                          fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                          background: `${DEPT_COLORS[dept] || '#64748b'}18`,
                          color: DEPT_COLORS[dept] || '#64748b',
                          lineHeight: '14px',
                        }}>
                          {dept}:{v.done}/{v.total}
                        </span>
                      ))}
                    </div>
                    {/* Volume summary */}
                    {vol.estimatedKg > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>
                        ⚖️ {(vol.acceptedKg / 1000).toFixed(1)}/{(vol.estimatedKg / 1000).toFixed(1)}T ({vol.acceptedPercent}% NT)
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bottleneck Map */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-heading)' }}>Bottleneck Map</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Task chờ xử lý theo phòng ban</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {bottleneck.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--success-bg)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--success)' }}>Không có bottleneck</p>
              </div>
            )}
            {bottleneck.map((b) => (
              <div key={b.role} style={{ padding: '16px', borderRadius: '14px', background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div>
                    <span style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary)' }}>{b.role}</span>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-heading)' }}>
                      {ROLES[b.role as keyof typeof ROLES]?.name || b.role}
                    </p>
                  </div>
                  <span style={{
                    fontSize: '14px', fontWeight: 700, padding: '4px 14px', borderRadius: '20px',
                    background: b.pendingCount > 3 ? 'var(--danger-bg)' : b.pendingCount > 1 ? 'var(--warning-bg)' : 'var(--success-bg)',
                    color: b.pendingCount > 3 ? 'var(--danger)' : b.pendingCount > 1 ? 'var(--warning)' : 'var(--success)',
                  }}>
                    {b.pendingCount}
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'var(--border-light)' }}>
                  <div style={{
                    height: '100%', borderRadius: '3px', transition: 'width 0.4s ease',
                    width: `${(b.pendingCount / maxBottleneck) * 100}%`,
                    background: b.pendingCount > 3 ? 'var(--danger)' : b.pendingCount > 1 ? 'var(--warning)' : 'var(--success)',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══ Role-Specific Insights Panel ═══ */
function RoleInsights({ data, role }: { data: RoleData; role: string }) {
  const myTasks = data.myTasks || { total: 0, byStatus: {} }
  const roleLabel: Record<string, string> = {
    R01: '📊 BGĐ', R02: '📋 PM', R04: '📐 Thiết kế', R05: '📦 Kho',
    R06: '🏭 Sản xuất', R07: '🤝 Thương mại', R09: '✅ QC',
  }

  return (
    <div style={{
      padding: '24px', borderRadius: '16px', background: 'white',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)',
      borderLeft: '4px solid var(--accent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-heading)' }}>
          {roleLabel[role] || '🔧'} Insights — Task của bạn
        </h3>
        <span style={{ padding: '3px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: 'var(--accent)', color: 'white' }}>
          {myTasks.total} tasks
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
        <MiniStat label="Đang xử lý" value={myTasks.byStatus?.IN_PROGRESS || 0} color="#0ea5e9" />
        <MiniStat label="Hoàn thành" value={myTasks.byStatus?.COMPLETED || 0} color="#059669" />
        {data.warehouse && (
          <>
            <MiniStat label="PR chờ duyệt" value={data.warehouse.prPending} color="#f59e0b" />
            <MiniStat label="PO đang xử lý" value={data.warehouse.poActive} color="#2563eb" />
          </>
        )}
        {data.production && (
          <>
            <MiniStat label="Phiếu CV hôm nay" value={data.production.todayJobCards} color="#f59e0b" />
            <MiniStat label="WO đang chạy" value={data.production.woByStatus?.IN_PROGRESS || 0} color="#0ea5e9" />
          </>
        )}
        {data.qc && (
          <>
            <MiniStat label="NCR mở" value={data.qc.ncrOpen} color="#dc2626" />
            <MiniStat label="CC sắp hết hạn" value={data.qc.certExpiring} color="#f59e0b" />
          </>
        )}
        {data.design && (
          <>
            <MiniStat label="ECO chờ duyệt" value={data.design.ecoPending} color="#f59e0b" />
            <MiniStat label="Bản vẽ IFR" value={data.design.drawingByStatus?.IFR || 0} color="#eab308" />
          </>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: '16px', borderRadius: '14px', transition: 'all 0.2s',
      background: `${color}08`, border: `1px solid ${color}20`,
    }}>
      <p style={{ fontSize: '24px', fontWeight: 800, color, letterSpacing: '-0.03em' }}>{value}</p>
      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '4px' }}>{label}</p>
    </div>
  )
}

/* ═══ Stat Card Component ═══ */
function StatCard({ label, value, icon, color, accent }: {
  label: string; value: number; icon: string; color: string; accent?: boolean
}) {
  return (
    <div style={{
      background: 'white', borderRadius: '16px', padding: '24px',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)',
      position: 'relative', overflow: 'hidden', transition: 'all 0.2s ease',
    }}
    className={accent && value > 0 ? 'animate-pulse-glow' : ''}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)' }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: color, borderRadius: '16px 16px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingTop: '4px' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${color}10` }}>
          <StatIcon name={icon} color={color} />
        </div>
        {accent && value > 0 && (
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            ⚠ Cảnh báo
          </span>
        )}
      </div>
      <p style={{ fontSize: '36px', fontWeight: 800, color, letterSpacing: '-0.04em', lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '8px' }}>{label}</p>
    </div>
  )
}

function StatIcon({ name, color }: { name: string; color: string }) {
  const props = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  switch (name) {
    case 'bar-chart': return <svg {...props}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
    case 'zap': return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
    case 'check-circle': return <svg {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
    case 'alert-circle': return <svg {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
    default: return <div style={{ width: 24, height: 24 }} />
  }
}
