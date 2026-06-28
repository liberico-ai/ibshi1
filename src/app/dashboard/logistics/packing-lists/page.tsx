'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface PLItem {
  id: string; pieceMark: string; weight: number | null; quantity: number; qcStatus: string;
  description: string | null;
  workOrder: { woCode: string; pieceMark: string | null; plannedWeight: number | null }
}

interface PackingList {
  id: string; plCode: string; status: string; totalWeight: number | null; totalPieces: number;
  dimensions: string | null; notes: string | null; createdAt: string;
  items: PLItem[];
  project: { projectCode: string; projectName: string };
  shipmentItems: Array<{ shipment: { shipmentCode: string; status: string } }>;
}

interface WO { id: string; woCode: string; pieceMark: string | null; plannedWeight: number | null }
interface ProjectOption { id: string; projectCode: string; projectName: string }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'SHIPPED', label: 'Đã xuất' },
]

export default function PackingListsPage() {
  const user = useAuthStore(s => s.user)
  const [packingLists, setPLs] = useState<PackingList[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const canCreate = ['R01', 'R02', 'R05', 'R05a', 'R07', 'R07a'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/logistics/packing-lists?${params}`)
    if (res.ok) setPLs(res.packingLists)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const totalWeight = packingLists.reduce((s, pl) => s + (pl.totalWeight || 0), 0)
  const totalPieces = packingLists.reduce((s, pl) => s + pl.totalPieces, 0)
  const shipped = packingLists.filter(p => p.status === 'SHIPPED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Packing List"
        subtitle={`${packingLists.length} kiện`}
        actions={canCreate ? <Button variant="accent" onClick={() => setShowCreate(true)}>+ Tạo kiện</Button> : undefined}
      />

      <div className="grid grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng kiện" value={packingLists.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Tổng kg" value={`${Math.round(totalWeight)} kg`} accentColor="var(--accent)" />
        <KPICard label="Piece-mark" value={totalPieces} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="Đã xuất" value={shipped} accentColor={SEMANTIC_COLORS.success.solid} />
      </div>

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã kiện</th><th>Dự án</th><th>Trạng thái</th><th>Piece-marks</th>
              <th>Trọng lượng</th><th>Kích thước</th><th>Chuyến</th><th>Ngày</th>
            </tr>
          </thead>
          <tbody>
            {packingLists.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon="📦" title="Chưa có kiện" /></td></tr>
            ) : packingLists.map(pl => (
              <tr key={pl.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{pl.plCode}</span></td>
                <td className="text-xs">{pl.project.projectCode}</td>
                <td><StatusBadge category="logistics" status={pl.status} /></td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {pl.items.map(it => (
                      <span key={it.id} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: SEMANTIC_COLORS.success.bg, color: SEMANTIC_COLORS.success.solid }}>
                        {it.pieceMark}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-xs font-mono">{pl.totalWeight ? `${pl.totalWeight} kg` : '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{pl.dimensions || '—'}</td>
                <td>
                  {pl.shipmentItems.length > 0
                    ? pl.shipmentItems.map(si => (
                      <span key={si.shipment.shipmentCode} className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: SEMANTIC_COLORS.info.bg, color: SEMANTIC_COLORS.info.solid }}>
                        {si.shipment.shipmentCode}
                      </span>
                    ))
                    : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                  }
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(pl.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreatePLModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData() }}
        />
      )}
    </div>
  )
}

function CreatePLModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [workOrders, setWorkOrders] = useState<WO[]>([])
  const [projectId, setProjectId] = useState('')
  const [dimensions, setDimensions] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<Array<{ workOrderId: string; pieceMark: string; weight: string; quantity: string; description: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/projects').then(r => { if (r.ok) setProjects(r.projects) })
  }, [])

  useEffect(() => {
    if (projectId) {
      apiFetch(`/api/production?projectId=${projectId}&limit=200`).then(r => {
        if (r.ok) setWorkOrders(r.workOrders.map((w: WO & { plannedWeight?: number }) => ({
          id: w.id, woCode: w.woCode, pieceMark: w.pieceMark, plannedWeight: w.plannedWeight ?? null,
        })))
      })
    }
  }, [projectId])

  const addItem = () => setItems([...items, { workOrderId: '', pieceMark: '', weight: '', quantity: '1', description: '' }])
  const updateItem = (i: number, f: string, v: string) => {
    const next = [...items]
    next[i] = { ...next[i], [f]: v }
    if (f === 'workOrderId') {
      const wo = workOrders.find(w => w.id === v)
      if (wo) {
        next[i].pieceMark = wo.pieceMark || ''
        next[i].weight = wo.plannedWeight ? String(wo.plannedWeight) : ''
      }
    }
    setItems(next)
  }
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (!projectId || items.length === 0) return alert('Chọn dự án và thêm piece-mark')
    setSubmitting(true)
    setError('')
    const res = await apiFetch('/api/logistics/packing-lists', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        dimensions: dimensions || undefined,
        notes: notes || undefined,
        items: items.map(it => ({
          workOrderId: it.workOrderId,
          pieceMark: it.pieceMark,
          description: it.description || undefined,
          weight: it.weight ? Number(it.weight) : undefined,
          quantity: it.quantity ? Number(it.quantity) : 1,
        })),
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Tạo Packing List" size="lg">
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded text-xs whitespace-pre-wrap" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Dự án *" value={projectId} onChange={e => setProjectId(e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
          <InputField label="Kích thước" value={dimensions} onChange={e => setDimensions(e.target.value)} placeholder="2000x1500x1200mm" />
        </div>
        <TextareaField label="Ghi chú" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="input-label">Piece-marks (QC gate: chỉ gom piece-mark QC đạt)</label>
            <Button variant="outline" onClick={addItem}>+ Thêm</Button>
          </div>
          {items.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Bấm + Thêm để thêm piece-mark vào kiện</p>}
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 mb-2 items-end">
              <SelectField label={i === 0 ? 'WO' : ''} value={it.workOrderId} onChange={e => updateItem(i, 'workOrderId', e.target.value)}
                options={[{ value: '', label: 'WO...' }, ...workOrders.map(w => ({ value: w.id, label: w.woCode }))]} />
              <InputField label={i === 0 ? 'Piece-mark' : ''} value={it.pieceMark} onChange={e => updateItem(i, 'pieceMark', e.target.value)} placeholder="C1" />
              <InputField label={i === 0 ? 'KL (kg)' : ''} type="number" value={it.weight} onChange={e => updateItem(i, 'weight', e.target.value)} />
              <InputField label={i === 0 ? 'SL' : ''} type="number" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} />
              <InputField label={i === 0 ? 'Mô tả' : ''} value={it.description} onChange={e => updateItem(i, 'description', e.target.value)} />
              <button onClick={() => removeItem(i)} className="text-xs px-2 py-1 rounded mb-1"
                style={{ color: SEMANTIC_COLORS.danger.solid }}>Xóa</button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>Tạo kiện</Button>
      </div>
    </Modal>
  )
}
