'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import EstimatePlanCard from './EstimatePlanCard'

// Tab "Dự toán" (KTKH lập dự toán thi công — bước P1.2).
// Vào từ thông báo với ?project=<id> (chọn sẵn dự án), hoặc tự chọn dự án ở dropdown.
interface Proj { id: string; projectCode: string; projectName: string }

export default function EstimatesPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('project') || ''
    setProjectId(p)
    apiFetch('/api/projects?page=1&limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) })
  }, [])

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Dự toán thi công</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>KTKH lập dự toán chi phí thi công cho dự án (Import Excel DT02 → 4 tổng).</p>
      </div>

      <div className="card p-4">
        <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Chọn dự án</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input-field text-sm" style={{ maxWidth: 420 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>

      {projectId
        ? <EstimatePlanCard projectId={projectId} />
        : <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Chọn một dự án để lập dự toán.</div>}
    </div>
  )
}
