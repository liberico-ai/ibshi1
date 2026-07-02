'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, StatusBadge, Button, EmptyState, Modal, KPICard, FilterBar } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { formatDate } from '@/lib/utils'
import { Package, ClipboardList, Search, BarChart3, CheckCircle } from 'lucide-react'
import { OriginPrSection } from '@/components/OriginPrSection'

/* ── Types ── */

interface BomInfo {
  id: string
  bomCode: string
  name: string
  projectId: string
  project: { projectCode: string; projectName: string }
}

interface BomVersionLine {
  id: string
  materialId: string
  category: string
  pieceMark: string | null
  profile: string | null
  grade: string | null
  quantity: number
  unit: string
  remarks: string | null
  sortOrder: number
  material: { materialCode: string; name: string; unit: string }
}

interface BomVersion {
  id: string
  bomId: string
  versionNo: number
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED'
  reason: string | null
  createdBy: string
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  sourceRevision: { id: string; versionNo: number } | null
  eco: { id: string; ecoCode: string; status: string } | null
  bom: { id: string; bomCode: string; name: string; projectId: string }
  lines: BomVersionLine[]
}

type DiffAction = 'ADDED' | 'REMOVED' | 'QTY_CHANGED' | 'SPEC_CHANGED'

interface DiffLine {
  action: DiffAction
  category: string
  materialId: string
  materialCode: string
  materialName: string
  pieceMark: string | null
  profile: string | null
  grade: string | null
  unit: string
  qtyOld: number
  qtyNew: number
  qtyDelta: number
}

interface DiffResult {
  oldVersionId: string | null
  newVersionId: string
  lines: DiffLine[]
  summary: {
    added: number
    removed: number
    qtyChanged: number
    specChanged: number
    byCategory: Record<string, { added: number; removed: number; qtyChanged: number; specChanged: number; deltaQty: number }>
    totalDeltaQty: number
  }
}

type SuggestedActionCode = 'UPDATE_PR' | 'ADD_PR' | 'REDUCE_PR' | 'CANCEL_PR' | 'ALERT_PO' | 'RETURN_STOCK' | 'USE_STOCK' | 'NCR' | 'NONE'

interface ImpactLine {
  diffLine: DiffLine
  procurementStatus: string
  currentPrQty: number
  currentPoQty: number
  currentStockQty: number
  suggestedAction: string
  suggestedActionCode: SuggestedActionCode
}

interface ImpactResult {
  versionId: string
  projectId: string
  lines: ImpactLine[]
  summary: {
    totalChanges: number
    needPurchase: number
    canUseStock: number
    needPOAlert: number
    needNCR: number
  }
}

/* ── Constants ── */

const CAN_CREATE_ROLES = ['R01', 'R04', 'R04a', 'R02']
const CAN_APPROVE_ROLES = ['R01', 'R02', 'R02a']

const CATEGORY_ORDER = ['MAIN', 'WELD', 'PAINT', 'AUX', 'CONSUMABLE'] as const
const CATEGORY_LABELS: Record<string, string> = {
  MAIN: 'Vật tư chính',
  WELD: 'Hàn',
  PAINT: 'Sơn',
  AUX: 'Phụ trợ',
  CONSUMABLE: 'Tiêu hao',
}

const DIFF_ACTION_LABELS: Record<DiffAction, string> = {
  ADDED: 'Thêm',
  REMOVED: 'Xoá',
  QTY_CHANGED: 'Đổi SL',
  SPEC_CHANGED: 'Đổi QC',
}

const DIFF_ACTION_ICONS: Record<DiffAction, string> = {
  ADDED: '+',
  REMOVED: '-',
  QTY_CHANGED: '~',
  SPEC_CHANGED: '*',
}

const DIFF_ROW_STYLES: Record<DiffAction, React.CSSProperties> = {
  ADDED: { background: SEMANTIC_COLORS.success.bg },
  REMOVED: { background: SEMANTIC_COLORS.danger.bg },
  QTY_CHANGED: { background: SEMANTIC_COLORS.warning.bg },
  SPEC_CHANGED: { background: SEMANTIC_COLORS.info.bg },
}

const PROCUREMENT_LABELS: Record<string, string> = {
  NOT_PURCHASED: 'Chua mua',
  IN_PR: 'Trong PR',
  IN_PO: 'Trong PO',
  IN_STOCK: 'Trong kho',
  ISSUED: 'Da cap phat',
  FABRICATED: 'Da che tao',
}

const ACTION_CODE_COLORS: Record<SuggestedActionCode, string> = {
  UPDATE_PR: SEMANTIC_COLORS.info.solid,
  ADD_PR: SEMANTIC_COLORS.info.solid,
  REDUCE_PR: SEMANTIC_COLORS.warning.solid,
  CANCEL_PR: SEMANTIC_COLORS.danger.solid,
  ALERT_PO: SEMANTIC_COLORS.danger.solid,
  RETURN_STOCK: SEMANTIC_COLORS.warning.solid,
  USE_STOCK: SEMANTIC_COLORS.success.solid,
  NCR: SEMANTIC_COLORS.danger.solid,
  NONE: SEMANTIC_COLORS.neutral.solid,
}

/** Map BomVersion status to revision StatusBadge */
function versionStatusCategory(status: string): string {
  if (status === 'ACTIVE') return 'ISSUED'
  return status // DRAFT, SUPERSEDED stay the same
}

/* ── Component ── */

export default function BomRevisionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const user = useAuthStore(s => s.user)

  // BOM info
  const [bom, setBom] = useState<BomInfo | null>(null)
  const [bomLoading, setBomLoading] = useState(true)

  // Versions
  const [versions, setVersions] = useState<BomVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(true)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)

  // Version detail
  const [versionDetail, setVersionDetail] = useState<BomVersion | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Tabs
  const [activeTab, setActiveTab] = useState<'items' | 'diff' | 'impact'>('items')

  // Diff
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  // Impact
  const [impact, setImpact] = useState<ImpactResult | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)

  // Approve action
  const [approving, setApproving] = useState(false)

  // Create revision modal
  const [showCreate, setShowCreate] = useState(false)
  const [createReason, setCreateReason] = useState('')
  const [creating, setCreating] = useState(false)

  // ── Load BOM info ──
  const loadBom = useCallback(async () => {
    if (!id) return
    setBomLoading(true)
    const res = await apiFetch('/api/design/bom')
    if (res.ok) {
      const found = (res.boms || []).find((b: BomInfo) => b.id === id)
      if (found) setBom(found)
    }
    setBomLoading(false)
  }, [id])

  useEffect(() => { loadBom() }, [loadBom])

  // ── Load versions ──
  const loadVersions = useCallback(async () => {
    if (!id) return
    setVersionsLoading(true)
    const res = await apiFetch(`/api/design/bom/versions?bomId=${id}`)
    if (res.ok) {
      const vList = res.versions || []
      setVersions(vList)
      // Auto-select the first (latest) version if none selected
      if (vList.length > 0 && !selectedVersionId) {
        setSelectedVersionId(vList[0].id)
      }
    }
    setVersionsLoading(false)
  }, [id, selectedVersionId])

  useEffect(() => { loadVersions() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load version detail when selected ──
  const loadVersionDetail = useCallback(async () => {
    if (!selectedVersionId) { setVersionDetail(null); return }
    setDetailLoading(true)
    setDiff(null)
    setImpact(null)
    setActiveTab('items')
    const res = await apiFetch(`/api/design/bom/versions/${selectedVersionId}`)
    if (res.ok) setVersionDetail(res.version || null)
    setDetailLoading(false)
  }, [selectedVersionId])

  useEffect(() => { loadVersionDetail() }, [loadVersionDetail])

  // ── Fetch diff ──
  const fetchDiff = useCallback(async () => {
    if (!selectedVersionId) return
    setDiffLoading(true)
    const res = await apiFetch(`/api/design/bom/versions/${selectedVersionId}/diff`)
    if (res.ok) setDiff(res.diff || null)
    setDiffLoading(false)
  }, [selectedVersionId])

  // ── Fetch impact ──
  const fetchImpact = useCallback(async () => {
    if (!selectedVersionId) return
    setImpactLoading(true)
    const res = await apiFetch(`/api/design/bom/versions/${selectedVersionId}/impact`)
    if (res.ok) setImpact(res.impact || null)
    setImpactLoading(false)
  }, [selectedVersionId])

  // ── Tab change handler ──
  const handleTabChange = (tab: string) => {
    const t = tab as 'items' | 'diff' | 'impact'
    setActiveTab(t)
    if (t === 'diff' && !diff && !diffLoading) fetchDiff()
    if (t === 'impact' && !impact && !impactLoading) fetchImpact()
  }

  // ── Approve / Activate version ──
  const handleApprove = async () => {
    if (!selectedVersionId || !versionDetail) return
    setApproving(true)
    const res = await apiFetch(`/api/design/bom/versions/${selectedVersionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACTIVE' }),
    })
    setApproving(false)
    if (res.ok) {
      setVersionDetail(res.version || null)
      // Reload versions to reflect status changes (SUPERSEDED, ACTIVE)
      loadVersions()
    } else {
      alert(res.error || 'Loi khi phat hanh phien ban')
    }
  }

  // ── Create new revision ──
  const handleCreateRevision = async () => {
    if (!id) return
    setCreating(true)
    const res = await apiFetch('/api/design/bom/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bomId: id, reason: createReason || undefined }),
    })
    setCreating(false)
    if (res.ok) {
      setShowCreate(false)
      setCreateReason('')
      const newVersion = res.version
      if (newVersion) setSelectedVersionId(newVersion.id)
      loadVersions()
    } else {
      alert(res.error || 'Khong the tao phien ban moi')
    }
  }

  // ── Permission checks ──
  const canCreate = CAN_CREATE_ROLES.includes(user?.roleCode || '')
  const canApprove = CAN_APPROVE_ROLES.includes(user?.roleCode || '')
  const canApproveThisVersion = canApprove
    && versionDetail?.status === 'DRAFT'
    && (!versionDetail.eco || versionDetail.eco.status === 'APPROVED')

  // ── Group items by category ──
  const groupedItems = versionDetail
    ? CATEGORY_ORDER
        .map(cat => ({
          category: cat,
          label: CATEGORY_LABELS[cat] || cat,
          items: versionDetail.lines.filter(l => (l.category || 'MAIN') === cat),
        }))
        .filter(g => g.items.length > 0)
    : []

  // ── Loading state ──
  if (bomLoading) {
    return (
      <div className="space-y-4 animate-fade-in" style={{ padding: '1.5rem' }}>
        {[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}
      </div>
    )
  }

  if (!bom) {
    return (
      <div className="space-y-6 animate-fade-in" style={{ padding: '1.5rem' }}>
        <EmptyState
          icon={<Package />}
          title="Khong tim thay BOM"
          description="BOM nay khong ton tai hoac ban khong co quyen xem"
          action={
            <Button variant="outline" onClick={() => router.push('/dashboard/design/bom')}>
              Quay lai danh sach
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <PageHeader
        title={`${bom.bomCode} — ${bom.name}`}
        subtitle={`DA: ${bom.project.projectCode} — ${bom.project.projectName}`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="ghost" onClick={() => router.push('/dashboard/design/bom')}>
              Quay lai
            </Button>
            {canCreate && (
              <Button variant="primary" icon={<span>+</span>} onClick={() => setShowCreate(true)}>
                Tao Rev moi
              </Button>
            )}
          </div>
        }
      />

      {/* ── Main layout: sidebar + content ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* ── Version Timeline (sidebar) ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="font-heading" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-heading)', margin: 0 }}>
              Lich su phien ban
            </h3>
          </div>
          {versionsLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <span className="btn-spinner" style={{ display: 'inline-block', width: 20, height: 20 }} />
            </div>
          ) : versions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              Chua co phien ban nao
            </div>
          ) : (
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {versions.map((v, idx) => {
                const isSelected = v.id === selectedVersionId
                const dotColor = v.status === 'ACTIVE' ? SEMANTIC_COLORS.success.solid
                  : v.status === 'DRAFT' ? SEMANTIC_COLORS.neutral.solid
                  : SEMANTIC_COLORS.neutral.solid
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVersionId(v.id)}
                    style={{
                      padding: '0.875rem 1.25rem',
                      cursor: 'pointer',
                      borderBottom: idx < versions.length - 1 ? '1px solid var(--border-light)' : undefined,
                      background: isSelected ? 'var(--bg-subtle)' : undefined,
                      borderLeft: isSelected ? `3px solid var(--accent)` : '3px solid transparent',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: dotColor, flexShrink: 0,
                      }} />
                      <span className="font-mono" style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                        Rev {v.versionNo}
                      </span>
                      <StatusBadge category="revision" status={versionStatusCategory(v.status)} />
                    </div>
                    <div style={{ paddingLeft: 18 }}>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '2px 0' }}>
                        {formatDate(v.createdAt)}
                      </p>
                      {v.reason && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '2px 0', lineHeight: 1.4 }}>
                          {v.reason}
                        </p>
                      )}
                      {v.sourceRevision && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '2px 0' }}>
                          Tu Rev {v.sourceRevision.versionNo}
                        </p>
                      )}
                      {v.eco && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '2px 0' }}>
                          ECO: {v.eco.ecoCode}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Content area ── */}
        <div className="space-y-5">
          {detailLoading ? (
            <div className="space-y-4">
              {[1, 2].map(i => <div key={i} className="h-32 skeleton rounded-xl" />)}
            </div>
          ) : !versionDetail ? (
            <EmptyState
              icon={<ClipboardList />}
              title="Chon mot phien ban"
              description="Chon phien ban o danh sach ben trai de xem chi tiet"
            />
          ) : (
            <>
              {/* ── Version header card ── */}
              <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <h2 className="font-heading" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-heading)', margin: 0 }}>
                        Phien ban {versionDetail.versionNo}
                      </h2>
                      <StatusBadge category="revision" status={versionStatusCategory(versionDetail.status)} />
                    </div>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
                      Tao ngay {formatDate(versionDetail.createdAt)}
                      {versionDetail.approvedAt && ` — Phat hanh ${formatDate(versionDetail.approvedAt)}`}
                      {' — '}{versionDetail.lines.length} dong vat tu
                    </p>
                    {versionDetail.reason && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
                        Ly do: {versionDetail.reason}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {/* Đợt 2D: version từ ECO → cho phép tạo PR bổ sung có truy vết nguồn */}
                    {versionDetail.eco && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          const params = new URLSearchParams({
                            originType: 'ECO',
                            originId: versionDetail.id,
                            originLabel: versionDetail.eco!.ecoCode,
                            projectId: bom.projectId,
                          })
                          router.push(`/dashboard/warehouse/purchase-requests/new?${params.toString()}`)
                        }}
                      >
                        Tao PR bo sung
                      </Button>
                    )}
                    {canApproveThisVersion && (
                      <Button variant="primary" loading={approving} onClick={handleApprove}>
                        Phat hanh BomVersion
                      </Button>
                    )}
                  </div>
                </div>

                {/* Truy vết ngược: PR phát sinh từ phiên bản này (ECO) */}
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-light)' }}>
                  <OriginPrSection originType="ECO" originId={versionDetail.id} />
                </div>
              </div>

              {/* ── Tab bar ── */}
              <FilterBar
                filters={[
                  { value: 'items', label: 'Vat tu', count: versionDetail.lines.length },
                  { value: 'diff', label: 'So sanh' },
                  { value: 'impact', label: 'Tac dong' },
                ]}
                value={activeTab}
                onChange={handleTabChange}
              />

              {/* ── Items tab ── */}
              {activeTab === 'items' && (
                <div className="space-y-4">
                  {groupedItems.length === 0 ? (
                    <EmptyState
                      icon={<Package />}
                      title="Chua co vat tu"
                      description="Phien ban nay chua co dong vat tu nao"
                    />
                  ) : (
                    groupedItems.map(group => (
                      <div key={group.category}>
                        <h4 className="font-heading" style={{
                          fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-heading)',
                          marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {group.label} ({group.items.length})
                        </h4>
                        <div className="dt-wrapper">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', width: 40 }}>#</th>
                                <th style={{ textAlign: 'left' }}>Ma VT</th>
                                <th style={{ textAlign: 'left' }}>Ten</th>
                                <th style={{ textAlign: 'left' }}>PieceMark</th>
                                <th style={{ textAlign: 'left' }}>Profile</th>
                                <th style={{ textAlign: 'left' }}>Grade</th>
                                <th style={{ textAlign: 'right' }}>SL</th>
                                <th style={{ textAlign: 'left' }}>DVT</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map((item, i) => (
                                <tr key={item.id}>
                                  <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                  <td>
                                    <span className="font-mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                      {item.material.materialCode}
                                    </span>
                                  </td>
                                  <td style={{ color: 'var(--text-primary)' }}>{item.material.name}</td>
                                  <td className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                                    {item.pieceMark || '—'}
                                  </td>
                                  <td style={{ color: 'var(--text-secondary)' }}>{item.profile || '—'}</td>
                                  <td style={{ color: 'var(--text-secondary)' }}>{item.grade || '—'}</td>
                                  <td className="font-mono" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {Number(item.quantity)}
                                  </td>
                                  <td style={{ color: 'var(--text-muted)' }}>{item.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ── Diff tab ── */}
              {activeTab === 'diff' && (
                <div className="space-y-4">
                  {diffLoading ? (
                    <div className="space-y-3">
                      {[1, 2].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}
                    </div>
                  ) : !diff ? (
                    <EmptyState
                      icon={<Search />}
                      title="Khong co du lieu so sanh"
                      description="Khong tim thay phien ban hieu luc de so sanh"
                    />
                  ) : diff.lines.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle />}
                      title="Khong co thay doi"
                      description="Phien ban nay giong voi phien ban hieu luc hien tai"
                    />
                  ) : (
                    <>
                      {/* Diff summary KPIs */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                        <KPICard
                          label="Them moi"
                          value={diff.summary.added}
                          accentColor={SEMANTIC_COLORS.success.solid}
                        />
                        <KPICard
                          label="Xoa bo"
                          value={diff.summary.removed}
                          accentColor={SEMANTIC_COLORS.danger.solid}
                        />
                        <KPICard
                          label="Doi SL"
                          value={diff.summary.qtyChanged}
                          accentColor={SEMANTIC_COLORS.warning.solid}
                        />
                        <KPICard
                          label="Doi quy cach"
                          value={diff.summary.specChanged}
                          accentColor={SEMANTIC_COLORS.info.solid}
                        />
                        <KPICard
                          label="Delta tong"
                          value={diff.summary.totalDeltaQty > 0 ? `+${diff.summary.totalDeltaQty}` : String(diff.summary.totalDeltaQty)}
                          deltaType={diff.summary.totalDeltaQty > 0 ? 'up' : diff.summary.totalDeltaQty < 0 ? 'down' : 'neutral'}
                        />
                      </div>

                      {/* Diff table */}
                      <div className="dt-wrapper">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'center', width: 50 }}>H.dong</th>
                              <th style={{ textAlign: 'left' }}>Ma VT</th>
                              <th style={{ textAlign: 'left' }}>Ten VT</th>
                              <th style={{ textAlign: 'left' }}>PieceMark</th>
                              <th style={{ textAlign: 'left' }}>Nhom</th>
                              <th style={{ textAlign: 'right' }}>SL cu</th>
                              <th style={{ textAlign: 'right' }}>SL moi</th>
                              <th style={{ textAlign: 'right' }}>Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.lines.map((line, idx) => (
                              <tr key={idx} style={DIFF_ROW_STYLES[line.action]}>
                                <td style={{ textAlign: 'center' }}>
                                  <span
                                    className="font-mono"
                                    title={DIFF_ACTION_LABELS[line.action]}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      width: 24, height: 24, borderRadius: 'var(--radius)',
                                      fontWeight: 700, fontSize: 'var(--text-sm)',
                                    }}
                                  >
                                    {DIFF_ACTION_ICONS[line.action]}
                                  </span>
                                </td>
                                <td>
                                  <span className="font-mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                    {line.materialCode}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--text-primary)' }}>{line.materialName}</td>
                                <td className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                                  {line.pieceMark || '—'}
                                </td>
                                <td style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase' }}>
                                  {CATEGORY_LABELS[line.category] || line.category}
                                </td>
                                <td className="font-mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                                  {line.qtyOld || '—'}
                                </td>
                                <td className="font-mono" style={{ textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>
                                  {line.qtyNew || '—'}
                                </td>
                                <td className="font-mono" style={{
                                  textAlign: 'right', fontWeight: 700,
                                  color: line.qtyDelta > 0 ? SEMANTIC_COLORS.success.solid
                                    : line.qtyDelta < 0 ? SEMANTIC_COLORS.danger.solid
                                    : 'var(--text-muted)',
                                }}>
                                  {line.qtyDelta > 0 ? `+${line.qtyDelta}` : line.qtyDelta === 0 ? '—' : String(line.qtyDelta)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {/* Summary footer by category */}
                          <tfoot>
                            {Object.entries(diff.summary.byCategory)
                              .filter(([, v]) => v.added + v.removed + v.qtyChanged + v.specChanged > 0)
                              .map(([cat, v]) => (
                                <tr key={cat} style={{ background: 'var(--bg-subtle)' }}>
                                  <td colSpan={4} style={{ fontWeight: 600, fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                                    {CATEGORY_LABELS[cat] || cat}
                                  </td>
                                  <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                    +{v.added} / -{v.removed} / ~{v.qtyChanged} / *{v.specChanged}
                                  </td>
                                  <td colSpan={2} />
                                  <td className="font-mono" style={{
                                    textAlign: 'right', fontWeight: 700, fontSize: 'var(--text-sm)',
                                    color: v.deltaQty > 0 ? SEMANTIC_COLORS.success.solid
                                      : v.deltaQty < 0 ? SEMANTIC_COLORS.danger.solid
                                      : 'var(--text-muted)',
                                  }}>
                                    {v.deltaQty > 0 ? `+${v.deltaQty}` : String(v.deltaQty)}
                                  </td>
                                </tr>
                              ))}
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Impact tab ── */}
              {activeTab === 'impact' && (
                <div className="space-y-4">
                  {impactLoading ? (
                    <div className="space-y-3">
                      {[1, 2].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}
                    </div>
                  ) : !impact ? (
                    <EmptyState
                      icon={<BarChart3 />}
                      title="Khong co du lieu tac dong"
                      description="Khong the phan tich tac dong cho phien ban nay"
                    />
                  ) : impact.lines.length === 0 ? (
                    <EmptyState
                      icon={<CheckCircle />}
                      title="Khong co tac dong"
                      description="Phien ban nay khong tao ra thay doi nao anh huong den mua sam"
                    />
                  ) : (
                    <>
                      {/* Impact KPIs */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                        <KPICard
                          label="Can mua them"
                          value={impact.summary.needPurchase}
                          accentColor={SEMANTIC_COLORS.info.solid}
                        />
                        <KPICard
                          label="Dung ton kho"
                          value={impact.summary.canUseStock}
                          accentColor={SEMANTIC_COLORS.success.solid}
                        />
                        <KPICard
                          label="Canh bao PO"
                          value={impact.summary.needPOAlert}
                          accentColor={SEMANTIC_COLORS.danger.solid}
                        />
                        <KPICard
                          label="Can NCR"
                          value={impact.summary.needNCR}
                          accentColor={SEMANTIC_COLORS.warning.solid}
                        />
                      </div>

                      {/* Impact table */}
                      <div className="dt-wrapper">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left' }}>Ma VT</th>
                              <th style={{ textAlign: 'left' }}>Ten VT</th>
                              <th style={{ textAlign: 'center' }}>H.dong</th>
                              <th style={{ textAlign: 'left' }}>Trang thai MS</th>
                              <th style={{ textAlign: 'right' }}>SL PR</th>
                              <th style={{ textAlign: 'right' }}>SL PO</th>
                              <th style={{ textAlign: 'right' }}>SL Ton</th>
                              <th style={{ textAlign: 'left' }}>De xuat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {impact.lines.map((line, idx) => (
                              <tr key={idx}>
                                <td>
                                  <span className="font-mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                    {line.diffLine.materialCode}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--text-primary)' }}>{line.diffLine.materialName}</td>
                                <td style={{ textAlign: 'center' }}>
                                  <span
                                    className="font-mono"
                                    title={DIFF_ACTION_LABELS[line.diffLine.action]}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      width: 24, height: 24, borderRadius: 'var(--radius)',
                                      fontWeight: 700, fontSize: 'var(--text-sm)',
                                      background: DIFF_ROW_STYLES[line.diffLine.action].background,
                                    }}
                                  >
                                    {DIFF_ACTION_ICONS[line.diffLine.action]}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                                  {PROCUREMENT_LABELS[line.procurementStatus] || line.procurementStatus}
                                </td>
                                <td className="font-mono" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>
                                  {line.currentPrQty || '—'}
                                </td>
                                <td className="font-mono" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>
                                  {line.currentPoQty || '—'}
                                </td>
                                <td className="font-mono" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>
                                  {line.currentStockQty || '—'}
                                </td>
                                <td>
                                  <span style={{
                                    fontSize: 'var(--text-xs)',
                                    color: ACTION_CODE_COLORS[line.suggestedActionCode] || 'var(--text-secondary)',
                                    fontWeight: 600,
                                  }}>
                                    {line.suggestedAction}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Create Revision Modal ── */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Tao phien ban BOM moi"
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Huy</Button>
            <Button variant="primary" loading={creating} onClick={handleCreateRevision}>Tao Rev</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              Ly do thay doi
            </label>
            <textarea
              value={createReason}
              onChange={e => setCreateReason(e.target.value)}
              placeholder="Mo ta ly do tao phien ban moi..."
              rows={3}
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                fontSize: 'var(--text-sm)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            Phien ban moi se sao chep cac dong vat tu tu phien ban hieu luc hien tai.
          </p>
        </div>
      </Modal>
    </div>
  )
}
