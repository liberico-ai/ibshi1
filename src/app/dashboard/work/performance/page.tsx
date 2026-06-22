'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Dept { deptCode: string; deptName: string; done: number; ahead: number; onTime: number; late: number; onTimePct: number; avgCycle: number; returned: number; misRoute: number; score: number }
interface Kpi { onTimePct: number; late: number; done: number; avgCycle: number; returnRate: number }

const scoreColor = (s: number) => s >= 85 ? { b: '#ecfdf5', c: '#059669' } : s >= 65 ? { b: '#fffbeb', c: '#d97706' } : { b: '#fef2f2', c: '#e63946' }

export default function PerformancePage() {
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [depts, setDepts] = useState<Dept[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function loadPerformance() {
    setLoading(true)
    setError('')
    apiFetch('/api/work/performance').then((r) => {
      if (r.ok) { setKpi(r.kpi); setDepts(r.departments) }
      else { setKpi(null); setDepts([]); setError(r.error || 'Không tải được dữ liệu hiệu suất') }
      setLoading(false)
    })
  }

  useEffect(() => { loadPerformance() }, [])

  const cards = kpi ? [
    { l: 'Tỷ lệ đúng hạn', v: `${kpi.onTimePct}%`, c: '#059669' },
    { l: 'Việc chậm', v: kpi.late, c: '#e63946' },
    { l: 'T.gian xử lý TB', v: `${kpi.avgCycle} ngày`, c: '#1d4ed8' },
    { l: 'Tỷ lệ bị trả lại', v: `${kpi.returnRate}%`, c: '#d97706' },
  ] : []

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📈 Hiệu suất & KPI</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Đánh giá theo phòng ban — kỳ hiện tại · nguồn: vòng đời task</p>
      </div>

      {loading ? <div className="h-24 skeleton rounded-xl" /> : error ? (
        <div className="text-center py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={loadPerformance} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Thử lại</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
            {cards.map((c) => (
              <div key={c.l} className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: `3px solid ${c.c}` }}>
                <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{c.l}</div>
                <div className="text-2xl font-extrabold mt-1" style={{ color: c.c }}>{c.v}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>🏢 Hiệu suất theo phòng ban</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                  {['Phòng ban', 'Việc xong', 'Vượt TĐ', 'Đúng hạn', 'Chậm', 'Đúng hạn %', 'T.gian TB', 'Bị trả lại', 'Định tuyến sai', 'Điểm'].map((h) =>
                    <th key={h} className="text-left px-3 py-2 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {depts.map((d) => {
                    const sc = scoreColor(d.score)
                    return (
                      <tr key={d.deptCode} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-3 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{d.deptName}</td>
                        <td className="px-3 py-2">{d.done}</td>
                        <td className="px-3 py-2">{d.ahead}</td>
                        <td className="px-3 py-2">{d.onTime}</td>
                        <td className="px-3 py-2" style={{ color: d.late > 0 ? '#e63946' : 'inherit', fontWeight: d.late > 0 ? 700 : 400 }}>{d.late}</td>
                        <td className="px-3 py-2">{d.onTimePct}%</td>
                        <td className="px-3 py-2">{d.avgCycle}đ</td>
                        <td className="px-3 py-2">{d.returned}</td>
                        <td className="px-3 py-2" style={{ color: d.misRoute > 0 ? '#e63946' : 'inherit', fontWeight: d.misRoute > 0 ? 700 : 400 }}>{d.misRoute}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded font-extrabold text-xs" style={{ background: sc.b, color: sc.c }}>{d.score}</span></td>
                      </tr>
                    )
                  })}
                  {depts.length === 0 && <tr><td colSpan={10} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu trong kỳ</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>* Định tuyến sai = số việc phòng này giao đi bị trả lại "sai phạm vi". Điểm = đúng-hạn% − phạt chậm/trả-lại/định-tuyến-sai. Đầu vào cho khoán/KPI tháng.</div>
          </div>
        </>
      )}
    </div>
  )
}
