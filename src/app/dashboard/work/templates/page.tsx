'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Step { id: string; code: string; title: string; roleCode: string | null; deptCode: string | null; deadlineDays: number | null; hookKeys: string[] }
interface Tpl { id: string; code: string; name: string; projectType: string; version: number; _count: { steps: number } }
interface Proj { id: string; projectCode: string; projectName: string }

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [projects, setProjects] = useState<Proj[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [sel, setSel] = useState<Tpl | null>(null)
  const [applyProj, setApplyProj] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    apiFetch('/api/work/templates').then((r) => { if (r.ok) setTemplates(r.templates) })
    apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) })
  }, [])

  const open = (t: Tpl) => { setSel(t); setSteps([]); apiFetch(`/api/work/templates/${t.id}`).then((r) => { if (r.ok) setSteps(r.template.steps) }) }
  const apply = async () => {
    if (!sel || !applyProj) return
    setMsg('')
    const res = await apiFetch('/api/work/templates/apply', { method: 'POST', body: JSON.stringify({ projectId: applyProj, templateCode: sel.code }) })
    setMsg(res.ok ? `✓ ${res.message}` : res.error)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quy trình & Template</h1>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Template theo loại dự án. Áp vào dự án để tự sinh các công việc chuẩn (động).</p>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        {templates.map((t) => (
          <div key={t.id} onClick={() => open(t)} className="rounded-xl p-4 cursor-pointer hover:shadow-md"
            style={{ background: 'var(--surface)', border: `1px solid ${sel?.id === t.id ? 'var(--text-heading)' : 'var(--border)'}` }}>
            <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{t.name}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t.code} · {t.projectType} · v{t.version} · {t._count.steps} bước</div>
          </div>
        ))}
        {templates.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có template. Chạy seed-dynamic-workflow.</div>}
      </div>

      {sel && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-2 items-center justify-between mb-3">
            <h3 className="font-semibold" style={{ color: 'var(--text-heading)' }}>{sel.name} — {steps.length} bước</h3>
            <div className="flex gap-2 items-center">
              <select value={applyProj} onChange={(e) => setApplyProj(e.target.value)} className="text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
                <option value="">— Chọn dự án —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
              </select>
              <button onClick={apply} disabled={!applyProj} className="btn-primary text-sm px-4 py-1.5 rounded-lg">Áp vào dự án</button>
            </div>
          </div>
          {msg && <div className="text-sm mb-3" style={{ color: msg.startsWith('✓') ? '#059669' : 'var(--danger)' }}>{msg}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                {['#', 'Mã', 'Tên bước', 'Phòng/Role', 'Deadline', 'Hook tự động'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--ibs-red)' }}>{s.code}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{s.title}</td>
                    <td className="px-3 py-2 text-xs">{s.deptCode || s.roleCode || '—'}</td>
                    <td className="px-3 py-2 text-xs">{s.deadlineDays ? `${s.deadlineDays} ngày` : '—'}</td>
                    <td className="px-3 py-2 text-xs">{s.hookKeys?.length ? s.hookKeys.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
