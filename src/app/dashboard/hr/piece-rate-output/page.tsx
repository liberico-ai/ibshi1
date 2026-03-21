'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Output {
  id: string; month: number; year: number; quantity: string; unitPrice: string; totalAmount: string; status: string; notes: string | null;
  contract: { contractCode: string; teamCode: string; workType: string; unit: string; project: { projectCode: string } | null }
}

export default function PieceRateOutputPage() {
  const [outputs, setOutputs] = useState<Output[]>([])
  const [totals, setTotals] = useState({ totalQuantity: 0, totalAmount: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())

  const fetchData = () => {
    setLoading(true)
    apiFetch(`/api/hr/piece-rate-output?month=${month}&year=${year}`).then(res => {
      if (res.ok) { setOutputs(res.outputs || []); setTotals(res.totals || { totalQuantity: 0, totalAmount: 0, count: 0 }) }
      setLoading(false)
    })
  }

  useEffect(() => { fetchData() }, [month, year])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📊 Khối lượng Khoán tháng</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Monthly Piece-Rate Output</p>
        </div>
        <div className="flex gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="text-sm p-1.5 rounded-lg" style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>T{i + 1}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="text-sm p-1.5 rounded-lg" style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>{totals.count}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Hợp đồng có KL</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{totals.totalQuantity.toLocaleString('vi-VN')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tổng KL</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: '#16a34a' }}>{totals.totalAmount.toLocaleString('vi-VN')}₫</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tổng thành tiền</p>
        </div>
      </div>

      {loading ? <div className="h-32 skeleton rounded-xl" /> : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th>HĐ</th><th>Dự án</th><th>Tổ</th><th>Công việc</th><th className="text-right">KL</th><th>ĐV</th><th className="text-right">Đơn giá</th><th className="text-right">Thành tiền</th><th>TT</th></tr></thead>
            <tbody>
              {outputs.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có KL khoán T{month}/{year}</td></tr>
              ) : outputs.map(o => (
                <tr key={o.id}>
                  <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{o.contract.contractCode}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.contract.project?.projectCode || '—'}</td>
                  <td className="text-xs font-bold" style={{ color: 'var(--primary)' }}>{o.contract.teamCode}</td>
                  <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{o.contract.workType}</td>
                  <td className="text-right text-xs font-bold" style={{ color: '#f59e0b' }}>{Number(o.quantity).toLocaleString('vi-VN')}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.contract.unit}</td>
                  <td className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{Number(o.unitPrice).toLocaleString('vi-VN')}₫</td>
                  <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{Number(o.totalAmount).toLocaleString('vi-VN')}₫</td>
                  <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
                    background: o.status === 'VERIFIED' ? '#16a34a20' : '#f59e0b20',
                    color: o.status === 'VERIFIED' ? '#16a34a' : '#f59e0b',
                  }}>{o.status === 'DRAFT' ? 'Nháp' : o.status === 'VERIFIED' ? 'Xác nhận' : o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
