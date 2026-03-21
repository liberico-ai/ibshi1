'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface NCR {
  id: string; ncrCode: string; projectId: string; category: string; severity: string;
  description: string; rootCause: string | null; disposition: string | null; status: string;
  reworkCount: number; createdAt: string;
  project: { projectCode: string; projectName: string };
  actions: Array<{ id: string; actionType: string; description: string; status: string; dueDate: string | null }>;
}

interface Project { id: string; projectCode: string; projectName: string }

const SEVERITY_MAP: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  MINOR: { label: 'Nhẹ', color: '#f59e0b', bg: '#fef9c3', icon: '⚠️' },
  MAJOR: { label: 'Nghiêm trọng', color: '#ea580c', bg: '#fff7ed', icon: '🔶' },
  CRITICAL: { label: 'Nghiêm trọng cao', color: '#dc2626', bg: '#fef2f2', icon: '🔴' },
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Mở', color: '#dc2626', bg: '#fef2f2' },
  INVESTIGATING: { label: 'Đang XL', color: '#f59e0b', bg: '#fef9c3' },
  ACTION_TAKEN: { label: 'Đã XL', color: '#2563eb', bg: '#eff6ff' },
  CLOSED: { label: 'Đóng', color: '#16a34a', bg: '#f0fdf4' },
  CANCELLED: { label: 'Hủy', color: '#64748b', bg: '#f1f5f9' },
}

const CATEGORY_MAP: Record<string, string> = {
  material: '🏗️ Vật liệu', welding: '🔥 Hàn', dimensional: '📐 Kích thước',
  painting: '🎨 Sơn', process: '⚙️ Quy trình',
}

export default function NCRPage() {
  const [ncrs, setNcrs] = useState<NCR[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterSev, setFilterSev] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSev) params.set('severity', filterSev)
    if (filterStatus) params.set('status', filterStatus)
    const res = await apiFetch(`/api/qc/ncr?${params}`)
    if (res.ok) setNcrs(res.ncrs || [])
    setLoading(false)
  }

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [filterSev, filterStatus])

  const canCreate = ['R01', 'R09', 'R09a', 'R06'].includes(user?.roleCode || '')

  // Stats
  const openCount = ncrs.filter(n => n.status === 'OPEN').length
  const criticalCount = ncrs.filter(n => n.severity === 'CRITICAL' && n.status !== 'CLOSED').length

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>NCR Tracker</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Non-Conformance Report management</p>
        </div>
        {canCreate && (
          <button onClick={openForm} className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg" style={{ background: 'var(--accent)' }}>
            + Tạo NCR
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Tổng NCR</p>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{ncrs.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>🔴 Đang mở</p>
          <p className="text-xl font-bold" style={{ color: '#dc2626' }}>{openCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>⚠️ Critical</p>
          <p className="text-xl font-bold" style={{ color: criticalCount > 0 ? '#dc2626' : '#16a34a' }}>{criticalCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex gap-1">
          {[{ v: '', l: 'Tất cả' }, ...Object.entries(SEVERITY_MAP).map(([k, v]) => ({ v: k, l: v.icon + ' ' + v.label }))].map(f => (
            <button key={f.v} onClick={() => setFilterSev(f.v)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={{ background: filterSev === f.v ? 'var(--accent)' : 'var(--bg-primary)', color: filterSev === f.v ? 'white' : 'var(--text-muted)' }}>
              {f.l}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[{ v: '', l: 'Tất cả' }, ...Object.entries(STATUS_MAP).map(([k, v]) => ({ v: k, l: v.label }))].map(f => (
            <button key={f.v} onClick={() => setFilterStatus(f.v)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={{ background: filterStatus === f.v ? '#e0e7ff' : 'var(--bg-primary)', color: filterStatus === f.v ? '#4338ca' : 'var(--text-muted)' }}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {/* NCR List */}
      <div className="space-y-2">
        {ncrs.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Không có NCR nào</p>
          </div>
        )}
        {ncrs.map(ncr => {
          const sev = SEVERITY_MAP[ncr.severity] || SEVERITY_MAP.MINOR
          const st = STATUS_MAP[ncr.status] || STATUS_MAP.OPEN
          return (
            <div key={ncr.id} className="card p-4 transition-all hover:shadow-md" style={{ borderLeft: `4px solid ${sev.color}` }}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{ncr.ncrCode}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: sev.bg, color: sev.color }}>{sev.icon} {sev.label}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{CATEGORY_MAP[ncr.category] || ncr.category}</span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{ncr.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>DA: {ncr.project.projectCode}</span>
                    {ncr.disposition && <span>Xử lý: {ncr.disposition}</span>}
                    {ncr.reworkCount > 0 && <span className="font-semibold" style={{ color: '#f59e0b' }}>Sửa lại: {ncr.reworkCount}x</span>}
                    <span>{new Date(ncr.createdAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Actions: {ncr.actions.length}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && <CreateNCRModal projects={projects} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); loadData() }} />}
    </div>
  )
}

function CreateNCRModal({ projects, onClose, onCreated }: { projects: Project[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ projectId: '', category: 'welding', severity: 'MINOR', description: '', rootCause: '' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.projectId || !form.description) return alert('Chọn dự án và nhập mô tả')
    setSubmitting(true)
    const res = await apiFetch('/api/qc/ncr', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo NCR')
  }

  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-lg animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Tạo NCR</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Dự án *</label>
          <select value={form.projectId} onChange={e => update('projectId', e.target.value)} style={inputStyle}>
            <option value="">Chọn...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại</label>
            <select value={form.category} onChange={e => update('category', e.target.value)} style={inputStyle}>
              {Object.entries(CATEGORY_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Mức độ</label>
            <select value={form.severity} onChange={e => update('severity', e.target.value)} style={inputStyle}>
              {Object.entries(SEVERITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Mô tả *</label>
          <textarea value={form.description} onChange={e => update('description', e.target.value)} rows={3}
            style={{ ...inputStyle, resize: 'none' as const }} placeholder="Mô tả vấn đề..." />
        </div>

        <div className="mb-5">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Nguyên nhân gốc</label>
          <textarea value={form.rootCause} onChange={e => update('rootCause', e.target.value)} rows={2}
            style={{ ...inputStyle, resize: 'none' as const }} placeholder="Phân tích nguyên nhân..." />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all" style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang tạo...' : 'Tạo NCR'}
          </button>
        </div>
      </div>
    </div>
  )
}
