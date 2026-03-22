'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'

type Tab = 'overview' | 'projects' | 'financial' | 'production' | 'qc' | 'warehouse' | 'hr' | 'safety' | 'procurement'

const TABS: { key: Tab; label: string; emoji: string }[] = [
  { key: 'overview', label: 'Tổng quan', emoji: '📊' },
  { key: 'projects', label: 'Dự án', emoji: '📁' },
  { key: 'financial', label: 'Tài chính', emoji: '💰' },
  { key: 'production', label: 'Sản xuất', emoji: '🏭' },
  { key: 'qc', label: 'Chất lượng', emoji: '🔍' },
  { key: 'warehouse', label: 'Kho vận', emoji: '📦' },
  { key: 'hr', label: 'Nhân sự & KPI', emoji: '👥' },
  { key: 'safety', label: 'An toàn', emoji: '🦺' },
  { key: 'procurement', label: 'Mua hàng', emoji: '🛒' },
]

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)

  const loadTab = useCallback(async (t: Tab) => {
    setLoading(true)
    const apiType = t === 'projects' ? 'project-progress' : t
    const res = await apiFetch(`/api/reports?type=${apiType}`)
    if (res.ok) setData(res)
    // Also load KPI for HR tab
    if (t === 'hr') {
      const kpi = await apiFetch('/api/reports?type=kpi')
      if (kpi.ok) setData(prev => ({ ...prev, kpi: kpi.kpi }))
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadTab(tab) }, [tab, loadTab])

  const Skeleton = () => <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📊 Báo cáo tổng hợp</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>11 loại báo cáo • 9 module</p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-lg overflow-x-auto" style={{ background: 'var(--bg-secondary)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="text-xs px-3 py-1.5 rounded-md transition-all font-medium whitespace-nowrap"
            style={{ background: tab === t.key ? 'var(--accent)' : 'transparent', color: tab === t.key ? 'white' : 'var(--text-muted)' }}>
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {loading ? <Skeleton /> : (
        <>
          {tab === 'overview' && <OverviewReport data={data} />}
          {tab === 'projects' && <ProjectsReport data={data} />}
          {tab === 'financial' && <FinancialReport data={data} />}
          {tab === 'production' && <ProductionReport data={data} />}
          {tab === 'qc' && <QCReport data={data} />}
          {tab === 'warehouse' && <WarehouseReport data={data} />}
          {tab === 'hr' && <HRReport data={data} />}
          {tab === 'safety' && <SafetyReport data={data} />}
          {tab === 'procurement' && <ProcurementReport data={data} />}
        </>
      )}
    </div>
  )
}

// ─── KPI Card ───
function KPI({ emoji, label, value, sub, color }: { emoji: string; label: string; value: string | number; sub: string; color: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl mb-1">{emoji}</div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
    </div>
  )
}

// ─── Overview ───
function OverviewReport({ data }: { data: Record<string, unknown> }) {
  const o = data.overview as Record<string, number> | undefined
  if (!o) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="📁" label="Tổng dự án" value={o.projectCount} sub={`${o.activeProjects} đang chạy`} color="var(--primary)" />
        <KPI emoji="✅" label="Tasks hoàn thành" value={`${o.taskCompletionRate}%`} sub={`${o.completedTasks}/${o.totalTasks}`} color="#16a34a" />
        <KPI emoji="⚠️" label="Quá hạn" value={o.overdueTasks} sub="tasks overdue" color="#dc2626" />
        <KPI emoji="🔧" label="WO đang chạy" value={o.activeWO} sub={`${o.openNCR} NCR mở`} color="#f59e0b" />
      </div>
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Task Completion Rate</h3>
        <div className="h-6 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
          <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${o.taskCompletionRate}%`, background: 'linear-gradient(90deg, var(--primary), var(--accent))' }} />
        </div>
        <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{o.completedTasks} completed</span>
          <span className="font-bold" style={{ color: 'var(--accent)' }}>{o.taskCompletionRate}%</span>
          <span>{o.totalTasks} total</span>
        </div>
      </div>
    </>
  )
}

// ─── Projects ───
function ProjectsReport({ data }: { data: Record<string, unknown> }) {
  const projects = (data.projects || []) as { projectCode: string; projectName: string; clientName: string; totalTasks: number; completedTasks: number; overdueTasks: number; percentage: number }[]
  return (
    <div className="space-y-3">
      {projects.length === 0 ? <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Không có dự án</p>
      : projects.map(p => (
        <div key={p.projectCode} className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{p.projectCode}</span>
              <span className="text-sm font-medium ml-2" style={{ color: 'var(--text-primary)' }}>{p.projectName}</span>
              {p.overdueTasks > 0 && <span className="text-xs ml-2 px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#dc262620', color: '#dc2626' }}>⚠ {p.overdueTasks} quá hạn</span>}
            </div>
            <span className="text-lg font-bold" style={{ color: p.percentage >= 80 ? '#16a34a' : p.percentage >= 50 ? '#f59e0b' : 'var(--text-muted)' }}>{p.percentage}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p.percentage}%`, background: p.percentage >= 80 ? '#16a34a' : p.percentage >= 50 ? '#f59e0b' : 'var(--primary)' }} />
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{p.completedTasks}/{p.totalTasks} tasks</p>
        </div>
      ))}
    </div>
  )
}

// ─── Financial (TC-01 Budget Variance) ───
function FinancialReport({ data }: { data: Record<string, unknown> }) {
  const items = (data.financial || []) as { projectCode: string; projectName: string; contractValue: number; budgetPlanned: number; budgetActual: number; invoicedTotal: number; variance: number; variancePct: number }[]
  return (
    <div className="card overflow-hidden">
      <table className="data-table">
        <thead><tr><th>Dự án</th><th className="text-right">Hợp đồng</th><th className="text-right">KH (Planned)</th><th className="text-right">TT (Actual)</th><th className="text-right">Chênh lệch</th><th className="text-right">%</th></tr></thead>
        <tbody>
          {items.length === 0 ? <tr><td colSpan={6} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu tài chính</td></tr>
          : items.map(f => (
            <tr key={f.projectCode}>
              <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{f.projectCode}</span> <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{f.projectName}</span></td>
              <td className="text-right text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{f.contractValue.toLocaleString('vi-VN')} ₫</td>
              <td className="text-right text-xs" style={{ color: '#0ea5e9' }}>{f.budgetPlanned.toLocaleString('vi-VN')} ₫</td>
              <td className="text-right text-xs" style={{ color: '#f59e0b' }}>{f.budgetActual.toLocaleString('vi-VN')} ₫</td>
              <td className="text-right text-xs font-bold" style={{ color: f.variance >= 0 ? '#16a34a' : '#dc2626' }}>{f.variance.toLocaleString('vi-VN')} ₫</td>
              <td className="text-right"><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: f.variancePct >= 0 ? '#16a34a20' : '#dc262620', color: f.variancePct >= 0 ? '#16a34a' : '#dc2626' }}>{f.variancePct}%</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Production (SX-01) ───
function ProductionReport({ data }: { data: Record<string, unknown> }) {
  const p = data.production as { total: number; statusBreakdown: Record<string, number>; byTeam: { teamCode: string; _count: number }[] } | undefined
  if (!p) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  const statusColors: Record<string, string> = { OPEN: '#888', IN_PROGRESS: '#2563eb', QC_PENDING: '#d97706', QC_PASSED: '#16a34a', QC_FAILED: '#dc2626', ON_HOLD: '#7c3aed', COMPLETED: '#16a34a', CANCELLED: '#dc2626' }
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="🏭" label="Tổng WO" value={p.total} sub="lệnh sản xuất" color="var(--primary)" />
        <KPI emoji="▶️" label="Đang chạy" value={p.statusBreakdown.IN_PROGRESS || 0} sub="in progress" color="#2563eb" />
        <KPI emoji="✅" label="Hoàn thành" value={p.statusBreakdown.COMPLETED || 0} sub="completed" color="#16a34a" />
        <KPI emoji="🔍" label="Chờ QC" value={p.statusBreakdown.QC_PENDING || 0} sub="awaiting QC" color="#d97706" />
      </div>
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Phân bổ theo trạng thái</h3>
        <div className="space-y-2">
          {Object.entries(p.statusBreakdown).filter(([, v]) => v > 0).map(([status, count]) => (
            <div key={status} className="flex items-center gap-3">
              <span className="text-xs w-28 font-mono" style={{ color: statusColors[status] || '#888' }}>{status}</span>
              <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                <div className="h-full rounded-full" style={{ width: `${(count / p.total) * 100}%`, background: statusColors[status] || '#888' }} />
              </div>
              <span className="text-xs font-bold w-8 text-right" style={{ color: 'var(--text-primary)' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
      {p.byTeam.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Theo tổ sản xuất</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {p.byTeam.map(t => (
              <div key={t.teamCode} className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                <p className="text-lg font-bold" style={{ color: 'var(--primary)' }}>{t._count}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{t.teamCode}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ─── QC (QC-01) ───
function QCReport({ data }: { data: Record<string, unknown> }) {
  const q = data.qc as { totalInspections: number; passed: number; failed: number; passRate: number; openNCR: number; closedNCR: number; totalCertificates: number } | undefined
  if (!q) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="🔍" label="Tổng kiểm tra" value={q.totalInspections} sub={`${q.passed} đạt, ${q.failed} không đạt`} color="var(--primary)" />
        <KPI emoji="✅" label="Tỉ lệ đạt" value={`${q.passRate}%`} sub="pass rate" color="#16a34a" />
        <KPI emoji="⚠️" label="NCR mở" value={q.openNCR} sub={`${q.closedNCR} đã đóng`} color="#dc2626" />
        <KPI emoji="📜" label="Certificates" value={q.totalCertificates} sub="chứng chỉ đã cấp" color="#0ea5e9" />
      </div>
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Pass Rate</h3>
        <div className="h-6 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
          <div className="h-full rounded-full" style={{ width: `${q.passRate}%`, background: q.passRate >= 90 ? '#16a34a' : q.passRate >= 70 ? '#f59e0b' : '#dc2626' }} />
        </div>
        <p className="text-xs mt-1 text-center font-bold" style={{ color: q.passRate >= 90 ? '#16a34a' : '#f59e0b' }}>{q.passRate}% — {q.passRate >= 90 ? 'Tốt' : q.passRate >= 70 ? 'Trung bình' : 'Cần cải thiện'}</p>
      </div>
    </>
  )
}

// ─── Warehouse (KH-01) ───
function WarehouseReport({ data }: { data: Record<string, unknown> }) {
  const w = data.warehouse as { totalMaterials: number; lowStockCount: number; lowStockItems: { materialCode: string; name: string; unit: string; currentStock: number; minStock: number }[]; totalMovementsIN: number; totalMovementsOUT: number } | undefined
  if (!w) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="📦" label="Tổng vật tư" value={w.totalMaterials} sub="material codes" color="var(--primary)" />
        <KPI emoji="🔴" label="Dưới tồn kho tối thiểu" value={w.lowStockCount} sub="cần đặt hàng" color="#dc2626" />
        <KPI emoji="📥" label="Nhập kho" value={w.totalMovementsIN} sub="stock IN" color="#16a34a" />
        <KPI emoji="📤" label="Xuất kho" value={w.totalMovementsOUT} sub="stock OUT" color="#f59e0b" />
      </div>
      {w.lowStockCount > 0 && (
        <div className="card overflow-hidden">
          <div className="p-3" style={{ background: '#dc262610', borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold" style={{ color: '#dc2626' }}>⚠ Vật tư dưới tồn kho tối thiểu ({w.lowStockCount})</h3>
          </div>
          <table className="data-table">
            <thead><tr><th>Mã VT</th><th>Tên</th><th>ĐVT</th><th className="text-right">Tồn hiện tại</th><th className="text-right">Tồn tối thiểu</th></tr></thead>
            <tbody>
              {w.lowStockItems.map(m => (
                <tr key={m.materialCode}>
                  <td className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{m.materialCode}</td>
                  <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{m.name}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.unit}</td>
                  <td className="text-right text-xs font-bold" style={{ color: '#dc2626' }}>{m.currentStock}</td>
                  <td className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{m.minStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ─── HR + KPI ───
function HRReport({ data }: { data: Record<string, unknown> }) {
  const hr = data.hr as { totalEmployees: number; activeEmployees: number; totalContracts: number; departments: { code: string; name: string; count: number }[] } | undefined
  const kpi = data.kpi as { taskCompletionRate: number; onTimeDelivery: number; ncrRate: number; woCompletionRate: number } | undefined
  if (!hr) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="👥" label="Nhân viên" value={hr.totalEmployees} sub={`${hr.activeEmployees} active`} color="var(--primary)" />
        <KPI emoji="📋" label="Hợp đồng" value={hr.totalContracts} sub="contracts" color="#0ea5e9" />
        <KPI emoji="🏢" label="Phòng ban" value={hr.departments.length} sub="departments" color="#16a34a" />
        <KPI emoji="📊" label="Task Rate" value={kpi ? `${kpi.taskCompletionRate}%` : '—'} sub="completion rate" color="#f59e0b" />
      </div>
      {kpi && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>KPI Tổng hợp (EX-02)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'OTD Rate', value: kpi.onTimeDelivery, color: '#16a34a' },
              { label: 'NCR Rate', value: kpi.ncrRate, color: kpi.ncrRate <= 5 ? '#16a34a' : '#dc2626' },
              { label: 'Task Completion', value: kpi.taskCompletionRate, color: '#0ea5e9' },
              { label: 'WO Completion', value: kpi.woCompletionRate, color: '#f59e0b' },
            ].map(k => (
              <div key={k.label} className="text-center">
                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-lg font-bold" style={{ background: `${k.color}15`, color: k.color }}>
                  {k.value}%
                </div>
                <p className="text-xs mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {hr.departments.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Phân bổ theo phòng ban</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {hr.departments.map(d => (
              <div key={d.code} className="text-center p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                <p className="text-lg font-bold" style={{ color: 'var(--primary)' }}>{d.count}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Safety ───
function SafetyReport({ data }: { data: Record<string, unknown> }) {
  const s = data.safety as { total: number; open: number; investigating: number; resolved: number; closed: number; bySeverity: Record<string, number> } | undefined
  if (!s) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  const severityColors: Record<string, string> = { LOW: '#16a34a', MEDIUM: '#f59e0b', HIGH: '#dc2626', CRITICAL: '#7c2d12' }
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="🦺" label="Tổng sự cố" value={s.total} sub="all incidents" color="var(--primary)" />
        <KPI emoji="🔴" label="Đang mở" value={s.open} sub="cần xử lý" color="#dc2626" />
        <KPI emoji="🔍" label="Đang điều tra" value={s.investigating} sub="investigating" color="#f59e0b" />
        <KPI emoji="✅" label="Đã đóng" value={s.closed} sub={`${s.resolved} resolved`} color="#16a34a" />
      </div>
      {Object.keys(s.bySeverity).length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Phân bổ theo mức độ nghiêm trọng</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(s.bySeverity).map(([sev, count]) => (
              <div key={sev} className="text-center p-3 rounded-lg" style={{ background: `${severityColors[sev] || '#94a3b8'}10` }}>
                <p className="text-2xl font-bold" style={{ color: severityColors[sev] || '#94a3b8' }}>{count}</p>
                <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{sev}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Procurement ───
function ProcurementReport({ data }: { data: Record<string, unknown> }) {
  const p = data.procurement as { totalPR: number; approvedPR: number; pendingPR: number; totalPO: number; approvedPO: number; pendingPO: number; totalPOValue: number; recentPOs: { poNumber: string; vendorName: string; totalAmount: number; status: string }[] } | undefined
  if (!p) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI emoji="📝" label="Tổng PR" value={p.totalPR} sub={`${p.approvedPR} approved`} color="var(--primary)" />
        <KPI emoji="⏳" label="PR chờ duyệt" value={p.pendingPR} sub="pending approval" color="#f59e0b" />
        <KPI emoji="📦" label="Tổng PO" value={p.totalPO} sub={`${p.approvedPO} approved`} color="#16a34a" />
        <KPI emoji="💰" label="Tổng giá trị PO" value={new Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(p.totalPOValue)} sub="VND" color="#dc2626" />
      </div>
      {p.recentPOs?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Đơn hàng gần đây ({p.recentPOs.length})</h3>
          </div>
          <table className="data-table">
            <thead><tr><th>Số PO</th><th>Nhà cung cấp</th><th className="text-right">Giá trị</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {p.recentPOs.map(po => (
                <tr key={po.poNumber}>
                  <td className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{po.poNumber}</td>
                  <td className="text-xs">{po.vendorName}</td>
                  <td className="text-right text-xs font-bold">{new Intl.NumberFormat('vi-VN').format(po.totalAmount)}</td>
                  <td><span className={`badge badge-${po.status === 'APPROVED' ? 'success' : po.status === 'PENDING' ? 'warning' : 'default'}`}>{po.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
