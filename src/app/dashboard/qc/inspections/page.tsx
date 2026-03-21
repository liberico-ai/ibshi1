'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface InspectionRecord {
  id: string; inspectionCode: string; type: string; status: string; result: string | null;
  inspectionDate: string | null; createdAt: string;
  workOrder: { woCode: string } | null
  items: { id: string }[]
}

const typeLabel: Record<string, string> = { DIMENSIONAL: 'Kích thước', VISUAL: 'Ngoại quan', NDT: 'NDT', PRESSURE: 'Áp lực', WELDING: 'Hàn', PAINTING: 'Sơn' }
const statusLabel: Record<string, string> = { PENDING: 'Chờ', IN_PROGRESS: 'Đang KT', COMPLETED: 'Xong', FAILED: 'Không đạt' }
const statusColor: Record<string, string> = { PENDING: '#888', IN_PROGRESS: '#0ea5e9', COMPLETED: '#16a34a', FAILED: '#dc2626' }
const resultColor: Record<string, string> = { PASS: '#16a34a', FAIL: '#dc2626', CONDITIONAL: '#f59e0b' }

export default function InspectionsPage() {
  const [inspections, setInspections] = useState<InspectionRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/qc').then(res => {
      if (res.ok) setInspections(res.inspections || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const passCount = inspections.filter(i => i.result === 'PASS').length
  const failCount = inspections.filter(i => i.result === 'FAIL').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🔍 Kiểm tra chất lượng</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{inspections.length} lần kiểm tra • ✓ {passCount} đạt • ✗ {failCount} không đạt</p>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã KT</th><th>WO</th><th>Loại</th><th>Trạng thái</th><th>Kết quả</th><th>Items</th><th>Ngày</th></tr></thead>
          <tbody>
            {inspections.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có kiểm tra</td></tr>
            ) : inspections.map(i => (
              <tr key={i.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{i.inspectionCode}</span></td>
                <td className="text-xs font-mono" style={{ color: '#0ea5e9' }}>{i.workOrder?.woCode || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{typeLabel[i.type] || i.type}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[i.status] || '#888'}20`, color: statusColor[i.status] || '#888' }}>{statusLabel[i.status] || i.status}</span></td>
                <td>{i.result ? <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${resultColor[i.result] || '#888'}20`, color: resultColor[i.result] || '#888' }}>{i.result}</span> : <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td className="text-xs font-bold" style={{ color: '#0ea5e9' }}>{i.items?.length || 0}</td>
                <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{i.inspectionDate ? new Date(i.inspectionDate).toLocaleDateString('vi-VN') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
