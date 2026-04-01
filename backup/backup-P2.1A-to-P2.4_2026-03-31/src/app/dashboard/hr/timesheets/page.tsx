'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface TimesheetEntry {
  id: string; workDate: string; hoursRegular: string; hoursOT: string; taskDescription: string | null; status: string;
  employee: { employeeCode: string; fullName: string }
  project: { projectCode: string; projectName: string }
}

export default function TimesheetPage() {
  const [timesheets, setTimesheets] = useState<TimesheetEntry[]>([])
  const [summary, setSummary] = useState({ regular: 0, ot: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [employeeList, setEmployeeList] = useState<{ id: string; employeeCode: string; fullName: string }[]>([])

  const load = () => {
    apiFetch('/api/hr/timesheets').then(res => {
      if (res.ok) { setTimesheets(res.timesheets); setSummary(res.summary) }
      setLoading(false)
    })
  }
  useEffect(() => { load() }, [])

  const openForm = async () => {
    const [pRes, eRes] = await Promise.all([apiFetch('/api/projects?page=1&limit=50'), apiFetch('/api/hr/employees')])
    if (pRes.ok) setProjectList(pRes.projects || [])
    if (eRes.ok) setEmployeeList(eRes.employees || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/hr/timesheets', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: fd.get('employeeId'), projectId: fd.get('projectId'),
        workDate: fd.get('workDate'), hoursRegular: Number(fd.get('hoursRegular') || 8),
        hoursOT: Number(fd.get('hoursOT') || 0), taskDescription: fd.get('taskDescription') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() } else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>⏰ Chấm công</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{timesheets.length} bản ghi</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Chấm công</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Giờ hành chính</p><p className="text-lg font-bold" style={{ color: '#0ea5e9' }}>{summary.regular}h</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Giờ tăng ca</p><p className="text-lg font-bold" style={{ color: '#f59e0b' }}>{summary.ot}h</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Tổng cộng</p><p className="text-lg font-bold" style={{ color: '#16a34a' }}>{summary.total}h</p></div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Chấm công nhân viên</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <select name="employeeId" required className="input-field text-sm"><option value="">— Nhân viên —</option>{employeeList.map(e => <option key={e.id} value={e.id}>{e.employeeCode} — {e.fullName}</option>)}</select>
            <select name="projectId" required className="input-field text-sm"><option value="">— Dự án —</option>{projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}</select>
            <input name="workDate" type="date" required className="input-field text-sm" />
            <input name="hoursRegular" type="number" step="0.5" defaultValue={8} placeholder="Giờ HC" className="input-field text-sm" />
            <input name="hoursOT" type="number" step="0.5" defaultValue={0} placeholder="Giờ OT" className="input-field text-sm" />
            <input name="taskDescription" placeholder="Công việc" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Nhân viên</th><th>Dự án</th><th>Ngày</th><th className="text-right">HC</th><th className="text-right">OT</th><th>Công việc</th><th>TT</th></tr></thead>
          <tbody>
            {timesheets.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có chấm công</td></tr>
            ) : timesheets.map(t => (
              <tr key={t.id}>
                <td><div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.employee.fullName}</div><div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{t.employee.employeeCode}</div></td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{t.project.projectCode}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(t.workDate).toLocaleDateString('vi-VN')}</td>
                <td className="text-right text-xs font-bold" style={{ color: '#0ea5e9' }}>{Number(t.hoursRegular)}h</td>
                <td className="text-right text-xs font-bold" style={{ color: Number(t.hoursOT) > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{Number(t.hoursOT)}h</td>
                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{t.taskDescription || '—'}</td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: t.status === 'APPROVED' ? '#16a34a20' : '#f59e0b20', color: t.status === 'APPROVED' ? '#16a34a' : '#f59e0b' }}>{t.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
