'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SearchBar } from '@/components/SearchPagination'
import {
  PageHeader, Button, FilterBar, StatusBadge,
  EmptyState, KPICard, Modal, InputField, SelectField, TextareaField,
  Pagination,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Factory } from 'lucide-react'

interface WorkOrder {
  id: string; woCode: string; projectId: string; description: string;
  teamCode: string; status: string; pieceMark: string | null;
  plannedWeight: number | null; completedQty: number | null;
  departmentId: string | null;
  department: { code: string; name: string } | null;
  project: { projectCode: string; projectName: string } | null;
  plannedStart: string | null; plannedEnd: string | null;
  actualStart: string | null; actualEnd: string | null;
  materialIssueCount: number; createdAt: string;
}

interface TeamLoad {
  id: string; code: string; name: string;
  totalWO: number; activeWO: number;
  plannedTons: number; completedTons: number; earnedTons: number;
  progressPct: number; earnedPct: number;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

interface ProgressData {
  summary: {
    totalTons: number; completedTons: number; earnedTons: number;
    tonsPct: number; earnedPct: number;
    totalPieceMarks: number; completedPieceMarks: number; earnedPieceMarks: number; pieceMarkPct: number;
  }
  stages: Array<{ stage: string; weight: number; totalCards: number; completedCards: number; totalQty: number; pct: number }>
  workOrderCount: number
}

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'OPEN', label: 'Chờ' },
  { value: 'IN_PROGRESS', label: 'Đang chạy' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
  { value: 'CANCELLED', label: 'Đã hủy' },
]

const STAGE_LABELS: Record<string, string> = {
  cutting: 'Cắt', assembly: 'Tổ hợp', welding: 'Hàn', painting: 'Sơn', inspection: 'Nghiệm thu',
}
const STAGE_COLORS = ['#6366f1', '#3b82f6', '#f59e0b', '#10b981', '#ef4444']

export default function ProductionPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [teams, setTeams] = useState<TeamLoad[]>([])
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showFromBom, setShowFromBom] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const canCreate = ['R01', 'R06', 'R06b'].includes(user?.roleCode || '')
  const canGenerateFromBom = ['R01', 'R02', 'R06'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const [woRes, teamRes, progRes] = await Promise.all([
      apiFetch(`/api/production?${params}`),
      apiFetch('/api/production/teams'),
      apiFetch('/api/production/progress'),
    ])
    if (woRes.ok) { setWorkOrders(woRes.workOrders); setPagination(woRes.pagination) }
    if (teamRes.ok) setTeams(teamRes.teams)
    if (progRes.ok) setProgress(progRes)
    setLoading(false)
  }, [statusFilter, search, page])

  const openCreate = async () => {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects)
    setShowCreate(true)
  }

  const openFromBom = async () => {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects)
    setShowFromBom(true)
  }

  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Sản xuất"
        subtitle={`${pagination.total} lệnh sản xuất`}
        actions={(canCreate || canGenerateFromBom) ? (
          <div className="flex gap-2">
            {canGenerateFromBom && <Button variant="outline" onClick={openFromBom}>Sinh WO từ BOM</Button>}
            {canCreate && <Button variant="primary" onClick={openCreate}>+ Tạo WO</Button>}
          </div>
        ) : undefined}
      />

      {/* Progress summary */}
      {progress && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
          <KPICard label="Tổng tấn" value={`${progress.summary.totalTons}t`} accentColor={SEMANTIC_COLORS.info.solid} />
          <KPICard label="SX báo" value={`${progress.summary.completedTons}t (${progress.summary.tonsPct}%)`} accentColor={SEMANTIC_COLORS.warning.solid} />
          <KPICard label="QC đạt (earned)" value={`${progress.summary.earnedTons}t (${progress.summary.earnedPct}%)`} accentColor={SEMANTIC_COLORS.success.solid} />
          <KPICard label="Piece-mark" value={`${progress.summary.earnedPieceMarks}/${progress.summary.totalPieceMarks}`} accentColor="var(--accent)" />
        </div>
      )}

      {/* 5-stage progress bar */}
      {progress && progress.stages.some(s => s.totalCards > 0) && (
        <div className="card p-4">
          <label className="input-label mb-3">Tiến độ 5 công đoạn</label>
          <div className="flex gap-1 items-end h-16">
            {progress.stages.map((s, i) => (
              <div key={s.stage} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold" style={{ color: STAGE_COLORS[i] }}>{s.pct}%</span>
                <div className="w-full rounded-t" style={{ height: `${Math.max(s.pct * 0.5, 4)}px`, background: STAGE_COLORS[i], transition: 'height 0.3s' }} />
                <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{STAGE_LABELS[s.stage]} ({Math.round(s.weight * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team load cards */}
      {teams.length > 0 && (
        <div>
          <label className="input-label mb-2">Tải theo tổ</label>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {teams.map(t => (
              <div key={t.id} className="card p-3 text-center" style={{ borderTop: `3px solid ${t.activeWO > 0 ? SEMANTIC_COLORS.info.solid : 'var(--border-light)'}` }}>
                <p className="text-xs font-bold font-mono" style={{ color: 'var(--accent)' }}>{t.code}</p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{t.name}</p>
                <p className="text-lg font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{t.activeWO}<span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>/{t.totalWO} WO</span></p>
                <div className="w-full h-1.5 rounded-full mt-1" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full" style={{ width: `${t.progressPct}%`, background: SEMANTIC_COLORS.success.solid, transition: 'width 0.3s' }} />
                </div>
                <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.completedTons}/{t.plannedTons}t</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <FilterBar
        filters={STATUS_FILTERS}
        value={statusFilter}
        onChange={setStatusFilter}
        actions={<div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã WO, piece-mark..." /></div>}
      />

      {/* WO table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã WO</th>
              <th>Piece-mark</th>
              <th>Mô tả</th>
              <th>Tổ SX</th>
              <th>Dự án</th>
              <th>Trọng lượng</th>
              <th>Trạng thái</th>
              <th>Ngày</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon={<Factory />} title="Chưa có WO" /></td></tr>
            ) : workOrders.map(wo => {
              const weightPct = wo.plannedWeight && wo.completedQty ? Math.round((wo.completedQty / wo.plannedWeight) * 100) : 0
              return (
                <tr key={wo.id} className="cursor-pointer hover:bg-[var(--bg-hover)]" onClick={() => router.push(`/dashboard/production/${wo.id}`)}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{wo.woCode}</span></td>
                  <td>{wo.pieceMark ? <span className="font-mono text-xs">{wo.pieceMark}</span> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td className="text-xs max-w-[200px] truncate">{wo.description}</td>
                  <td>
                    <span className="text-xs font-mono">{wo.department?.code || wo.teamCode}</span>
                    {wo.department && <span className="text-[10px] block" style={{ color: 'var(--text-muted)' }}>{wo.department.name}</span>}
                  </td>
                  <td className="text-xs font-mono">{wo.project?.projectCode || '—'}</td>
                  <td>
                    {wo.plannedWeight ? (
                      <div className="text-xs">
                        <span className="font-mono">{wo.completedQty || 0}/{wo.plannedWeight} kg</span>
                        <div className="w-16 h-1.5 rounded-full mt-0.5" style={{ background: 'var(--border-light)' }}>
                          <div className="h-full rounded-full" style={{ width: `${weightPct}%`, background: SEMANTIC_COLORS.success.solid }} />
                        </div>
                      </div>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td><StatusBadge category="production" status={wo.status} /></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(wo.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={setPage} />

      <CreateWOModal
        open={showCreate}
        projects={projects}
        teams={teams}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadData() }}
      />

      <GenerateFromBomModal
        open={showFromBom}
        projects={projects}
        onClose={() => setShowFromBom(false)}
        onDone={() => { setShowFromBom(false); loadData() }}
      />
    </div>
  )
}

function GenerateFromBomModal({ open, projects, onClose, onDone }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onDone: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!projectId) return alert('Chọn dự án')
    setSubmitting(true)
    const res = await apiFetch('/api/production/work-orders/from-bom', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    })
    setSubmitting(false)
    if (res.ok) {
      alert(res.message || `Đã tạo ${res.created} WO, bỏ qua ${res.skipped}`)
      onDone()
    } else {
      alert(res.error || 'Lỗi sinh WO từ BOM')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Sinh WO từ BOM">
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Tạo lệnh sản xuất cho từng piece-mark trong BOM version đã duyệt (ACTIVE) mới nhất của dự án.
          Piece-mark đã có WO sẽ được bỏ qua — bấm lại không tạo trùng.
        </p>
        <SelectField label="Dự án *" value={projectId} onChange={e => setProjectId(e.target.value)}
          options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Sinh WO</Button>
      </div>
    </Modal>
  )
}

function CreateWOModal({ open, projects, teams, onClose, onCreated }: {
  open: boolean; projects: ProjectOption[]; teams: TeamLoad[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    woCode: '', projectId: '', description: '', teamCode: '',
    plannedStart: '', plannedEnd: '', pieceMark: '', plannedWeight: '',
    departmentId: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.woCode || !form.projectId || !form.description || !form.teamCode) return alert('Nhập đầy đủ')
    setSubmitting(true)
    const res = await apiFetch('/api/production', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        plannedWeight: form.plannedWeight ? Number(form.plannedWeight) : undefined,
        departmentId: form.departmentId || undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo lệnh sản xuất" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <InputField label="Mã WO *" value={form.woCode} onChange={e => update('woCode', e.target.value)} placeholder="WO-2026-001" />
          <SelectField label="Dự án *" value={form.projectId} onChange={e => update('projectId', e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
          <InputField label="Tổ SX *" value={form.teamCode} onChange={e => update('teamCode', e.target.value)} placeholder="TO-HAN1" />
        </div>
        <TextareaField label="Mô tả *" rows={2} value={form.description} onChange={e => update('description', e.target.value)} />
        <div className="grid grid-cols-4 gap-3">
          <InputField label="Piece-mark" value={form.pieceMark} onChange={e => update('pieceMark', e.target.value)} placeholder="C1, B2..." />
          <InputField label="Trọng lượng (kg)" type="number" value={form.plannedWeight} onChange={e => update('plannedWeight', e.target.value)} />
          <SelectField label="Phân về tổ" value={form.departmentId} onChange={e => update('departmentId', e.target.value)}
            options={[{ value: '', label: 'Không chọn' }, ...teams.map(t => ({ value: t.id, label: `${t.code} — ${t.name}` }))]} />
          <InputField label="Ngày BĐ" type="date" value={form.plannedStart} onChange={e => update('plannedStart', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Tạo WO</Button>
      </div>
    </Modal>
  )
}
