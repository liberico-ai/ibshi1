'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Incident {
  id: string; incidentCode: string; severity: string; category: string; location: string | null;
  description: string; rootCause: string | null; correctiveAction: string | null; status: string;
  incidentDate: string; project: { projectCode: string; projectName: string }
}

const sevLabel: Record<string, string> = { NEAR_MISS: 'Suýt chạm', MINOR: 'Nhẹ', MAJOR: 'Nặng', CRITICAL: 'Nghiêm trọng' }
const sevColor: Record<string, string> = { NEAR_MISS: '#f59e0b', MINOR: '#0ea5e9', MAJOR: '#f97316', CRITICAL: '#dc2626' }
const catLabel: Record<string, string> = { fall: 'Ngã', electrical: 'Điện', fire: 'Cháy', chemical: 'Hóa chất', ergonomic: 'Công thái', other: 'Khác' }

export default function SafetyPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const TRANSITIONS: Record<string, { next: string; label: string; color: string }[]> = {
    OPEN: [{ next: 'INVESTIGATING', label: '🔍 Điều tra', color: '#0ea5e9' }],
    INVESTIGATING: [
      { next: 'RESOLVED', label: '✓ Xử lý xong', color: '#16a34a' },
      { next: 'OPEN', label: '← Mở lại', color: '#f59e0b' },
    ],
    RESOLVED: [
      { next: 'CLOSED', label: '✅ Đóng', color: '#16a34a' },
      { next: 'INVESTIGATING', label: '← Điều tra lại', color: '#f59e0b' },
    ],
  }

  const load = () => {
    const url = filter ? `/api/safety?severity=${filter}` : '/api/safety'
    apiFetch(url).then(res => { if (res.ok) { setIncidents(res.incidents); setStats(res.stats || {}) }; setLoading(false) })
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
    const res = await apiFetch('/api/safety', {
      method: 'POST',
      body: JSON.stringify({
        projectId: fd.get('projectId'), incidentDate: fd.get('incidentDate'),
        severity: fd.get('severity'), category: fd.get('category'),
        location: fd.get('location') || null, description: fd.get('description'),
        rootCause: fd.get('rootCause') || null, correctiveAction: fd.get('correctiveAction') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() } else alert(res.error || 'Lỗi')
  }

  const handleTransition = async (id: string, nextStatus: string) => {
    setActionLoading(id)
    const res = await apiFetch(`/api/safety/${id}/status`, {
      method: 'POST', body: JSON.stringify({ nextStatus }),
    })
    if (res.ok) load()
    else alert(res.error || 'Lỗi chuyển trạng thái')
    setActionLoading(null)
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalCount = Object.values(stats).reduce((s, c) => s + c, 0)
  const openCount = incidents.filter(i => i.status === 'OPEN').length
  const resolvedCount = incidents.filter(i => i.status === 'RESOLVED' || i.status === 'CLOSED').length
  const criticalCount = incidents.filter(i => i.severity === 'CRITICAL' || i.severity === 'MAJOR').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>An toàn lao động</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{incidents.length} sự cố đã ghi nhận</p>
        </div>
        <button onClick={openForm} className="btn-accent">+ Báo cáo sự cố</button>
      </div>

      {/* Stats Overview — Dashboard style */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        {[
          { label: 'Tổng sự cố', value: totalCount, color: '#0a2540', icon: '🦺' },
          { label: 'Đang mở', value: openCount, color: '#f59e0b', icon: '⚠️' },
          { label: 'Nghiêm trọng', value: criticalCount, color: '#dc2626', icon: '🔴' },
          { label: 'Đã xử lý', value: resolvedCount, color: '#16a34a', icon: '✅' },
        ].map(s => (
          <div key={s.label} className="card p-6 relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: s.color, borderRadius: '16px 16px 0 0' }} />
            <div className="flex items-center justify-between mb-4 pt-1">
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${s.color}10`, fontSize: '20px' }}>
                {s.icon}
              </div>
            </div>
            <p style={{ fontSize: '32px', fontWeight: 800, color: s.color, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</p>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '8px' }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} className="text-xs px-3 py-1 rounded-full font-medium"
          style={{ background: !filter ? 'var(--accent)' : 'var(--surface-hover)', color: !filter ? '#fff' : 'var(--text-muted)' }}>
          Tất cả ({Object.values(stats).reduce((s, c) => s + c, 0)})
        </button>
        {Object.entries(sevLabel).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === k ? sevColor[k] : 'var(--surface-hover)', color: filter === k ? '#fff' : 'var(--text-muted)' }}>
            {v} ({stats[k] || 0})
          </button>
        ))}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Báo cáo sự cố an toàn</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select name="projectId" required className="input-field text-sm"><option value="">— Dự án —</option>{projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}</select>
            <input name="incidentDate" type="date" required className="input-field text-sm" />
            <select name="severity" required className="input-field text-sm"><option value="">— Mức độ —</option>{Object.entries(sevLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="category" required className="input-field text-sm"><option value="">— Loại —</option>{Object.entries(catLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="location" placeholder="Vị trí" className="input-field text-sm" />
            <textarea name="description" required placeholder="Mô tả *" rows={2} className="input-field text-sm col-span-2" />
            <input name="rootCause" placeholder="Nguyên nhân gốc" className="input-field text-sm" />
            <input name="correctiveAction" placeholder="Hành động khắc phục" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
            <button type="submit" className="btn-accent">Lưu sự cố</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã</th><th>Dự án</th><th>Mức độ</th><th>Loại</th><th>Mô tả</th><th>Ngày</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {incidents.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có sự cố</td></tr>
            ) : incidents.map(i => (
              <tr key={i.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{i.incidentCode}</span></td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{i.project.projectCode}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${sevColor[i.severity]}20`, color: sevColor[i.severity] }}>{sevLabel[i.severity]}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{catLabel[i.category] || i.category}</td>
                <td className="text-xs max-w-40 truncate" style={{ color: 'var(--text-primary)' }}>{i.description}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(i.incidentDate).toLocaleDateString('vi-VN')}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: i.status === 'OPEN' ? '#f59e0b20' : i.status === 'CLOSED' ? '#16a34a20' : '#0ea5e920', color: i.status === 'OPEN' ? '#f59e0b' : i.status === 'CLOSED' ? '#16a34a' : '#0ea5e9' }}>{i.status}</span></td>
                <td>
                  <div className="flex gap-1">
                    {(TRANSITIONS[i.status] || []).map(t => (
                      <button
                        key={t.next}
                        onClick={() => handleTransition(i.id, t.next)}
                        disabled={actionLoading === i.id}
                        className="text-[10px] px-2 py-1 rounded font-bold transition-colors"
                        style={{ background: `${t.color}20`, color: t.color }}
                      >
                        {t.label}
                      </button>
                    ))}
                    {actionLoading === i.id && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>⏳</span>}
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
