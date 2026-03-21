'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Drawing {
  id: string; drawingCode: string; title: string; discipline: string; currentRev: string;
  status: string; drawnBy: string | null;
  project: { projectCode: string; projectName: string }
  revisions: { id: string; revision: string; description: string | null; issuedDate: string }[]
}

const discLabel: Record<string, string> = { structural: 'Kết cấu', piping: 'Đường ống', electrical: 'Điện', mechanical: 'Cơ khí' }
const discColor: Record<string, string> = { structural: '#0ea5e9', piping: '#f59e0b', electrical: '#dc2626', mechanical: '#16a34a' }
const statusLabel: Record<string, string> = { IFR: 'Chờ duyệt', IFC: 'Thi công', AFC: 'Hoàn công' }
const statusColor: Record<string, string> = { IFR: '#f59e0b', IFC: '#0ea5e9', AFC: '#16a34a' }

export default function DrawingRegisterPage() {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const TRANSITIONS: Record<string, { next: string; label: string; color: string }[]> = {
    IFR: [{ next: 'IFC', label: '→ IFC', color: '#0ea5e9' }],
    IFC: [
      { next: 'AFC', label: '→ AFC', color: '#16a34a' },
      { next: 'IFR', label: '← IFR', color: '#f59e0b' },
    ],
  }

  const load = () => {
    const url = filter ? `/api/drawings?status=${filter}` : '/api/drawings'
    apiFetch(url).then(res => {
      if (res.ok) { setDrawings(res.drawings); setStats(res.stats || {}) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [filter])

  const openForm = async () => {
    const res = await apiFetch('/api/projects?page=1&limit=50')
    if (res.ok) setProjectList(res.projects || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/drawings', {
      method: 'POST',
      body: JSON.stringify({
        drawingCode: fd.get('drawingCode'), projectId: fd.get('projectId'),
        title: fd.get('title'), discipline: fd.get('discipline'),
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const handleTransition = async (id: string, nextStatus: string) => {
    setActionLoading(id)
    const res = await apiFetch(`/api/drawings/${id}/transition`, {
      method: 'POST', body: JSON.stringify({ nextStatus }),
    })
    if (res.ok) load()
    else alert(res.error || 'Lỗi chuyển trạng thái')
    setActionLoading(null)
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📐 Sổ bản vẽ</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{drawings.length} bản vẽ</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm bản vẽ</button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        <button onClick={() => setFilter('')} className="text-xs px-3 py-1 rounded-full font-medium"
          style={{ background: !filter ? 'var(--accent)' : 'var(--surface-hover)', color: !filter ? '#fff' : 'var(--text-muted)' }}>
          Tất cả ({Object.values(stats).reduce((s, c) => s + c, 0)})
        </button>
        {Object.entries(statusLabel).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === k ? statusColor[k] : 'var(--surface-hover)', color: filter === k ? '#fff' : 'var(--text-muted)' }}>
            {v} ({stats[k] || 0})
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm bản vẽ</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="drawingCode" required placeholder="Mã bản vẽ *" className="input-field text-sm" />
            <select name="projectId" required className="input-field text-sm">
              <option value="">— Dự án —</option>
              {projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
            <input name="title" required placeholder="Tiêu đề *" className="input-field text-sm" />
            <select name="discipline" required className="input-field text-sm">
              <option value="">— Bộ môn —</option>
              {Object.entries(discLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã BV</th><th>Tiêu đề</th><th>Bộ môn</th><th>Dự án</th><th>Rev</th><th>Trạng thái</th><th>Sửa đổi gần nhất</th><th>Thao tác</th></tr></thead>
          <tbody>
            {drawings.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có bản vẽ</td></tr>
            ) : drawings.map(d => (
              <tr key={d.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{d.drawingCode}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{d.title}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${discColor[d.discipline]}20`, color: discColor[d.discipline] }}>{discLabel[d.discipline] || d.discipline}</span></td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.project.projectCode}</td>
                <td className="text-xs font-mono font-bold" style={{ color: '#0ea5e9' }}>{d.currentRev}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${statusColor[d.status]}20`, color: statusColor[d.status] }}>{statusLabel[d.status]}</span></td>
                <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {d.revisions[0] ? `${d.revisions[0].revision} — ${new Date(d.revisions[0].issuedDate).toLocaleDateString('vi-VN')}` : '—'}
                </td>
                <td>
                  <div className="flex gap-1">
                    {(TRANSITIONS[d.status] || []).map(t => (
                      <button
                        key={t.next}
                        onClick={() => handleTransition(d.id, t.next)}
                        disabled={actionLoading === d.id}
                        className="text-[10px] px-2 py-1 rounded font-bold transition-colors"
                        style={{ background: `${t.color}20`, color: t.color }}
                      >
                        {t.label}
                      </button>
                    ))}
                    {actionLoading === d.id && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>⏳</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
