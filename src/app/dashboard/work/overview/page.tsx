'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'

interface Proj { id: string; projectCode: string; projectName: string }
interface DeptRow { deptCode: string; deptName: string; total: number; active: number; done: number; overdue: number }
interface ActiveTask { id: string; title: string; status: string; deptName: string; assignee: string; deadline: string | null; overdue: boolean }
interface Overview {
  project: { projectCode: string; projectName: string; clientName: string; status: string; contractValue: number | null }
  progress: number; totalTasks: number; completedTasks: number
  phases: { phase: string; pct: number }[]
  material: { demand: number; ordered: number; received: number; remaining: number; inProjectStock: number }
  statusSummary: Record<string, number>
  byDept: DeptRow[]
  activeTasks: ActiveTask[]
}
const ST_LABEL: Record<string, { l: string; c: string; b: string }> = {
  OPEN: { l: 'Mới', c: '#475569', b: '#f1f5f9' },
  IN_PROGRESS: { l: 'Đang xử lý', c: '#1d4ed8', b: '#eff6ff' },
  AWAITING_REVIEW: { l: 'Chờ kết thúc', c: '#b45309', b: '#fffbeb' },
  RETURNED: { l: 'Bị trả lại', c: '#e63946', b: '#fef2f2' },
  DONE: { l: 'Hoàn thành', c: '#059669', b: '#ecfdf5' },
}
const billion = (n: number) => (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const PHASE_NAME: Record<string, string> = { P1: 'Khởi tạo', P2: 'Thiết kế & dự toán', P3: 'Cung ứng', P4: 'Mua & nhập kho', P5: 'Sản xuất', P6: 'Đóng dự án', Khác: 'Khác' }

export default function WorkOverviewPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Proj[]>([])
  const [sel, setSel] = useState('')
  const [ov, setOv] = useState<Overview | null>(null)

  useEffect(() => { apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) { setProjects(r.projects || []); if (r.projects?.[0]) setSel(r.projects[0].id) } }) }, [])
  useEffect(() => { if (sel) apiFetch(`/api/work/project-overview/${sel}`).then((r) => { if (r.ok) setOv(r) }) }, [sel])

  const m = ov?.material
  const max = m ? Math.max(m.demand, 1) : 1
  const fbar = (label: string, val: number, color: string, hl = false) => (
    <div className="flex items-center gap-3" style={hl ? { background: '#f8fafc', padding: '6px 8px', borderRadius: 8 } : {}}>
      <span className="text-sm" style={{ width: 220, flexShrink: 0, color: 'var(--text-primary)', fontWeight: hl ? 700 : 400 }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (val / max) * 100)}%`, height: '100%', background: color }} /></div>
      <span className="text-sm font-bold" style={{ width: 70, textAlign: 'right' }}>{billion(val)}</span>
    </div>
  )

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📊 Tổng quan dự án</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Góc nhìn điều hành — HĐQT / BOM</p>
        </div>
        <select value={sel} onChange={(e) => setSel(e.target.value)} className="text-sm px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>

      {!ov ? <div className="h-24 skeleton rounded-xl" /> : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #1d4ed8' }}>
              <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Tiến độ tổng thể</div>
              <div className="text-2xl font-extrabold mt-1" style={{ color: '#1d4ed8' }}>{ov.progress}%</div>
              <div style={{ height: 8, background: '#e2e8f0', borderRadius: 6, overflow: 'hidden', marginTop: 6 }}><div style={{ width: `${ov.progress}%`, height: '100%', background: '#1d4ed8' }} /></div>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #0a2540' }}>
              <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Công việc</div>
              <div className="text-2xl font-extrabold mt-1" style={{ color: '#0a2540' }}>{ov.completedTasks}/{ov.totalTasks}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Hoàn thành / tổng</div>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #059669' }}>
              <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Giá trị hợp đồng</div>
              <div className="text-2xl font-extrabold mt-1" style={{ color: '#059669' }}>{ov.project.contractValue ? billion(ov.project.contractValue) : '—'} <span className="text-sm" style={{ color: 'var(--text-muted)' }}>tỷ</span></div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>KH: {ov.project.clientName}</div>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #d97706' }}>
              <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Tồn gắn dự án</div>
              <div className="text-2xl font-extrabold mt-1" style={{ color: '#d97706' }}>{m ? billion(m.inProjectStock) : 0} <span className="text-sm" style={{ color: 'var(--text-muted)' }}>tỷ</span></div>
            </div>
          </div>

          {m && (
            <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="font-semibold mb-1" style={{ color: 'var(--navy,#0a2540)' }}>📦 Vật tư mua sắm (tỷ đồng)</h3>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Từ Budget vật tư: nhu cầu (BOM) → đã đặt (PO) → đã nhận (GRN).</p>
              <div className="space-y-2">
                {fbar('Nhu cầu vật tư (BOM)', m.demand, '#cbd5e1')}
                {fbar('Đã đặt mua (PO)', m.ordered, '#1d4ed8')}
                {fbar('Đã nhận về (GRN)', m.received, '#059669')}
                {fbar('Còn phải mua', m.remaining, '#e63946', true)}
              </div>
            </div>
          )}

          <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>Tiến độ theo giai đoạn</h3>
            {ov.phases.map((p) => (
              <div key={p.phase} className="flex items-center gap-3 mb-2 text-sm">
                <span style={{ width: 160, flexShrink: 0 }}>{PHASE_NAME[p.phase] || p.phase}</span>
                <div style={{ flex: 1, height: 9, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${p.pct}%`, height: '100%', background: p.pct === 100 ? '#059669' : '#1d4ed8' }} /></div>
                <b style={{ width: 42, textAlign: 'right' }}>{p.pct}%</b>
              </div>
            ))}
            {ov.phases.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có công việc động cho dự án này (áp template để sinh).</div>}
          </div>

          {/* Công việc theo phòng ban */}
          <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>👥 Công việc theo phòng ban</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                  {['Phòng ban', 'Tổng', 'Đang làm', 'Hoàn thành', 'Quá hạn'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {ov.byDept.map((d) => (
                    <tr key={d.deptCode} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{d.deptName}</td>
                      <td className="px-3 py-2">{d.total}</td>
                      <td className="px-3 py-2" style={{ color: '#1d4ed8', fontWeight: 600 }}>{d.active}</td>
                      <td className="px-3 py-2" style={{ color: '#059669' }}>{d.done}</td>
                      <td className="px-3 py-2" style={{ color: d.overdue > 0 ? '#e63946' : 'var(--text-muted)', fontWeight: d.overdue > 0 ? 700 : 400 }}>{d.overdue}</td>
                    </tr>
                  ))}
                  {ov.byDept.length === 0 && <tr><td colSpan={5} className="text-center py-4" style={{ color: 'var(--text-muted)' }}>Chưa có công việc</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Việc đang chạy — ai/phòng/trạng thái/deadline */}
          <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--navy,#0a2540)' }}>📋 Việc đang chạy ({ov.activeTasks.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                  {['Công việc', 'Phòng ban', 'Người làm', 'Trạng thái', 'Hạn'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {ov.activeTasks.map((t) => {
                    const st = ST_LABEL[t.status] || ST_LABEL.OPEN
                    return (
                      <tr key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)} className="cursor-pointer hover:bg-blue-50" style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-3 py-2" style={{ color: '#1d4ed8', fontWeight: 500 }}>{t.title} ↗</td>
                        <td className="px-3 py-2 text-xs">{t.deptName}</td>
                        <td className="px-3 py-2 text-xs">{t.assignee}</td>
                        <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.b, color: st.c }}>{st.l}</span></td>
                        <td className="px-3 py-2 text-xs" style={{ color: t.overdue ? '#e63946' : 'var(--text-muted)', fontWeight: t.overdue ? 700 : 400 }}>{t.deadline ? new Date(t.deadline).toLocaleDateString('vi-VN') : '—'}{t.overdue ? ' (quá hạn)' : ''}</td>
                      </tr>
                    )
                  })}
                  {ov.activeTasks.length === 0 && <tr><td colSpan={5} className="text-center py-4" style={{ color: 'var(--text-muted)' }}>Không có việc đang chạy</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
