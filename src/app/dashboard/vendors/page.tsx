'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Vendor {
  id: string; vendorCode: string; name: string; contactName: string | null; email: string | null;
  phone: string | null; address: string | null; country: string; category: string; rating: string | null;
  isActive: boolean; notes: string | null;
  _count: { purchaseOrders: number; invoices: number; subcontracts: number }
}

const catLabel: Record<string, string> = {
  steel_supplier: 'Thép', equipment: 'Thiết bị', subcontractor: 'Thầu phụ', service: 'Dịch vụ',
}
const catColor: Record<string, string> = {
  steel_supplier: '#0ea5e9', equipment: '#f59e0b', subcontractor: '#8b5cf6', service: '#10b981',
}

export default function VendorPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')

  const load = () => {
    const url = filter ? `/api/vendors?category=${filter}` : '/api/vendors'
    apiFetch(url).then(res => {
      if (res.ok) { setVendors(res.vendors); setStats(res.stats || {}) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [filter])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/vendors', {
      method: 'POST',
      body: JSON.stringify({
        vendorCode: fd.get('vendorCode'), name: fd.get('name'), category: fd.get('category'),
        contactName: fd.get('contactName') || null, email: fd.get('email') || null,
        phone: fd.get('phone') || null, address: fd.get('address') || null, notes: fd.get('notes') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🏢 Nhà cung cấp</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{vendors.length} nhà cung cấp</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm NCC</button>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${!filter ? 'text-white' : ''}`}
          style={{ background: !filter ? 'var(--accent)' : 'var(--surface-hover)', color: !filter ? '#fff' : 'var(--text-muted)' }}>
          Tất cả ({Object.values(stats).reduce((s, c) => s + c, 0)})
        </button>
        {Object.entries(catLabel).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} className="text-xs px-3 py-1 rounded-full font-medium transition-all"
            style={{ background: filter === k ? catColor[k] : 'var(--surface-hover)', color: filter === k ? '#fff' : 'var(--text-muted)' }}>
            {v} ({stats[k] || 0})
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm nhà cung cấp</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="vendorCode" required placeholder="Mã NCC *" className="input-field text-sm" />
            <input name="name" required placeholder="Tên NCC *" className="input-field text-sm" />
            <select name="category" required className="input-field text-sm">
              <option value="">— Loại *—</option>
              {Object.entries(catLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input name="contactName" placeholder="Người liên hệ" className="input-field text-sm" />
            <input name="email" type="email" placeholder="Email" className="input-field text-sm" />
            <input name="phone" placeholder="SĐT" className="input-field text-sm" />
            <input name="address" placeholder="Địa chỉ" className="input-field text-sm col-span-2" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã</th><th>Tên NCC</th><th>Loại</th><th>Liên hệ</th>
              <th className="text-center">PO</th><th className="text-center">HĐ</th><th className="text-center">Thầu phụ</th>
            </tr>
          </thead>
          <tbody>
            {vendors.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có NCC</td></tr>
            ) : vendors.map(v => (
              <tr key={v.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{v.vendorCode}</span></td>
                <td>
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{v.name}</div>
                  {v.address && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{v.address}</div>}
                </td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${catColor[v.category]}20`, color: catColor[v.category] }}>{catLabel[v.category] || v.category}</span></td>
                <td>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.contactName || '—'}</div>
                  {v.phone && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{v.phone}</div>}
                </td>
                <td className="text-center"><span className="text-xs font-bold">{v._count.purchaseOrders}</span></td>
                <td className="text-center"><span className="text-xs font-bold">{v._count.invoices}</span></td>
                <td className="text-center"><span className="text-xs font-bold">{v._count.subcontracts}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
