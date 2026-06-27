'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { PageHeader, StatusBadge, EmptyState } from '@/components/ui'

interface Inspection {
  id: string; inspectionCode: string; type: string; stepCode: string;
  status: string; totalItems: number; passedItems: number; failedItems: number;
  inspectedAt: string | null; createdAt: string;
}

const QC_TYPES: Record<string, string> = {
  material_incoming: 'Nghiệm thu VT', ndt: 'NDT', pressure_test: 'Thử áp',
  dimensional: 'Kích thước', visual: 'Trực quan', fat: 'FAT', sat: 'SAT',
}

export default function InspectionsPage() {
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/qc').then(res => {
      if (res.ok) setInspections(res.inspections || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const passCount = inspections.filter(i => i.status === 'PASSED').length
  const failCount = inspections.filter(i => i.status === 'FAILED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kiểm tra chất lượng"
        subtitle={`${inspections.length} biên bản · ✓ ${passCount} đạt · ✗ ${failCount} không đạt`}
      />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Mã KT</th><th>Loại</th><th>Bước WF</th><th>Trạng thái</th><th>Checklist</th><th>Ngày KT</th></tr>
          </thead>
          <tbody>
            {inspections.length === 0 ? (
              <tr><td colSpan={6}><EmptyState icon="🔍" title="Chưa có biên bản kiểm tra" /></td></tr>
            ) : inspections.map(i => (
              <tr key={i.id}>
                <td><span className="font-mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{i.inspectionCode}</span></td>
                <td>{QC_TYPES[i.type] || i.type}</td>
                <td className="font-mono" style={{ color: 'var(--text-muted)' }}>{i.stepCode}</td>
                <td><StatusBadge category="task" status={i.status === 'PASSED' ? 'DONE' : i.status === 'FAILED' ? 'RETURNED' : i.status === 'CONDITIONAL' ? 'AWAITING_REVIEW' : 'OPEN'} /></td>
                <td>
                  {i.totalItems > 0 ? (
                    <span className="font-mono">{i.passedItems}/{i.totalItems}</span>
                  ) : '—'}
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{i.inspectedAt ? formatDate(i.inspectedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
