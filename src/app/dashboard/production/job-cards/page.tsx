'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

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

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Chờ', color: '#475569', bg: '#f1f5f9' },
  IN_PROGRESS: { label: 'Đang làm', color: '#2563eb', bg: '#eff6ff' },
  COMPLETED: { label: 'Xong', color: '#16a34a', bg: '#f0fdf4' },
  CANCELLED: { label: 'Hủy', color: '#dc2626', bg: '#fef2f2' },
}

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
    const woRes = await apiFetch('/api/production?status=IN_PROGRESS&limit=100')
    if (woRes.ok) setWorkOrders(woRes.workOrders || [])
    // Also load OPEN ones
    const woOpen = await apiFetch('/api/production?status=OPEN&limit=100')
    if (woOpen.ok) setWorkOrders(prev => [...prev, ...(woOpen.workOrders || [])])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [filterType])

  const canCreate = ['R01', 'R06', 'R06a', 'R06b'].includes(user?.roleCode || '')

  // Stats
  const todayCount = jobCards.filter(j => new Date(j.workDate).toDateString() === new Date().toDateString()).length
  const totalQty = jobCards.reduce((acc, j) => acc + (j.actualQty || 0), 0)
  const completedCount = jobCards.filter(j => j.status === 'COMPLETED').length

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1,2,3,4].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Phiếu Công Việc</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tổ trưởng nhập khối lượng hàng ngày</p>
        </div>
        {canCreate && (
          <button onClick={openForm}
            className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg"
            style={{ background: 'var(--accent)' }}>
            + Nhập KL
          </button>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Hôm nay', value: todayCount, icon: '📅', color: '#2563eb' },
          { label: 'Tổng KL', value: `${totalQty.toLocaleString()}`, icon: '📊', color: '#16a34a' },
          { label: 'Hoàn thành', value: completedCount, icon: '✅', color: '#059669' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{s.icon} {s.label}</p>
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Work type filters */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterType('')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: !filterType ? 'var(--accent)' : 'var(--bg-primary)', color: !filterType ? 'white' : 'var(--text-muted)' }}>
          Tất cả
        </button>
        {Object.entries(WORK_TYPES).map(([key, val]) => (
          <button key={key} onClick={() => setFilterType(key)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: filterType === key ? '#e0e7ff' : 'var(--bg-primary)', color: filterType === key ? val.color : 'var(--text-muted)' }}>
            {val.icon} {val.label}
          </button>
        ))}
      </div>

      {/* Job Card list */}
      <div className="space-y-2">
        {jobCards.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có phiếu công việc</p>
          </div>
        )}
        {jobCards.map(jc => {
          const wt = WORK_TYPES[jc.workType] || { label: jc.workType, icon: '📋', color: '#64748b' }
          const st = STATUS_MAP[jc.status] || STATUS_MAP.OPEN
          const progress = jc.plannedQty && jc.actualQty ? Math.min(100, Math.round((jc.actualQty / jc.plannedQty) * 100)) : null
          return (
            <div key={jc.id} className="card p-4 transition-all hover:shadow-md">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: st.bg }}>{wt.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{jc.jobCode}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: '#f8fafc', color: wt.color }}>{wt.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>WO: {jc.workOrder.woCode}</span>
                    <span>Tổ: {jc.teamCode}</span>
                    {jc.manpower && <span>👷 {jc.manpower}</span>}
                  </div>
                </div>
                <div className="text-right min-w-[100px]">
                  {jc.actualQty != null && (
                    <p className="text-lg font-bold" style={{ color: '#16a34a' }}>
                      {jc.actualQty.toLocaleString()} <span className="text-xs font-normal">{jc.unit}</span>
                    </p>
                  )}
                  {progress != null && (
                    <div className="mt-1">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e2e8f0', width: '80px', marginLeft: 'auto' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: progress >= 100 ? '#16a34a' : '#f59e0b' }} />
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{progress}% kế hoạch</p>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {new Date(jc.workDate).toLocaleDateString('vi-VN')}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && (
        <CreateJobCardModal
          workOrders={workOrders}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadData() }}
        />
      )}
    </div>
  )
}

function CreateJobCardModal({ workOrders, onClose, onCreated }: {
  workOrders: WO[]; onClose: () => void; onCreated: () => void
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

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '14px', outline: 'none',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nhập Khối Lượng Hàng Ngày</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* WO selector */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Lệnh SX (WO) *</label>
          <select value={form.workOrderId} onChange={e => update('workOrderId', e.target.value)} style={inputStyle}>
            <option value="">Chọn WO...</option>
            {workOrders.map(wo => (
              <option key={wo.id} value={wo.id}>{wo.woCode} — {wo.description}</option>
            ))}
          </select>
        </div>

        {/* Work type */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại công việc *</label>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(WORK_TYPES).map(([key, val]) => (
              <button key={key} onClick={() => update('workType', key)}
                className="py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: form.workType === key ? '#e0e7ff' : 'var(--bg-primary)',
                  color: form.workType === key ? val.color : 'var(--text-muted)',
                  border: form.workType === key ? `1px solid ${val.color}` : '1px solid transparent',
                }}>
                {val.icon} {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Qty + Unit */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>KL kế hoạch</label>
            <input type="number" value={form.plannedQty} onChange={e => update('plannedQty', e.target.value)} style={inputStyle} placeholder="0" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>KL thực tế *</label>
            <input type="number" value={form.actualQty} onChange={e => update('actualQty', e.target.value)} style={inputStyle} placeholder="0" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Đơn vị</label>
            <select value={form.unit} onChange={e => update('unit', e.target.value)} style={inputStyle}>
              <option value="kg">kg</option>
              <option value="m">mét</option>
              <option value="m2">m²</option>
              <option value="cái">cái</option>
              <option value="bộ">bộ</option>
            </select>
          </div>
        </div>

        {/* Date + Manpower */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ngày làm *</label>
            <input type="date" value={form.workDate} onChange={e => update('workDate', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Số CN</label>
            <input type="number" value={form.manpower} onChange={e => update('manpower', e.target.value)} style={inputStyle} placeholder="Số công nhân" />
          </div>
        </div>

        {/* Notes */}
        <div className="mb-5">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ghi chú</label>
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={2}
            style={{ ...inputStyle, resize: 'none' as const }} placeholder="Ghi chú..." />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang lưu...' : 'Lưu phiếu'}
          </button>
        </div>
      </div>
    </div>
  )
}
