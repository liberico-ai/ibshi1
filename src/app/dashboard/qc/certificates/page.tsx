'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface Certificate {
  id: string; certType: string; certNumber: string; holderName: string;
  issuedBy: string; issueDate: string; expiryDate: string; standard: string | null;
  scope: string | null; isActive: boolean;
  daysToExpiry: number; isExpired: boolean; isExpiringSoon: boolean;
}

const TYPE_MAP: Record<string, { label: string; icon: string }> = {
  welder_cert: { label: 'Thợ hàn', icon: '🔥' },
  ndt_cert: { label: 'NDT', icon: '🔬' },
  workshop_cert: { label: 'Xưởng', icon: '🏭' },
  calibration: { label: 'Hiệu chuẩn', icon: '📏' },
}

export default function CertificatePage() {
  const [certs, setCerts] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Certificate Registry</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sổ chứng chỉ & hiệu chuẩn</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg" style={{ background: 'var(--accent)' }}>
            + Thêm chứng chỉ
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Tổng CC</p>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{certs.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>✅ Còn hạn</p>
          <p className="text-xl font-bold" style={{ color: '#16a34a' }}>{certs.length - expiredCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>⚠️ Sắp hết hạn</p>
          <p className="text-xl font-bold" style={{ color: '#f59e0b' }}>{expiringSoonCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>🔴 Hết hạn</p>
          <p className="text-xl font-bold" style={{ color: '#dc2626' }}>{expiredCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1">
        {[{ v: '', l: 'Tất cả' }, ...Object.entries(TYPE_MAP).map(([k, v]) => ({ v: k, l: `${v.icon} ${v.label}` }))].map(f => (
          <button key={f.v} onClick={() => setFilterType(f.v)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: filterType === f.v ? 'var(--accent)' : 'var(--bg-primary)', color: filterType === f.v ? 'white' : 'var(--text-muted)' }}>
            {f.l}
          </button>
        ))}
      </div>

      {/* Cert List */}
      <div className="space-y-2">
        {certs.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">🎓</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có chứng chỉ nào</p>
          </div>
        )}
        {certs.map(cert => {
          const tp = TYPE_MAP[cert.certType] || { label: cert.certType, icon: '📄' }
          const borderColor = cert.isExpired ? '#dc2626' : cert.isExpiringSoon ? '#f59e0b' : '#16a34a'
          return (
            <div key={cert.id} className="card p-4 transition-all hover:shadow-md" style={{ borderLeft: `4px solid ${borderColor}` }}>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: cert.isExpired ? '#fef2f2' : '#f0fdf4' }}>
                  {tp.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{cert.holderName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: cert.isExpired ? '#fef2f2' : cert.isExpiringSoon ? '#fef9c3' : '#f0fdf4', color: borderColor }}>
                      {cert.isExpired ? 'HẾT HẠN' : cert.isExpiringSoon ? `${cert.daysToExpiry} ngày` : `${cert.daysToExpiry} ngày`}
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
                  <p>Cấp: {new Date(cert.issueDate).toLocaleDateString('vi-VN')}</p>
                  <p className="font-semibold" style={{ color: borderColor }}>
                    HH: {new Date(cert.expiryDate).toLocaleDateString('vi-VN')}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && <CreateCertModal onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); loadData() }} />}
    </div>
  )
}

function CreateCertModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ certType: 'welder_cert', certNumber: '', holderName: '', issuedBy: '', issueDate: '', expiryDate: '', standard: '', scope: '' })
  const [submitting, setSubmitting] = useState(false)
  const update = (f: string, v: string) => setForm({ ...form, [f]: v })

  const submit = async () => {
    if (!form.certNumber || !form.holderName || !form.issuedBy || !form.issueDate || !form.expiryDate) return alert('Điền đầy đủ thông tin')
    setSubmitting(true)
    const res = await apiFetch('/api/qc/certificates', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo chứng chỉ')
  }

  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-lg animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Thêm chứng chỉ</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>
        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại *</label>
              <select value={form.certType} onChange={e => update('certType', e.target.value)} style={inputStyle}>
                {Object.entries(TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Số chứng chỉ *</label>
              <input value={form.certNumber} onChange={e => update('certNumber', e.target.value)} style={inputStyle} placeholder="AWS-..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tên người/TB *</label>
              <input value={form.holderName} onChange={e => update('holderName', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Cơ quan cấp *</label>
              <input value={form.issuedBy} onChange={e => update('issuedBy', e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ngày cấp *</label>
              <input type="date" value={form.issueDate} onChange={e => update('issueDate', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ngày hết hạn *</label>
              <input type="date" value={form.expiryDate} onChange={e => update('expiryDate', e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tiêu chuẩn</label>
              <input value={form.standard} onChange={e => update('standard', e.target.value)} style={inputStyle} placeholder="AWS D1.1, ASNT..." />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Phạm vi</label>
              <input value={form.scope} onChange={e => update('scope', e.target.value)} style={inputStyle} placeholder="SMAW, GTAW..." />
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang lưu...' : 'Thêm chứng chỉ'}
          </button>
        </div>
      </div>
    </div>
  )
}
