'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface ITP {
  id: string; itpCode: string; projectId: string; name: string; revision: string;
  status: string; createdAt: string; totalCheckpoints: number;
  passedCheckpoints: number; failedCheckpoints: number;
  project: { projectCode: string; projectName: string };
  checkpoints: Array<{ id: string; checkpointNo: number; activity: string; description: string; inspectionType: string; status: string }>;
}

interface Project { id: string; projectCode: string; projectName: string }

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Nháp', color: '#475569', bg: '#f1f5f9' },
  APPROVED: { label: 'Đã duyệt', color: '#16a34a', bg: '#f0fdf4' },
  IN_PROGRESS: { label: 'Đang kiểm', color: '#2563eb', bg: '#eff6ff' },
  COMPLETED: { label: 'Hoàn thành', color: '#059669', bg: '#ecfdf5' },
}

const INSP_TYPE: Record<string, { label: string; color: string }> = {
  HOLD: { label: 'H', color: '#dc2626' },
  WITNESS: { label: 'W', color: '#f59e0b' },
  MONITOR: { label: 'M', color: '#2563eb' },
  REVIEW: { label: 'R', color: '#64748b' },
}

export default function ITPPage() {
  const [itps, setItps] = useState<ITP[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const res = await apiFetch('/api/qc/itp')
    if (res.ok) setItps(res.itps || [])
    setLoading(false)
  }

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [])

  const canCreate = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Kế hoạch Kiểm tra (ITP)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Inspection & Test Plan management</p>
        </div>
        {canCreate && (
          <button onClick={openForm} className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg" style={{ background: 'var(--accent)' }}>
            + Tạo ITP
          </button>
        )}
      </div>

      <div className="space-y-3">
        {itps.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có ITP nào</p>
          </div>
        )}
        {itps.map(itp => {
          const st = STATUS_MAP[itp.status] || STATUS_MAP.DRAFT
          const progress = itp.totalCheckpoints ? Math.round((itp.passedCheckpoints / itp.totalCheckpoints) * 100) : 0
          const isExpanded = expanded === itp.id
          return (
            <div key={itp.id} className="card overflow-hidden transition-all hover:shadow-md">
              <div className="p-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : itp.id)}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg" style={{ background: st.bg, color: st.color }}>
                    {progress}%
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{itp.itpCode}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Rev {itp.revision}</span>
                    </div>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{itp.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>DA: {itp.project.projectCode}</p>
                  </div>
                  <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    <p>{itp.totalCheckpoints} điểm kiểm</p>
                    <p className="font-semibold" style={{ color: '#16a34a' }}>✓ {itp.passedCheckpoints}</p>
                    {itp.failedCheckpoints > 0 && <p className="font-semibold" style={{ color: '#dc2626' }}>✗ {itp.failedCheckpoints}</p>}
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                </div>
              </div>
              {isExpanded && itp.checkpoints.length > 0 && (
                <div className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <div className="p-3 space-y-1">
                    {itp.checkpoints.map(cp => {
                      const ins = INSP_TYPE[cp.inspectionType] || INSP_TYPE.MONITOR
                      const cpSt = STATUS_MAP[cp.status] || { label: cp.status, color: '#64748b', bg: '#f1f5f9' }
                      return (
                        <div key={cp.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg" style={{ background: 'var(--bg-primary)' }}>
                          <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold text-white" style={{ background: ins.color }}>{ins.label}</span>
                          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>#{cp.checkpointNo}</span>
                          <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>{cp.description}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: cpSt.bg, color: cpSt.color }}>{cpSt.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showForm && <CreateITPModal projects={projects} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); loadData() }} />}
    </div>
  )
}

function CreateITPModal({ projects, onClose, onCreated }: { projects: Project[]; onClose: () => void; onCreated: () => void }) {
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [checkpoints, setCheckpoints] = useState([{ activity: 'welding', description: '', standard: '', inspectionType: 'MONITOR' }])
  const [submitting, setSubmitting] = useState(false)

  const addCheckpoint = () => setCheckpoints([...checkpoints, { activity: 'welding', description: '', standard: '', inspectionType: 'MONITOR' }])

  const submit = async () => {
    if (!projectId || !name) return alert('Chọn dự án và nhập tên ITP')
    const validCPs = checkpoints.filter(c => c.description)
    setSubmitting(true)
    const res = await apiFetch('/api/qc/itp', {
      method: 'POST',
      body: JSON.stringify({ projectId, name, checkpoints: validCPs.length > 0 ? validCPs : undefined }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo ITP')
  }

  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Tạo ITP mới</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Dự án *</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
              <option value="">Chọn...</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tên ITP *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="VD: Pressure Vessel ITP" />
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Điểm kiểm tra</label>
            <button onClick={addCheckpoint} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--accent)' }}>+ Thêm</button>
          </div>
          {checkpoints.map((cp, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 mb-2">
              <select value={cp.activity} onChange={e => { const n = [...checkpoints]; n[i].activity = e.target.value; setCheckpoints(n) }}
                style={{ ...inputStyle, fontSize: '12px', padding: '8px' }}>
                <option value="welding">Hàn</option>
                <option value="ndt">NDT</option>
                <option value="pressure_test">Thử áp</option>
                <option value="dimensional">Kích thước</option>
                <option value="painting">Sơn</option>
                <option value="visual">Ngoại quan</option>
              </select>
              <input value={cp.description} onChange={e => { const n = [...checkpoints]; n[i].description = e.target.value; setCheckpoints(n) }}
                style={{ ...inputStyle, fontSize: '12px', padding: '8px' }} placeholder="Mô tả..." className="col-span-2" />
              <select value={cp.inspectionType} onChange={e => { const n = [...checkpoints]; n[i].inspectionType = e.target.value; setCheckpoints(n) }}
                style={{ ...inputStyle, fontSize: '12px', padding: '8px' }}>
                <option value="HOLD">Hold (H)</option>
                <option value="WITNESS">Witness (W)</option>
                <option value="MONITOR">Monitor (M)</option>
                <option value="REVIEW">Review (R)</option>
              </select>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all" style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang tạo...' : 'Tạo ITP'}
          </button>
        </div>
      </div>
    </div>
  )
}
