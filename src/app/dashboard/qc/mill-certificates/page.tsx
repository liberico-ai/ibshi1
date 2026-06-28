'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import {
  PageHeader, Button, FilterBar, KPICard, EmptyState, Modal,
  InputField,
} from '@/components/ui'
import { FileText } from 'lucide-react'

interface MillCert {
  id: string; certNumber: string; heatNumber: string; grade: string | null; thickness: string | null;
  isVerified: boolean; createdAt: string;
  material: { materialCode: string; name: string }
  vendor: { vendorCode: string; companyName: string }
}

interface TraceData {
  certificate: MillCert & { material: { id: string; materialCode: string; name: string; unit: string; currentStock: number }; vendor: { vendorCode: string; name: string } }
  traceability: {
    stockMovements: Array<{ id: string; type: string; quantity: number; reason: string; referenceNo: string | null; heatNumber: string | null; lotNumber: string | null; createdAt: string }>
    materialIssues: Array<{ id: string; quantity: number; heatNumber: string | null; issuedAt: string; workOrder: { woCode: string } }>
    relatedCerts: Array<{ id: string; certNumber: string; grade: string | null }>
  }
}

export default function MillCertificatesPage() {
  const [certs, setCerts] = useState<MillCert[]>([])
  const [stats, setStats] = useState({ verified: 0, unverified: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [traceTarget, setTraceTarget] = useState<TraceData | null>(null)
  const [filter, setFilter] = useState<'' | 'true' | 'false'>('')
  const [materialList, setMaterialList] = useState<{ id: string; materialCode: string; name: string }[]>([])
  const [vendorList, setVendorList] = useState<{ id: string; vendorCode: string; companyName: string }[]>([])

  const load = () => {
    const url = filter ? `/api/mill-certificates?verified=${filter}` : '/api/mill-certificates'
    apiFetch(url).then(res => { if (res.ok) { setCerts(res.certificates); setStats(res.stats) }; setLoading(false) })
  }
  useEffect(() => { load() }, [filter])

  const openForm = async () => {
    const [mRes, vRes] = await Promise.all([apiFetch('/api/warehouse'), apiFetch('/api/vendors')])
    if (mRes.ok) setMaterialList(mRes.materials || [])
    if (vRes.ok) setVendorList(vRes.vendors || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/mill-certificates', {
      method: 'POST',
      body: JSON.stringify({
        certNumber: fd.get('certNumber'), materialId: fd.get('materialId'),
        vendorId: fd.get('vendorId'), heatNumber: fd.get('heatNumber'),
        grade: fd.get('grade') || null, thickness: fd.get('thickness') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() } else alert(res.error || 'Loi')
  }

  const openTrace = async (certId: string) => {
    const res = await apiFetch(`/api/mill-certificates/${certId}/trace`)
    if (res.ok) setTraceTarget(res as TraceData)
    else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const filterOptions = [
    { value: '', label: 'Tat ca', count: stats.verified + stats.unverified },
    { value: 'true', label: 'Da xac minh', count: stats.verified },
    { value: 'false', label: 'Chua xac minh', count: stats.unverified },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Mill Certificates (MTR)"
        subtitle={`${certs.length} chung chi`}
        actions={
          <Button variant="accent" size="md" onClick={openForm}>
            + Them MTR
          </Button>
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-4">
        <KPICard
          label="Da xac minh"
          value={stats.verified}
          accentColor={SEMANTIC_COLORS.success.solid}
        />
        <KPICard
          label="Chua xac minh"
          value={stats.unverified}
          accentColor={SEMANTIC_COLORS.warning.solid}
        />
      </div>

      {/* Filters */}
      <FilterBar
        filters={filterOptions}
        value={filter}
        onChange={v => setFilter(v as '' | 'true' | 'false')}
      />

      {/* Inline Create Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-heading font-bold" style={{ color: 'var(--text-primary)' }}>Them Mill Certificate</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <InputField name="certNumber" required placeholder="So chung chi *" />
            <div className="input-field">
              <label className="input-label">Vat tu *</label>
              <select name="materialId" required className="input">
                <option value="">-- Vat tu --</option>
                {materialList.map(m => <option key={m.id} value={m.id}>{m.materialCode} -- {m.name}</option>)}
              </select>
            </div>
            <div className="input-field">
              <label className="input-label">Nha cung cap *</label>
              <select name="vendorId" required className="input">
                <option value="">-- Nha cung cap --</option>
                {vendorList.map(v => <option key={v.id} value={v.id}>{v.vendorCode} -- {v.companyName}</option>)}
              </select>
            </div>
            <InputField name="heatNumber" required placeholder="Heat Number *" />
            <InputField name="grade" placeholder="Grade" />
            <InputField name="thickness" placeholder="Thickness" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="accent" size="sm">Luu</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Huy</Button>
          </div>
        </form>
      )}

      {/* Data Table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>So CC</th>
              <th>Heat No.</th>
              <th>Vat tu</th>
              <th>NCC</th>
              <th>Grade</th>
              <th>Day</th>
              <th>Xác minh</th>
              <th>Ngày</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {certs.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState icon={<FileText />} title="Chua co MTR" />
                </td>
              </tr>
            ) : certs.map(c => (
              <tr key={c.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{c.certNumber}</span></td>
                <td className="font-mono text-xs" style={{ color: SEMANTIC_COLORS.info.solid }}>{c.heatNumber}</td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{c.material.materialCode}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.vendor.companyName}</td>
                <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{c.grade || '--'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.thickness || '--'}</td>
                <td>
                  <span
                    className="badge text-xs"
                    style={{
                      background: c.isVerified ? SEMANTIC_COLORS.success.bg : SEMANTIC_COLORS.warning.bg,
                      color: c.isVerified ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.warning.solid,
                    }}
                  >
                    {c.isVerified ? 'Da XM' : 'Cho'}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(c.createdAt)}</td>
                <td><Button variant="ghost" size="sm" onClick={() => openTrace(c.id)}>Truy vết</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {traceTarget && (
        <Modal open={true} onClose={() => setTraceTarget(null)} title={`Truy vết: Heat ${traceTarget.certificate.heatNumber}`} size="lg">
          <div className="space-y-4">
            {/* Certificate info */}
            <div className="card p-3">
              <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
                <p><strong>MTR:</strong> <span className="font-mono">{traceTarget.certificate.certNumber}</span></p>
                <p><strong>Vật tư:</strong> {traceTarget.certificate.material.materialCode} — {traceTarget.certificate.material.name}</p>
                <p><strong>NCC:</strong> {traceTarget.certificate.vendor.name}</p>
                <p><strong>Heat:</strong> <span className="font-mono" style={{ color: SEMANTIC_COLORS.info.solid }}>{traceTarget.certificate.heatNumber}</span></p>
                {traceTarget.certificate.grade && <p><strong>Grade:</strong> {traceTarget.certificate.grade}</p>}
              </div>
            </div>

            {/* Stock movements */}
            <div>
              <label className="input-label">Nhập/Xuất kho ({traceTarget.traceability.stockMovements.length})</label>
              {traceTarget.traceability.stockMovements.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa có giao dịch kho</p>
              ) : (
                <div className="space-y-1 mt-1">
                  {traceTarget.traceability.stockMovements.map(sm => (
                    <div key={sm.id} className="flex items-center gap-3 p-2 rounded-lg text-xs" style={{ background: 'var(--bg-primary)' }}>
                      <span className="px-1.5 py-0.5 rounded font-bold text-[10px]" style={{
                        background: sm.type === 'RECEIVE' ? SEMANTIC_COLORS.success.bg : SEMANTIC_COLORS.warning.bg,
                        color: sm.type === 'RECEIVE' ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.warning.solid,
                      }}>{sm.type}</span>
                      <span className="font-mono">{sm.quantity}</span>
                      <span className="flex-1" style={{ color: 'var(--text-muted)' }}>{sm.reason}</span>
                      {sm.referenceNo && <span className="font-mono" style={{ color: 'var(--accent)' }}>{sm.referenceNo}</span>}
                      <span style={{ color: 'var(--text-muted)' }}>{formatDate(sm.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Material issues */}
            <div>
              <label className="input-label">Cấp phát vật tư ({traceTarget.traceability.materialIssues.length})</label>
              {traceTarget.traceability.materialIssues.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Chưa cấp phát</p>
              ) : (
                <div className="space-y-1 mt-1">
                  {traceTarget.traceability.materialIssues.map(mi => (
                    <div key={mi.id} className="flex items-center gap-3 p-2 rounded-lg text-xs" style={{ background: 'var(--bg-primary)' }}>
                      <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{mi.workOrder.woCode}</span>
                      <span className="font-mono">{mi.quantity}</span>
                      <span className="flex-1" />
                      <span style={{ color: 'var(--text-muted)' }}>{formatDate(mi.issuedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Related certs */}
            {traceTarget.traceability.relatedCerts.length > 0 && (
              <div>
                <label className="input-label">MTR cùng Heat</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {traceTarget.traceability.relatedCerts.map(rc => (
                    <span key={rc.id} className="badge text-xs font-mono">{rc.certNumber}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
