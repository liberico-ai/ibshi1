'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'

// Tóm tắt WBS (P1.2A) + dự toán (P1.2) để BGĐ xem tại chỗ trước khi duyệt P1.3.
// Đọc resultData của 2 bước qua step-task (đã DONE thì API trả bản DONE gần nhất).
type Totals = { totalMaterial?: number; totalLabor?: number; totalService?: number; totalOverhead?: number; totalEstimate?: number }

export default function PlanEstimatePreview({ projectId }: { projectId: string }) {
  const [wbsCount, setWbsCount] = useState<number | null>(null)
  const [est, setEst] = useState<Totals | null>(null)

  useEffect(() => {
    apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=P1.2A`).then((r) => {
      if (r.ok && r.task) {
        const w = r.task.resultData?.wbsItems
        const arr = typeof w === 'string' ? JSON.parse(w || '[]') : Array.isArray(w) ? w : []
        setWbsCount(Array.isArray(arr) ? arr.length : 0)
      } else setWbsCount(0)
    }).catch(() => setWbsCount(0))
    apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=P1.2`).then((r) => {
      if (r.ok && r.task) setEst(r.task.resultData as Totals)
      else setEst({})
    }).catch(() => setEst({}))
  }, [projectId])

  const row = (label: string, val?: number) => (
    <div className="flex justify-between text-sm py-1" style={{ borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{val ? formatCurrency(val) : '—'}</span>
    </div>
  )

  return (
    <div className="rounded-xl p-4 mb-4 grid gap-4" style={{ background: '#fff', border: '1px solid var(--border)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      {/* Kế hoạch (WBS) */}
      <div className="rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold" style={{ color: '#3b82f6' }}>Kế hoạch (WBS)</span>
          <a href={`/dashboard/milestones?project=${projectId}`} className="text-xs hover:underline" style={{ color: '#2563eb' }}>Mở Cột mốc →</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-heading)' }}>{wbsCount == null ? '…' : wbsCount}</span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>hạng mục WBS</span>
        </div>
      </div>

      {/* Dự toán */}
      <div className="rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold" style={{ color: '#7c3aed' }}>Dự toán chi phí</span>
          <a href={`/dashboard/estimates?project=${projectId}`} className="text-xs hover:underline" style={{ color: '#2563eb' }}>Mở Dự toán →</a>
        </div>
        {est == null ? (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>
        ) : (
          <>
            {row('Vật tư', est.totalMaterial)}
            {row('Nhân công', est.totalLabor)}
            {row('Dịch vụ', est.totalService)}
            {row('Chi phí chung', est.totalOverhead)}
            <div className="flex justify-between py-1.5 mt-1" style={{ borderTop: '2px solid var(--border)' }}>
              <span className="text-sm font-bold">TỔNG DỰ TOÁN</span>
              <span className="font-mono font-extrabold" style={{ color: '#059669', fontSize: 16 }}>{est.totalEstimate ? formatCurrency(est.totalEstimate) : '—'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
