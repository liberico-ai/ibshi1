'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Contract {
  id: string; contractCode: string; type: string; startDate: string; endDate: string | null;
  status: string; baseSalary: number; createdAt: string;
  employee: { employeeCode: string; fullName: string } | null
}

const typeLabel: Record<string, string> = { PERMANENT: 'Chính thức', PROBATION: 'Thử việc', PIECE_RATE: 'Khoán', SEASONAL: 'Thời vụ' }
const typeColor: Record<string, string> = { PERMANENT: '#16a34a', PROBATION: '#f59e0b', PIECE_RATE: '#0ea5e9', SEASONAL: '#8b5cf6' }
const statusLabel: Record<string, string> = { ACTIVE: 'Hiệu lực', EXPIRED: 'Hết hạn', TERMINATED: 'Chấm dứt' }
const statusColor: Record<string, string> = { ACTIVE: '#16a34a', EXPIRED: '#888', TERMINATED: '#dc2626' }

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/hr/contracts').then(res => {
      if (res.ok) setContracts(res.contracts || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📑 Hợp đồng lao động</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{contracts.length} hợp đồng</p>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã HĐ</th><th>Nhân viên</th><th>Loại</th><th className="text-right">Lương cơ bản</th><th>Bắt đầu</th><th>Kết thúc</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có hợp đồng</td></tr>
            ) : contracts.map(c => (
              <tr key={c.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{c.contractCode}</span></td>
                <td><div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{c.employee?.fullName || '—'}</div><div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{c.employee?.employeeCode || ''}</div></td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${typeColor[c.type] || '#888'}20`, color: typeColor[c.type] || '#888' }}>{typeLabel[c.type] || c.type}</span></td>
                <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{Number(c.baseSalary).toLocaleString('vi-VN')} ₫</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(c.startDate).toLocaleDateString('vi-VN')}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.endDate ? new Date(c.endDate).toLocaleDateString('vi-VN') : '—'}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${statusColor[c.status] || '#888'}20`, color: statusColor[c.status] || '#888' }}>{statusLabel[c.status] || c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
