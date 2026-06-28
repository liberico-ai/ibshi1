'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ClipboardList } from 'lucide-react'

interface Permit {
  id: string; permitCode: string; permitType: string; description: string;
  location: string | null; status: string; validFrom: string; validTo: string;
  project: { projectCode: string; projectName: string } | null;
  workOrder: { woCode: string } | null;
}

interface Project { id: string; projectCode: string; projectName: string }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'ACTIVE', label: 'Hiệu lực' },
  { value: 'CLOSED', label: 'Đóng' },
]

const TYPE_LABELS: Record<string, string> = {
  HOT_WORK: 'Hàn/Cắt nóng', HEIGHT_WORK: 'Trên cao', CONFINED_SPACE: 'Không gian kín',
  ELECTRICAL: 'Điện', EXCAVATION: 'Đào', OTHER: 'Khác',
}

export default function WorkPermitsPage() {
  const user = useAuthStore(s => s.user)
  const [permits, setPermits] = useState<Permit[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const canEdit = ['R01', 'R10', 'R06', 'R06a'].includes(user?.roleCode || '')
  const canApprove = ['R01', 'R10'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/hse/work-permits?${params}`)
    if (res.ok) setPermits(res.permits)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const approve = async (id: string) => {
    const res = await apiFetch(`/api/hse/work-permits/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'APPROVED' }) })
    if (res.ok) loadData()
    else alert(res.error || 'Lỗi')
  }

  const close = async (id: string) => {
    const res = await apiFetch(`/api/hse/work-permits/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'CLOSED' }) })
    if (res.ok) loadData()
    else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const active = permits.filter(p => p.status === 'ACTIVE' || p.status === 'APPROVED').length
  const pending = permits.filter(p => p.status === 'PENDING' || p.status === 'DRAFT').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Giấy phép làm việc"
        subtitle={`${permits.length} giấy phép`}
        actions={canEdit ? <Button variant="accent" onClick={() => setShowCreate(true)}>+ Tạo PTW</Button> : undefined}
      />

      <div className="grid grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng" value={permits.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Hiệu lực" value={active} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Chờ duyệt" value={pending} accentColor={pending > 0 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Đã đóng" value={permits.filter(p => p.status === 'CLOSED').length} accentColor={SEMANTIC_COLORS.info.solid} />
      </div>

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Mã</th><th>Loại</th><th>Mô tả</th><th>Dự án</th><th>WO</th><th>Hiệu lực</th><th>Trạng thái</th>{canApprove && <th></th>}</tr>
          </thead>
          <tbody>
            {permits.length === 0 ? (
              <tr><td colSpan={canApprove ? 8 : 7}><EmptyState icon={<ClipboardList />} title="Chưa có giấy phép" /></td></tr>
            ) : permits.map(p => (
              <tr key={p.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{p.permitCode}</span></td>
                <td className="text-xs">{TYPE_LABELS[p.permitType] || p.permitType}</td>
                <td className="text-xs max-w-[200px] truncate">{p.description}</td>
                <td className="text-xs font-mono">{p.project?.projectCode || '—'}</td>
                <td className="text-xs font-mono">{p.workOrder?.woCode || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(p.validFrom)} → {formatDate(p.validTo)}</td>
                <td><StatusBadge category="permit" status={p.status} /></td>
                {canApprove && (
                  <td className="text-xs">
                    {(p.status === 'PENDING' || p.status === 'DRAFT') && (
                      <button onClick={() => approve(p.id)} className="text-[10px] px-2 py-0.5 rounded font-bold"
                        style={{ background: SEMANTIC_COLORS.success.bg, color: SEMANTIC_COLORS.success.solid }}>Duyệt</button>
                    )}
                    {(p.status === 'APPROVED' || p.status === 'ACTIVE') && (
                      <button onClick={() => close(p.id)} className="text-[10px] px-2 py-0.5 rounded font-bold"
                        style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>Đóng</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreatePermitModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}
    </div>
  )
}

function CreatePermitModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [form, setForm] = useState({ permitType: 'HOT_WORK', projectId: '', description: '', location: '', hazards: '', precautions: '', validFrom: '', validTo: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const u = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/projects?active=true').then(r => { if (r.ok) setProjects(r.projects) })
  }, [])

  const submit = async () => {
    if (!form.description || !form.validFrom || !form.validTo) return alert('Nhập mô tả + thời hạn')
    setSubmitting(true)
    const res = await apiFetch('/api/hse/work-permits', {
      method: 'POST',
      body: JSON.stringify({ ...form, projectId: form.projectId || undefined }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Tạo giấy phép làm việc" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Loại permit" value={form.permitType} onChange={e => u('permitType', e.target.value)}
            options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
          <SelectField label="Dự án" value={form.projectId} onChange={e => u('projectId', e.target.value)}
            options={[{ value: '', label: 'Không chọn' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
        </div>
        <TextareaField label="Mô tả công việc *" rows={2} value={form.description} onChange={e => u('description', e.target.value)} />
        <InputField label="Vị trí" value={form.location} onChange={e => u('location', e.target.value)} placeholder="Khu vực A, Tầng 2" />
        <TextareaField label="Mối nguy" rows={2} value={form.hazards} onChange={e => u('hazards', e.target.value)} placeholder="Tia lửa, khí độc..." />
        <TextareaField label="Biện pháp an toàn" rows={2} value={form.precautions} onChange={e => u('precautions', e.target.value)} placeholder="PPE, cách ly, ..." />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Có hiệu lực từ *" type="date" value={form.validFrom} onChange={e => u('validFrom', e.target.value)} />
          <InputField label="Đến *" type="date" value={form.validTo} onChange={e => u('validTo', e.target.value)} />
        </div>
        <TextareaField label="Ghi chú" rows={2} value={form.notes} onChange={e => u('notes', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>Tạo</Button>
      </div>
    </Modal>
  )
}
