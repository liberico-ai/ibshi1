'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, Button, KPICard, EmptyState } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface Dept { deptCode: string; deptName: string; done: number; ahead: number; onTime: number; late: number; onTimePct: number; avgCycle: number; returned: number; misRoute: number; score: number }
interface Kpi { onTimePct: number; late: number; done: number; avgCycle: number; returnRate: number }

const scoreColor = (s: number) => s >= 85 ? { b: SEMANTIC_COLORS.success.bg, c: SEMANTIC_COLORS.success.solid } : s >= 65 ? { b: SEMANTIC_COLORS.warning.bg, c: SEMANTIC_COLORS.warning.solid } : { b: SEMANTIC_COLORS.danger.bg, c: SEMANTIC_COLORS.danger.solid }

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

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Hiệu suất & KPI" subtitle="Đánh giá theo phòng ban — kỳ hiện tại" />

      {loading ? <div className="h-24 skeleton rounded-xl" /> : error ? (
        <EmptyState icon="!" title={error} action={<Button variant="outline" onClick={loadPerformance}>Thử lại</Button>} />
      ) : (
        <>
          {kpi && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
              <KPICard label="Tỷ lệ đúng hạn" value={`${kpi.onTimePct}%`} accentColor={SEMANTIC_COLORS.success.solid} />
              <KPICard label="Việc chậm" value={kpi.late} accentColor={kpi.late > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
              <KPICard label="T.gian xử lý TB" value={`${kpi.avgCycle} ngày`} accentColor={SEMANTIC_COLORS.info.solid} />
              <KPICard label="Tỷ lệ bị trả lại" value={`${kpi.returnRate}%`} accentColor={SEMANTIC_COLORS.warning.solid} />
            </div>
          )}

          <div className="glass-card p-5">
            <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>Hiệu suất theo phòng ban</h3>
            <div className="dt-wrapper">
              <table className="data-table">
                <thead><tr>
                  {['Phòng ban', 'Xong', 'Vượt TĐ', 'Đúng hạn', 'Chậm', '%', 'T.gian', 'Trả lại', 'Sai PV', 'Điểm'].map((h) =>
                    <th key={h}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {depts.map((d) => {
                    const sc = scoreColor(d.score)
                    return (
                      <tr key={d.deptCode}>
                        <td className="font-semibold">{d.deptName}</td>
                        <td>{d.done}</td>
                        <td>{d.ahead}</td>
                        <td>{d.onTime}</td>
                        <td style={{ color: d.late > 0 ? SEMANTIC_COLORS.danger.solid : 'inherit', fontWeight: d.late > 0 ? 700 : 400 }}>{d.late}</td>
                        <td>{d.onTimePct}%</td>
                        <td>{d.avgCycle}d</td>
                        <td>{d.returned}</td>
                        <td style={{ color: d.misRoute > 0 ? SEMANTIC_COLORS.danger.solid : 'inherit', fontWeight: d.misRoute > 0 ? 700 : 400 }}>{d.misRoute}</td>
                        <td><span className="text-[10px] px-1.5 py-0.5 rounded font-extrabold" style={{ background: sc.b, color: sc.c }}>{d.score}</span></td>
                      </tr>
                    )
                  })}
                  {depts.length === 0 && <tr><td colSpan={10}><EmptyState icon="📊" title="Chưa có dữ liệu trong kỳ" /></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>* Sai PV = việc phòng giao bị trả lại sai phạm vi. Điểm = đúng-hạn% − phạt.</div>
          </div>
        </>
      )}
    </div>
  )
}
