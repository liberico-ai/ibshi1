'use client'

/**
 * Đợt 2D — Truy vết ngược: section "PR phát sinh" từ một nguồn ECO/NCR.
 * Query PR theo originType + originId (GET /api/purchase-requests?originType=&originId=).
 * Dùng ở: NCR detail modal + BOM version detail page.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/ui'

interface OriginPr {
  id: string
  prCode: string
  status: string
  createdAt: string
  itemCount?: number
  items?: unknown[]
  project?: { projectCode: string }
}

export function OriginPrSection({ originType, originId }: {
  originType: 'ECO' | 'NCR'
  originId: string
}) {
  const [prs, setPrs] = useState<OriginPr[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ originType, originId })
    const res = await apiFetch(`/api/purchase-requests?${params}`)
    if (res.ok) setPrs(res.purchaseRequests || [])
    setLoading(false)
  }, [originType, originId])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="input-label" style={{ marginBottom: 0 }}>
          PR phát sinh ({prs.length})
        </label>
        <Link
          href="/dashboard/warehouse/purchase-requests"
          className="text-xs"
          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
        >
          Xem tất cả PR
        </Link>
      </div>

      {loading ? (
        <div className="h-8 skeleton rounded-lg" />
      ) : prs.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Chưa có PR nào phát sinh từ {originType} này
        </p>
      ) : (
        <div className="space-y-1.5">
          {prs.map(pr => (
            <div
              key={pr.id}
              className="flex items-center gap-3 p-2.5 rounded-lg"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)' }}
            >
              <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{pr.prCode}</span>
              <StatusBadge category="pr" status={pr.status} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {pr.itemCount ?? pr.items?.length ?? 0} dòng VT
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {formatDate(pr.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
