'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import {
  PageHeader, Button, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Ruler } from 'lucide-react'

interface Norm {
  id: string; code: string; name: string; category: string;
  unit: string; rate: number; basisUnit: string;
  projectId: string | null; notes: string | null;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  WELD: 'Hàn', PAINT: 'Sơn', CONSUMABLE: 'Tiêu hao',
}
const CATEGORY_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'WELD', label: 'Hàn' },
  { value: 'PAINT', label: 'Sơn' },
  { value: 'CONSUMABLE', label: 'Tiêu hao' },
]
const BASIS_OPTIONS = [
  { value: 'ton', label: 'tấn thép (ton)' },
  { value: 'kg', label: 'kg thép (kg)' },
]

const EDIT_ROLES = ['R01', 'R03', 'R03a']

export default function NormsPage() {
  const user = useAuthStore(s => s.user)
  const [norms, setNorms] = useState<Norm[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Norm | null>(null)

  const canEdit = EDIT_ROLES.includes(user?.roleCode || '')

  const loadNorms = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter) params.set('category', filter)
    const res = await apiFetch(`/api/design/norms?${params}`)
    if (res.ok) setNorms(res.norms)
    setLoading(false)
  }, [filter])

  useEffect(() => { loadNorms() }, [loadNorms])

  const openEdit = (norm: Norm) => { setEditing(norm); setShowForm(true) }
  const openCreate = () => { setEditing(null); setShowForm(true) }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Định mức"
        subtitle={`${norms.length} định mức`}
        actions={canEdit ? <Button variant="primary" onClick={openCreate}>+ Tạo định mức</Button> : undefined}
      />

      <div className="flex gap-2">
        {CATEGORY_OPTIONS.map(c => (
          <button
            key={c.value}
            onClick={() => setFilter(c.value)}
            className="filter-pill"
            data-active={filter === c.value}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên vật tư</th>
              <th>Loại</th>
              <th>Đơn vị</th>
              <th>Định mức</th>
              <th>Cơ sở</th>
              <th>Ghi chú</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {norms.length === 0 ? (
              <tr><td colSpan={canEdit ? 8 : 7}><EmptyState icon={<Ruler />} title="Chưa có định mức" /></td></tr>
            ) : norms.map(n => (
              <tr key={n.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{n.code}</span></td>
                <td className="text-xs">{n.name}</td>
                <td><span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{
                  background: n.category === 'WELD' ? '#dbeafe' : n.category === 'PAINT' ? '#fef3c7' : '#e0e7ff',
                  color: n.category === 'WELD' ? '#1d4ed8' : n.category === 'PAINT' ? '#92400e' : '#4338ca',
                }}>{CATEGORY_LABELS[n.category] || n.category}</span></td>
                <td className="text-xs font-mono">{n.unit}</td>
                <td className="text-xs font-mono font-bold" style={{ color: SEMANTIC_COLORS.info.solid }}>{Number(n.rate)}</td>
                <td className="text-xs font-mono">{n.basisUnit === 'ton' ? '/tấn' : `/${n.basisUnit}`}</td>
                <td className="text-xs max-w-[200px] truncate" style={{ color: 'var(--text-muted)' }}>{n.notes || '—'}</td>
                {canEdit && (
                  <td>
                    <button
                      onClick={() => openEdit(n)}
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{ color: 'var(--accent)' }}
                    >
                      Sửa
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tóm tắt: nếu có 10t thép chính, mỗi norm sẽ tiêu bao nhiêu */}
      {norms.length > 0 && (
        <div className="card p-4">
          <label className="input-label mb-2">Ước tính cho 10 tấn thép chính</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {norms.map(n => {
              const basis = n.basisUnit === 'ton' ? 10 : 10000
              const qty = Math.round(basis * Number(n.rate) * 100) / 100
              return (
                <div key={n.id} className="text-xs p-2 rounded" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="font-bold truncate">{n.name}</p>
                  <p className="font-mono" style={{ color: SEMANTIC_COLORS.info.solid }}>{qty} {n.unit}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <NormFormModal
        open={showForm}
        editing={editing}
        onClose={() => { setShowForm(false); setEditing(null) }}
        onSaved={() => { setShowForm(false); setEditing(null); loadNorms() }}
      />
    </div>
  )
}

function NormFormModal({ open, editing, onClose, onSaved }: {
  open: boolean; editing: Norm | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    code: '', name: '', category: 'WELD', unit: '', rate: '', basisUnit: 'ton', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    if (editing) {
      setForm({
        code: editing.code, name: editing.name, category: editing.category,
        unit: editing.unit, rate: String(editing.rate), basisUnit: editing.basisUnit,
        notes: editing.notes || '',
      })
    } else {
      setForm({ code: '', name: '', category: 'WELD', unit: '', rate: '', basisUnit: 'ton', notes: '' })
    }
  }, [editing, open])

  const submit = async () => {
    if (!form.name || !form.unit || !form.rate) return alert('Nhập đầy đủ tên, đơn vị, định mức')
    setSubmitting(true)

    if (editing) {
      const res = await apiFetch(`/api/design/norms/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name, unit: form.unit,
          rate: Number(form.rate), basisUnit: form.basisUnit,
          notes: form.notes || null,
        }),
      })
      setSubmitting(false)
      if (res.ok) onSaved()
      else alert(res.error || 'Lỗi')
    } else {
      const res = await apiFetch('/api/design/norms', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code || undefined,
          name: form.name, category: form.category, unit: form.unit,
          rate: Number(form.rate), basisUnit: form.basisUnit,
          notes: form.notes || null,
        }),
      })
      setSubmitting(false)
      if (res.ok) onSaved()
      else alert(res.error || 'Lỗi')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Sửa ${editing.code}` : 'Tạo định mức mới'} size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {!editing && (
            <InputField label="Mã (tự sinh nếu trống)" value={form.code} onChange={e => update('code', e.target.value)} placeholder="NORM-WELD-1" />
          )}
          <InputField label="Tên vật tư *" value={form.name} onChange={e => update('name', e.target.value)} placeholder="Que hàn E7018" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {!editing && (
            <SelectField label="Loại *" value={form.category} onChange={e => update('category', e.target.value)}
              options={CATEGORY_OPTIONS.filter(c => c.value !== '')} />
          )}
          <InputField label="Đơn vị *" value={form.unit} onChange={e => update('unit', e.target.value)} placeholder="kg, lít, viên..." />
          <InputField label="Định mức *" type="number" value={form.rate} onChange={e => update('rate', e.target.value)} placeholder="20" />
        </div>
        <SelectField label="Đơn vị cơ sở" value={form.basisUnit} onChange={e => update('basisUnit', e.target.value)}
          options={BASIS_OPTIONS} />
        <TextareaField label="Ghi chú" rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>{editing ? 'Cập nhật' : 'Tạo'}</Button>
      </div>
    </Modal>
  )
}
