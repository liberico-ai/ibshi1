'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate, formatNumber } from '@/lib/utils'
import { PageHeader, Button, Badge, KPICard, EmptyState } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { FolderOpen, ClipboardList } from 'lucide-react'

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

const ST_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'default'> = {
  OPEN: 'default', IN_PROGRESS: 'info', AWAITING_REVIEW: 'warning', RETURNED: 'danger', DONE: 'success',
}
const ST_LABEL: Record<string, string> = {
  OPEN: 'Mới', IN_PROGRESS: 'Đang xử lý', AWAITING_REVIEW: 'Chờ kết thúc', RETURNED: 'Bị trả lại', DONE: 'Hoàn thành',
}
const billion = (n: number) => formatNumber(n / 1e9)
const PHASE_NAME: Record<string, string> = { P1: 'Khởi tạo', P2: 'Thiết kế & dự toán', P3: 'Cung ứng', P4: 'Mua & nhập kho', P5: 'Sản xuất', P6: 'Đóng dự án', Khác: 'Khác' }

export default function WorkOverviewPage() {
  const router = useRouter()
  const [agg, setAgg] = useState<Aggregate | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  function loadOverview() {
    setLoading(true)
    setError('')
    apiFetch('/api/work/project-overview').then((r) => {
      if (r.ok) {
        setAgg(r.aggregate)
        const sorted = (r.projects as ProjectSummary[]).sort((a, b) => b.overdueTasks - a.overdueTasks || b.activeTasks - a.activeTasks)
        setProjects(sorted)
      } else {
        setAgg(null)
        setProjects([])
        setError(r.error || 'Không tải được tổng quan dự án')
      }
      setLoading(false)
    })
  }

  useEffect(() => { loadOverview() }, [])

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

  if (error) return (
    <EmptyState title={error} action={<Button variant="outline" onClick={loadOverview}>Thử lại</Button>} />
  )

  if (selectedId) {
    const proj = projects.find((p) => p.id === selectedId)
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={backToAll}>← Tổng quan</Button>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{proj?.projectCode} — {proj?.projectName}</h1>
            {proj?.id !== '__general__' && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>KH: {proj?.clientName}</p>}
          </div>
        </div>
        {detailLoading || !detail ? <div className="h-48 skeleton rounded-xl" /> : <ProjectDetail data={detail} router={router} />}
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Tổng quan dự án" subtitle="Góc nhìn điều hành — toàn bộ dự án đang chạy" />

      {agg && (
        <div className="grid gap-3 stagger-children" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))' }}>
          <KPICard label="Dự án" value={agg.projectCount} accentColor="var(--ibs-navy)" />
          <KPICard label="Tiến độ chung" value={`${agg.overallProgress}%`} accentColor={SEMANTIC_COLORS.info.solid} />
          <KPICard label="Đang chạy" value={agg.totalActive} accentColor={SEMANTIC_COLORS.warning.solid} />
          <KPICard label="Quá hạn" value={agg.totalOverdue} accentColor={agg.totalOverdue > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
          <KPICard label="Giá trị HĐ" value={agg.totalContractValue ? `${billion(agg.totalContractValue)} tỷ` : '—'} accentColor={SEMANTIC_COLORS.success.solid} />
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
        {projects.map((p) => {
          const isGeneral = p.id === '__general__'
          const accentColor = isGeneral ? '#6d28d9' : SEMANTIC_COLORS.info.solid
          return (
            <div key={p.id} onClick={() => openDetail(p.id)}
              className="glass-card p-5 cursor-pointer hover:shadow-md transition-all"
              style={{
                border: p.overdueTasks > 0 ? `2px solid ${SEMANTIC_COLORS.danger.bg}` : isGeneral ? '2px dashed #c4b5fd' : undefined,
              }}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-sm" style={{ color: accentColor }}>{p.projectCode}</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.projectName}</div>
                  {!isGeneral && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>KH: {p.clientName}</div>}
                </div>
                <div className="text-2xl font-extrabold" style={{ color: accentColor }}>{p.progress}%</div>
              </div>

              <div className="progress-bar mb-3">
                <div className="progress-bar-fill" style={{ width: `${p.progress}%`, background: p.progress === 100 ? SEMANTIC_COLORS.success.solid : accentColor }} />
              </div>

              <div className="flex gap-4 text-xs">
                <span style={{ color: 'var(--text-muted)' }}>Tổng: <b>{p.totalTasks}</b></span>
                <span style={{ color: SEMANTIC_COLORS.success.solid }}>Xong: <b>{p.completedTasks}</b></span>
                <span style={{ color: accentColor }}>Active: <b>{p.activeTasks}</b></span>
                {p.overdueTasks > 0 && <span style={{ color: SEMANTIC_COLORS.danger.solid }}>Quá hạn: <b>{p.overdueTasks}</b></span>}
              </div>

              {!isGeneral && (p.contractValue || p.materialRemaining > 0) && (
                <div className="flex gap-4 text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  {p.contractValue ? <div>HĐ: <b style={{ color: 'var(--text-primary)' }}>{billion(p.contractValue)} tỷ</b></div> : null}
                  {p.materialRemaining > 0 && <div>Còn mua: <b style={{ color: SEMANTIC_COLORS.warning.solid }}>{billion(p.materialRemaining)} tỷ</b></div>}
                </div>
              )}

              <div className="text-xs mt-3 text-right font-semibold" style={{ color: accentColor }}>Xem chi tiết →</div>
            </div>
          )
        })}
        {projects.length === 0 && (
          <div className="col-span-full">
            <EmptyState icon={<FolderOpen />} title="Chưa có dự án nào" />
          </div>
        )}
      </div>
    </div>
  )
}

type TaskFilter = { label: string; fn: (t: ActiveTask) => boolean } | null

function ProjectDetail({ data: ov, router }: { data: DetailData; router: ReturnType<typeof useRouter> }) {
  const [filter, setFilter] = useState<TaskFilter>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const m = ov.material
  const max = Math.max(m.demand, 1)
  const fbar = (label: string, val: number, color: string, hl = false) => (
    <div className="flex items-center gap-3" style={hl ? { background: 'var(--surface-alt, #f8fafc)', padding: '6px 8px', borderRadius: 8 } : {}}>
      <span className="text-sm" style={{ width: 220, flexShrink: 0, color: 'var(--text-primary)', fontWeight: hl ? 700 : 400 }}>{label}</span>
      <div className="progress-bar flex-1"><div className="progress-bar-fill" style={{ width: `${Math.min(100, (val / max) * 100)}%`, background: color }} /></div>
      <span className="text-sm font-bold" style={{ width: 70, textAlign: 'right' }}>{billion(val)}</span>
    </div>
  )

  const applyFilter = (f: TaskFilter) => {
    setFilter((prev) => prev?.label === f?.label ? null : f)
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const allTasks = ov.allTasks || []
  const shown = filter ? allTasks.filter(filter.fn) : allTasks

  return (
    <>
      <div className="grid gap-3 stagger-children" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <KPICard label="Tiến độ tổng thể" value={`${ov.progress}%`} accentColor={SEMANTIC_COLORS.info.solid} />
        <div className="glass-card p-4 cursor-pointer" onClick={() => applyFilter({ label: 'all', fn: () => true })}
          style={{ borderColor: filter?.label === 'all' ? 'var(--ibs-navy)' : undefined, borderWidth: filter?.label === 'all' ? 2 : undefined }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Công việc</div>
          <div className="text-2xl font-extrabold mt-1">
            <span className="cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); applyFilter({ label: 'done', fn: (t) => t.status === 'DONE' }) }} style={{ color: SEMANTIC_COLORS.success.solid }}>{ov.completedTasks}</span>
            <span style={{ color: 'var(--text-primary)' }}>/{ov.totalTasks}</span>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Hoàn thành / tổng</div>
        </div>
        {(ov.project.contractValue || ov.project.id !== '__general__') && (
          <KPICard label="Giá trị hợp đồng" value={ov.project.contractValue ? `${billion(ov.project.contractValue)} tỷ` : '—'} accentColor={SEMANTIC_COLORS.success.solid} />
        )}
        {(m.inProjectStock > 0 || ov.project.id !== '__general__') && (
          <KPICard label="Tồn gắn dự án" value={`${billion(m.inProjectStock)} tỷ`} accentColor={SEMANTIC_COLORS.warning.solid} />
        )}
      </div>

      {m.demand > 0 && (
        <div className="glass-card p-5">
          <h3 className="font-semibold mb-1" style={{ color: 'var(--text-heading)' }}>Vật tư mua sắm (tỷ đồng)</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Từ Budget vật tư: nhu cầu (BOM) → đã đặt (PO) → đã nhận (GRN).</p>
          <div className="space-y-2">
            {fbar('Nhu cầu vật tư (BOM)', m.demand, '#cbd5e1')}
            {fbar('Đã đặt mua (PO)', m.ordered, SEMANTIC_COLORS.info.solid)}
            {fbar('Đã nhận về (GRN)', m.received, SEMANTIC_COLORS.success.solid)}
            {fbar('Còn phải mua', m.remaining, SEMANTIC_COLORS.danger.solid, true)}
          </div>
        </div>
      )}

      <div className="glass-card p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-heading)' }}>Tiến độ theo giai đoạn</h3>
        {ov.phases.map((p) => (
          <div key={p.phase} className="flex items-center gap-3 mb-2 text-sm">
            <span style={{ width: 160, flexShrink: 0 }}>{PHASE_NAME[p.phase] || p.phase}</span>
            <div className="progress-bar flex-1"><div className="progress-bar-fill" style={{ width: `${p.pct}%`, background: p.pct === 100 ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.info.solid }} /></div>
            <b style={{ width: 42, textAlign: 'right' }}>{p.pct}%</b>
          </div>
        ))}
        {ov.phases.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có công việc động cho dự án này.</div>}
      </div>

      <div className="glass-card p-5">
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text-heading)' }}>Công việc theo phòng ban</h3>
        <div className="dt-wrapper">
          <table className="data-table">
            <thead><tr>
              {['Phòng ban', 'Tổng', 'Đang làm', 'Hoàn thành', 'Quá hạn'].map((h) => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {ov.byDept.map((d) => (
                <tr key={d.deptCode}>
                  <td className="font-semibold cursor-pointer hover:underline" onClick={() => applyFilter({ label: `dept-${d.deptCode}`, fn: (t) => t.deptName === d.deptName })}>{d.deptName}</td>
                  <td className="cursor-pointer hover:underline" onClick={() => applyFilter({ label: `dept-${d.deptCode}`, fn: (t) => t.deptName === d.deptName })}>{d.total}</td>
                  <td className="cursor-pointer hover:underline" style={{ color: SEMANTIC_COLORS.info.solid, fontWeight: 600 }} onClick={() => applyFilter({ label: `dept-active-${d.deptCode}`, fn: (t) => t.deptName === d.deptName && t.status !== 'DONE' })}>{d.active}</td>
                  <td className="cursor-pointer hover:underline" style={{ color: SEMANTIC_COLORS.success.solid }} onClick={() => applyFilter({ label: `dept-done-${d.deptCode}`, fn: (t) => t.deptName === d.deptName && t.status === 'DONE' })}>{d.done}</td>
                  <td className="cursor-pointer hover:underline" style={{ color: d.overdue > 0 ? SEMANTIC_COLORS.danger.solid : 'var(--text-muted)', fontWeight: d.overdue > 0 ? 700 : 400 }} onClick={() => applyFilter({ label: `dept-overdue-${d.deptCode}`, fn: (t) => t.deptName === d.deptName && t.overdue })}>{d.overdue}</td>
                </tr>
              ))}
              {ov.byDept.length === 0 && <tr><td colSpan={5}><EmptyState icon={<FolderOpen />} title="Chưa có công việc" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div ref={tableRef} className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold" style={{ color: 'var(--text-heading)' }}>
            {filter ? `Công việc lọc (${shown.length})` : `Tất cả công việc (${allTasks.length})`}
          </h3>
          {filter && <Button variant="outline" size="sm" onClick={() => setFilter(null)}>Bỏ lọc</Button>}
        </div>
        <div className="dt-wrapper">
          <table className="data-table">
            <thead><tr>
              {['Công việc', 'Phòng ban', 'Người làm', 'Trạng thái', 'Hạn'].map((h) => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)} className="cursor-pointer">
                  <td style={{ color: SEMANTIC_COLORS.info.solid, fontWeight: 500 }}>{t.title}</td>
                  <td className="text-xs">{t.deptName}</td>
                  <td className="text-xs">{t.assignee}</td>
                  <td><Badge variant={ST_VARIANT[t.status] || 'default'}>{ST_LABEL[t.status] || t.status}</Badge></td>
                  <td className="text-xs" style={{ color: t.overdue ? SEMANTIC_COLORS.danger.solid : 'var(--text-muted)', fontWeight: t.overdue ? 700 : 400 }}>{t.deadline ? formatDate(t.deadline) : '—'}{t.overdue ? ' (quá hạn)' : ''}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={5}><EmptyState icon={<ClipboardList />} title="Không có công việc" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
