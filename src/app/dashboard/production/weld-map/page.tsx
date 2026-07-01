'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import {
  PageHeader, Button, FilterBar, KPICard, EmptyState, Modal,
  InputField, SelectField, StatusBadge,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { AlertTriangle } from 'lucide-react'

interface WeldJoint {
  id: string; jointNo: string; jointType: string; wpsNo: string | null;
  welderId: string | null; welderCertId: string | null; wpsCertId: string | null;
  diameter: number | null; thickness: number | null; length: number | null;
  status: string; weldedAt: string | null; ndtStatus: string | null; ndtMethod: string | null;
  ncrId: string | null; remarks: string | null; workOrderId: string;
  workOrder: { woCode: string; pieceMark: string | null };
  welder: { id: string; fullName: string } | null;
  ncr: { id: string; ncrCode: string; status: string } | null;
}

interface Stats { total: number; welded: number; pending: number; ndtPassed: number; ndtFailed: number }
interface WO { id: string; woCode: string }

const NDT_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  PENDING: { bg: '#F1F3F5', color: '#64748B', label: 'Chờ UT' },
  PASSED:  { bg: SEMANTIC_COLORS.success.bg, color: SEMANTIC_COLORS.success.solid, label: 'UT Đạt' },
  FAILED:  { bg: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid, label: 'UT Lỗi' },
}
const JOINT_TYPES: Record<string, string> = { BUTT: 'Butt', FILLET: 'Fillet', LAP: 'Lap', TEE: 'Tee', CORNER: 'Corner' }

export default function WeldMapPage() {
  const [joints, setJoints] = useState<WeldJoint[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, welded: 0, pending: 0, ndtPassed: 0, ndtFailed: 0 })
  const [workOrders, setWorkOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterWO, setFilterWO] = useState('')
  const user = useAuthStore(s => s.user)

  const canEdit = ['R01', 'R06', 'R06a', 'R06b', 'R09', 'R09a'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    if (filterWO) params.set('workOrderId', filterWO)
    const [jRes, woRes] = await Promise.all([
      apiFetch(`/api/production/weld-map?${params}`),
      apiFetch('/api/production?limit=100'),
    ])
    if (jRes.ok) { setJoints(jRes.joints); setStats(jRes.stats) }
    if (woRes.ok) setWorkOrders(woRes.workOrders.map((w: WO) => ({ id: w.id, woCode: w.woCode })))
    setLoading(false)
  }, [filterStatus, filterWO])

  useEffect(() => { loadData() }, [loadData])

  const updateJoint = async (id: string, data: Record<string, unknown>) => {
    const res = await apiFetch(`/api/production/weld-map/${id}`, {
      method: 'PUT', body: JSON.stringify(data),
    })
    if (res.ok) loadData()
    else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const statusFilters = [
    { value: '', label: 'Tất cả' },
    { value: 'PENDING', label: 'Chờ hàn' },
    { value: 'WELDED', label: 'Đã hàn' },
    { value: 'REPAIRED', label: 'Sửa chữa' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Weld Map"
        subtitle="Sơ đồ mối hàn & NDT"
        actions={canEdit ? <Button variant="primary" onClick={() => setShowForm(true)}>+ Thêm mối hàn</Button> : undefined}
      />

      <div className="grid grid-cols-5 gap-3 stagger-children">
        <KPICard label="Tổng mối" value={stats.total} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đã hàn" value={stats.welded} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Chờ hàn" value={stats.pending} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="UT Đạt" value={stats.ndtPassed} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="UT Lỗi" value={stats.ndtFailed} accentColor={stats.ndtFailed > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
      </div>

      <div className="flex gap-4 flex-wrap">
        <FilterBar filters={statusFilters} value={filterStatus} onChange={setFilterStatus} />
        {workOrders.length > 0 && (
          <select className="input text-xs" value={filterWO} onChange={e => setFilterWO(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Tất cả WO</option>
            {workOrders.map(w => <option key={w.id} value={w.id}>{w.woCode}</option>)}
          </select>
        )}
      </div>

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mối hàn</th>
              <th>WO</th>
              <th>Loại</th>
              <th>WPS</th>
              <th>Thợ hàn</th>
              <th>Kích thước</th>
              <th>Trạng thái</th>
              <th>NDT</th>
              <th>NCR</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {joints.length === 0 ? (
              <tr><td colSpan={canEdit ? 10 : 9}><EmptyState icon={<AlertTriangle />} title="Chưa có mối hàn" /></td></tr>
            ) : joints.map(j => {
              const ndt = NDT_COLORS[j.ndtStatus || 'PENDING']
              return (
                <tr key={j.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{j.jointNo}</span></td>
                  <td>
                    <span className="text-xs font-mono">{j.workOrder.woCode}</span>
                    {j.workOrder.pieceMark && <span className="text-[10px] block" style={{ color: 'var(--text-muted)' }}>{j.workOrder.pieceMark}</span>}
                  </td>
                  <td className="text-xs">{JOINT_TYPES[j.jointType] || j.jointType}</td>
                  <td className="text-xs font-mono">{j.wpsNo || '—'}</td>
                  <td className="text-xs">{j.welder?.fullName || '—'}</td>
                  <td className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {[j.diameter && `D${j.diameter}`, j.thickness && `t${j.thickness}`, j.length && `L${j.length}`].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td><StatusBadge category="qc" status={j.status === 'WELDED' ? 'PASSED' : j.status === 'REPAIRED' ? 'CONDITIONAL' : 'PENDING'} /></td>
                  <td><span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: ndt.bg, color: ndt.color }}>{ndt.label}</span></td>
                  <td>
                    {j.ncr ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>{j.ncr.ncrCode}</span>
                    ) : '—'}
                  </td>
                  {canEdit && (
                    <td>
                      <div className="flex gap-1">
                        {j.status === 'PENDING' && (
                          <button className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: SEMANTIC_COLORS.success.solid }}
                            onClick={() => updateJoint(j.id, { status: 'WELDED' })}>Đã hàn</button>
                        )}
                        {j.status === 'WELDED' && j.ndtStatus === 'PENDING' && (
                          <>
                            <button className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: SEMANTIC_COLORS.success.solid }}
                              onClick={() => updateJoint(j.id, { ndtStatus: 'PASSED', ndtMethod: 'UT' })}>UT Đạt</button>
                            <button className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: SEMANTIC_COLORS.danger.solid }}
                              onClick={() => updateJoint(j.id, { ndtStatus: 'FAILED', ndtMethod: 'UT' })}>UT Lỗi</button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <CreateJointModal
          workOrders={workOrders}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadData() }}
        />
      )}
    </div>
  )
}

interface CertOption { id: string; certNumber: string; holderName: string; isExpired: boolean; isExpiringSoon: boolean }

function CreateJointModal({ workOrders, onClose, onCreated }: {
  workOrders: WO[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    workOrderId: '', jointNo: '', jointType: 'BUTT', wpsNo: '', wpsCertId: '',
    diameter: '', thickness: '', length: '', remarks: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [wpsCerts, setWpsCerts] = useState<CertOption[]>([])
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/qc/certificates?certType=wps').then(res => {
      if (res.ok) setWpsCerts(res.certificates.filter((c: CertOption) => !c.isExpired))
    })
  }, [])

  const submit = async () => {
    if (!form.workOrderId || !form.jointNo) return alert('Chọn WO và nhập số mối')
    setSubmitting(true)
    const res = await apiFetch('/api/production/weld-map', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        wpsCertId: form.wpsCertId || undefined,
        diameter: form.diameter ? Number(form.diameter) : undefined,
        thickness: form.thickness ? Number(form.thickness) : undefined,
        length: form.length ? Number(form.length) : undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Thêm mối hàn" size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="WO *" value={form.workOrderId} onChange={e => update('workOrderId', e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...workOrders.map(w => ({ value: w.id, label: w.woCode }))]} />
          <InputField label="Số mối *" value={form.jointNo} onChange={e => update('jointNo', e.target.value)} placeholder="J1, W2..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Loại" value={form.jointType} onChange={e => update('jointType', e.target.value)}
            options={Object.entries(JOINT_TYPES).map(([k, v]) => ({ value: k, label: v }))} />
          <SelectField label="WPS (cert)" value={form.wpsCertId} onChange={e => update('wpsCertId', e.target.value)}
            options={[{ value: '', label: 'Không chọn' }, ...wpsCerts.map(c => ({ value: c.id, label: `${c.certNumber} — ${c.holderName}${c.isExpiringSoon ? ' ⚠' : ''}` }))]} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <InputField label="D (mm)" type="number" value={form.diameter} onChange={e => update('diameter', e.target.value)} />
          <InputField label="t (mm)" type="number" value={form.thickness} onChange={e => update('thickness', e.target.value)} />
          <InputField label="L (mm)" type="number" value={form.length} onChange={e => update('length', e.target.value)} />
        </div>
        <InputField label="Ghi chú" value={form.remarks} onChange={e => update('remarks', e.target.value)} />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Thêm</Button>
      </div>
    </Modal>
  )
}
