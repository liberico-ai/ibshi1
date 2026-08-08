'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import StepWorkCard from '@/components/StepWorkCard'
import type { TemplateType } from '@/components/TemplateSelector'

// Khối "bước quy trình" nhúng vào 1 trang sidebar (Cách A): đọc ?project= (từ thông báo redirect)
// hoặc cho chọn dự án, rồi render các StepWorkCard cho các bước thuộc trang đó. Card tự ẩn nếu
// dự án không có bước tương ứng đang mở → trang gọn khi truy cập bình thường.
export interface StepDef { code: string; title: string; template?: TemplateType; noTemplate?: boolean; nextHint?: string }
interface Proj { id: string; projectCode: string; projectName: string }

export default function SidebarStepLanding({ steps, heading = 'Bước quy trình dự án' }: { steps: StepDef[]; heading?: string }) {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  // ?step=<code> (từ thông báo) → chỉ hiện đúng card bước đó, không lẫn bước khác cùng trang.
  const [stepFilter, setStepFilter] = useState('')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setProjectId(q.get('project') || '')
    setStepFilter(q.get('step') || '')
    apiFetch('/api/projects?page=1&limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) })
  }, [])

  const shownSteps = stepFilter ? steps.filter((s) => s.code === stepFilter) : steps

  return (
    <div className="card p-4 space-y-3" style={{ border: '1px solid #6366f130', background: '#faf9ff' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold" style={{ color: '#4338ca' }}>⚙️ {heading}</h2>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input-field text-sm" style={{ maxWidth: 360 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>
      {projectId ? (
        <div className="space-y-4">
          {shownSteps.map((s) => (
            <StepWorkCard key={s.code} projectId={projectId} stepCode={s.code} title={s.title}
              initialTemplate={s.template} noTemplate={s.noTemplate} nextHint={s.nextHint} />
          ))}
        </div>
      ) : (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chọn dự án để xử lý bước quy trình (hoặc mở từ thông báo ở tab Công việc).</div>
      )}
    </div>
  )
}
