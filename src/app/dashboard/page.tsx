'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { getProgressColor } from '@/lib/utils'
import { StatCard, Card } from '@/components/ui'
import {
  BarChart, Zap, CheckCircle, AlertCircle,
  Package, Factory, ShieldCheck,
} from 'lucide-react'

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

  if (!data) return <p className="text-center py-10" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>Không thể tải dữ liệu dashboard</p>

  const { stats, projects, bottleneck, modules } = data
  const maxBottleneck = Math.max(...bottleneck.map(b => b.pendingCount), 1)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      {/* ═══ Welcome Section ═══ */}
      <div className="welcome-banner">
        <div>
          <h1 className="welcome-title">
            Xin chào, {user?.fullName?.replace(/\s*\(.*\)\s*$/, '').split(' ').pop()} 👋
          </h1>
          <p className="welcome-subtitle">
            {ROLES[user?.roleCode as keyof typeof ROLES]?.name || user?.roleCode} — Tổng quan hệ thống hôm nay
          </p>
        </div>
        <div className="hidden md:block" style={{ textAlign: 'right' }}>
          <p className="welcome-date">
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* ═══ Stats Grid ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Tổng task" value={stats.totalTasks} color="#0a2540" icon={<BarChart size={24} stroke="#0a2540" />} />
        <StatCard label="Đang xử lý" value={stats.inProgressTasks} color="#0ea5e9" icon={<Zap size={24} stroke="#0ea5e9" />} />
        <StatCard label="Hoàn thành" value={stats.completedTasks} color="#059669" icon={<CheckCircle size={24} stroke="#059669" />} />
        <StatCard label="Quá hạn" value={stats.overdueTasks} color="#dc2626" icon={<AlertCircle size={24} stroke="#dc2626" />} accent />
      </div>

      {/* ═══ Module Overview ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
        <ModuleCard
          title="Kho vật tư" subtitle="Warehouse" href="/dashboard/warehouse"
          icon={<Package size={22} stroke="#0ea5e9" />} iconBg="#eff6ff"
          metrics={[
            { value: modules.warehouse.totalMaterials, label: 'Loại vật tư', color: '#0ea5e9' },
            { value: modules.warehouse.lowStockCount, label: 'Thiếu hàng', color: modules.warehouse.lowStockCount > 0 ? '#dc2626' : '#059669', alertBg: modules.warehouse.lowStockCount > 0 },
          ]}
        />
        <ModuleCard
          title="Sản xuất" subtitle="Production" href="/dashboard/production"
          icon={<Factory size={22} stroke="#f59e0b" />} iconBg="#fffbeb"
          metrics={[
            { value: modules.production.totalWO, label: 'WO', color: '#f59e0b' },
            { value: modules.production.woInProgress, label: 'Đang chạy', color: '#2563eb' },
            { value: modules.production.woPendingMaterial, label: 'Chờ VT', color: modules.production.woPendingMaterial > 0 ? '#dc2626' : 'var(--text-muted)', alertBg: modules.production.woPendingMaterial > 0 },
          ]}
        />
        <ModuleCard
          title="Chất lượng" subtitle="Quality Control" href="/dashboard/qc"
          icon={<ShieldCheck size={22} stroke="#059669" />} iconBg="#f0fdf4"
          metrics={[
            { value: modules.qc.totalInspections, label: 'Biên bản', color: '#059669' },
            { value: modules.qc.inspectionsPassed, label: 'Đạt', color: '#059669' },
            { value: modules.qc.inspectionsPending, label: 'Chờ kiểm', color: modules.qc.inspectionsPending > 0 ? '#d97706' : 'var(--text-muted)', alertBg: modules.qc.inspectionsPending > 0 },
          ]}
        />
      </div>

      {/* ═══ Role-Specific Insights ═══ */}
      {roleData && <RoleInsights data={roleData} role={user?.roleCode || ''} />}

      {/* ═══ Main Content Grid ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
        {/* Projects */}
        <Card padding="spacious">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
            <div>
              <h3 className="section-title">Dự án đang triển khai</h3>
              <p className="section-subtitle">{projects.length} dự án hoạt động</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {projects.length === 0 && (
              <div className="empty-state">
                <p className="empty-state-icon">📋</p>
                <p className="empty-state-text">Chưa có dự án nào</p>
              </div>
            )}
            {projects.map((p) => <ProjectRow key={p.id} project={p} />)}
          </div>
        </Card>

        {/* Bottleneck Map */}
        <Card padding="spacious">
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <h3 className="section-title">Bottleneck Map</h3>
            <p className="section-subtitle">Task chờ xử lý theo phòng ban</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {bottleneck.length === 0 && (
              <div style={{ textAlign: 'center', padding: 'var(--space-2xl) var(--space-lg)' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto var(--space-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--success-bg)' }}>
                  <CheckCircle size={22} stroke="var(--success)" />
                </div>
                <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--success)' }}>Không có bottleneck</p>
              </div>
            )}
            {bottleneck.map((b) => (
              <div key={b.role} className="bottleneck-item">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                  <div>
                    <span className="mono-label">{b.role}</span>
                    <p className="bottleneck-name">
                      {ROLES[b.role as keyof typeof ROLES]?.name || b.role}
                    </p>
                  </div>
                  <span className="bottleneck-count" style={{
                    background: b.pendingCount > 3 ? 'var(--danger-bg)' : b.pendingCount > 1 ? 'var(--warning-bg)' : 'var(--success-bg)',
                    color: b.pendingCount > 3 ? 'var(--danger)' : b.pendingCount > 1 ? 'var(--warning)' : 'var(--success)',
                  }}>
                    {b.pendingCount}
                  </span>
                </div>
                <div className="progress-bar" style={{ height: 6 }}>
                  <div className="progress-bar-fill" style={{
                    width: `${(b.pendingCount / maxBottleneck) * 100}%`,
                    background: b.pendingCount > 3 ? 'var(--danger)' : b.pendingCount > 1 ? 'var(--warning)' : 'var(--success)',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ═══ Module Card — Clickable overview ═══ */
function ModuleCard({ title, subtitle, href, icon, iconBg, metrics }: {
  title: string; subtitle: string; href: string
  icon: React.ReactNode; iconBg: string
  metrics: Array<{ value: number; label: string; color: string; alertBg?: boolean }>
}) {
  return (
    <Card as="a" href={href} hoverable padding="default">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 'var(--radius)', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </div>
        <div>
          <h4 className="section-title" style={{ fontSize: 'var(--text-md)' }}>{title}</h4>
          <p className="section-subtitle" style={{ marginTop: 0 }}>{subtitle}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metrics.length}, 1fr)`, gap: 'var(--space-xs)' }}>
        {metrics.map(m => (
          <div key={m.label} style={{ padding: 'var(--space-sm)', borderRadius: 'var(--radius)', background: m.alertBg ? '#fef2f2' : 'var(--bg-subtle)', textAlign: metrics.length > 2 ? 'center' : undefined }}>
            <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: m.color, letterSpacing: '-0.03em' }}>{m.value}</p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>{m.label}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ═══ Project Row ═══ */
function ProjectRow({ project: p }: { project: DashboardData['projects'][0] }) {
  const vol = p.volumeProgress
  const depts = Object.entries(p.deptBreakdown || {}).sort((a, b) => b[1].total - a[1].total)
  const DEPT_COLORS: Record<string, string> = { SX: '#e74c3c', QC: '#2ecc71', KHO: '#f39c12', TK: '#3498db', PM: '#9b59b6', KTKH: '#1abc9c', TM: '#e67e22', KT: '#34495e', 'BGĐ': '#8e44ad', HT: '#95a5a6' }

  return (
    <a href={`/dashboard/projects/${p.id}`} className="project-row" style={{ display: 'block', textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
        <div>
          <span className="mono-label" style={{ color: '#f06876' }}>{p.projectCode}</span>
          <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: '#f0f4f8', marginTop: 4 }}>{p.projectName}</h4>
          <p style={{ fontSize: 'var(--text-sm)', color: '#94a3b8', marginTop: 2 }}>{p.clientName}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="stat-value" style={{ fontSize: 'var(--text-2xl)', color: p.progress > 50 ? '#34d399' : '#e2e8f0' }}>{p.progress}%</span>
          <p style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: '#94a3b8', marginTop: 2 }}>{p.completedTasks}/{p.totalTasks} tasks</p>
        </div>
      </div>

      {/* Task progress bar */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: '#94a3b8', width: 100 }}>Tiến độ C.Việc</span>
          <div className="progress-bar" style={{ flex: 1, background: 'rgba(255,255,255,0.1)' }}>
            <div className={`progress-bar-fill ${getProgressColor(p.progress)}`} style={{ width: `${p.progress}%` }} />
          </div>
        </div>
      </div>

      {/* Volume progress bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: '#94a3b8', width: 100 }}>Khối lượng T.Tế</span>
          {vol.estimatedKg > 0 ? (
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.1)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(vol.completedPercent, 100)}%`, background: '#93c5fd', borderRadius: 4, transition: 'width 0.6s ease' }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(vol.acceptedPercent, 100)}%`, background: '#2563eb', borderRadius: 4, transition: 'width 0.6s ease' }} />
            </div>
          ) : (
            <span style={{ fontSize: 'var(--text-xs)', color: '#64748b', fontStyle: 'italic' }}>Chưa có dữ liệu KL (BOM)</span>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px var(--space-sm)' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {depts.slice(0, 6).map(([dept, v]) => (
            <span key={dept} className="dept-tag" style={{
              background: `${DEPT_COLORS[dept] || '#64748b'}30`,
              color: DEPT_COLORS[dept] || '#94a3b8',
            }}>
              {dept}:{v.done}/{v.total}
            </span>
          ))}
        </div>
        {vol.estimatedKg > 0 && (
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: '#60a5fa', whiteSpace: 'nowrap' }}>
            ⚖️ {(vol.acceptedKg / 1000).toFixed(1)}/{(vol.estimatedKg / 1000).toFixed(1)}T ({vol.acceptedPercent}% NT)
          </span>
        )}
      </div>
    </a>
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
    <Card padding="default" className="role-insights-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <h3 className="section-title" style={{ fontSize: 'var(--text-md)' }}>
          {roleLabel[role] || '🔧'} Insights — Task của bạn
        </h3>
        <span className="role-badge">{myTasks.total} tasks</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-sm)' }}>
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
    </Card>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <StatCard label={label} value={value} color={color} compact />
  )
}
