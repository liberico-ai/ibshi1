'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, Badge } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { formatCurrency, formatDate } from '@/lib/utils'

interface DashboardData {
  project: { projectCode: string; projectName: string; contractValue: number; currency: string }
  volume: {
    baseline: { tons: number | null; label: string | null; frozenAt: string | null }
    current: { bomTons: number; bomPieceMarks: number; versionNo: number | null }
    actual: { completedTons: number; earnedTons: number; completedPct: number; earnedPct: number; completedPieceMarks: number; earnedPieceMarks: number; totalPieceMarks: number }
    variance: { bomVsBaseline: number | null }
  }
  cost: {
    baselinePlanned: number | null; currentPlanned: number; committed: number
    actual: number | null; forecast: number | null; profitLoss: number | null
    poCount: number; byCategory: { category: string; planned: number; actual: number; committed: number; forecast: number }[]
    _notes: Record<string, string>
  }
  changes: {
    totalEcos: number
    bySource: Record<string, { count: number; totalDeltaCost: number }>
    byCostBearer: Record<string, { count: number; totalDeltaCost: number }>
    recentEcos: { ecoCode: string; title: string; status: string; source: string | null; costBearer: string | null; impactCost: number; hasNcr: boolean; createdAt: string }[]
  }
  stages: { stage: string; weight: number; totalCards: number; completedCards: number; pct: number }[]
}

const SOURCE_LABELS: Record<string, string> = {
  DESIGN: 'Kỹ thuật', CUSTOMER: 'Khách hàng', ENGINEERING_SHOPDRAWING: 'Shop drawing',
  PRODUCTION_NCR: 'NCR sản xuất', SUBSTITUTION: 'Thay thế VT', CORRECTION: 'Sửa sai', SITE: 'Công trường',
}
const BEARER_LABELS: Record<string, string> = {
  INTERNAL: 'Nội bộ', CUSTOMER: 'Khách trả', SUPPLIER: 'NCC chịu',
  PRODUCTION_TEAM: 'Tổ SX', SITE_TBD: 'TBD (site)',
}
const STAGE_LABELS: Record<string, string> = { CUTTING: 'Cắt', ASSEMBLY: 'Tổ hợp', WELDING: 'Hàn', PAINTING: 'Sơn', INSPECTION: 'QC' }
const ECO_STATUS_VARIANT: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default', SUBMITTED: 'info', APPROVED: 'success', REJECTED: 'danger', IMPLEMENTED: 'success',
}

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null) return '—'
  return `${n.toLocaleString('vi-VN')}${suffix}`
}

function pctBar(pct: number, color: string) {
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  )
}

export default function ControlDashboardPage() {
  const params = useParams()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!params.id) return
    apiFetch(`/api/projects/${params.id}/control-dashboard`).then(r => {
      if (r.ok) setData(r)
      else setError(r.error || 'Không tải được')
      setLoading(false)
    })
  }, [params.id])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3, 4].map(i => <div key={i} className="h-32 skeleton rounded-xl" />)}</div>
  if (error || !data) return <div className="card p-6 text-center" style={{ color: SEMANTIC_COLORS.danger.solid }}>{error || 'Lỗi'}</div>

  const { project, volume, cost, changes, stages } = data

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Bảng điều khiển — ${project.projectCode}`}
        subtitle={project.projectName}
      />

      {/* ── 3 ĐƯỜNG tóm tắt ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="① KẾ HOẠCH (Baseline)"
          value={volume.baseline.tons != null ? `${fmt(volume.baseline.tons)} tấn` : 'Chưa đông cứng'}
          sub={volume.baseline.label ? `${volume.baseline.label} — ${volume.baseline.frozenAt ? formatDate(volume.baseline.frozenAt) : ''}` : null}
          color={SEMANTIC_COLORS.info.solid}
        />
        <SummaryCard
          label="② HIỆN HÀNH (BOM)"
          value={`${fmt(volume.current.bomTons)} tấn`}
          sub={`${volume.current.bomPieceMarks} piece-mark${volume.current.versionNo ? ` · v${volume.current.versionNo}` : ''}`}
          color="#8b5cf6"
          extra={volume.variance.bomVsBaseline != null ? (
            <span className="text-xs font-mono" style={{ color: volume.variance.bomVsBaseline > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid }}>
              Δ {volume.variance.bomVsBaseline > 0 ? '+' : ''}{fmt(volume.variance.bomVsBaseline)} tấn vs baseline
            </span>
          ) : null}
        />
        <SummaryCard
          label="③ THỰC HIỆN (Earned)"
          value={`${fmt(volume.actual.earnedTons)} tấn`}
          sub={`QC đạt ${volume.actual.earnedPct}% · SX báo ${volume.actual.completedPct}%`}
          color={SEMANTIC_COLORS.success.solid}
          extra={pctBar(volume.actual.earnedPct, SEMANTIC_COLORS.success.solid)}
        />
      </div>

      {/* ── KHỐI 1: Khối lượng chi tiết ── */}
      <div className="card p-5">
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Khối lượng</h3>
        <div className="dt-wrapper">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>Thước đo</th>
                <th className="text-right">① Kế hoạch</th>
                <th className="text-right">② Hiện hành</th>
                <th className="text-right">③ Earned (QC đạt)</th>
                <th className="text-right">Tiến độ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-bold">Tấn thép</td>
                <td className="text-right font-mono">{fmt(volume.baseline.tons)}</td>
                <td className="text-right font-mono">{fmt(volume.current.bomTons)}</td>
                <td className="text-right font-mono font-bold" style={{ color: SEMANTIC_COLORS.success.solid }}>{fmt(volume.actual.earnedTons)}</td>
                <td className="text-right font-mono">{volume.actual.earnedPct}%</td>
              </tr>
              <tr>
                <td className="font-bold">Piece-mark</td>
                <td className="text-right font-mono">—</td>
                <td className="text-right font-mono">{volume.current.bomPieceMarks}</td>
                <td className="text-right font-mono font-bold" style={{ color: SEMANTIC_COLORS.success.solid }}>{volume.actual.earnedPieceMarks}</td>
                <td className="text-right font-mono">{volume.actual.totalPieceMarks > 0 ? Math.round(volume.actual.earnedPieceMarks / volume.actual.totalPieceMarks * 100) : 0}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── KHỐI 2: Chi phí ── */}
      <div className="card p-5">
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Chi phí</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <KpiBox label="Ngân sách gốc" value={cost.baselinePlanned != null ? formatCurrency(cost.baselinePlanned, project.currency) : '—'} />
          <KpiBox label="Dự toán hiện hành" value={formatCurrency(cost.currentPlanned, project.currency)} />
          <KpiBox label={`Cam kết PO (${cost.poCount})`} value={formatCurrency(cost.committed, project.currency)} color={SEMANTIC_COLORS.warning.solid} />
          <KpiBox label="Thực chi" value="—" note={cost._notes.actual} />
          <KpiBox label="Lãi/lỗ dự báo" value="—" note={cost._notes.profitLoss} />
        </div>
        {cost.byCategory.length > 0 && (
          <div className="dt-wrapper">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>Hạng mục</th>
                  <th className="text-right">Kế hoạch</th>
                  <th className="text-right">Cam kết</th>
                  <th className="text-right">Thực chi</th>
                  <th className="text-right">Dự báo</th>
                </tr>
              </thead>
              <tbody>
                {cost.byCategory.map(c => (
                  <tr key={c.category}>
                    <td className="font-bold">{c.category}</td>
                    <td className="text-right font-mono">{formatCurrency(c.planned, project.currency)}</td>
                    <td className="text-right font-mono">{formatCurrency(c.committed, project.currency)}</td>
                    <td className="text-right font-mono">{c.actual ? formatCurrency(c.actual, project.currency) : '—'}</td>
                    <td className="text-right font-mono">{c.forecast ? formatCurrency(c.forecast, project.currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── KHỐI 3: Thay đổi (ECO) ── */}
      <div className="card p-5">
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          Thay đổi kỹ thuật — {changes.totalEcos} ECO
        </h3>
        {changes.totalEcos === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có ECO nào cho dự án này.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="input-label mb-1">Theo nguồn</label>
                <div className="space-y-1">
                  {Object.entries(changes.bySource).map(([src, v]) => (
                    <div key={src} className="flex justify-between text-xs">
                      <span>{SOURCE_LABELS[src] || src}</span>
                      <span className="font-mono font-bold">{v.count} ECO · Δ{formatCurrency(v.totalDeltaCost, project.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="input-label mb-1">Ai chịu chi phí</label>
                <div className="space-y-1">
                  {Object.entries(changes.byCostBearer).map(([cb, v]) => (
                    <div key={cb} className="flex justify-between text-xs">
                      <span>{BEARER_LABELS[cb] || cb}</span>
                      <span className="font-mono font-bold">{v.count} · Δ{formatCurrency(v.totalDeltaCost, project.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dt-wrapper">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>ECO</th>
                    <th>Tiêu đề</th>
                    <th>Nguồn</th>
                    <th>Chi phí do</th>
                    <th className="text-right">Δ Chi phí</th>
                    <th>Trạng thái</th>
                    <th>Ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.recentEcos.map(e => (
                    <tr key={e.ecoCode}>
                      <td className="font-mono font-bold" style={{ color: 'var(--accent)' }}>
                        {e.ecoCode}
                        {e.hasNcr && <span className="ml-1" title="Từ NCR">🔴</span>}
                      </td>
                      <td className="max-w-[200px] truncate">{e.title}</td>
                      <td>{SOURCE_LABELS[e.source || ''] || e.source || '—'}</td>
                      <td>{BEARER_LABELS[e.costBearer || ''] || e.costBearer || '—'}</td>
                      <td className="text-right font-mono">{e.impactCost ? formatCurrency(e.impactCost, project.currency) : '—'}</td>
                      <td><Badge variant={ECO_STATUS_VARIANT[e.status] || 'default'}>{e.status}</Badge></td>
                      <td className="font-mono">{formatDate(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── KHỐI 4: Công đoạn ── */}
      <div className="card p-5">
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Tiến độ công đoạn</h3>
        <div className="grid grid-cols-5 gap-3">
          {stages.map(s => (
            <div key={s.stage} className="text-center">
              <p className="text-xs font-bold mb-1">{STAGE_LABELS[s.stage] || s.stage}</p>
              <p className="text-lg font-mono font-bold" style={{ color: s.pct >= 100 ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.info.solid }}>{s.pct}%</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.completedCards}/{s.totalCards} cards</p>
              <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>trọng số {Math.round(s.weight * 100)}%</p>
              {pctBar(s.pct, s.pct >= 100 ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.info.solid)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, color, extra }: {
  label: string; value: string; sub: string | null; color: string; extra?: React.ReactNode
}) {
  return (
    <div className="card p-4" style={{ borderTop: `3px solid ${color}` }}>
      <p className="text-xs font-bold mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-mono font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      {extra && <div className="mt-2">{extra}</div>}
    </div>
  )
}

function KpiBox({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return (
    <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm font-mono font-bold mt-1" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
      {note && <p className="text-xs mt-1 italic" style={{ color: SEMANTIC_COLORS.warning.solid }}>{note}</p>}
    </div>
  )
}
