'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { Pagination } from '@/components/SearchPagination'
import { PageHeader, StatusBadge, Button, EmptyState, FilterBar } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ClipboardList } from 'lucide-react'

interface PrItem {
  id: string
  quantity: number
  notes: string | null
  material: { materialCode: string; name: string; unit: string } | null
}

interface PurchaseRequest {
  id: string
  prCode: string
  status: string
  urgency: string
  notes: string | null
  originType: 'ECO' | 'NCR' | null
  originId: string | null
  originLabel: string | null
  createdAt: string
  project: { projectCode: string; projectName: string }
  items: PrItem[]
  itemCount: number
}

interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const CAN_CREATE_ROLES = ['R01', 'R02', 'R03', 'R05']

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'SUBMITTED', label: 'Đã gửi' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Từ chối' },
  { value: 'CONVERTED', label: 'Đã chuyển PO' },
]

const URGENCY_LABELS: Record<string, string> = {
  NORMAL: 'Bình thường', URGENT: 'Gấp', CRITICAL: 'Rất gấp',
}

// Route trang nguồn để click ngược từ badge
const ORIGIN_ROUTE: Record<string, string> = {
  ECO: '/dashboard/design/eco',
  NCR: '/dashboard/qc/ncr',
}

/** Badge "Từ ECO-xxx" / "Từ NCR-xxx" — Đợt 2D truy vết nguồn PR */
function OriginBadge({ pr }: { pr: PurchaseRequest }) {
  if (!pr.originType) return null
  const label = `Từ ${pr.originLabel || `${pr.originType}`}`
  const href = ORIGIN_ROUTE[pr.originType]
  const style: React.CSSProperties = {
    background: pr.originType === 'NCR' ? SEMANTIC_COLORS.danger.bg : SEMANTIC_COLORS.info.bg,
    color: pr.originType === 'NCR' ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.info.solid,
    fontSize: 'var(--text-2xs)',
    fontWeight: 700,
  }
  if (!href) return <span className="badge" style={style}>{label}</span>
  return (
    <Link href={href} onClick={e => e.stopPropagation()} className="badge" style={style} title={`Xem trang ${pr.originType}`}>
      {label}
    </Link>
  )
}

export default function PurchaseRequestsPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const [prs, setPrs] = useState<PurchaseRequest[]>([])
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    params.set('page', String(page))
    const res = await apiFetch(`/api/purchase-requests?${params}`)
    if (res.ok) {
      setPrs(res.purchaseRequests || [])
      setPagination(res.pagination)
    }
    setLoading(false)
  }, [statusFilter, page])

  useEffect(() => { setPage(1) }, [statusFilter])
  useEffect(() => { loadData() }, [loadData])

  const canCreate = CAN_CREATE_ROLES.includes(user?.roleCode || '')

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Đề nghị mua hàng (PR)"
        subtitle="Danh sách yêu cầu mua vật tư — có truy vết nguồn ECO/NCR"
        actions={canCreate ? (
          <Button variant="primary" onClick={() => router.push('/dashboard/warehouse/purchase-requests/new')}>
            + Tạo PR
          </Button>
        ) : undefined}
      />

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      {prs.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="Chưa có đề nghị mua hàng nào"
          description={canCreate ? 'Bấm "+ Tạo PR" để tạo yêu cầu mua vật tư' : undefined}
        />
      ) : (
        <div className="dt-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã PR</th>
                <th>Dự án</th>
                <th>Trạng thái</th>
                <th>Ưu tiên</th>
                <th>Nguồn</th>
                <th className="text-right">Số dòng VT</th>
                <th>Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {prs.map(pr => (
                <PrRow
                  key={pr.id}
                  pr={pr}
                  expanded={expandedId === pr.id}
                  onToggle={() => setExpandedId(expandedId === pr.id ? null : pr.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
      )}
    </div>
  )
}

function PrRow({ pr, expanded, onToggle }: { pr: PurchaseRequest; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle}>
        <td>
          <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>
            {expanded ? '▼' : '▶'} {pr.prCode}
          </span>
        </td>
        <td>
          <span style={{ color: 'var(--text-primary)' }}>{pr.project.projectCode}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{pr.project.projectName}</span>
        </td>
        <td><StatusBadge category="pr" status={pr.status} /></td>
        <td className="text-xs" style={{ color: pr.urgency === 'NORMAL' ? 'var(--text-secondary)' : SEMANTIC_COLORS.danger.solid }}>
          {URGENCY_LABELS[pr.urgency] || pr.urgency}
        </td>
        <td><OriginBadge pr={pr} /></td>
        <td className="text-right font-mono">{pr.itemCount ?? pr.items.length}</td>
        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(pr.createdAt)}</td>
      </tr>

      {expanded && (
        <tr style={{ background: 'var(--bg-section-alt)' }}>
          <td colSpan={7} style={{ padding: '1rem 1.5rem' }}>
            {/* Chi tiết PR: nguồn phát sinh + danh sách vật tư */}
            {pr.originType && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                Nguồn phát sinh: <OriginBadge pr={pr} />{' '}
                <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                  ({pr.originType} — {pr.originLabel || pr.originId})
                </span>
              </p>
            )}
            {pr.notes && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>Ghi chú: {pr.notes}</p>
            )}
            <table style={{ width: '100%', fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th style={{ textAlign: 'left', fontWeight: 600, paddingBottom: 6 }}>Vật tư</th>
                  <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: 6 }}>Số lượng</th>
                  <th style={{ textAlign: 'left', fontWeight: 600, paddingBottom: 6, paddingLeft: 16 }}>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {pr.items.map(item => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.375rem 0' }}>
                      <span className="font-mono" style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}>
                        {item.material?.materialCode || '—'}
                      </span>
                      {item.material?.name || 'Vật tư đã xóa'}
                    </td>
                    <td className="font-mono" style={{ textAlign: 'right', padding: '0.375rem 0' }}>
                      {Number(item.quantity)} {item.material?.unit || ''}
                    </td>
                    <td style={{ padding: '0.375rem 0 0.375rem 16px', color: 'var(--text-muted)' }}>{item.notes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}
