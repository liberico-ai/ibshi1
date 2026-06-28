'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface Equip {
  id: string; equipmentCode: string; name: string; category: string;
  model: string | null; serialNo: string | null; manufacturer: string | null;
  location: string | null; status: string; condition: string;
  inspectionDue: string | null; lastInspection: string | null;
  inspectionAlert: string | null;
  department: { code: string; name: string } | null;
  currentAssignment: { workOrder: { woCode: string } | null; department: { code: string; name: string } | null } | null;
}

interface Dept { id: string; code: string; name: string }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'AVAILABLE', label: 'Sẵn sàng' },
  { value: 'IN_USE', label: 'Đang dùng' },
  { value: 'MAINTENANCE', label: 'Bảo trì' },
  { value: 'RETIRED', label: 'Thanh lý' },
]

const CATEGORIES: Record<string, string> = {
  CRANE: 'Cẩu', WELDING_MACHINE: 'Máy hàn', CUTTING_MACHINE: 'Máy cắt',
  COMPRESSOR: 'Máy nén', GENERATOR: 'Máy phát', VEHICLE: 'Xe',
  SCAFFOLD: 'Giàn giáo', OTHER: 'Khác',
}

export default function EquipmentPage() {
  const user = useAuthStore(s => s.user)
  const [equipment, setEquipment] = useState<Equip[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const canEdit = ['R01', 'R10', 'R13', 'R06'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/tbcg/equipment?${params}`)
    if (res.ok) setEquipment(res.equipment)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const overdue = equipment.filter(e => e.inspectionAlert === 'OVERDUE').length
  const dueSoon = equipment.filter(e => e.inspectionAlert === 'DUE_SOON').length
  const inUse = equipment.filter(e => e.status === 'IN_USE').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Thiết bị & Cơ giới"
        subtitle={`${equipment.length} thiết bị`}
        actions={canEdit ? <Button variant="accent" onClick={() => setShowCreate(true)}>+ Thêm TB</Button> : undefined}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
        <KPICard label="Tổng TB" value={equipment.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đang dùng" value={inUse} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Sẵn sàng" value={equipment.filter(e => e.status === 'AVAILABLE').length} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="KĐ quá hạn" value={overdue} accentColor={overdue > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="KĐ sắp hết" value={dueSoon} accentColor={dueSoon > 0 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.success.solid} />
      </div>

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã</th><th>Tên</th><th>Loại</th><th>Vị trí</th><th>Phòng</th>
              <th>Trạng thái</th><th>Kiểm định</th><th>Đang gắn</th>
            </tr>
          </thead>
          <tbody>
            {equipment.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon="🔧" title="Chưa có thiết bị" /></td></tr>
            ) : equipment.map(eq => (
              <tr key={eq.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{eq.equipmentCode}</span></td>
                <td className="text-xs font-bold">{eq.name}</td>
                <td className="text-xs">{CATEGORIES[eq.category] || eq.category}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{eq.location || '—'}</td>
                <td className="text-xs font-mono">{eq.department?.code || '—'}</td>
                <td><StatusBadge category="equipment" status={eq.status} /></td>
                <td>
                  {eq.inspectionAlert === 'OVERDUE' ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold animate-pulse" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>QUÁ HẠN</span>
                  ) : eq.inspectionAlert === 'DUE_SOON' ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: SEMANTIC_COLORS.warning.bg, color: SEMANTIC_COLORS.warning.solid }}>SẮP HẾT</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>OK</span>
                  )}
                </td>
                <td className="text-xs">
                  {eq.currentAssignment ? (
                    <span className="font-mono">{eq.currentAssignment.workOrder?.woCode || eq.currentAssignment.department?.code || '—'}</span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateEquipmentModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}
    </div>
  )
}

function CreateEquipmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [depts, setDepts] = useState<Dept[]>([])
  const [form, setForm] = useState({ name: '', category: 'OTHER', model: '', serialNo: '', manufacturer: '', location: '', departmentId: '', inspectionDue: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const u = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/production/teams').then(r => { if (r.ok) setDepts(r.teams) })
  }, [])

  const submit = async () => {
    if (!form.name) return alert('Nhập tên thiết bị')
    setSubmitting(true)
    const res = await apiFetch('/api/tbcg/equipment', {
      method: 'POST',
      body: JSON.stringify({ ...form, departmentId: form.departmentId || undefined, inspectionDue: form.inspectionDue || undefined }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Thêm thiết bị" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Tên thiết bị *" value={form.name} onChange={e => u('name', e.target.value)} placeholder="Cẩu trục 10T" />
          <SelectField label="Loại" value={form.category} onChange={e => u('category', e.target.value)}
            options={Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v }))} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <InputField label="Model" value={form.model} onChange={e => u('model', e.target.value)} />
          <InputField label="Serial No." value={form.serialNo} onChange={e => u('serialNo', e.target.value)} />
          <InputField label="Nhà SX" value={form.manufacturer} onChange={e => u('manufacturer', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <InputField label="Vị trí" value={form.location} onChange={e => u('location', e.target.value)} placeholder="Nhà xưởng A" />
          <SelectField label="Tổ/Phòng" value={form.departmentId} onChange={e => u('departmentId', e.target.value)}
            options={[{ value: '', label: 'Không chọn' }, ...depts.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` }))]} />
          <InputField label="Hạn kiểm định" type="date" value={form.inspectionDue} onChange={e => u('inspectionDue', e.target.value)} />
        </div>
        <TextareaField label="Ghi chú" rows={2} value={form.notes} onChange={e => u('notes', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>Thêm</Button>
      </div>
    </Modal>
  )
}
