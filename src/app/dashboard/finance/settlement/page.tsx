'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface VarianceData {
  projectId: string; totalBudget: number; totalActualPO: number; totalPaid: number;
  variance: number; variancePercent: number; status: string;
  budgetLines: { category: string; planned: number; actual: number; variance: number; description?: string }[]
}

export default function SettlementPage() {
  const [projects, setProjects] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<VarianceData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    apiFetch('/api/projects?limit=100').then(res => {
      if (res.ok) setProjects(res.projects || [])
    })
  }, [])

  useEffect(() => {
    if (!projectId) { setData(null); return }
    setLoading(true)
    apiFetch(`/api/finance/budgets/variance?projectId=${projectId}`).then(res => {
      if (res.ok) setData(res as VarianceData)
      setLoading(false)
    })
  }, [projectId])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>💰 Quyết toán Tài chính Dự án</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Phase 6.2 — Financial Settlement</p>
      </div>

      <div className="card p-4">
        <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Chọn dự án</label>
        <select
          value={projectId} onChange={e => setProjectId(e.target.value)}
          className="mt-1 w-full p-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          <option value="">— Chọn —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>

      {loading && <div className="h-32 skeleton rounded-xl" />}

      {data && (
        <>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Tổng ngân sách', value: data.totalBudget, color: '#0ea5e9' },
              { label: 'Chi phí PO', value: data.totalActualPO, color: '#f59e0b' },
              { label: 'Đã thanh toán', value: data.totalPaid, color: '#8b5cf6' },
              { label: 'Chênh lệch', value: data.variance, color: data.variance >= 0 ? '#16a34a' : '#dc2626', suffix: ` (${data.variancePercent}%)` },
            ].map((c, i) => (
              <div key={i} className="card p-4 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                <p className="text-xl font-bold" style={{ color: c.color }}>
                  {c.value.toLocaleString('vi-VN')} ₫
                </p>
                {c.suffix && <p className="text-xs font-bold" style={{ color: c.color }}>{c.suffix}</p>}
              </div>
            ))}
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{data.status === 'UNDER_BUDGET' ? '✅' : '⚠️'}</span>
              <div>
                <p className="font-bold" style={{ color: data.status === 'UNDER_BUDGET' ? '#16a34a' : '#dc2626' }}>
                  {data.status === 'UNDER_BUDGET' ? 'Trong ngân sách' : 'Vượt ngân sách'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Chi phí thực tế {data.status === 'UNDER_BUDGET' ? 'thấp hơn' : 'cao hơn'} ngân sách {Math.abs(data.variancePercent)}%
                </p>
              </div>
            </div>
          </div>

          {data.budgetLines.length > 0 && (
            <div className="card overflow-hidden">
              <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Chi tiết ngân sách</h3>
              </div>
              <table className="data-table">
                <thead><tr><th>Hạng mục</th><th className="text-right">Dự toán</th><th className="text-right">Thực tế</th><th className="text-right">Chênh lệch</th></tr></thead>
                <tbody>
                  {data.budgetLines.map((b, i) => (
                    <tr key={i}>
                      <td className="text-xs font-bold" style={{ color: 'var(--primary)' }}>{b.category}</td>
                      <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{(b.planned || 0).toLocaleString('vi-VN')} ₫</td>
                      <td className="text-right text-xs font-bold" style={{ color: '#f59e0b' }}>{(b.actual || 0).toLocaleString('vi-VN')} ₫</td>
                      <td className="text-right text-xs font-bold" style={{ color: (b.variance >= 0) ? '#16a34a' : '#dc2626' }}>{(b.variance || 0).toLocaleString('vi-VN')} ₫</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
