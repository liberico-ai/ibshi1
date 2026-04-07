'use client'

import React, { useEffect, useState, useCallback } from 'react'
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

// ─── Projects (P5.4 Weekly Volume Report) ───
interface StageData {
  name: string;
  weeks: Record<string, number>;
  total: number;
  totalAssigned?: number;
  totalProduced?: number;
  totalRemaining?: number;
}
interface HangMucData {
  name: string;
  totalHm: number;
  stages: StageData[];
}
interface ProjectData {
  projectCode: string;
  projectName: string;
  totalProj: number;
  hangMucs: HangMucData[];
}

function ProjectsReport({ data }: { data: Record<string, unknown> }) {
  const customData = data.weeklyData as ProjectData[] | undefined
  const customWeekKeys = data.weekKeys as string[] | undefined

  const weeklyData: ProjectData[] = customData || []
  const weekKeys = customWeekKeys || ['Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4']

  return (
    <div className="card overflow-hidden animate-fade-in shadow-sm border border-slate-200">
      <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', background: '#f8fafc' }}>
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <span style={{ color: '#f59e0b', fontSize: '1.2rem' }}>📊</span>
            Báo cáo Sản lượng Nghiệm thu (P5.4)
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Chi tiết theo Dự án {'>'} Hạng mục {'>'} Công đoạn. Dữ liệu từ khối lượng PM xác nhận.</p>
        </div>
        <button className="text-xs font-bold px-3 py-1.5 rounded-lg transition-transform hover:scale-105" style={{ background: '#0ea5e9', color: 'white' }}>
          Tải xuống Excel
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table" style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#1e293b', color: 'white' }}>
              <th rowSpan={2} style={{ width: '25%', padding: '12px 16px', fontWeight: 600, verticalAlign: 'middle' }}>Cấu trúc Hình cây (WBS)</th>
              {weekKeys.map(w => <th key={w} rowSpan={2} className="text-right" style={{ width: '8%', padding: '12px 16px', fontWeight: 600, verticalAlign: 'middle' }}>{w}</th>)}
              <th className="text-center whitespace-nowrap" style={{ padding: '10px 16px 4px', fontWeight: 800, color: '#38bdf8', borderLeft: '1px solid #334155' }}>Nghiệm thu</th>
              <th colSpan={3} className="text-center whitespace-nowrap" style={{ padding: '10px 16px 4px', fontWeight: 700, color: '#94a3b8', borderLeft: '1px solid #334155' }}>Tổng hợp khối lượng</th>
            </tr>
            <tr style={{ background: '#334155' }}>
              <th className="text-right whitespace-nowrap" style={{ padding: '4px 16px 10px', fontWeight: 700, color: '#1e293b', background: '#e0f2fe', fontSize: '0.7rem', borderLeft: '1px solid #475569' }}>KL xác nhận (P5.4)</th>
              <th className="text-right whitespace-nowrap" style={{ padding: '4px 16px 10px', fontWeight: 700, color: '#1e293b', background: '#f1f5f9', fontSize: '0.7rem', borderLeft: '1px solid #475569' }}>SL phân giao (WBS)</th>
              <th className="text-right whitespace-nowrap" style={{ padding: '4px 16px 10px', fontWeight: 700, color: '#1e293b', background: '#dcfce7', fontSize: '0.7rem' }}>SL sản xuất (P5.1)</th>
              <th className="text-right whitespace-nowrap" style={{ padding: '4px 16px 10px', fontWeight: 700, color: '#1e293b', background: '#fef9c3', fontSize: '0.7rem' }}>Còn lại cần TH</th>
            </tr>
          </thead>
          <tbody>
            {weeklyData.map((proj, i) => (
              <React.Fragment key={proj.projectCode}>
                {/* DÒNG DỰ ÁN */}
                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0', borderTop: i > 0 ? '4px solid white' : 'none' }}>
                  <td colSpan={1} style={{ padding: '10px 16px' }}>
                    <div className="font-bold text-sm" style={{ color: 'var(--primary)' }}>
                      <span className="mr-2">📁</span>
                      {proj.projectCode} — <span style={{ color: 'var(--text-primary)' }}>{proj.projectName}</span>
                    </div>
                  </td>
                  {weekKeys.map(w => {
                    const projSum = proj.hangMucs.reduce((sum: number, hm: HangMucData) => sum + hm.stages.reduce((s: number, stg: StageData) => s + (stg.weeks[w] || 0), 0), 0)
                    return (
                      <td key={w} className="text-right font-bold text-sm" style={{ background: projSum > 0 ? '#e0f2fe' : 'transparent', color: projSum > 0 ? '#0369a1' : 'var(--text-muted)', borderLeft: '1px solid #f1f5f9' }}>
                        {projSum > 0 ? projSum.toLocaleString() : '-'}
                      </td>
                    )
                  })}
                  <td className="text-right font-extrabold text-sm whitespace-nowrap" style={{ color: '#0ea5e9', background: '#f8fafc', borderLeft: '2px solid white' }}>
                    {proj.totalProj.toLocaleString()} kg
                  </td>
                  {(() => {
                    const pAssigned = proj.hangMucs.reduce((sum, hm) => sum + hm.stages.reduce((s, stg) => s + (stg.totalAssigned || 0), 0), 0)
                    const pProduced = proj.hangMucs.reduce((sum, hm) => sum + hm.stages.reduce((s, stg) => s + (stg.totalProduced || 0), 0), 0)
                    const pRemaining = proj.hangMucs.reduce((sum, hm) => sum + hm.stages.reduce((s, stg) => s + (stg.totalRemaining || 0), 0), 0)
                    return (
                      <>
                        <td className="text-right font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{pAssigned.toLocaleString()}</td>
                        <td className="text-right font-bold text-sm" style={{ color: '#16a34a' }}>{pProduced.toLocaleString()}</td>
                        <td className="text-right font-bold text-sm" style={{ color: pRemaining > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{pRemaining.toLocaleString()}</td>
                      </>
                    )
                  })()}
                </tr>

                {proj.hangMucs.map((hm: HangMucData, j: number) => (
                  <React.Fragment key={`${proj.projectCode}-${hm.name}`}>
                    {/* DÒNG HẠNG MỤC - chỉ hiển thị tên tham chiếu */}
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <td colSpan={weekKeys.length + 5} style={{ padding: '8px 16px 8px 36px' }}>
                        <div className="font-semibold text-xs text-slate-700 flex items-center">
                          <span className="mr-2 text-slate-400">↳</span>
                          <span className="px-2 py-0.5 rounded bg-slate-200 mr-2 text-[10px]">HẠNG MỤC</span>
                          {hm.name}
                        </div>
                      </td>
                    </tr>

                    {/* CÁC CÔNG ĐOẠN */}
                    {hm.stages.map((stg: StageData, k: number) => (
                      <tr key={stg.name} className="hover:bg-slate-50 transition-colors" style={{ borderBottom: k === hm.stages.length - 1 ? 'none' : '1px dotted #e2e8f0' }}>
                        <td style={{ padding: '8px 16px 8px 64px' }}>
                          <span className="text-xs font-medium" style={{ color: '#64748b' }}>
                            <span className="mr-2 text-slate-300">▪</span>
                            {stg.name}
                          </span>
                        </td>
                        {weekKeys.map(w => {
                          const val = stg.weeks[w] || 0
                          const isHigh = val > 1000
                          return (
                            <td key={w} className="text-right text-xs" style={{ verticalAlign: 'middle' }}>
                              {val > 0 ? (
                                <span className="inline-block px-2 py-0.5 rounded-full" style={{
                                  background: isHigh ? '#dcfce7' : '#f1f5f9',
                                  color: isHigh ? '#166534' : '#475569',
                                  fontWeight: isHigh ? 700 : 600
                                }}>
                                  {val.toLocaleString()} <span className="text-[9px] opacity-70">kg</span>
                                </span>
                              ) : (
                                <span style={{ color: '#cbd5e1' }}>—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="text-right text-xs font-semibold" style={{ color: '#64748b', borderLeft: '1px dotted #e2e8f0' }}>
                          {stg.total.toLocaleString()}
                        </td>
                        <td className="text-right text-xs" style={{ color: 'var(--text-primary)' }}>{(stg.totalAssigned || 0).toLocaleString()}</td>
                        <td className="text-right text-xs" style={{ color: '#16a34a' }}>{(stg.totalProduced || 0).toLocaleString()}</td>
                        <td className="text-right text-xs font-semibold" style={{ color: (stg.totalRemaining || 0) > 0 ? '#f59e0b' : '#94a3b8' }}>{(stg.totalRemaining || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f8fafc', borderTop: '2px solid #94a3b8' }}>
              <td className="text-right text-sm font-bold p-4" style={{ color: 'var(--text-primary)' }}>TỔNG SẢN LƯỢNG NGHIỆM THU:</td>
              {weekKeys.map(w => {
                const sum = weeklyData.reduce((acc: number, proj: ProjectData) => acc + proj.hangMucs.reduce((s: number, hm: HangMucData) => s + hm.stages.reduce((st: number, stg: StageData) => st + (stg.weeks[w] || 0), 0), 0), 0)
                return (
                  <td key={w} className="text-right text-sm font-black p-4" style={{ color: '#0ea5e9' }}>
                    {sum.toLocaleString()} <span className="text-xs">kg</span>
                  </td>
                )
              })}
              <td className="text-right text-base font-black p-4 whitespace-nowrap" style={{ color: '#0284c7', borderLeft: '2px solid #e2e8f0' }}>
                {weeklyData.reduce((acc: number, proj: ProjectData) => acc + proj.totalProj, 0).toLocaleString()} <span className="text-xs">kg</span>
              </td>
              {(() => {
                const totalAssigned = weeklyData.reduce((sum, proj) => sum + proj.hangMucs.reduce((hs, hm) => hs + hm.stages.reduce((ss, stg) => ss + (stg.totalAssigned || 0), 0), 0), 0)
                const totalProduced = weeklyData.reduce((sum, proj) => sum + proj.hangMucs.reduce((hs, hm) => hs + hm.stages.reduce((ss, stg) => ss + (stg.totalProduced || 0), 0), 0), 0)
                const totalRemaining = weeklyData.reduce((sum, proj) => sum + proj.hangMucs.reduce((hs, hm) => hs + hm.stages.reduce((ss, stg) => ss + (stg.totalRemaining || 0), 0), 0), 0)
                return (
                  <>
                    <td className="text-right text-base font-bold p-4 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{totalAssigned.toLocaleString()}</td>
                    <td className="text-right text-base font-bold p-4 whitespace-nowrap" style={{ color: '#16a34a' }}>{totalProduced.toLocaleString()}</td>
                    <td className="text-right text-base font-bold p-4 whitespace-nowrap" style={{ color: '#f59e0b' }}>{totalRemaining.toLocaleString()}</td>
                  </>
                )
              })()}
            </tr>
          </tfoot>
        </table>
      </div>
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
