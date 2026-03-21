'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface Vendor {
  id: string; vendorCode: string; name: string; contactName: string | null;
  email: string | null; phone: string | null; address: string | null;
  country: string; category: string; rating: number | string | null;
  isActive: boolean; notes: string | null; createdAt: string;
}

const CATEGORY_MAP: Record<string, { label: string; icon: string; color: string }> = {
  steel_supplier: { label: 'Thép', icon: '🏗️', color: '#6366f1' },
  equipment: { label: 'Thiết bị', icon: '⚙️', color: '#0891b2' },
  subcontractor: { label: 'Thầu phụ', icon: '👷', color: '#ea580c' },
  service: { label: 'Dịch vụ', icon: '🔧', color: '#16a34a' },
  welding: { label: 'Hàn', icon: '🔥', color: '#dc2626' },
  paint: { label: 'Sơn', icon: '🎨', color: '#8b5cf6' },
}

const COUNTRY_FLAG: Record<string, string> = {
  VN: '🇻🇳', KR: '🇰🇷', SG: '🇸🇬', JP: '🇯🇵', US: '🇺🇸', CN: '🇨🇳', DE: '🇩🇪',
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterCat, setFilterCat] = useState('')
  const user = useAuthStore((s) => s.user)

  const loadData = async () => {
    setLoading(true)
    const res = await apiFetch('/api/vendors')
    if (res.ok) {
      let list = res.vendors || []
      if (filterCat) list = list.filter((v: Vendor) => v.category === filterCat)
      setVendors(list)
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [filterCat])

  const canManage = ['R01', 'R02', 'R07'].includes(user?.roleCode || '')

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Nhà cung cấp</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Quản lý danh sách NCC & đánh giá</p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(true)}
            className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg"
            style={{ background: 'var(--accent)' }}>
            + Thêm NCC
          </button>
        )}
      </div>

      {/* Category Filters */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterCat('')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: !filterCat ? 'var(--accent)' : 'var(--bg-primary)', color: !filterCat ? 'white' : 'var(--text-muted)' }}>
          Tất cả ({vendors.length})
        </button>
        {Object.entries(CATEGORY_MAP).map(([key, val]) => (
          <button key={key} onClick={() => setFilterCat(key)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: filterCat === key ? '#e0e7ff' : 'var(--bg-primary)', color: filterCat === key ? val.color : 'var(--text-muted)' }}>
            {val.icon} {val.label}
          </button>
        ))}
      </div>

      {/* Vendor Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {vendors.length === 0 && (
          <div className="card p-12 text-center col-span-2">
            <p className="text-4xl mb-3">🏭</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có nhà cung cấp</p>
          </div>
        )}
        {vendors.map(v => {
          const cat = CATEGORY_MAP[v.category] || { label: v.category, icon: '📦', color: '#64748b' }
          const rating = Number(v.rating || 0)
          return (
            <div key={v.id} className="card p-5 transition-all hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold"
                  style={{ background: 'var(--bg-primary)', color: cat.color }}>
                  {v.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{v.name}</span>
                    <span className="text-xs">{COUNTRY_FLAG[v.country] || v.country}</span>
                    {!v.isActive && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: '#fef2f2', color: '#dc2626' }}>Ngừng HĐ</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>{v.vendorCode}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: '#f0f9ff', color: cat.color }}>{cat.icon} {cat.label}</span>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {v.contactName && <p>👤 {v.contactName}</p>}
                    {v.email && <p>✉️ {v.email}</p>}
                    {v.phone && <p>📞 {v.phone}</p>}
                  </div>
                </div>
                <div className="text-right">
                  {/* Rating Stars */}
                  <div className="flex gap-0.5 justify-end mb-1">
                    {[1,2,3,4,5].map(star => (
                      <span key={star} className="text-sm"
                        style={{ color: star <= rating ? '#f59e0b' : '#e2e8f0' }}>★</span>
                    ))}
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {new Date(v.createdAt).toLocaleDateString('vi-VN')}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && (
        <CreateVendorModal
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadData() }}
        />
      )}
    </div>
  )
}

function CreateVendorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    vendorCode: '', name: '', category: 'steel_supplier', country: 'VN',
    contactName: '', email: '', phone: '', address: '', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (field: string, value: string) => setForm({ ...form, [field]: value })

  const submit = async () => {
    if (!form.vendorCode || !form.name) return alert('Nhập mã và tên NCC')
    setSubmitting(true)
    const res = await apiFetch('/api/vendors', {
      method: 'POST',
      body: JSON.stringify(form),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi tạo NCC')
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
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Thêm Nhà cung cấp</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Mã NCC *</label>
            <input value={form.vendorCode} onChange={e => update('vendorCode', e.target.value)} placeholder="NCC-xxx" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Tên NCC *</label>
            <input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Tên công ty" style={inputStyle} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại</label>
            <select value={form.category} onChange={e => update('category', e.target.value)} style={inputStyle}>
              {Object.entries(CATEGORY_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.icon} {val.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Quốc gia</label>
            <select value={form.country} onChange={e => update('country', e.target.value)} style={inputStyle}>
              {Object.entries(COUNTRY_FLAG).map(([code, flag]) => (
                <option key={code} value={code}>{flag} {code}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Người liên hệ</label>
          <input value={form.contactName} onChange={e => update('contactName', e.target.value)} placeholder="Họ tên" style={inputStyle} />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Email</label>
            <input value={form.email} onChange={e => update('email', e.target.value)} placeholder="email@ncc.com" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Điện thoại</label>
            <input value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="09x-xxx-xxxx" style={inputStyle} />
          </div>
        </div>

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
            {submitting ? 'Đang tạo...' : 'Thêm NCC'}
          </button>
        </div>
      </div>
    </div>
  )
}
