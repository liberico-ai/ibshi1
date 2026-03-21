'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface SalaryRecord {
  id: string; month: number; year: number; baseSalary: string;
  actualDays: string; overtimeHours: string; overtimePay: string;
  allowances: string; socialInsurance: string; healthInsurance: string;
  unemploymentIns: string; personalTax: string; netSalary: string;
  status: string;
  employee: { employeeCode: string; fullName: string }
}

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT: { label: 'Nháp', bg: '#f1f5f9', color: '#64748b' },
  CALCULATED: { label: 'Đã tính', bg: '#eff6ff', color: '#2563eb' },
  APPROVED: { label: 'Đã duyệt', bg: '#f0fdf4', color: '#16a34a' },
  PAID: { label: 'Đã chi', bg: '#faf5ff', color: '#7c3aed' },
}

export default function SalaryPage() {
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [totals, setTotals] = useState({ grossPay: 0, deductions: 0, netPay: 0, count: 0 })
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)

  useEffect(() => { loadData() }, [month, year])

  async function loadData() {
    setLoading(true)
    const res = await apiFetch(`/api/hr/salary?month=${month}&year=${year}`)
    if (res.ok) { setRecords(res.records); setTotals(res.totals) }
    setLoading(false)
  }

  async function handleCalculate() {
    setCalculating(true)
    const res = await apiFetch('/api/hr/salary', { method: 'POST', body: JSON.stringify({ month, year }) })
    setCalculating(false)
    if (res.ok) loadData()
  }

  const fmt = (v: string | number) => Number(v).toLocaleString('vi-VN')

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Bảng lương</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tháng {month}/{year} • {totals.count} nhân viên</p>
        </div>
        <div className="flex items-center gap-3">
          <select className="input w-24" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>T{i + 1}</option>)}
          </select>
          <select className="input w-28" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={handleCalculate} disabled={calculating} className="btn-accent disabled:opacity-50">
            {calculating ? '⏳ Đang tính...' : '🧮 Tính lương'}
          </button>
        </div>
      </div>

      {/* Salary Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4" style={{ borderTop: '3px solid #16a34a' }}>
          <p className="text-xl font-extrabold" style={{ color: '#16a34a' }}>{fmt(totals.grossPay)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Tổng thu nhập (VNĐ)</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #dc2626' }}>
          <p className="text-xl font-extrabold" style={{ color: '#dc2626' }}>{fmt(totals.deductions)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Tổng khấu trừ</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #0ea5e9' }}>
          <p className="text-xl font-extrabold" style={{ color: '#0ea5e9' }}>{fmt(totals.netPay)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Thực lĩnh</p>
        </div>
      </div>

      {/* Salary table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã NV</th><th>Họ tên</th><th className="text-right">Lương cơ bản</th>
              <th className="text-right">Ngày công</th><th className="text-right">OT (h)</th>
              <th className="text-right">Phụ cấp</th><th className="text-right">BHXH</th>
              <th className="text-right">Thuế TNCN</th><th className="text-right">Thực lĩnh</th>
              <th>TT</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Đang tải...</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                Chưa có dữ liệu lương. Bấm &quot;Tính lương&quot; để tạo bảng lương.
              </td></tr>
            ) : records.map(r => {
              const st = STATUS_MAP[r.status] || STATUS_MAP.DRAFT
              return (
                <tr key={r.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{r.employee.employeeCode}</span></td>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.employee.fullName}</td>
                  <td className="text-right text-xs font-mono">{fmt(r.baseSalary)}</td>
                  <td className="text-right text-xs">{r.actualDays}</td>
                  <td className="text-right text-xs">{Number(r.overtimeHours) > 0 ? r.overtimeHours : '-'}</td>
                  <td className="text-right text-xs">{fmt(r.allowances)}</td>
                  <td className="text-right text-xs" style={{ color: '#dc2626' }}>-{fmt(Number(r.socialInsurance) + Number(r.healthInsurance) + Number(r.unemploymentIns))}</td>
                  <td className="text-right text-xs" style={{ color: '#dc2626' }}>{Number(r.personalTax) > 0 ? `-${fmt(r.personalTax)}` : '-'}</td>
                  <td className="text-right font-semibold" style={{ color: '#16a34a' }}>{fmt(r.netSalary)}</td>
                  <td><span className="badge" style={{ background: st.bg, color: st.color }}>{st.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
