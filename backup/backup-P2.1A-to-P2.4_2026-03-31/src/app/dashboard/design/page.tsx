'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface Drawing {
  id: string; drawingCode: string; title: string; discipline: string;
  currentRev: string; status: string; createdAt: string;
  project: { projectCode: string; projectName: string };
  revisions: Array<{ revision: string; issuedDate: string }>;
}

interface Project { id: string; projectCode: string; projectName: string }

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  IFR: { label: 'IFR', color: '#f59e0b', bg: '#fef9c3' },
  IFC: { label: 'IFC', color: '#2563eb', bg: '#eff6ff' },
  AFC: { label: 'AFC', color: '#16a34a', bg: '#f0fdf4' },
}

const DISC_MAP: Record<string, { label: string; icon: string }> = {
  structural: { label: 'Kết cấu', icon: '🏗️' },
  piping: { label: 'Đường ống', icon: '🔧' },
  electrical: { label: 'Điện', icon: '⚡' },
  mechanical: { label: 'Cơ khí', icon: '⚙️' },
}

export default function DrawingPage() {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    const res = await apiFetch(`/api/design?${params}`)
    if (res.ok) setDrawings(res.drawings || [])
    setLoading(false)
  }

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [filterStatus])

  const canCreate = ['R01', 'R04', 'R02'].includes(user?.roleCode || '')

  // Stats
  const ifrCount = drawings.filter(d => d.status === 'IFR').length
  const ifcCount = drawings.filter(d => d.status === 'IFC').length
  const afcCount = drawings.filter(d => d.status === 'AFC').length

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quản lý Bản vẽ</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{drawings.length} bản vẽ kỹ thuật</p>
        </div>
        {canCreate && (
          <button onClick={openForm} className="btn-accent">+ Tạo bản vẽ</button>
        )}
      </div>

      {/* Stats — Dashboard style with colored top borders */}
      <div className="grid grid-cols-4 gap-4 stagger-children">
        {[
          { label: 'Tổng bản vẽ', value: drawings.length, color: '#0a2540', icon: '📐' },
          { label: 'IFR — Chờ duyệt', value: ifrCount, color: '#f59e0b', icon: '🟡' },
          { label: 'IFC — Thi công', value: ifcCount, color: '#2563eb', icon: '🔵' },
          { label: 'AFC — Hoàn công', value: afcCount, color: '#16a34a', icon: '🟢' },
        ].map(s => (
          <div key={s.label} className="card p-6 relative overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
            style={{ borderTop: 'none' }}>
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

      {/* Filters */}
      <div className="flex gap-1">
        {[{ v: '', l: 'Tất cả' }, { v: 'IFR', l: '🟡 IFR' }, { v: 'IFC', l: '🔵 IFC' }, { v: 'AFC', l: '🟢 AFC' }].map(f => (
          <button key={f.v} onClick={() => setFilterStatus(f.v)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: filterStatus === f.v ? 'var(--accent)' : 'var(--bg-primary)', color: filterStatus === f.v ? 'white' : 'var(--text-muted)' }}>
            {f.l}
          </button>
        ))}
      </div>

      {/* Drawing List */}
      <div className="space-y-2">
        {drawings.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">📐</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có bản vẽ nào</p>
          </div>
        )}
        {drawings.map(dwg => {
          const st = STATUS_MAP[dwg.status] || STATUS_MAP.IFR
          const disc = DISC_MAP[dwg.discipline] || { label: dwg.discipline, icon: '📄' }
          return (
            <div key={dwg.id} className="card p-4 transition-all hover:shadow-md">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: st.bg }}>
                  {disc.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{dwg.drawingCode}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Rev {dwg.currentRev}</span>
                  </div>
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{dwg.title}</p>
                  <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    <span>DA: {dwg.project.projectCode}</span>
                    <span>{disc.label}</span>
                    <span>{new Date(dwg.createdAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && <CreateDrawingModal projects={projects} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); loadData() }} />}
    </div>
  )
}

function CreateDrawingModal({ projects, onClose, onCreated }: { projects: Project[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ projectId: '', title: '', discipline: 'structural' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.projectId || !form.title) return alert('Chọn dự án và nhập tiêu đề')
    setSubmitting(true)
    const res = await apiFetch('/api/design', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo bản vẽ')
  }

  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-md animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Tạo bản vẽ mới</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Dự án *</label>
            <select value={form.projectId} onChange={e => update('projectId', e.target.value)} style={inputStyle}>
              <option value="">Chọn...</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tiêu đề *</label>
            <input value={form.title} onChange={e => update('title', e.target.value)} style={inputStyle} placeholder="VD: GA Plan Layout" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại bản vẽ</label>
            <select value={form.discipline} onChange={e => update('discipline', e.target.value)} style={inputStyle}>
              {Object.entries(DISC_MAP).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang tạo...' : 'Tạo bản vẽ'}
          </button>
        </div>
      </div>
    </div>
  )
}
