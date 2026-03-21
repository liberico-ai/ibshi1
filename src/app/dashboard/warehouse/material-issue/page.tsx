'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface MaterialIssueRecord {
  id: string; quantity: number; heatNumber: string | null; lotNumber: string | null; notes: string | null; createdAt: string;
  type: string; reason: string; referenceNo: string | null;
  material: { materialCode: string; name: string; unit: string }
}

export default function MaterialIssuePage() {
  const [issues, setIssues] = useState<MaterialIssueRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/stock-movements?type=OUT&reason=wo_issue').then(res => {
      if (res.ok) setIssues(res.movements || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalQty = issues.reduce((s, r) => s + Number(r.quantity), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📤 Cấp phát vật tư</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{issues.length} phiếu cấp • Tổng SL: {totalQty.toLocaleString('vi-VN')}</p>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>WO</th><th>Vật tư</th><th>SL</th><th>ĐVT</th><th>Heat No.</th><th>Lot No.</th><th>Ghi chú</th><th>Ngày</th></tr></thead>
          <tbody>
            {issues.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có phiếu cấp vật tư</td></tr>
            ) : issues.map(r => (
              <tr key={r.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{r.referenceNo || '—'}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{r.material.materialCode} — {r.material.name}</td>
                <td className="text-xs font-bold" style={{ color: '#dc2626' }}>{Number(r.quantity).toLocaleString('vi-VN')}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.material.unit}</td>
                <td className="text-xs font-mono" style={{ color: '#0ea5e9' }}>{r.heatNumber || '—'}</td>
                <td className="text-xs font-mono" style={{ color: '#f59e0b' }}>{r.lotNumber || '—'}</td>
                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{new Date(r.createdAt).toLocaleDateString('vi-VN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
