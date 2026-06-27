'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, FilterBar, StatusBadge, EmptyState,
  KPICard, Modal, InputField, SelectField, TextareaField,
} from '@/components/ui'

interface JobCard {
  id: string; jobCode: string; workOrderId: string; teamCode: string; workType: string;
  description: string | null; plannedQty: number | null; actualQty: number | null; unit: string;
  workDate: string; manpower: number | null; status: string; notes: string | null; createdAt: string;
  workOrder: { woCode: string; description: string; projectId: string };
}

interface WO { id: string; woCode: string; description: string; status: string; teamCode: string }

const WORK_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  cutting: { label: 'Cắt', icon: '✂️', color: '#dc2626' },
  welding: { label: 'Hàn', icon: '🔥', color: '#ea580c' },
  assembly: { label: 'Lắp ráp', icon: '🔩', color: '#2563eb' },
  painting: { label: 'Sơn', icon: '🎨', color: '#7c3aed' },
  blasting: { label: 'Phun bi', icon: '💨', color: '#64748b' },
  machining: { label: 'Gia công', icon: '⚙️', color: '#0891b2' },
  inspection: { label: 'Kiểm tra', icon: '🔍', color: '#16a34a' },
}

const WORK_TYPE_FILTERS = [
  { value: '', label: 'Tất cả' },
  ...Object.entries(WORK_TYPES).map(([key, val]) => ({
    value: key,
    label: `${val.icon} ${val.label}`,
  })),
]

export default function JobCardsPage() {
  const [jobCards, setJobCards] = useState<JobCard[]>([])
  const [workOrders, setWorkOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const params = filterType ? `?workType=${filterType}` : ''
    const res = await apiFetch(`/api/production/job-cards${params}`)
    if (res.ok) setJobCards(res.jobCards || [])
    setLoading(false)
  }

  const openForm = async () => {
    // Reset state before loading to avoid accumulating WOs (race condition fix)
    setWorkOrders([])
    const woRes = await apiFetch('/api/production?status=IN_PROGRESS&limit=100')
    const inProgressWOs = woRes.ok ? (woRes.workOrders || []) : []
    // Also load OPEN ones
    const woOpen = await apiFetch('/api/production?status=OPEN&limit=100')
    const openWOs = woOpen.ok ? (woOpen.workOrders || []) : []
    setWorkOrders([...inProgressWOs, ...openWOs])
    setShowForm(true)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData() }, [filterType])

  const canCreate = ['R01', 'R06', 'R06a', 'R06b'].includes(user?.roleCode || '')

  // Stats
  const todayCount = jobCards.filter(j => new Date(j.workDate).toDateString() === new Date().toDateString()).length
  const totalQty = jobCards.reduce((acc, j) => acc + (j.actualQty || 0), 0)
  const completedCount = jobCards.filter(j => j.status === 'COMPLETED').length

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Phiếu Công Việc"
        subtitle="Tổ trưởng nhập khối lượng hàng ngày"
        actions={canCreate ? <Button variant="accent" onClick={openForm}>+ Nhập KL</Button> : undefined}
      />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 stagger-children">
        <KPICard label="Hôm nay" value={todayCount} accentColor="var(--info, #2D6CB5)" icon={<span style={{ fontSize: 20 }}>📅</span>} />
        <KPICard label="Tổng KL" value={totalQty.toLocaleString()} accentColor="var(--success, #1E8E5A)" icon={<span style={{ fontSize: 20 }}>📊</span>} />
        <KPICard label="Hoàn thành" value={completedCount} accentColor="#059669" icon={<span style={{ fontSize: 20 }}>✅</span>} />
      </div>

      {/* Work type filters */}
      <FilterBar
        filters={WORK_TYPE_FILTERS}
        value={filterType}
        onChange={setFilterType}
      />

      {/* Job Card list */}
      <div className="space-y-2">
        {jobCards.length === 0 && (
          <EmptyState icon="📋" title="Chưa có phiếu công việc" description="Nhập khối lượng hàng ngày để tạo phiếu mới" />
        )}
        {jobCards.map(jc => {
          const wt = WORK_TYPES[jc.workType] || { label: jc.workType, icon: '📋', color: '#64748b' }
          const progress = jc.plannedQty && jc.actualQty ? Math.min(100, Math.round((jc.actualQty / jc.plannedQty) * 100)) : null
          return (
            <div key={jc.id} className="card p-4 transition-all hover:shadow-md">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: 'var(--bg-secondary, #f1f5f9)' }}>{wt.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{jc.jobCode}</span>
                    <StatusBadge category="jobCard" status={jc.status} />
                    <span className="badge" style={{ background: 'var(--bg-secondary, #f8fafc)', color: wt.color }}>{wt.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>WO: <span className="font-mono">{jc.workOrder.woCode}</span></span>
                    <span>Tổ: {jc.teamCode}</span>
                    {jc.manpower && <span>👷 {jc.manpower}</span>}
                  </div>
                </div>
                <div className="text-right min-w-[100px]">
                  {jc.actualQty != null && (
                    <p className="text-lg font-mono font-bold" style={{ color: 'var(--success, #16a34a)' }}>
                      {jc.actualQty.toLocaleString()} <span className="text-xs font-normal">{jc.unit}</span>
                    </p>
                  )}
                  {progress != null && (
                    <div className="mt-1">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border, #e2e8f0)', width: '80px', marginLeft: 'auto' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: progress >= 100 ? 'var(--success, #16a34a)' : 'var(--warning, #f59e0b)' }} />
                      </div>
                      <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{progress}% kế hoạch</p>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(jc.workDate)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <CreateJobCardModal
        open={showForm}
        workOrders={workOrders}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); loadData() }}
      />
    </div>
  )
}

function CreateJobCardModal({ open, workOrders, onClose, onCreated }: {
  open: boolean; workOrders: WO[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    workOrderId: '', workType: 'welding', description: '',
    plannedQty: '', actualQty: '', unit: 'kg',
    workDate: new Date().toISOString().split('T')[0],
    manpower: '', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (field: string, value: string) => setForm({ ...form, [field]: value })

  const submit = async () => {
    if (!form.workOrderId || !form.workType || !form.workDate) return alert('Chọn WO, loại việc, và ngày')
    setSubmitting(true)
    const res = await apiFetch('/api/production/job-cards', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        plannedQty: form.plannedQty ? parseFloat(form.plannedQty) : undefined,
        actualQty: form.actualQty ? parseFloat(form.actualQty) : undefined,
        manpower: form.manpower ? parseInt(form.manpower) : undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo phiếu')
  }

  return (
    <Modal open={open} onClose={onClose} title="Nhập Khối Lượng Hàng Ngày" size="lg"
      actions={
        <div className="flex gap-3 w-full justify-end">
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button variant="accent" onClick={submit} loading={submitting}>{submitting ? 'Đang lưu...' : 'Lưu phiếu'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* WO selector */}
        <SelectField
          label="Lệnh SX (WO) *"
          value={form.workOrderId}
          onChange={e => update('workOrderId', e.target.value)}
          options={[
            { value: '', label: 'Chọn WO...' },
            ...workOrders.map(wo => ({ value: wo.id, label: `${wo.woCode} — ${wo.description}` })),
          ]}
        />

        {/* Work type - keep specialized grid UI as-is */}
        <div>
          <label className="input-label">Loại công việc *</label>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(WORK_TYPES).map(([key, val]) => (
              <button key={key} onClick={() => update('workType', key)}
                className="py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: form.workType === key ? 'var(--accent-bg, #e0e7ff)' : 'var(--bg-primary)',
                  color: form.workType === key ? val.color : 'var(--text-muted)',
                  border: form.workType === key ? `1px solid ${val.color}` : '1px solid transparent',
                }}>
                {val.icon} {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Qty + Unit */}
        <div className="grid grid-cols-3 gap-3">
          <InputField
            label="KL kế hoạch"
            type="number"
            value={form.plannedQty}
            onChange={e => update('plannedQty', e.target.value)}
            placeholder="0"
          />
          <InputField
            label="KL thực tế *"
            type="number"
            value={form.actualQty}
            onChange={e => update('actualQty', e.target.value)}
            placeholder="0"
          />
          <SelectField
            label="Đơn vị"
            value={form.unit}
            onChange={e => update('unit', e.target.value)}
            options={[
              { value: 'kg', label: 'kg' },
              { value: 'm', label: 'mét' },
              { value: 'm2', label: 'm²' },
              { value: 'cái', label: 'cái' },
              { value: 'bộ', label: 'bộ' },
            ]}
          />
        </div>

        {/* Date + Manpower */}
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Ngày làm *"
            type="date"
            value={form.workDate}
            onChange={e => update('workDate', e.target.value)}
          />
          <InputField
            label="Số CN"
            type="number"
            value={form.manpower}
            onChange={e => update('manpower', e.target.value)}
            placeholder="Số công nhân"
          />
        </div>

        {/* Notes */}
        <TextareaField
          label="Ghi chú"
          value={form.notes}
          onChange={e => update('notes', e.target.value)}
          rows={2}
          placeholder="Ghi chú..."
        />
      </div>
    </Modal>
  )
}
