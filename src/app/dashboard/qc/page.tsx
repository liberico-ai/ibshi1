'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, openAuthedFile } from '@/hooks/useAuth'
import SidebarStepLanding from '@/components/SidebarStepLanding'
import { formatDate } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, KPICard, StatusBadge, Button, EmptyState, Modal, InputField, SelectField } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ChevronRight, ClipboardList } from 'lucide-react'

interface Inspection {
  id: string; projectId: string; inspectionCode: string;
  type: string; stepCode: string; status: string;
  totalItems: number; passedItems: number; failedItems: number;
  inspectedAt: string | null; remarks: string | null; createdAt: string;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const QC_TYPES = [
  { value: 'material_incoming', label: 'Nghiệm thu vật tư' },
  { value: 'ndt', label: 'Kiểm tra NDT' },
  { value: 'pressure_test', label: 'Thử áp lực' },
  { value: 'dimensional', label: 'Kiểm tra kích thước' },
  { value: 'visual', label: 'Kiểm tra trực quan' },
  { value: 'fat', label: 'FAT' },
  { value: 'sat', label: 'SAT' },
]

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING', label: 'Chờ kiểm' },
  { value: 'PASSED', label: 'Đạt' },
  { value: 'FAILED', label: 'Không đạt' },
  { value: 'CONDITIONAL', label: 'Đạt ĐK' },
]

export default function QCPage() {
  const router = useRouter()
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const loadProjects = useCallback(async () => {
    const res = await apiFetch('/api/projects/options')
    if (res.ok) setProjects(res.projects)
  }, [])

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/qc?${params}`)
    if (res.ok) { setInspections(res.inspections); setPagination(res.pagination) }
    setLoading(false)
  }, [search, statusFilter, page])

  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { loadData() }, [loadData])

  async function handleVerdict(e: React.MouseEvent, id: string, status: string) {
    e.stopPropagation()
    const res = await apiFetch(`/api/qc/${id}`, {
      method: 'PUT', body: JSON.stringify({ status }),
    })
    if (res.ok) loadData()
  }

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} />
      ))}
    </div>
  )

  const passCount = inspections.filter(i => i.status === 'PASSED').length
  const failCount = inspections.filter(i => i.status === 'FAILED').length
  const condCount = inspections.filter(i => i.status === 'CONDITIONAL').length
  const pendCount = inspections.filter(i => i.status === 'PENDING').length
  const passRate = passCount + failCount > 0 ? Math.round(passCount / (passCount + failCount) * 100) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <SidebarStepLanding heading="Bước quy trình — Chất lượng" steps={[
        { code: 'P5.3', title: 'TP QAQC nghiệm thu chất lượng & khối lượng', noTemplate: true },
        { code: 'P5.4', title: 'PM nghiệm thu chất lượng & khối lượng', noTemplate: true },
        { code: 'P6.1', title: 'Tổng hợp hồ sơ chất lượng (Dossier)', noTemplate: true },
      ]} />
      <PageHeader
        title="Quản lý Chất lượng (QC)"
        subtitle="Biên bản kiểm tra chất lượng"
        actions={<Button variant="primary" onClick={() => setShowCreate(!showCreate)}>+ Tạo biên bản</Button>}
      />

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
        <KPICard label="Tổng biên bản" value={pagination.total} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đạt" value={passCount} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Không đạt" value={failCount} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard label="Chờ / ĐK" value={pendCount + condCount} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard
          label="Tỷ lệ đạt"
          value={`${passRate}%`}
          accentColor={passRate >= 80 ? SEMANTIC_COLORS.success.solid : passRate >= 50 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.danger.solid}
        />
      </div>

      <CreateInspectionModal
        open={showCreate}
        projects={projects}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadData() }}
      />

      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã biên bản..." /></div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`filter-pill ${statusFilter === f.value ? 'active' : ''}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Inspection table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã biên bản</th>
              <th>Loại kiểm tra</th>
              <th>Dự án</th>
              <th>Bước WF</th>
              <th>Kết quả</th>
              <th>Checklist</th>
              <th>Ngày KT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((insp) => {
              const project = projects.find(p => p.id === insp.projectId)
              const qcType = QC_TYPES.find(t => t.value === insp.type)
              return (
                <tr key={insp.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => router.push(`/dashboard/qc/${insp.id}`)}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--primary)' }}>{insp.inspectionCode}</span></td>
                  <td style={{ color: 'var(--text-primary)' }}>{qcType?.label || insp.type}</td>
                  <td><span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{project?.projectCode || '-'}</span></td>
                  <td><span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{insp.stepCode}</span></td>
                  <td><StatusBadge category="qc" status={insp.status} /></td>
                  <td>
                    {insp.totalItems > 0 ? (
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: SEMANTIC_COLORS.neutral.bg }}>
                          <div className="h-full rounded-full" style={{
                            width: `${(insp.passedItems / insp.totalItems) * 100}%`,
                            background: insp.failedItems > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid,
                          }} />
                        </div>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{insp.passedItems}/{insp.totalItems}</span>
                      </div>
                    ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{insp.inspectedAt ? formatDate(insp.inspectedAt) : 'Chưa KT'}</td>
                  <td>
                    {insp.status === 'PENDING' ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={(e) => handleVerdict(e, insp.id, 'PASSED')}
                          style={{ background: SEMANTIC_COLORS.success.bg, color: SEMANTIC_COLORS.success.solid }}>Đạt</Button>
                        <Button size="sm" variant="ghost" onClick={(e) => handleVerdict(e, insp.id, 'FAILED')}
                          style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>Lỗi</Button>
                      </div>
                    ) : (
                      <ChevronRight size={16} stroke="var(--text-muted)" />
                    )}
                  </td>
                </tr>
              )
            })}
            {inspections.length === 0 && (
              <tr><td colSpan={8}><EmptyState icon={<ClipboardList />} title="Chưa có biên bản QC" /></td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
        </div>
      </div>
    </div>
  )
}

interface WOOption { id: string; woCode: string; pieceMark: string | null; status: string }

const WO_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Mở', IN_PROGRESS: 'Đang SX', QC_PENDING: 'Chờ QC', QC_PASSED: 'QC Đạt',
  QC_FAILED: 'QC Lỗi', COMPLETED: 'Xong', ON_HOLD: 'Tạm dừng', PENDING_MATERIAL: 'Chờ VT',
}

// Nghiệm thu vật tư: PO mà TM đã xác nhận hàng về (PARTIAL_RECEIVED / RECEIVED)
interface POOption { id: string; poCode: string; vendorName: string; status: string; projectCode: string | null; projectId: string | null }
// Hồ sơ Heat/Lot/Mill Cert của từng PO (bắt buộc QC đọc/xem trước khi kết luận)
interface CertLine { materialName: string; quantity: number; heatNumber: string | null; lotNumber: string | null; millCert: string | null }
// File hồ sơ TM đính kèm lúc GRN (hợp đồng / chứng chỉ)
interface PODoc { id: string; fileName: string; mimeType: string | null }
const PO_STATUS_LABEL: Record<string, string> = { PARTIAL_RECEIVED: 'Về một phần', RECEIVED: 'Đã về đủ' }

// Bước Workflow tự điền theo loại kiểm tra (không cho sửa)
const STEP_CODE_BY_TYPE: Record<string, string> = {
  material_incoming: 'P4.3_QC', ndt: 'QC_NDT', pressure_test: 'QC_PRESSURE',
  dimensional: 'QC_DIM', visual: 'QC_VISUAL', fat: 'FAT', sat: 'SAT',
}
function stepCodeForType(type: string): string { return STEP_CODE_BY_TYPE[type] || 'QC' }

function CreateInspectionModal({ open, projects, onClose, onCreated }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    inspectionCode: '', projectId: '', type: 'material_incoming', stepCode: stepCodeForType('material_incoming'),
    workOrderId: '', pieceMark: '',
    poIds: [] as string[],
    checklistItems: [{ checkItem: '', standard: '' }],
  })
  const [workOrders, setWorkOrders] = useState<WOOption[]>([])
  const [loadingWO, setLoadingWO] = useState(false)
  const [receivedPOs, setReceivedPOs] = useState<POOption[]>([])
  const [loadingPO, setLoadingPO] = useState(false)
  const [poCerts, setPoCerts] = useState<Record<string, CertLine[]>>({})
  const [poDocs, setPoDocs] = useState<Record<string, PODoc[]>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isMaterialIncoming = form.type === 'material_incoming'

  // Tất cả PO mà TM đã xác nhận hàng về (PARTIAL_RECEIVED / RECEIVED) — không lọc theo dự án.
  // Hiển thị kèm mã dự án (nếu có) để QC nhận biết.
  async function loadReceivedPOs() {
    setLoadingPO(true)
    const res = await apiFetch(`/api/purchase-orders?status=PARTIAL_RECEIVED,RECEIVED`)
    if (res.ok) setReceivedPOs((res.purchaseOrders || res.data || []).map((po: { id: string; poCode: string; vendor?: { name?: string }; status: string; projectId?: string | null; project?: { projectCode?: string } | null }) => ({
      id: po.id, poCode: po.poCode, vendorName: po.vendor?.name || 'N/A', status: po.status,
      projectId: po.projectId || null, projectCode: po.project?.projectCode || null,
    })))
    setLoadingPO(false)
  }

  // Tải danh sách PO ngay khi mở modal ở loại "Nghiệm thu vật tư"
  useEffect(() => {
    if (open && form.type === 'material_incoming') loadReceivedPOs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onProjectChange(projectId: string) {
    setForm(prev => ({ ...prev, projectId, workOrderId: '', pieceMark: '' }))
    setWorkOrders([])
    if (!projectId) return
    setLoadingWO(true)
    const res = await apiFetch(`/api/production?projectId=${projectId}&limit=500`)
    if (res.ok) setWorkOrders((res.workOrders || []).map((wo: { id: string; woCode: string; pieceMark: string | null; status: string }) => ({
      id: wo.id, woCode: wo.woCode, pieceMark: wo.pieceMark, status: wo.status,
    })))
    setLoadingWO(false)
  }

  function onTypeChange(type: string) {
    setForm(prev => ({ ...prev, type, poIds: [], stepCode: stepCodeForType(type) }))
    setPoCerts({}); setPoDocs({})
    if (type === 'material_incoming') loadReceivedPOs()
    else setReceivedPOs([])
  }

  // Khi chọn PO, tự điền dự án của biên bản theo dự án của PO (nếu PO có gắn và form chưa chọn)
  function autoFillProjectFromPO(po: POOption) {
    if (po.projectId && !form.projectId) setForm(prev => ({ ...prev, projectId: po.projectId! }))
  }

  // Bật/tắt 1 PO; khi bật thì tải hồ sơ Heat/Lot/Mill Cert (từ phiếu nhập GRN) để QC xem
  async function togglePO(poId: string, poCode: string) {
    const selected = form.poIds.includes(poId)
    setForm(prev => ({ ...prev, poIds: selected ? prev.poIds.filter(id => id !== poId) : [...prev.poIds, poId] }))
    if (!selected) {
      const po = receivedPOs.find(p => p.id === poId)
      if (po) autoFillProjectFromPO(po)
    }
    if (!selected && !poCerts[poId]) {
      const res = await apiFetch(`/api/grn?poCode=${encodeURIComponent(poCode)}&limit=100`)
      if (res.ok) {
        const lines: CertLine[] = (res.receipts || []).map((m: { material?: { name?: string; unit?: string }; quantity: number; heatNumber: string | null; lotNumber: string | null; millCert?: string | null }) => ({
          materialName: m.material?.name || '—',
          quantity: Number(m.quantity),
          heatNumber: m.heatNumber, lotNumber: m.lotNumber, millCert: m.millCert || null,
        }))
        setPoCerts(prev => ({ ...prev, [poId]: lines }))
      }
    }
    // Tải file hồ sơ TM đính kèm lúc GRN (entityType=GRN, entityId=poId)
    if (!selected && !poDocs[poId]) {
      const dres = await apiFetch(`/api/upload?entityType=GRN&entityId=${poId}`)
      if (dres.ok) {
        setPoDocs(prev => ({ ...prev, [poId]: (dres.attachments || []).map((a: { id: string; fileName: string; mimeType: string | null }) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType })) }))
      }
    }
  }

  function onWOChange(workOrderId: string) {
    const wo = workOrders.find(w => w.id === workOrderId)
    setForm(prev => ({ ...prev, workOrderId, pieceMark: wo?.pieceMark || '' }))
  }

  function addCheckItem() {
    setForm({ ...form, checklistItems: [...form.checklistItems, { checkItem: '', standard: '' }] })
  }
  function updateCheckItem(index: number, field: string, value: string) {
    const items = [...form.checklistItems]
    items[index] = { ...items[index], [field]: value }
    setForm({ ...form, checklistItems: items })
  }
  function removeCheckItem(index: number) {
    setForm({ ...form, checklistItems: form.checklistItems.filter((_, i) => i !== index) })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isMaterialIncoming && form.poIds.length === 0) {
      setError('Chọn ít nhất 1 PO mà TM đã xác nhận hàng về để nghiệm thu')
      return
    }
    if (isMaterialIncoming && !form.projectId) {
      setError('PO đã chọn chưa gắn dự án — không thể tạo biên bản. Vui lòng gắn dự án cho PO trước.')
      return
    }
    setError(''); setSubmitting(true)
    const payload = {
      ...form,
      workOrderId: form.workOrderId || undefined,
      pieceMark: form.pieceMark || undefined,
      poIds: isMaterialIncoming ? form.poIds : undefined,
      checklistItems: form.checklistItems.filter(ci => ci.checkItem.trim()),
    }
    const res = await apiFetch('/api/qc', { method: 'POST', body: JSON.stringify(payload) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  return (
    <Modal open={open} onClose={onClose} title="Tạo biên bản kiểm tra" size="lg">
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid, border: `1px solid ${SEMANTIC_COLORS.danger.solid}20` }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Mã biên bản *"
            value={form.inspectionCode}
            onChange={(e) => setForm({ ...form, inspectionCode: e.target.value })}
            placeholder="QC-2026-001"
            required
          />
          {/* Nghiệm thu vật tư: dự án suy ra từ PO đã chọn → ẩn ô chọn dự án / WO / piece mark */}
          {!isMaterialIncoming && (
            <>
              <SelectField
                label="Dự án *"
                value={form.projectId}
                onChange={(e) => onProjectChange(e.target.value)}
                options={[{ value: '', label: 'Chọn dự án' }, ...projects.map(p => ({ value: p.id, label: p.projectCode }))]}
                required
              />
              <SelectField
                label={`Work Order${loadingWO ? ' (đang tải...)' : ''}`}
                value={form.workOrderId}
                onChange={(e) => onWOChange(e.target.value)}
                options={[
                  { value: '', label: form.projectId ? 'Không gắn WO' : 'Chọn dự án trước' },
                  ...workOrders.map(wo => ({
                    value: wo.id,
                    label: `${wo.woCode}${wo.pieceMark ? ` — ${wo.pieceMark}` : ''} [${WO_STATUS_LABEL[wo.status] || wo.status}]`,
                  })),
                ]}
              />
              <InputField
                label="Piece Mark"
                value={form.pieceMark}
                onChange={(e) => setForm({ ...form, pieceMark: e.target.value })}
                placeholder="Tự điền khi chọn WO"
                readOnly={!!form.workOrderId}
                style={form.workOrderId ? { background: 'var(--bg-secondary)', cursor: 'not-allowed' } : undefined}
              />
            </>
          )}
          <SelectField
            label="Loại kiểm tra *"
            value={form.type}
            onChange={(e) => onTypeChange(e.target.value)}
            options={QC_TYPES}
          />
          <InputField
            label="Bước Workflow (tự điền)"
            value={form.stepCode}
            onChange={() => {}}
            readOnly
            style={{ background: 'var(--bg-secondary)', cursor: 'not-allowed' }}
          />
        </div>

        {/* Nghiệm thu vật tư: hiện tất cả PO TM đã báo về cho tích + xem hồ sơ Heat/Lot/Mill Cert */}
        {isMaterialIncoming && (
          <div>
            <label className="input-label">PO đã về (TM xác nhận) — chọn để nghiệm thu *</label>
            {loadingPO ? (
              <div className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Đang tải danh sách PO...</div>
            ) : receivedPOs.length === 0 ? (
              <div className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Chưa có PO nào TM xác nhận hàng về</div>
            ) : (
              <div className="space-y-2">
                {receivedPOs.map(po => {
                  const checked = form.poIds.includes(po.id)
                  const certs = poCerts[po.id]
                  return (
                    <div key={po.id} className="rounded-lg border" style={{ borderColor: checked ? 'var(--accent)' : 'var(--border)' }}>
                      <label className="flex items-center gap-2 p-2 cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => togglePO(po.id, po.poCode)} />
                        <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{po.poCode}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {po.vendorName}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--info-bg, var(--bg-secondary))', color: po.projectCode ? 'var(--info)' : 'var(--text-muted)' }}>
                          🏗 {po.projectCode || 'Chưa gắn dự án'}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{PO_STATUS_LABEL[po.status] || po.status}</span>
                      </label>
                      {checked && (
                        <div className="px-3 pb-2">
                          <div className="text-xs font-bold mb-1" style={{ color: 'var(--warning)' }}>📋 Hồ sơ Heat / Lot / Mill Cert — bắt buộc đọc/xem</div>
                          {!certs ? (
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Đang tải hồ sơ...</div>
                          ) : certs.length === 0 ? (
                            <div className="text-xs" style={{ color: 'var(--danger)' }}>Chưa có hồ sơ Heat/Lot/Mill Cert cho PO này</div>
                          ) : (
                            <div className="dt-wrapper">
                              <table className="data-table" style={{ fontSize: '0.75rem' }}>
                                <thead>
                                  <tr><th>Vật tư</th><th>SL</th><th>Heat No.</th><th>Lot No.</th><th>Mill Cert</th></tr>
                                </thead>
                                <tbody>
                                  {certs.map((c, ci) => (
                                    <tr key={ci}>
                                      <td>{c.materialName}</td>
                                      <td className="font-mono">{c.quantity}</td>
                                      <td className="font-mono" style={{ color: 'var(--info)' }}>{c.heatNumber || '—'}</td>
                                      <td className="font-mono" style={{ color: 'var(--warning)' }}>{c.lotNumber || '—'}</td>
                                      <td className="font-mono" style={{ color: c.millCert ? 'var(--success)' : 'var(--text-muted)' }}>{c.millCert || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {/* File hồ sơ TM đính kèm — QC bấm để đọc/xem */}
                          <div className="mt-2">
                            <div className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>📎 File hồ sơ đính kèm</div>
                            {!poDocs[po.id] ? (
                              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Đang tải...</div>
                            ) : poDocs[po.id].length === 0 ? (
                              <div className="text-xs" style={{ color: 'var(--danger)' }}>Chưa có file hồ sơ đính kèm cho PO này</div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {poDocs[po.id].map(d => (
                                  <a key={d.id} href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(d.id, d.fileName, d.mimeType) }}
                                    className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--accent)', textDecoration: 'none' }}>
                                    📄 {d.fileName}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="input-label">Danh mục kiểm tra</label>
            <Button type="button" variant="ghost" size="sm" onClick={addCheckItem}>+ Thêm</Button>
          </div>
          <div className="space-y-2">
            {form.checklistItems.map((ci, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className="input flex-1" placeholder="Nội dung kiểm tra" value={ci.checkItem} onChange={(e) => updateCheckItem(i, 'checkItem', e.target.value)} />
                <input className="input w-48" placeholder="Tiêu chuẩn" value={ci.standard} onChange={(e) => updateCheckItem(i, 'standard', e.target.value)} />
                {form.checklistItems.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeCheckItem(i)}
                    style={{ color: SEMANTIC_COLORS.danger.solid }}>x</Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="primary" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Tạo'}</Button>
        </div>
      </form>
    </Modal>
  )
}
