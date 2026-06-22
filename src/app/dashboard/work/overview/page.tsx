'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'

interface ProjectSummary {
  id: string; projectCode: string; projectName: string; clientName: string
  status: string; contractValue: number | null
  progress: number; totalTasks: number; completedTasks: number
  activeTasks: number; overdueTasks: number
  materialDemand: number; materialRemaining: number
}
interface Aggregate {
  projectCount: number; totalContractValue: number; totalTasks: number
  totalCompleted: number; totalActive: number; totalOverdue: number; overallProgress: number
}
interface DeptRow { deptCode: string; deptName: string; total: number; active: number; done: number; overdue: number }
interface ActiveTask { id: string; title: string; status: string; deptName: string; assignee: string; deadline: string | null; overdue: boolean }
interface DetailData {
  project: { id: string; projectCode: string; projectName: string; clientName: string; status: string; contractValue: number | null }
  progress: number; totalTasks: number; completedTasks: number
  phases: { phase: string; pct: number }[]
  material: { demand: number; ordered: number; received: number; remaining: number; inProjectStock: number }
  statusSummary: Record<string, number>
  byDept: DeptRow[]
  activeTasks: ActiveTask[]
  allTasks?: ActiveTask[]
}

const ST_LABEL: Record<string, { l: string; c: string; b: string }> = {
  OPEN: { l: 'Mới', c: '#475569', b: '#f1f5f9' },
  IN_PROGRESS: { l: 'Đang xử lý', c: '#1d4ed8', b: '#eff6ff' },
  AWAITING_REVIEW: { l: 'Chờ kết thúc', c: '#b45309', b: '#fffbeb' },
  RETURNED: { l: 'Bị trả lại', c: '#e63946', b: '#fef2f2' },
  DONE: { l: 'Hoàn thành', c: '#059669', b: '#ecfdf5' },
}
const billion = (n: number) => (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const PHASE_NAME: Record<string, string> = { P1: 'Khởi tạo', P2: 'Thiết kế & dự toán', P3: 'Cung ứng', P4: 'Mua & nhập kho', P5: 'Sản xuất', P6: 'Đóng dự án', Khác: 'Khác' }

export default function WorkOverviewPage() {
  const router = useRouter()
  const [agg, setAgg] = useState<Aggregate | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    apiFetch('/api/work/project-overview').then((r) => {
      if (r.ok) {
        setAgg(r.aggregate)
        const sorted = (r.projects as ProjectSummary[]).sort((a, b) => b.overdueTasks - a.overdueTasks || b.activeTasks - a.activeTasks)
        setProjects(sorted)
      }
      setLoading(false)
    })
  }, [])

  const openDetail = (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setDetail(null)
    apiFetch(`/api/work/project-overview/${id}`).then((r) => {
      if (r.ok) setDetail(r as unknown as DetailData)
      setDetailLoading(false)
    })
  }

  const backToAll = () => { setSelectedId(null); setDetail(null) }

  if (loading) return <div className="space-y-4 animate-fade-in"><div className="h-24 skeleton rounded-xl" /><div className="h-48 skeleton rounded-xl" /></div>

  // ── Tầng 2: Chi tiết 1 dự án ──
  if (selectedId) {
    const proj = projects.find((p) => p.id === selectedId)
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={backToAll} className="text-sm px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#f1f5f9', color: '#1d4ed8', border: '1px solid #e2e8f0' }}>
            ← Tổng quan
          </button>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{proj?.projectCode} — {proj?.projectName}</h1>
            {proj?.id !== '__general__' && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>KH: {proj?.clientName}</p>}
          </div>
        </div>
        {detailLoading || !detail ? <div className="h-48 skeleton rounded-xl" /> : <ProjectDetail data={detail} router={router} />}
      </div>
    )
  }

  // ── Tầng 1: Tổng quan tất cả dự án ──
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Tổng quan dự án</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Góc nhìn điều hành — toàn bộ dự án đang chạy</p>
      </div>

      {/* KPI tổng */}
      {agg && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))' }}>
          <KpiCard label="Dự án" value={String(agg.projectCount)} sub="đang hoạt động" color="#0a2540" />
          <KpiCard label="Tiến độ chung" value={`${agg.overallProgress}%`} sub={`${agg.totalCompleted}/${agg.totalTasks} việc xong`} color="#1d4ed8" bar={agg.overallProgress} />
          <KpiCard label="Đang chạy" value={String(agg.totalActive)} sub="công việc active" color="#b45309" />
          <KpiCard label="Quá hạn" value={String(agg.totalOverdue)} sub="cần xử lý" color={agg.totalOverdue > 0 ? '#e63946' : '#059669'} alert={agg.totalOverdue > 0} />
          <KpiCard label="Giá trị HĐ" value={`${billion(agg.totalContractValue)}`} sub="tỷ đồng" color="#059669" />
        </div>
      )}

      {/* Project cards */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
        {projects.map((p) => {
          const isGeneral = p.id === '__general__'
          const accentColor = isGeneral ? '#6d28d9' : '#1d4ed8'
          return (
            <div
              key={p.id}
              onClick={() => openDetail(p.id)}
              className="rounded-xl p-5 cursor-pointer transition-all"
              style={{
                background: 'var(--surface)',
                border: p.overdueTasks > 0 ? '2px solid #fca5a5' : isGeneral ? '2px dashed #c4b5fd' : '1px solid var(--border)',
                boxShadow: p.overdueTasks > 0 ? '0 0 0 1px #fca5a5' : 'none',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = p.overdueTasks > 0 ? '0 0 0 1px #fca5a5' : 'none'; e.currentTarget.style.transform = 'none' }}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-sm" style={{ color: accentColor }}>{p.projectCode}</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.projectName}</div>
                  {!isGeneral && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>KH: {p.clientName}</div>}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold" style={{ color: accentColor }}>{p.progress}%</div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ width: `${p.progress}%`, height: '100%', background: p.progress === 100 ? '#059669' : accentColor, transition: 'width 0.3s' }} />
              </div>

              {/* Stats row */}
              <div className="flex gap-4 text-xs">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tổng: </span>
                  <span className="font-semibold">{p.totalTasks}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Xong: </span>
                  <span className="font-semibold" style={{ color: '#059669' }}>{p.completedTasks}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Active: </span>
                  <span className="font-semibold" style={{ color: accentColor }}>{p.activeTasks}</span>
                </div>
                {p.overdueTasks > 0 && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Quá hạn: </span>
                    <span className="font-bold" style={{ color: '#e63946' }}>{p.overdueTasks}</span>
                  </div>
                )}
              </div>

              {/* Contract + material — hide for general */}
              {!isGeneral && (p.contractValue || p.materialRemaining > 0) && (
                <div className="flex gap-4 text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  {p.contractValue ? <div>HĐ: <b style={{ color: 'var(--text-primary)' }}>{billion(p.contractValue)} tỷ</b></div> : null}
                  {p.materialRemaining > 0 && <div>Còn mua: <b style={{ color: '#b45309' }}>{billion(p.materialRemaining)} tỷ</b></div>}
                </div>
              )}

              <div className="text-xs mt-3 text-right" style={{ color: accentColor }}>Xem chi tiết →</div>
            </div>
          )
        })}
        {projects.length === 0 && (
          <div className="col-span-full text-center py-12 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Chưa có dự án nào
          </div>
        )}
      </div>
    </div>
  )
}

// ── KPI Card component ──
function KpiCard({ label, value, sub, color, bar, alert }: {
  label: string; value: string; sub: string; color: string; bar?: number; alert?: boolean
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: `3px solid ${color}` }}>
      <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-2xl font-extrabold mt-1" style={{ color, animation: alert ? 'pulse 2s infinite' : undefined }}>{value}</div>
      {bar != null && (
        <div style={{ height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
          <div style={{ width: `${bar}%`, height: '100%', background: color }} />
        </div>
      )}
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  )
}

// ── Project Detail (tầng 2, giữ nguyên logic cũ) ──
function ProjectDetail({ data: ov, router }: { data: DetailData; router: ReturnType<typeof useRouter> }) {
  const m = ov.material
  const max = Math.max(m.demand, 1)
  const fbar = (label: string, val: number, color: string, hl = false) => (
    <div className="flex items-center gap-3" style={hl ? { background: '#f8fafc', padding: '6px 8px', borderRadius: 8 } : {}}>
      <span className="text-sm" style={{ width: 220, flexShrink: 0, color: 'var(--text-primary)', fontWeight: hl ? 700 : 400 }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (val / max) * 100)}%`, height: '100%', background: color }} /></div>
      <span className="text-sm font-bold" style={{ width: 70, textAlign: 'right' }}>{billion(val)}</span>
    </div>
  )

  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #1d4ed8' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Tiến độ tổng thể</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color: '#1d4ed8' }}>{ov.progress}%</div>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 6, overflow: 'hidden', marginTop: 6 }}><div style={{ width: `${ov.progress}%`, height: '100%', background: '#1d4ed8' }} /></div>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #0a2540' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Công việc</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color: '#0a2540' }}>{ov.completedTasks}/{ov.totalTasks}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Hoàn thành / tổng</div>
        </div>
        {(ov.project.contractValue || ov.project.id !== '__general__') && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #059669' }}>
            <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Giá trị hợp đồng</div>
            <div className="text-2xl font-extrabold mt-1" style={{ color: '#059669' }}>{ov.project.contractValue ? billion(ov.project.contractValue) : '—'} <span className="text-sm" style={{ color: 'var(--text-muted)' }}>tỷ</span></div>
            {ov.project.id !== '__general__' && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>KH: {ov.project.clientName}</div>}
          </div>
        )}
        {(m.inProjectStock > 0 || ov.project.id !== '__general__') && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #d97706' }}>
            <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Tồn gắn dự án</div>
            <div className="text-2xl font-extrabold mt-1" style={{ color: '#d97706' }}>{billion(m.inProjectStock)} <span className="text-sm" style={{ color: 'var(--text-muted)' }}>tỷ</span></div>
          </div>
        )}
      </div>

      {m.demand > 0 && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="font-semibold mb-1" style={{ color: 'var(--navy,#0a2540)' }}>Vật tư mua sắm (tỷ đồng)</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Từ Budget vật tư: nhu cầu (BOM) → đã đặt (PO) → đã nhận (GRN).</p>
          <div className="space-y-2">
            {fbar('Nhu cầu vật tư (BOM)', m.demand, '#cbd5e1')}
            {fbar('Đã đặt mua (PO)', m.ordered, '#1d4ed8')}
            {fbar('Đã nhận về (GRN)', m.received, '#059669')}
            {fbar('Còn phải mua', m.remaining, '#e63946', true)}
          </div>
        </div>
      )}

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>Tiến độ theo giai đoạn</h3>
        {ov.phases.map((p) => (
          <div key={p.phase} className="flex items-center gap-3 mb-2 text-sm">
            <span style={{ width: 160, flexShrink: 0 }}>{PHASE_NAME[p.phase] || p.phase}</span>
            <div style={{ flex: 1, height: 9, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${p.pct}%`, height: '100%', background: p.pct === 100 ? '#059669' : '#1d4ed8' }} /></div>
            <b style={{ width: 42, textAlign: 'right' }}>{p.pct}%</b>
          </div>
        ))}
        {ov.phases.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có công việc động cho dự án này.</div>}
      </div>

      <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>Công việc theo phòng ban</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
              {['Phòng ban', 'Tổng', 'Đang làm', 'Hoàn thành', 'Quá hạn'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {ov.byDept.map((d) => (
                <tr key={d.deptCode} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-3 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{d.deptName}</td>
                  <td className="px-3 py-2">{d.total}</td>
                  <td className="px-3 py-2" style={{ color: '#1d4ed8', fontWeight: 600 }}>{d.active}</td>
                  <td className="px-3 py-2" style={{ color: '#059669' }}>{d.done}</td>
                  <td className="px-3 py-2" style={{ color: d.overdue > 0 ? '#e63946' : 'var(--text-muted)', fontWeight: d.overdue > 0 ? 700 : 400 }}>{d.overdue}</td>
                </tr>
              ))}
              {ov.byDept.length === 0 && <tr><td colSpan={5} className="text-center py-4" style={{ color: 'var(--text-muted)' }}>Chưa có công việc</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {ov.activeTasks.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>Việc đang chạy ({ov.activeTasks.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                {['Công việc', 'Phòng ban', 'Người làm', 'Trạng thái', 'Hạn'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ov.activeTasks.map((t) => {
                  const st = ST_LABEL[t.status] || ST_LABEL.OPEN
                  return (
                    <tr key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)} className="cursor-pointer hover:bg-blue-50" style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2" style={{ color: '#1d4ed8', fontWeight: 500 }}>{t.title} ↗</td>
                      <td className="px-3 py-2 text-xs">{t.deptName}</td>
                      <td className="px-3 py-2 text-xs">{t.assignee}</td>
                      <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.b, color: st.c }}>{st.l}</span></td>
                      <td className="px-3 py-2 text-xs" style={{ color: t.overdue ? '#e63946' : 'var(--text-muted)', fontWeight: t.overdue ? 700 : 400 }}>{t.deadline ? new Date(t.deadline).toLocaleDateString('vi-VN') : '—'}{t.overdue ? ' (quá hạn)' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ov.allTasks && ov.allTasks.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>Tất cả công việc ({ov.allTasks.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                {['Công việc', 'Phòng ban', 'Người làm', 'Trạng thái', 'Hạn'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ov.allTasks.map((t) => {
                  const st = ST_LABEL[t.status] || ST_LABEL.OPEN
                  return (
                    <tr key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)} className="cursor-pointer hover:bg-blue-50" style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2" style={{ color: '#1d4ed8', fontWeight: 500 }}>{t.title} ↗</td>
                      <td className="px-3 py-2 text-xs">{t.deptName}</td>
                      <td className="px-3 py-2 text-xs">{t.assignee}</td>
                      <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.b, color: st.c }}>{st.l}</span></td>
                      <td className="px-3 py-2 text-xs" style={{ color: t.overdue ? '#e63946' : 'var(--text-muted)', fontWeight: t.overdue ? 700 : 400 }}>{t.deadline ? new Date(t.deadline).toLocaleDateString('vi-VN') : '—'}{t.overdue ? ' (quá hạn)' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
