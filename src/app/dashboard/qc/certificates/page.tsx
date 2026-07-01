'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import {
  PageHeader, Button, FilterBar, KPICard, EmptyState, Modal,
  InputField, SelectField,
} from '@/components/ui'
import { ClipboardList } from 'lucide-react'

interface Certificate {
  id: string; certType: string; certNumber: string; holderName: string;
  issuedBy: string; issueDate: string; expiryDate: string; standard: string | null;
  scope: string | null; isActive: boolean; renewedFromId: string | null;
  daysToExpiry: number; isExpired: boolean; isExpiringSoon: boolean;
}

const TYPE_MAP: Record<string, { label: string; icon: string }> = {
  welder_cert: { label: 'Thợ hàn', icon: 'WD' },
  wps: { label: 'WPS', icon: 'WP' },
  pqr: { label: 'PQR', icon: 'PQ' },
  ndt_cert: { label: 'NDT', icon: 'NT' },
  workshop_cert: { label: 'Xưởng', icon: 'WS' },
  calibration: { label: 'Hiệu chuẩn', icon: 'CA' },
}

export default function CertificatePage() {
  const [certs, setCerts] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [renewTarget, setRenewTarget] = useState<Certificate | null>(null)
  const [filterType, setFilterType] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterType) params.set('certType', filterType)
    const res = await apiFetch(`/api/qc/certificates?${params}`)
    if (res.ok) setCerts(res.certificates || [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [filterType])

  const canCreate = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')
  const expiredCount = certs.filter(c => c.isExpired).length
  const expiringSoonCount = certs.filter(c => c.isExpiringSoon && !c.isExpired).length

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const filterOptions = [
    { value: '', label: 'Tat ca', count: certs.length },
    ...Object.entries(TYPE_MAP).map(([k, v]) => ({
      value: k,
      label: `${v.icon} ${v.label}`,
    })),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Certificate Registry"
        subtitle="So chung chi & hieu chuan"
        actions={canCreate ? (
          <Button variant="primary" size="md" onClick={() => setShowForm(true)}>
            + Them chung chi
          </Button>
        ) : undefined}
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-4 gap-3">
        <KPICard
          label="Tong CC"
          value={certs.length}
          accentColor={SEMANTIC_COLORS.info.solid}
        />
        <KPICard
          label="Con han"
          value={certs.length - expiredCount}
          accentColor={SEMANTIC_COLORS.success.solid}
        />
        <KPICard
          label="Sap het han"
          value={expiringSoonCount}
          accentColor={SEMANTIC_COLORS.warning.solid}
        />
        <KPICard
          label="Het han"
          value={expiredCount}
          accentColor={SEMANTIC_COLORS.danger.solid}
        />
      </div>

      {/* Filters */}
      <FilterBar
        filters={filterOptions}
        value={filterType}
        onChange={setFilterType}
      />

      {/* Cert List */}
      <div className="space-y-2">
        {certs.length === 0 && (
          <EmptyState
            icon={<ClipboardList />}
            title="Chua co chung chi nao"
            description="Them chung chi moi de bat dau theo doi"
          />
        )}
        {certs.map(cert => {
          const tp = TYPE_MAP[cert.certType] || { label: cert.certType, icon: '--' }
          const borderColor = cert.isExpired
            ? SEMANTIC_COLORS.danger.solid
            : cert.isExpiringSoon
              ? SEMANTIC_COLORS.warning.solid
              : SEMANTIC_COLORS.success.solid
          const badgeBg = cert.isExpired
            ? SEMANTIC_COLORS.danger.bg
            : cert.isExpiringSoon
              ? SEMANTIC_COLORS.warning.bg
              : SEMANTIC_COLORS.success.bg
          return (
            <div key={cert.id} className="card p-4 transition-all hover:shadow-md" style={{ borderLeft: `4px solid ${borderColor}` }}>
              <div className="flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: cert.isExpired ? SEMANTIC_COLORS.danger.bg : SEMANTIC_COLORS.success.bg }}
                >
                  {tp.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{cert.holderName}</span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded font-bold"
                      style={{ background: badgeBg, color: borderColor }}
                    >
                      {cert.isExpired ? 'HET HAN' : `${cert.daysToExpiry} ngay`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-mono">{cert.certNumber}</span>
                    <span>{tp.label}</span>
                    <span>{cert.issuedBy}</span>
                    {cert.standard && <span>{cert.standard}</span>}
                  </div>
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                  <p>Cấp: {formatDate(cert.issueDate)}</p>
                  <p className="font-semibold" style={{ color: borderColor }}>
                    HH: {formatDate(cert.expiryDate)}
                  </p>
                  {canCreate && (cert.isExpired || cert.isExpiringSoon) && cert.isActive && (
                    <Button variant="outline" size="sm" className="mt-1"
                      onClick={() => setRenewTarget(cert)}>Gia hạn</Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && <CreateCertModal onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); loadData() }} />}

      {renewTarget && (
        <RenewCertModal
          cert={renewTarget}
          onClose={() => setRenewTarget(null)}
          onCreated={() => { setRenewTarget(null); loadData() }}
        />
      )}
    </div>
  )
}

function CreateCertModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ certType: 'welder_cert', certNumber: '', holderName: '', issuedBy: '', issueDate: '', expiryDate: '', standard: '', scope: '' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.certNumber || !form.holderName || !form.issuedBy || !form.issueDate || !form.expiryDate) return alert('Dien day du thong tin')
    setSubmitting(true)
    const res = await apiFetch('/api/qc/certificates', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Loi tao chung chi')
  }

  const typeOptions = Object.entries(TYPE_MAP).map(([k, v]) => ({
    value: k,
    label: `${v.icon} ${v.label}`,
  }))

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Them chung chi"
      size="lg"
      actions={
        <div className="flex gap-3 w-full">
          <Button variant="ghost" onClick={onClose} className="flex-1">Huy</Button>
          <Button variant="primary" onClick={submit} loading={submitting} className="flex-1">
            Them chung chi
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Loai *"
            value={form.certType}
            onChange={e => update('certType', e.target.value)}
            options={typeOptions}
          />
          <InputField
            label="So chung chi *"
            value={form.certNumber}
            onChange={e => update('certNumber', e.target.value)}
            placeholder="AWS-..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Ten nguoi/TB *"
            value={form.holderName}
            onChange={e => update('holderName', e.target.value)}
          />
          <InputField
            label="Co quan cap *"
            value={form.issuedBy}
            onChange={e => update('issuedBy', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Ngay cap *"
            type="date"
            value={form.issueDate}
            onChange={e => update('issueDate', e.target.value)}
          />
          <InputField
            label="Ngay het han *"
            type="date"
            value={form.expiryDate}
            onChange={e => update('expiryDate', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Tieu chuan"
            value={form.standard}
            onChange={e => update('standard', e.target.value)}
            placeholder="AWS D1.1, ASNT..."
          />
          <InputField
            label="Pham vi"
            value={form.scope}
            onChange={e => update('scope', e.target.value)}
            placeholder="SMAW, GTAW..."
          />
        </div>
      </div>
    </Modal>
  )
}

function RenewCertModal({ cert, onClose, onCreated }: { cert: Certificate; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ certNumber: '', issueDate: '', expiryDate: '' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.certNumber || !form.issueDate || !form.expiryDate) return alert('Điền đầy đủ')
    setSubmitting(true)
    const res = await apiFetch(`/api/qc/certificates/${cert.id}/renew`, {
      method: 'POST', body: JSON.stringify(form),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi gia hạn')
  }

  return (
    <Modal open={true} onClose={onClose} title={`Gia hạn: ${cert.holderName}`} size="md">
      <div className="card p-3 mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        <p>CC cũ: <span className="font-mono">{cert.certNumber}</span> — HH: {formatDate(cert.expiryDate)}</p>
      </div>
      <div className="space-y-3">
        <InputField label="Số CC mới *" value={form.certNumber} onChange={e => update('certNumber', e.target.value)} placeholder={`${cert.certNumber}-R1`} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Ngày cấp *" type="date" value={form.issueDate} onChange={e => update('issueDate', e.target.value)} />
          <InputField label="Ngày hết hạn *" type="date" value={form.expiryDate} onChange={e => update('expiryDate', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Gia hạn</Button>
      </div>
    </Modal>
  )
}
