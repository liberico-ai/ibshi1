'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'
import { SearchBar } from '@/components/SearchPagination'
import {
  PageHeader, Button, FilterBar, StatusBadge,
  EmptyState, KPICard, Modal, InputField, SelectField, TextareaField,
  Pagination,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Factory, Pencil } from 'lucide-react'
import { notify } from '@/components/ui/Toast'
import SidebarStepLanding from '@/components/SidebarStepLanding'
import WoFromWbsModal from './WoFromWbsModal'
import WoMaterialRequestModal from './WoMaterialRequestModal'

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
  const [showFromWbs, setShowFromWbs] = useState(false)
  const [editWO, setEditWO] = useState<WorkOrder | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filterProjectId, setFilterProjectId] = useState('')

  // Tạo LSX: chỉ PM (R02) + BGĐ (R01) — QLSX/Tổ trưởng không còn tạo
  const canCreate = ['R01', 'R02'].includes(user?.roleCode || '')
  const canGenerateFromBom = ['R01', 'R02'].includes(user?.roleCode || '')
  // Đề nghị cấp vật tư là việc của XƯỞNG (PM chỉ phát hành WO) — khớp WO_MATERIAL_REQUEST_ROLES ở server
  const canRequestMaterial = ['R06', 'R06a', 'R06b'].includes(user?.roleCode || '')

  const [selected, setSelected] = useState<string[]>([])
  const [matWoIds, setMatWoIds] = useState<string[] | null>(null)
  // Máy chủ giới hạn danh sách theo xưởng của tài khoản (R06/R06a/R06b) — hiện lại cho người dùng biết
  const [scope, setScope] = useState<{ departmentId: string; code: string; name: string } | null>(null)
  const [scopeMissing, setScopeMissing] = useState(false)
  // Đặt vật tư được khi: lệnh chưa hoàn thành/hủy VÀ thuộc một xưởng nội bộ.
  // Lệnh giao thầu phụ làm ngoài (không gắn xưởng) vẫn hiện để theo dõi, nhưng chưa mở đề nghị
  // vật tư — chờ chốt hướng riêng.
  const isSubcontract = (wo: WorkOrder) => !wo.departmentId
  const canSelect = (wo: WorkOrder) => !['COMPLETED', 'CANCELLED'].includes(wo.status) && !isSubcontract(wo)
  const matHint = (wo: WorkOrder) =>
    isSubcontract(wo) ? 'Lệnh thầu phụ — chưa mở đề nghị vật tư'
      : ['COMPLETED', 'CANCELLED'].includes(wo.status) ? 'Lệnh đã hoàn thành/hủy'
        : 'Đề nghị cấp vật tư cho lệnh này'
  const selectable = workOrders.filter(canSelect)
  // Gợi ý BOM/PR lấy theo dự án ⟹ chỉ gộp được các lệnh cùng một dự án
  const selectedWos = workOrders.filter(w => selected.includes(w.id))
  const multiProject = new Set(selectedWos.map(w => w.project?.projectCode)).size > 1

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    if (filterProjectId) params.set('projectId', filterProjectId)
    params.set('page', String(page))
    const projQs = filterProjectId ? `?projectId=${filterProjectId}` : ''
    const [woRes, teamRes, progRes] = await Promise.all([
      apiFetch(`/api/production?${params}`),
      apiFetch(`/api/production/teams${projQs}`),
      apiFetch(`/api/production/progress${projQs}`),
    ])
    if (woRes.ok) {
      setWorkOrders(woRes.workOrders); setPagination(woRes.pagination)
      setScope(woRes.scope || null); setScopeMissing(!!woRes.scopeMissing)
    }
    if (teamRes.ok) setTeams(teamRes.teams)
    if (progRes.ok) setProgress(progRes)
    setLoading(false)
  }, [statusFilter, search, page, filterProjectId])

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

  const openFromWbs = async () => {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects)
    setShowFromWbs(true)
  }

  useEffect(() => { setPage(1) }, [search, statusFilter, filterProjectId])
  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    apiFetch('/api/projects').then(r => {
      if (r.ok) setProjects(r.projects || [])
      // Mở từ thông báo bước quy trình (?project=…&step=P3.4) → chọn sẵn dự án để vùng làm việc
      // LSX hiện ra ngay, khỏi phải chọn lại trong dropdown.
      const p = new URLSearchParams(window.location.search).get('project')
      if (p) setFilterProjectId(p)
    })
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <SidebarStepLanding heading="Bước quy trình — Sản xuất" steps={[
        { code: 'P3.3', title: 'Lập lệnh SX thầu phụ + đề nghị cấp VT', noTemplate: true },
        { code: 'P3.4', title: 'Lập lệnh sản xuất nội bộ & thầu phụ', noTemplate: true },
        { code: 'P5.1', title: 'Báo cáo khối lượng nội bộ theo ngày', noTemplate: true },
        { code: 'P5.1A', title: 'Báo cáo khối lượng thầu phụ theo ngày', noTemplate: true },
        { code: 'P5.2', title: 'Báo cáo khối lượng hoàn thành theo tuần', noTemplate: true },
      ]} />
      <PageHeader
        title="Quản lý Sản xuất"
        subtitle={`${pagination.total} lệnh sản xuất`}
        actions={(canCreate || canGenerateFromBom) ? (
          <div className="flex gap-2">
            {canGenerateFromBom && <Button variant="outline" onClick={openFromWbs}>Tạo WO từ WBS</Button>}
            {canGenerateFromBom && <Button variant="outline" onClick={openFromBom}>Sinh WO từ BOM</Button>}
            {canCreate && <Button variant="primary" onClick={openCreate}>+ Tạo WO</Button>}
          </div>
        ) : undefined}
      />

      {scope && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          Đang xem lệnh sản xuất của <b>{scope.name} ({scope.code})</b>, kèm lệnh giao thầu phụ làm ngoài — lệnh thầu phụ chỉ để theo dõi, chưa mở đề nghị vật tư.
        </div>
      )}
      {scopeMissing && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          Tài khoản của bạn chưa được gán xưởng nên chỉ thấy lệnh thầu phụ. Báo quản trị gán phòng/xưởng cho tài khoản để thấy lệnh của xưởng mình.
        </div>
      )}

      {/* Lọc theo dự án — áp cho KPI, thẻ xưởng và danh sách WO */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Lọc theo dự án:</label>
        <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 360 }}>
          <option value="">— Tất cả dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {filterProjectId && <button onClick={() => setFilterProjectId('')} className="text-xs px-2 py-1 rounded" style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>✕ Bỏ lọc</button>}
      </div>

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
          <label className="input-label mb-2">Tải theo xưởng</label>
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

      {/* Thanh thao tác khi chọn nhiều lệnh — lập đề nghị vật tư chung một lượt */}
      {canRequestMaterial && selected.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl px-4 py-3"
          style={{ border: '1px solid #8b5cf640', background: '#f5f3ff' }}>
          <span className="text-sm font-semibold" style={{ color: '#6d28d9' }}>Đã chọn {selected.length} lệnh</span>
          {multiProject && <span className="text-xs" style={{ color: '#b45309' }}>Chọn lẫn nhiều dự án — chỉ gộp được các lệnh cùng một dự án</span>}
          <div className="flex-1" />
          <button onClick={() => setSelected([])} className="text-xs px-3 py-1.5 rounded-lg"
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Bỏ chọn</button>
          <Button variant="primary" disabled={multiProject} onClick={() => setMatWoIds(selected)}>
            Đề nghị cấp vật tư ({selected.length} lệnh)
          </Button>
        </div>
      )}

      {/* WO table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {canRequestMaterial && (
                <th style={{ width: 32 }}>
                  <input type="checkbox" title="Chọn tất cả lệnh đang hiện"
                    checked={selectable.length > 0 && selected.length === selectable.length}
                    onChange={e => setSelected(e.target.checked ? selectable.map(w => w.id) : [])} />
                </th>
              )}
              <th>Mã WO</th>
              <th>Piece-mark</th>
              <th>Mô tả</th>
              <th>Xưởng</th>
              <th>Dự án</th>
              <th>Trọng lượng</th>
              <th>Trạng thái</th>
              <th>Ngày</th>
              {canRequestMaterial && <th className="text-center">Vật tư</th>}
              {canCreate && <th className="text-center">Sửa</th>}
            </tr>
          </thead>
          <tbody>
            {workOrders.length === 0 ? (
              <tr><td colSpan={11}><EmptyState icon={<Factory />} title="Chưa có WO" /></td></tr>
            ) : workOrders.map(wo => {
              const weightPct = wo.plannedWeight && wo.completedQty ? Math.round((wo.completedQty / wo.plannedWeight) * 100) : 0
              return (
                <tr key={wo.id} className="cursor-pointer hover:bg-[var(--bg-hover)]" onClick={() => router.push(`/dashboard/production/${wo.id}`)}>
                  {canRequestMaterial && (
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" disabled={!canSelect(wo)} checked={selected.includes(wo.id)}
                        title={canSelect(wo) ? 'Chọn để lập đề nghị vật tư chung' : matHint(wo)}
                        onChange={e => setSelected(s => (e.target.checked ? [...s, wo.id] : s.filter(x => x !== wo.id)))} />
                    </td>
                  )}
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
                  {canRequestMaterial && (
                    <td className="text-center" onClick={e => e.stopPropagation()}>
                      <button type="button" disabled={!canSelect(wo)} onClick={() => setMatWoIds([wo.id])}
                        title={matHint(wo)}
                        className="text-[11px] px-2 py-1 rounded font-semibold"
                        style={{ border: '1px solid #8b5cf6', background: '#f5f3ff', color: '#6d28d9', opacity: canSelect(wo) ? 1 : 0.4, cursor: canSelect(wo) ? 'pointer' : 'not-allowed' }}>
                        {isSubcontract(wo) ? 'Thầu phụ' : 'Vật tư'}
                      </button>
                    </td>
                  )}
                  {canCreate && (
                    <td className="text-center" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setEditWO(wo)} title="Sửa WO" className="p-1.5 rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }}><Pencil className="w-3.5 h-3.5" /></button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={setPage} />

      {matWoIds && (
        <WoMaterialRequestModal
          woIds={matWoIds}
          onClose={() => setMatWoIds(null)}
          onSaved={() => { setSelected([]); loadData() }}
        />
      )}

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

      <WoFromWbsModal
        open={showFromWbs}
        projects={projects}
        onClose={() => setShowFromWbs(false)}
        onIssued={loadData}
      />

      {editWO && <EditWOModal wo={editWO} teams={teams} onClose={() => setEditWO(null)} onSaved={() => { setEditWO(null); loadData() }} />}
    </div>
  )
}

// ── Modal sửa thông tin WO (mô tả/xưởng/trọng lượng/ngày kế hoạch) ──
function EditWOModal({ wo, teams, onClose, onSaved }: { wo: WorkOrder; teams: TeamLoad[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    description: wo.description || '', teamCode: wo.teamCode || '',
    plannedWeight: wo.plannedWeight != null ? String(wo.plannedWeight) : '',
    plannedStart: wo.plannedStart ? wo.plannedStart.slice(0, 10) : '', plannedEnd: wo.plannedEnd ? wo.plannedEnd.slice(0, 10) : '',
  })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))

  const submit = async () => {
    if (!form.description.trim() || !form.teamCode) return notify('Nhập mô tả và xưởng')
    if (form.plannedStart && form.plannedEnd && form.plannedEnd < form.plannedStart) return notify('Ngày kết thúc phải sau ngày bắt đầu')
    setSubmitting(true)
    const res = await apiFetch(`/api/production/${wo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        description: form.description.trim(), teamCode: form.teamCode,
        plannedWeight: form.plannedWeight ? Number(form.plannedWeight) : undefined,
        plannedStart: form.plannedStart || '', plannedEnd: form.plannedEnd || '',
      }),
    })
    setSubmitting(false)
    if (res.ok) { notify(res.message || 'Đã cập nhật WO', 'success'); onSaved() } else notify(res.error || 'Lỗi cập nhật')
  }

  return (
    <Modal open onClose={onClose} title={`Sửa WO ${wo.woCode}`} size="md">
      <div className="space-y-3">
        <TextareaField label="Mô tả *" rows={2} value={form.description} onChange={e => update('description', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Xưởng *" value={form.teamCode}
            onChange={e => update('teamCode', e.target.value)}
            options={[{ value: '', label: 'Chọn xưởng...' }, ...PRODUCTION_WORKSHOPS.map(w => ({ value: w.code, label: `${w.code} — ${w.name}` })), ...(teams.some(t => t.code === form.teamCode) || PRODUCTION_WORKSHOPS.some(w => w.code === form.teamCode) ? [] : [{ value: form.teamCode, label: form.teamCode }])]} />
          <InputField label="Trọng lượng (kg)" type="number" value={form.plannedWeight} onChange={e => update('plannedWeight', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Ngày BĐ" type="date" value={form.plannedStart} onChange={e => update('plannedStart', e.target.value)} />
          <InputField label="Ngày KT" type="date" value={form.plannedEnd} min={form.plannedStart || undefined} onChange={e => update('plannedEnd', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Lưu</Button>
      </div>
    </Modal>
  )
}

function GenerateFromBomModal({ open, projects, onClose, onDone }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onDone: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!projectId) return notify('Chọn dự án')
    setSubmitting(true)
    const res = await apiFetch('/api/production/work-orders/from-bom', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    })
    setSubmitting(false)
    if (res.ok) {
      notify(res.message || `Đã tạo ${res.created} WO, bỏ qua ${res.skipped}`)
      onDone()
    } else {
      notify(res.error || 'Lỗi sinh WO từ BOM')
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
    if (!form.woCode || !form.projectId || !form.description || !form.teamCode) return notify('Nhập đầy đủ')
    if (form.plannedStart && form.plannedEnd && form.plannedEnd < form.plannedStart) return notify('Ngày kết thúc phải sau ngày bắt đầu')
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
    else notify(res.error || 'Lỗi')
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo lệnh sản xuất" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <InputField label="Mã WO *" value={form.woCode} onChange={e => update('woCode', e.target.value)} placeholder="WO-2026-001" />
          <SelectField label="Dự án *" value={form.projectId} onChange={e => update('projectId', e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
          {/* Danh sách Xưởng LUÔN từ hằng số PRODUCTION_WORKSHOPS (5 xưởng) — không phụ thuộc DB đã
              migrate tạo phòng xưởng hay chưa. Nếu teams (từ /production/teams) có id thì gắn kèm
              departmentId cho FK; chưa có thì để trống, server tự tra theo teamCode. */}
          <SelectField label="Xưởng *" value={form.teamCode}
            onChange={e => { const code = e.target.value; const x = teams.find(t => t.code === code); setForm(f => ({ ...f, teamCode: code, departmentId: x?.id || '' })) }}
            options={[{ value: '', label: 'Chọn xưởng...' }, ...PRODUCTION_WORKSHOPS.map(w => ({ value: w.code, label: `${w.code} — ${w.name}` }))]} />
        </div>
        <TextareaField label="Mô tả *" rows={2} value={form.description} onChange={e => update('description', e.target.value)} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InputField label="Piece-mark" value={form.pieceMark} onChange={e => update('pieceMark', e.target.value)} placeholder="C1, B2..." />
          <InputField label="Trọng lượng (kg)" type="number" value={form.plannedWeight} onChange={e => update('plannedWeight', e.target.value)} />
          <InputField label="Ngày BĐ" type="date" value={form.plannedStart} onChange={e => update('plannedStart', e.target.value)} />
          <InputField label="Ngày KT" type="date" value={form.plannedEnd} min={form.plannedStart || undefined} onChange={e => update('plannedEnd', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Tạo WO</Button>
      </div>
    </Modal>
  )
}
