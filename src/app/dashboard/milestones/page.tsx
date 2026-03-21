'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Milestone {
  id: string; name: string; nameEn: string; description: string | null; billingPercent: string;
  plannedDate: string | null; actualDate: string | null; status: string; sortOrder: number
}
interface ProjectGroup {
  projectId: string; projectCode: string; projectName: string; contractValue: number;
  milestones: Milestone[]; billingCompleted: number; billingTotal: number; billingProgress: number
}

const statusLabel: Record<string, string> = { PENDING: 'Chờ', COMPLETED: 'Hoàn thành', DELAYED: 'Trễ hạn' }
const statusColor: Record<string, string> = { PENDING: '#f59e0b', COMPLETED: '#16a34a', DELAYED: '#dc2626' }

export default function MilestonePage() {
  const [projects, setProjects] = useState<ProjectGroup[]>([])
  const [totalMs, setTotalMs] = useState(0)
  const [completedMs, setCompletedMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])

  const load = () => {
    apiFetch('/api/milestones').then(res => {
      if (res.ok) {
        setProjects(res.projects); setTotalMs(res.totalMilestones); setCompletedMs(res.completedMilestones)
      }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  const openForm = async () => {
    const res = await apiFetch('/api/projects?page=1&limit=50')
    if (res.ok) setProjectList(res.projects || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/milestones', {
      method: 'POST',
      body: JSON.stringify({
        projectId: fd.get('projectId'), name: fd.get('name'),
        billingPercent: Number(fd.get('billingPercent') || 0),
        plannedDate: fd.get('plannedDate') || null,
        description: fd.get('description') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const updateStatus = async (id: string, status: string) => {
    const res = await apiFetch('/api/milestones', {
      method: 'PATCH',
      body: JSON.stringify({ id, status }),
    })
    if (res.ok) load()
  }

  const fmt = (v: number | string) => Number(v).toLocaleString('vi-VN')

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🎯 Cột mốc & Thanh toán theo tiến độ</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{completedMs}/{totalMs} cột mốc hoàn thành</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm cột mốc</button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm cột mốc</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select name="projectId" required className="input-field text-sm">
              <option value="">— Chọn dự án —</option>
              {projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
            <input name="name" required placeholder="Tên cột mốc *" className="input-field text-sm" />
            <input name="billingPercent" type="number" step="0.1" placeholder="% thanh toán" className="input-field text-sm" />
            <input name="plannedDate" type="date" className="input-field text-sm" />
            <input name="description" placeholder="Mô tả" className="input-field text-sm col-span-2" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Projects with milestones */}
      {projects.length === 0 ? (
        <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có cột mốc. Nhấn "+ Thêm cột mốc" để bắt đầu.</div>
      ) : projects.map(proj => (
        <div key={proj.projectId} className="card overflow-hidden">
          <div className="p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex justify-between items-center mb-2">
              <div>
                <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{proj.projectCode}</span>
                <span className="ml-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{proj.projectName}</span>
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>HĐ: {fmt(proj.contractValue)} VNĐ</span>
            </div>
            {/* Billing progress bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--surface-hover)' }}>
                <div className="h-2 rounded-full transition-all" style={{ width: `${proj.billingProgress}%`, background: '#16a34a' }} />
              </div>
              <span className="text-xs font-bold" style={{ color: '#16a34a' }}>{proj.billingProgress}%</span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Cột mốc</th><th className="text-right">% TT</th>
                <th>Ngày dự kiến</th><th>Ngày thực tế</th><th>Trạng thái</th><th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {proj.milestones.map((m, i) => (
                <tr key={m.id}>
                  <td className="text-xs font-mono">{i + 1}</td>
                  <td>
                    <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{m.name}</div>
                    {m.description && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.description}</div>}
                  </td>
                  <td className="text-right font-mono text-xs font-bold" style={{ color: '#0ea5e9' }}>{Number(m.billingPercent)}%</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.plannedDate ? new Date(m.plannedDate).toLocaleDateString('vi-VN') : '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.actualDate ? new Date(m.actualDate).toLocaleDateString('vi-VN') : '—'}</td>
                  <td>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${statusColor[m.status]}20`, color: statusColor[m.status] }}>
                      {statusLabel[m.status]}
                    </span>
                  </td>
                  <td>
                    {m.status !== 'COMPLETED' && (
                      <button onClick={() => updateStatus(m.id, 'COMPLETED')} className="text-[10px] px-2 py-1 rounded font-medium" style={{ background: '#16a34a20', color: '#16a34a' }}>
                        ✓ Hoàn thành
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
