'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { HardHat } from 'lucide-react'

interface Incident {
  id: string; incidentCode: string; severity: string; category: string;
  description: string; location: string | null; status: string;
  incidentDate: string; rootCause: string | null; correctiveAction: string | null;
  lostTimeDays: number | null;
  project: { projectCode: string; projectName: string } | null;
}

interface Project { id: string; projectCode: string; projectName: string }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'OPEN', label: 'Mở' },
  { value: 'INVESTIGATING', label: 'Đang ĐT' },
  { value: 'ACTION_TAKEN', label: 'Đã XL' },
  { value: 'CLOSED', label: 'Đóng' },
]

const SEVERITY_LABELS: Record<string, string> = { CRITICAL: 'Nghiêm trọng', MAJOR: 'Lớn', MINOR: 'Nhỏ', NEAR_MISS: 'Suýt xảy ra' }
const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  CRITICAL: { bg: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid },
  MAJOR: { bg: SEMANTIC_COLORS.warning.bg, color: SEMANTIC_COLORS.warning.solid },
  MINOR: { bg: SEMANTIC_COLORS.info.bg, color: SEMANTIC_COLORS.info.solid },
  NEAR_MISS: { bg: '#F1F3F5', color: '#64748B' },
}

export default function IncidentsPage() {
  const user = useAuthStore(s => s.user)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const canEdit = ['R01', 'R10', 'R06'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/hse/incidents?${params}`)
    if (res.ok) setIncidents(res.incidents)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const open = incidents.filter(i => i.status !== 'CLOSED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Sự cố An toàn"
        subtitle={`${incidents.length} sự cố`}
        actions={canEdit ? <Button variant="accent" onClick={() => setShowCreate(true)}>+ Báo sự cố</Button> : undefined}
      />

      <div className="grid grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng" value={incidents.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đang mở" value={open} accentColor={open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Nghiêm trọng" value={incidents.filter(i => i.severity === 'CRITICAL').length} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard label="Đã đóng" value={incidents.filter(i => i.status === 'CLOSED').length} accentColor={SEMANTIC_COLORS.success.solid} />
      </div>

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Mã</th><th>Dự án</th><th>Mức độ</th><th>Loại</th><th>Mô tả</th><th>Ngày</th><th>Trạng thái</th></tr>
          </thead>
          <tbody>
            {incidents.length === 0 ? (
              <tr><td colSpan={7}><EmptyState icon={<HardHat />} title="Chưa có sự cố" /></td></tr>
            ) : incidents.map(i => (
              <tr key={i.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{i.incidentCode}</span></td>
                <td className="text-xs font-mono">{i.project?.projectCode || '—'}</td>
                <td>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                    style={{ background: SEVERITY_COLORS[i.severity]?.bg, color: SEVERITY_COLORS[i.severity]?.color }}>
                    {SEVERITY_LABELS[i.severity] || i.severity}
                  </span>
                </td>
                <td className="text-xs">{i.category}</td>
                <td className="text-xs max-w-[200px] truncate">{i.description}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(i.incidentDate)}</td>
                <td><StatusBadge category="incident" status={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateIncidentModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}
    </div>
  )
}

function CreateIncidentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [form, setForm] = useState({ projectId: '', severity: 'MINOR', category: '', location: '', description: '', incidentDate: '' })
  const [submitting, setSubmitting] = useState(false)
  const u = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/projects?active=true').then(r => { if (r.ok) setProjects(r.projects) })
  }, [])

  const submit = async () => {
    if (!form.projectId || !form.category || !form.description) return alert('Nhập đủ trường bắt buộc')
    setSubmitting(true)
    const res = await apiFetch('/api/hse/incidents', {
      method: 'POST',
      body: JSON.stringify(form),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Báo sự cố an toàn" size="md">
      <div className="space-y-3">
        <SelectField label="Dự án *" value={form.projectId} onChange={e => u('projectId', e.target.value)}
          options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Mức độ" value={form.severity} onChange={e => u('severity', e.target.value)}
            options={Object.entries(SEVERITY_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
          <InputField label="Phân loại *" value={form.category} onChange={e => u('category', e.target.value)} placeholder="Té ngã / Cháy / ..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Vị trí" value={form.location} onChange={e => u('location', e.target.value)} placeholder="Khu vực A" />
          <InputField label="Ngày xảy ra" type="date" value={form.incidentDate} onChange={e => u('incidentDate', e.target.value)} />
        </div>
        <TextareaField label="Mô tả *" rows={3} value={form.description} onChange={e => u('description', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>Báo</Button>
      </div>
    </Modal>
  )
}
