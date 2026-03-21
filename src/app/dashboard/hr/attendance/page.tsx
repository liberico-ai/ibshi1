'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface AttendanceRecord {
  id: string; date: string; checkIn: string | null; checkOut: string | null; status: string;
  overtime: string; note: string | null;
  employee: { employeeCode: string; fullName: string }
}

const statusLabel: Record<string, string> = { PRESENT: 'Có mặt', ABSENT: 'Vắng', LATE: 'Trễ', LEAVE: 'Nghỉ phép', HOLIDAY: 'Lễ' }
const statusColor: Record<string, string> = { PRESENT: '#16a34a', ABSENT: '#dc2626', LATE: '#f59e0b', LEAVE: '#0ea5e9', HOLIDAY: '#8b5cf6' }

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const load = () => {
    const url = filter ? `/api/hr/attendance?status=${filter}` : '/api/hr/attendance'
    apiFetch(url).then(res => { if (res.ok) setRecords(res.records || res.attendance || []); setLoading(false) })
  }
  useEffect(() => { load() }, [filter])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const statusCounts = records.reduce((acc: Record<string, number>, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📋 Điểm danh</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{records.length} bản ghi</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} className="text-xs px-3 py-1 rounded-full font-medium"
          style={{ background: !filter ? 'var(--accent)' : 'var(--surface-hover)', color: !filter ? '#fff' : 'var(--text-muted)' }}>
          Tất cả ({records.length})
        </button>
        {Object.entries(statusLabel).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === k ? statusColor[k] : 'var(--surface-hover)', color: filter === k ? '#fff' : 'var(--text-muted)' }}>
            {v} ({statusCounts[k] || 0})
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Nhân viên</th><th>Ngày</th><th>Check-in</th><th>Check-out</th><th>OT</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu điểm danh</td></tr>
            ) : records.map(r => (
              <tr key={r.id}>
                <td><div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{r.employee?.fullName || '—'}</div><div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{r.employee?.employeeCode || '—'}</div></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(r.date).toLocaleDateString('vi-VN')}</td>
                <td className="text-xs font-mono" style={{ color: '#16a34a' }}>{r.checkIn || '—'}</td>
                <td className="text-xs font-mono" style={{ color: '#dc2626' }}>{r.checkOut || '—'}</td>
                <td className="text-xs font-mono" style={{ color: '#f59e0b' }}>{Number(r.overtime) > 0 ? `${r.overtime}h` : '—'}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${statusColor[r.status] || '#888'}20`, color: statusColor[r.status] || '#888' }}>{statusLabel[r.status] || r.status}</span></td>
                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
