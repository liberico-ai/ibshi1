'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface ShipmentPLItem { pieceMark: string; weight: number | null; quantity: number }
interface ShipmentItem {
  id: string; packingList: { plCode: string; totalWeight: number | null; totalPieces: number; items: ShipmentPLItem[] }
}

interface Shipment {
  id: string; shipmentCode: string; status: string; vehicleNo: string | null;
  driverName: string | null; driverPhone: string | null; destination: string | null;
  shippedAt: string | null; arrivedAt: string | null; receivedAt: string | null;
  totalWeight: number | null; totalPieces: number; notes: string | null; createdAt: string;
  items: ShipmentItem[];
  project: { projectCode: string; projectName: string };
}

interface AvailablePL { id: string; plCode: string; totalWeight: number | null; totalPieces: number; status: string }
interface ProjectOption { id: string; projectCode: string; projectName: string }

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING', label: 'Chờ xuất' },
  { value: 'IN_TRANSIT', label: 'Đang VC' },
  { value: 'ARRIVED', label: 'Đã tới' },
  { value: 'RECEIVED', label: 'Đã nhận' },
]

export default function ShipmentsPage() {
  const user = useAuthStore(s => s.user)
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const canCreate = ['R01', 'R02', 'R05', 'R05a', 'R07', 'R07a'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/logistics/shipments?${params}`)
    if (res.ok) setShipments(res.shipments)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const transitionMap: Record<string, { next: string; label: string }> = {
    PENDING: { next: 'IN_TRANSIT', label: 'Xuất phát' },
    IN_TRANSIT: { next: 'ARRIVED', label: 'Đã tới' },
    ARRIVED: { next: 'RECEIVED', label: 'KH nhận' },
  }

  const handleTransition = async (id: string, nextStatus: string) => {
    setActionLoading(id)
    const res = await apiFetch(`/api/logistics/shipments/${id}`, {
      method: 'PUT', body: JSON.stringify({ status: nextStatus }),
    })
    if (res.ok) loadData()
    else alert(res.error || 'Lỗi')
    setActionLoading(null)
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const totalWeight = shipments.reduce((s, sh) => s + (sh.totalWeight || 0), 0)
  const inTransit = shipments.filter(s => s.status === 'IN_TRANSIT').length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Chuyến hàng"
        subtitle={`${shipments.length} chuyến`}
        actions={canCreate ? <Button variant="accent" onClick={() => setShowCreate(true)}>+ Tạo chuyến</Button> : undefined}
      />

      <div className="grid grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng chuyến" value={shipments.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Tổng tấn" value={`${Math.round(totalWeight / 1000 * 100) / 100}t`} accentColor="var(--accent)" />
        <KPICard label="Đang VC" value={inTransit} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="Đã nhận" value={shipments.filter(s => s.status === 'RECEIVED').length} accentColor={SEMANTIC_COLORS.success.solid} />
      </div>

      <FilterBar filters={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã chuyến</th><th>Dự án</th><th>Trạng thái</th><th>Kiện</th>
              <th>KL</th><th>Xe</th><th>Đích đến</th><th>Ngày</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shipments.length === 0 ? (
              <tr><td colSpan={9}><EmptyState icon="🚚" title="Chưa có chuyến hàng" /></td></tr>
            ) : shipments.map(sh => {
              const action = transitionMap[sh.status]
              return (
                <tr key={sh.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{sh.shipmentCode}</span></td>
                  <td className="text-xs">{sh.project.projectCode}</td>
                  <td><StatusBadge category="logistics" status={sh.status} /></td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {sh.items.map(si => (
                        <span key={si.id} className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: SEMANTIC_COLORS.info.bg, color: SEMANTIC_COLORS.info.solid }}>
                          {si.packingList.plCode}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-xs font-mono">{sh.totalWeight ? `${sh.totalWeight}kg` : '—'}</td>
                  <td className="text-xs">{sh.vehicleNo || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{sh.destination || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {sh.shippedAt ? formatDate(sh.shippedAt) : formatDate(sh.createdAt)}
                  </td>
                  <td>
                    {action && (
                      <button
                        onClick={() => handleTransition(sh.id, action.next)}
                        disabled={actionLoading === sh.id}
                        className="text-xs px-2 py-1 rounded font-bold text-white"
                        style={{ background: SEMANTIC_COLORS.success.solid }}
                      >
                        {actionLoading === sh.id ? '...' : action.label}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateShipmentModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData() }}
        />
      )}
    </div>
  )
}

function CreateShipmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [availablePLs, setAvailablePLs] = useState<AvailablePL[]>([])
  const [projectId, setProjectId] = useState('')
  const [selectedPLs, setSelectedPLs] = useState<string[]>([])
  const [vehicleNo, setVehicleNo] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [destination, setDestination] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    apiFetch('/api/projects').then(r => { if (r.ok) setProjects(r.projects) })
  }, [])

  useEffect(() => {
    if (projectId) {
      apiFetch(`/api/logistics/packing-lists?projectId=${projectId}&status=DRAFT`).then(r => {
        if (r.ok) setAvailablePLs(r.packingLists.map((pl: AvailablePL) => ({
          id: pl.id, plCode: pl.plCode, totalWeight: pl.totalWeight, totalPieces: pl.totalPieces, status: pl.status,
        })))
      })
    }
  }, [projectId])

  const togglePL = (id: string) => {
    setSelectedPLs(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  const submit = async () => {
    if (!projectId || selectedPLs.length === 0) return alert('Chọn dự án và ít nhất 1 kiện')
    setSubmitting(true)
    const res = await apiFetch('/api/logistics/shipments', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        packingListIds: selectedPLs,
        vehicleNo: vehicleNo || undefined,
        driverName: driverName || undefined,
        driverPhone: driverPhone || undefined,
        destination: destination || undefined,
        notes: notes || undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Tạo chuyến hàng" size="lg">
      <div className="space-y-4">
        <SelectField label="Dự án *" value={projectId} onChange={e => { setProjectId(e.target.value); setSelectedPLs([]) }}
          options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />

        {availablePLs.length > 0 && (
          <div>
            <label className="input-label mb-2">Chọn kiện (DRAFT) để gom vào chuyến</label>
            <div className="space-y-1">
              {availablePLs.map(pl => (
                <label key={pl.id} className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-[var(--bg-hover)]">
                  <input type="checkbox" checked={selectedPLs.includes(pl.id)} onChange={() => togglePL(pl.id)} />
                  <span className="font-mono text-xs font-bold">{pl.plCode}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {pl.totalWeight ? `${pl.totalWeight}kg` : '—'} / {pl.totalPieces}pc
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {projectId && availablePLs.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Không có kiện DRAFT cho dự án này</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <InputField label="Biển số xe" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="51C-12345" />
          <InputField label="Tài xế" value={driverName} onChange={e => setDriverName(e.target.value)} />
          <InputField label="SĐT tài xế" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} />
        </div>
        <InputField label="Đích đến" value={destination} onChange={e => setDestination(e.target.value)} placeholder="Công trình ABC, KCN XYZ" />
        <TextareaField label="Ghi chú" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>Tạo chuyến</Button>
      </div>
    </Modal>
  )
}
