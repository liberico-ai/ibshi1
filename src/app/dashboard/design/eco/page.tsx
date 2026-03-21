'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface ECO {
  id: string; ecoCode: string; title: string; description: string;
  changeType: string; impactCost: number | null; impactSchedule: number | null;
  status: string; createdAt: string;
  project: { projectCode: string; projectName: string };
}

interface Project { id: string; projectCode: string; projectName: string }

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Nháp', color: '#475569', bg: '#f1f5f9' },
  SUBMITTED: { label: 'Đã gửi', color: '#f59e0b', bg: '#fef9c3' },
  APPROVED: { label: 'Duyệt', color: '#16a34a', bg: '#f0fdf4' },
  REJECTED: { label: 'Từ chối', color: '#dc2626', bg: '#fef2f2' },
  IMPLEMENTED: { label: 'Đã áp dụng', color: '#2563eb', bg: '#eff6ff' },
}

const TYPE_MAP: Record<string, string> = {
  design: '📐 Thiết kế', material: '🏗️ Vật liệu', process: '⚙️ Quy trình', specification: '📋 Tiêu chuẩn',
}

export default function ECOPage() {
  const [ecos, setEcos] = useState<ECO[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    const res = await apiFetch(`/api/design/eco?${params}`)
    if (res.ok) setEcos(res.ecos || [])
    setLoading(false)
  }

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [filterStatus])

  const canCreate = ['R01', 'R04', 'R02', 'R06'].includes(user?.roleCode || '')

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>ECO Tracker</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Engineering Change Orders</p>
        </div>
        {canCreate && (
          <button onClick={openForm} className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg" style={{ background: 'var(--accent)' }}>
            + Tạo ECO
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-1">
        {[{ v: '', l: 'Tất cả' }, ...Object.entries(STATUS_MAP).map(([k, v]) => ({ v: k, l: v.label }))].map(f => (
          <button key={f.v} onClick={() => setFilterStatus(f.v)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
            style={{ background: filterStatus === f.v ? 'var(--accent)' : 'var(--bg-primary)', color: filterStatus === f.v ? 'white' : 'var(--text-muted)' }}>
            {f.l}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {ecos.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">🔄</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có ECO nào</p>
          </div>
        )}
        {ecos.map(eco => {
          const st = STATUS_MAP[eco.status] || STATUS_MAP.DRAFT
          return (
            <div key={eco.id} className="card p-4 transition-all hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{eco.ecoCode}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{TYPE_MAP[eco.changeType] || eco.changeType}</span>
                  </div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{eco.title}</p>
                  <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{eco.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>DA: {eco.project.projectCode}</span>
                    {eco.impactCost && <span className="font-semibold" style={{ color: '#f59e0b' }}>💰 {Number(eco.impactCost).toLocaleString('vi-VN')} đ</span>}
                    {eco.impactSchedule && <span className="font-semibold" style={{ color: '#dc2626' }}>📅 +{eco.impactSchedule} ngày</span>}
                    <span>{new Date(eco.createdAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && <CreateECOModal projects={projects} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); loadData() }} />}
    </div>
  )
}

function CreateECOModal({ projects, onClose, onCreated }: { projects: Project[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ projectId: '', title: '', description: '', changeType: 'design', impactCost: '', impactSchedule: '' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.projectId || !form.title || !form.description) return alert('Điền đầy đủ thông tin')
    setSubmitting(true)
    const res = await apiFetch('/api/design/eco', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        impactCost: form.impactCost ? Number(form.impactCost) : null,
        impactSchedule: form.impactSchedule ? Number(form.impactSchedule) : null,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo ECO')
  }

  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-lg animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Tạo ECO</h2>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tiêu đề *</label>
              <input value={form.title} onChange={e => update('title', e.target.value)} style={inputStyle} placeholder="Thay đổi..." />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại</label>
              <select value={form.changeType} onChange={e => update('changeType', e.target.value)} style={inputStyle}>
                {Object.entries(TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Mô tả *</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'none' as const }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Chi phí ảnh hưởng (VNĐ)</label>
              <input type="number" value={form.impactCost} onChange={e => update('impactCost', e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tiến độ ảnh hưởng (ngày)</label>
              <input type="number" value={form.impactSchedule} onChange={e => update('impactSchedule', e.target.value)} style={inputStyle} placeholder="0" />
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang tạo...' : 'Tạo ECO'}
          </button>
        </div>
      </div>
    </div>
  )
}
