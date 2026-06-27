'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import {
  PageHeader, Button, FilterBar, KPICard, EmptyState,
  InputField,
} from '@/components/ui'

interface MillCert {
  id: string; certNumber: string; heatNumber: string; grade: string | null; thickness: string | null;
  isVerified: boolean; createdAt: string;
  material: { materialCode: string; name: string }
  vendor: { vendorCode: string; companyName: string }
}

export default function MillCertificatesPage() {
  const [certs, setCerts] = useState<MillCert[]>([])
  const [stats, setStats] = useState({ verified: 0, unverified: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
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
              <th>Xac minh</th>
              <th>Ngay</th>
            </tr>
          </thead>
          <tbody>
            {certs.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState icon="📜" title="Chua co MTR" />
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
