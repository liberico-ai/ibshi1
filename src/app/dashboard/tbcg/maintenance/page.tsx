'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Wrench } from 'lucide-react'

interface MaintRecord {
  id: string; maintCode: string; type: string; description: string;
  scheduledDate: string | null; completedDate: string | null; cost: number | null;
  status: string; notes: string | null;
  equipment: { equipmentCode: string; name: string };
}

interface Equip { id: string; equipmentCode: string; name: string }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'SCHEDULED', label: 'Lên lịch' },
  { value: 'IN_PROGRESS', label: 'Đang làm' },
  { value: 'COMPLETED', label: 'Xong' },
]

const TYPE_LABELS: Record<string, string> = { PREVENTIVE: 'Định kỳ', BREAKDOWN: 'Sự cố', INSPECTION: 'Kiểm định' }

export default function MaintenancePage() {
  const user = useAuthStore(s => s.user)
  const [records, setRecords] = useState<MaintRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const canEdit = ['R01', 'R10', 'R13', 'R06'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/tbcg/maintenance?${params}`)
    if (res.ok) setRecords(res.maintenanceRecords)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Bảo trì thiết bị"
        subtitle={`${records.length} phiếu`}
        actions={canEdit ? <Button variant="primary" onClick={() => setShowCreate(true)}>+ Tạo phiếu</Button> : undefined}
      />

      <div className="grid grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng" value={records.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đã lên lịch" value={records.filter(r => r.status === 'SCHEDULED').length} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="Sự cố" value={records.filter(r => r.type === 'BREAKDOWN').length} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard label="Hoàn thành" value={records.filter(r => r.status === 'COMPLETED').length} accentColor={SEMANTIC_COLORS.success.solid} />
      </div>

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Mã</th><th>Thiết bị</th><th>Loại</th><th>Mô tả</th><th>Ngày lịch</th><th>Trạng thái</th><th>Chi phí</th></tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={7}><EmptyState icon={<Wrench />} title="Chưa có phiếu bảo trì" /></td></tr>
            ) : records.map(r => (
              <tr key={r.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{r.maintCode}</span></td>
                <td className="text-xs"><span className="font-mono">{r.equipment.equipmentCode}</span> <span style={{ color: 'var(--text-muted)' }}>{r.equipment.name}</span></td>
                <td><span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                  style={{ background: r.type === 'BREAKDOWN' ? SEMANTIC_COLORS.danger.bg : SEMANTIC_COLORS.info.bg,
                    color: r.type === 'BREAKDOWN' ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.info.solid }}>
                  {TYPE_LABELS[r.type] || r.type}</span></td>
                <td className="text-xs max-w-[200px] truncate">{r.description}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.scheduledDate ? formatDate(r.scheduledDate) : '—'}</td>
                <td><StatusBadge category="maintenance" status={r.status} /></td>
                <td className="text-xs font-mono">{r.cost ? `${r.cost.toLocaleString()}đ` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateMaintModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}
    </div>
  )
}

function CreateMaintModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [equips, setEquips] = useState<Equip[]>([])
  const [form, setForm] = useState({ equipmentId: '', type: 'PREVENTIVE', description: '', scheduledDate: '', cost: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const u = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/tbcg/equipment').then(r => { if (r.ok) setEquips(r.equipment.map((e: Equip) => ({ id: e.id, equipmentCode: e.equipmentCode, name: e.name }))) })
  }, [])

  const submit = async () => {
    if (!form.equipmentId || !form.description) return alert('Chọn TB và nhập mô tả')
    setSubmitting(true)
    const res = await apiFetch('/api/tbcg/maintenance', {
      method: 'POST',
      body: JSON.stringify({ ...form, cost: form.cost ? Number(form.cost) : undefined, scheduledDate: form.scheduledDate || undefined }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Tạo phiếu bảo trì" size="md">
      <div className="space-y-3">
        <SelectField label="Thiết bị *" value={form.equipmentId} onChange={e => u('equipmentId', e.target.value)}
          options={[{ value: '', label: 'Chọn...' }, ...equips.map(e => ({ value: e.id, label: `${e.equipmentCode} — ${e.name}` }))]} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Loại" value={form.type} onChange={e => u('type', e.target.value)}
            options={[{ value: 'PREVENTIVE', label: 'Định kỳ' }, { value: 'BREAKDOWN', label: 'Sự cố' }, { value: 'INSPECTION', label: 'Kiểm định' }]} />
          <InputField label="Ngày lịch" type="date" value={form.scheduledDate} onChange={e => u('scheduledDate', e.target.value)} />
        </div>
        <TextareaField label="Mô tả *" rows={2} value={form.description} onChange={e => u('description', e.target.value)} />
        <InputField label="Chi phí (VND)" type="number" value={form.cost} onChange={e => u('cost', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Tạo</Button>
      </div>
    </Modal>
  )
}
