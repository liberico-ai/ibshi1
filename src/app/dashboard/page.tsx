'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { ROLES, HIDDEN_MENU_KEYS } from '@/lib/constants'
import { StatCard, Card } from '@/components/ui'
import {
  BarChart, Zap, CheckCircle, AlertCircle,
  Package, Factory, ShieldCheck,
  PieChart, FileBarChart, BarChart3,
  ClipboardList, Ruler, Handshake, Wrench,
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

  const { stats, modules } = data
  const MGMT_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10']
  const showManagement = user?.roleCode && MGMT_ROLES.includes(user.roleCode)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      {/* ═══ Welcome Section ═══ */}
      <div className="welcome-banner">
        <div>
          <h1 className="welcome-title">
            Xin chào, {user?.fullName?.replace(/\s*\(.*\)\s*$/, '').split(' ').pop()}
          </h1>
          <p className="welcome-subtitle">
            {ROLES[user?.roleCode as keyof typeof ROLES]?.name || user?.roleCode} — Tổng quan hệ thống hôm nay
          </p>
        </div>
        <div className="hidden md:block" style={{ textAlign: 'right' }}>
          <p className="welcome-date">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* ═══ Stats Grid ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Tổng task" value={stats.totalTasks} color="var(--ibs-red)" icon={<BarChart size={24} />} />
        <StatCard label="Đang xử lý" value={stats.inProgressTasks} color="var(--info)" icon={<Zap size={24} />} />
        <StatCard label="Hoàn thành" value={stats.completedTasks} color="var(--success)" icon={<CheckCircle size={24} />} />
        <StatCard label="Quá hạn" value={stats.overdueTasks} color="var(--danger)" icon={<AlertCircle size={24} />} accent />
      </div>

      {/* ═══ Module Overview ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
        {!HIDDEN_MENU_KEYS.has('warehouse') && (
        <ModuleCard
          title="Kho vật tư" subtitle="Warehouse" href="/dashboard/warehouse"
          icon={<Package size={22} stroke="#0ea5e9" />} iconBg="#eff6ff"
          metrics={[
            { value: modules.warehouse.totalMaterials, label: 'Loại vật tư', color: '#0ea5e9' },
            { value: modules.warehouse.lowStockCount, label: 'Thiếu hàng', color: modules.warehouse.lowStockCount > 0 ? '#dc2626' : '#059669', alertBg: modules.warehouse.lowStockCount > 0 },
          ]}
        />
        )}
        {!HIDDEN_MENU_KEYS.has('production') && (
        <ModuleCard
          title="Sản xuất" subtitle="Production" href="/dashboard/production"
          icon={<Factory size={22} stroke="#f59e0b" />} iconBg="#fffbeb"
          metrics={[
            { value: modules.production.totalWO, label: 'WO', color: '#f59e0b' },
            { value: modules.production.woInProgress, label: 'Đang chạy', color: '#2563eb' },
            { value: modules.production.woPendingMaterial, label: 'Chờ VT', color: modules.production.woPendingMaterial > 0 ? '#dc2626' : 'var(--text-muted)', alertBg: modules.production.woPendingMaterial > 0 },
          ]}
        />
        )}
        {!HIDDEN_MENU_KEYS.has('qc') && (
        <ModuleCard
          title="Chất lượng" subtitle="Quality Control" href="/dashboard/qc"
          icon={<ShieldCheck size={22} stroke="#059669" />} iconBg="#f0fdf4"
          metrics={[
            { value: modules.qc.totalInspections, label: 'Biên bản', color: '#059669' },
            { value: modules.qc.inspectionsPassed, label: 'Đạt', color: '#059669' },
            { value: modules.qc.inspectionsPending, label: 'Chờ kiểm', color: modules.qc.inspectionsPending > 0 ? '#d97706' : 'var(--text-muted)', alertBg: modules.qc.inspectionsPending > 0 },
          ]}
        />
        )}
      </div>

      {/* ═══ Role-Specific Insights ═══ */}
      {roleData && <RoleInsights data={roleData} role={user?.roleCode || ''} />}

      {/* ═══ Management Quick Links ═══ */}
      {showManagement && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
          <ModuleCard
            title="Tổng quan dự án" subtitle="Tiến độ & giá trị các dự án" href="/dashboard/work/overview"
            icon={<PieChart size={22} stroke="#2563eb" />} iconBg="#eff6ff"
            metrics={[]}
          />
          <ModuleCard
            title="Giao ban tuần" subtitle="Việc quá hạn/tắc, họp tuần" href="/dashboard/work/briefing"
            icon={<FileBarChart size={22} stroke="#c2410c" />} iconBg="#fff7ed"
            metrics={[]}
          />
          <ModuleCard
            title="Hiệu suất & KPI" subtitle="Hiệu quả theo phòng ban" href="/dashboard/work/performance"
            icon={<BarChart3 size={22} stroke="#059669" />} iconBg="#f0fdf4"
            metrics={[]}
          />
        </div>
      )}
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

/* ═══ Role-Specific Insights Panel ═══ */
function RoleInsights({ data, role }: { data: RoleData; role: string }) {
  const myTasks = data.myTasks || { total: 0, byStatus: {} }
  const roleIcon: Record<string, React.ReactNode> = {
    R01: <BarChart3 size={16} />, R02: <ClipboardList size={16} />, R04: <Ruler size={16} />, R05: <Package size={16} />,
    R06: <Factory size={16} />, R07: <Handshake size={16} />, R08: <FileBarChart size={16} />, R09: <ShieldCheck size={16} />,
  }
  const roleLabel: Record<string, string> = {
    R01: 'BGĐ', R02: 'PM', R04: 'Thiết kế', R05: 'Kho',
    R06: 'Sản xuất', R07: 'Thương mại', R08: 'Tài chính', R09: 'QC',
  }

  return (
    <Card padding="default" className="role-insights-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <h3 className="section-title" style={{ fontSize: 'var(--text-md)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{roleIcon[role] || <Wrench size={16} />} {roleLabel[role] || role}</span> Insights — Task của bạn
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
