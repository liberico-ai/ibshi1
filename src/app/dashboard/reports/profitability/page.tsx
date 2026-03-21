'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface ProjectPL {
  id: string; projectCode: string; projectName: string; clientName: string;
  status: string; contractValue: number; revenue: number; costs: number;
  grossProfit: number; margin: number; cashIn: number; cashOut: number;
  netCashflow: number; budgetPlanned: number; budgetActual: number; budgetVariance: number;
}
interface Totals { contractValue: number; revenue: number; costs: number; grossProfit: number; cashIn: number; cashOut: number }

export default function ProfitabilityPage() {
  const [projects, setProjects] = useState<ProjectPL[]>([])
  const [totals, setTotals] = useState<Totals>({ contractValue: 0, revenue: 0, costs: 0, grossProfit: 0, cashIn: 0, cashOut: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/reports/project-profitability').then(res => {
      if (res.ok) { setProjects(res.projects); setTotals(res.totals) }
      setLoading(false)
    })
  }, [])

  const fmt = (v: number) => v.toLocaleString('vi-VN')

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
    </div>
  )

  const overallMargin = totals.contractValue > 0
    ? Math.round(totals.grossProfit / totals.contractValue * 100) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>💹 Lợi nhuận theo dự án</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{projects.length} dự án • Biên lợi nhuận TB: {overallMargin}%</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card p-4" style={{ borderTop: '3px solid #0ea5e9' }}>
          <p className="text-lg font-extrabold" style={{ color: '#0ea5e9' }}>{fmt(totals.contractValue)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Giá trị HĐ</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #16a34a' }}>
          <p className="text-lg font-extrabold" style={{ color: '#16a34a' }}>{fmt(totals.revenue)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Doanh thu</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #dc2626' }}>
          <p className="text-lg font-extrabold" style={{ color: '#dc2626' }}>{fmt(totals.costs)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Chi phí</p>
        </div>
        <div className="card p-4" style={{ borderTop: `3px solid ${totals.grossProfit >= 0 ? '#16a34a' : '#dc2626'}` }}>
          <p className="text-lg font-extrabold" style={{ color: totals.grossProfit >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(totals.grossProfit)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Lợi nhuận gộp</p>
        </div>
        <div className="card p-4" style={{ borderTop: `3px solid ${overallMargin >= 20 ? '#16a34a' : '#f59e0b'}` }}>
          <p className="text-lg font-extrabold" style={{ color: overallMargin >= 20 ? '#16a34a' : '#f59e0b' }}>{overallMargin}%</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Biên LN trung bình</p>
        </div>
      </div>

      {/* Profitability table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã DA</th><th>Tên dự án</th><th>Khách hàng</th>
              <th className="text-right">Giá trị HĐ</th><th className="text-right">Chi phí</th>
              <th className="text-right">LN gộp</th><th className="text-right">Biên LN</th>
              <th className="text-right">Cash In</th><th className="text-right">Cash Out</th>
              <th>TT</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu</td></tr>
            ) : projects.map(p => (
              <tr key={p.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{p.projectCode}</span></td>
                <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.projectName}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.clientName}</td>
                <td className="text-right font-mono text-xs">{fmt(p.contractValue)}</td>
                <td className="text-right font-mono text-xs" style={{ color: '#dc2626' }}>{p.costs > 0 ? fmt(p.costs) : '-'}</td>
                <td className="text-right font-mono text-xs font-bold" style={{ color: p.grossProfit >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(p.grossProfit)}</td>
                <td className="text-right">
                  <span className="badge font-mono" style={{
                    background: p.margin >= 20 ? '#f0fdf4' : p.margin >= 0 ? '#fefce8' : '#fef2f2',
                    color: p.margin >= 20 ? '#16a34a' : p.margin >= 0 ? '#ca8a04' : '#dc2626',
                  }}>{p.margin}%</span>
                </td>
                <td className="text-right font-mono text-xs" style={{ color: '#16a34a' }}>{p.cashIn > 0 ? `+${fmt(p.cashIn)}` : '-'}</td>
                <td className="text-right font-mono text-xs" style={{ color: '#dc2626' }}>{p.cashOut > 0 ? `-${fmt(p.cashOut)}` : '-'}</td>
                <td><span className="badge" style={{
                  background: p.status === 'ACTIVE' ? '#f0fdf4' : '#f1f5f9',
                  color: p.status === 'ACTIVE' ? '#16a34a' : '#64748b',
                }}>{p.status === 'ACTIVE' ? 'Đang TK' : p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
