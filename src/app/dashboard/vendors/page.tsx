'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'

interface Vendor {
  id: string; vendorCode: string; name: string; contactName: string | null; email: string | null;
  phone: string | null; address: string | null; country: string; category: string; rating: string | null;
  isActive: boolean; notes: string | null;
  // Hồ sơ NCC bổ sung (Module 1)
  shortName?: string | null; taxCode?: string | null; city?: string | null; website?: string | null;
  contactTitle?: string | null; contactPhone?: string | null; contactEmail?: string | null;
  vendorType?: string | null; bank?: string | null; accountNo?: string | null; blacklisted?: boolean;
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
  const [editVendor, setEditVendor] = useState<Vendor | null>(null)
  const [filter, setFilter] = useState('')

  const openEdit = (v: Vendor) => { setEditVendor(v); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setEditVendor(null) }

  // Đồng bộ "Loại": hợp {nhãn cứng đã biết} ∪ {loại THẬT trong data (từ stats)} → form/chip/nhãn luôn
  // khớp dữ liệu (local hay prod), không cần đổi DB. Loại đã biết → nhãn đẹp; loại lạ → hiện thô (hoa đầu).
  const allCats = Array.from(new Set([...Object.keys(catLabel), ...Object.keys(stats)])).filter(Boolean)
  const labelOf = (c: string) => catLabel[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : c)
  const colorOf = (c: string) => catColor[c] || '#64748b'

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
    const s = (k: string) => (fd.get(k) as string) || undefined
    const body = {
      vendorCode: fd.get('vendorCode'), name: fd.get('name'), category: fd.get('category'),
      contactName: s('contactName'), email: s('email'), phone: s('phone'), address: s('address'), notes: s('notes'),
      // Field bổ sung (Module 1)
      shortName: s('shortName'), taxCode: s('taxCode'), city: s('city'), website: s('website'),
      contactTitle: s('contactTitle'), contactPhone: s('contactPhone'), contactEmail: s('contactEmail'),
      vendorType: s('vendorType'), bank: s('bank'), accountNo: s('accountNo'),
      ...(editVendor ? { isActive: fd.get('isActive') === 'on', blacklisted: fd.get('blacklisted') === 'on' } : {}),
    }
    const res = editVendor
      ? await apiFetch(`/api/vendors/${editVendor.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await apiFetch('/api/vendors', { method: 'POST', body: JSON.stringify(body) })
    if (res.ok) { notify(editVendor ? 'Đã cập nhật NCC' : 'Đã thêm NCC', 'success'); closeForm(); load() }
    else notify(res.error || 'Lỗi lưu NCC')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Nhà cung cấp</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{vendors.length} nhà cung cấp</p>
        </div>
        <button onClick={() => { setEditVendor(null); setShowForm(v => editVendor ? true : !v) }} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm NCC</button>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${!filter ? 'text-white' : ''}`}
          style={{ background: !filter ? 'var(--accent)' : 'var(--surface-hover)', color: !filter ? '#fff' : 'var(--text-muted)' }}>
          Tất cả ({Object.values(stats).reduce((s, c) => s + c, 0)})
        </button>
        {allCats.map((k) => (
          <button key={k} onClick={() => setFilter(k)} className="text-xs px-3 py-1 rounded-full font-medium transition-all"
            style={{ background: filter === k ? colorOf(k) : 'var(--surface-hover)', color: filter === k ? '#fff' : 'var(--text-muted)' }}>
            {labelOf(k)} ({stats[k] || 0})
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form key={editVendor?.id || 'new'} onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{editVendor ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="vendorCode" required placeholder="Mã NCC *" defaultValue={editVendor?.vendorCode || ''} readOnly={!!editVendor} className="input text-sm" style={editVendor ? { opacity: 0.6 } : undefined} />
            <input name="name" required placeholder="Tên NCC *" defaultValue={editVendor?.name || ''} className="input text-sm" />
            <select name="category" required defaultValue={editVendor?.category || ''} className="input text-sm">
              <option value="">— Loại *—</option>
              {allCats.map((k) => <option key={k} value={k}>{labelOf(k)}</option>)}
            </select>
            <input name="contactName" placeholder="Người liên hệ" defaultValue={editVendor?.contactName || ''} className="input text-sm" />
            <input name="shortName" placeholder="Tên gọi tắt" defaultValue={editVendor?.shortName || ''} className="input text-sm" />
            <input name="taxCode" placeholder="Mã số thuế" defaultValue={editVendor?.taxCode || ''} className="input text-sm" />
            <select name="vendorType" defaultValue={editVendor?.vendorType || 'DOMESTIC'} className="input text-sm">
              <option value="DOMESTIC">Nội địa</option><option value="IMPORT">Nhập khẩu</option><option value="MIXED">Cả hai</option>
            </select>
            <input name="city" placeholder="Thành phố" defaultValue={editVendor?.city || ''} className="input text-sm" />
            <input name="email" type="email" placeholder="Email" defaultValue={editVendor?.email || ''} className="input text-sm" />
            <input name="phone" placeholder="SĐT" defaultValue={editVendor?.phone || ''} className="input text-sm" />
            <input name="website" placeholder="Website" defaultValue={editVendor?.website || ''} className="input text-sm" />
            <input name="contactTitle" placeholder="Chức danh liên hệ" defaultValue={editVendor?.contactTitle || ''} className="input text-sm" />
            <input name="contactPhone" placeholder="SĐT liên hệ" defaultValue={editVendor?.contactPhone || ''} className="input text-sm" />
            <input name="contactEmail" type="email" placeholder="Email liên hệ" defaultValue={editVendor?.contactEmail || ''} className="input text-sm" />
            <input name="bank" placeholder="Ngân hàng" defaultValue={editVendor?.bank || ''} className="input text-sm" />
            <input name="accountNo" placeholder="Số tài khoản" defaultValue={editVendor?.accountNo || ''} className="input text-sm" />
            <input name="address" placeholder="Địa chỉ" defaultValue={editVendor?.address || ''} className="input text-sm md:col-span-2" />
            <input name="notes" placeholder="Ghi chú" defaultValue={editVendor?.notes || ''} className="input text-sm md:col-span-2" />
          </div>
          {editVendor && (
            <div className="flex gap-5 items-center text-sm" style={{ color: 'var(--text-primary)' }}>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" name="isActive" defaultChecked={editVendor.isActive} /> Đang hoạt động</label>
              <label className="flex items-center gap-2 cursor-pointer" style={{ color: '#dc2626' }}><input type="checkbox" name="blacklisted" defaultChecked={!!editVendor.blacklisted} /> Blacklist (chặn)</label>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">{editVendor ? 'Lưu thay đổi' : 'Lưu'}</button>
            <button type="button" onClick={closeForm} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã</th><th>Tên NCC</th><th>Loại</th><th>Liên hệ</th>
              <th className="text-center">PO</th><th className="text-center">HĐ</th><th className="text-center">Thầu phụ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {vendors.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có NCC</td></tr>
            ) : vendors.map(v => (
              <tr key={v.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{v.vendorCode}</span></td>
                <td>
                  <div className="text-xs font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    {v.name}
                    {v.blacklisted && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#111827', color: '#fca5a5' }}>Blacklist</span>}
                    {!v.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#fef2f2', color: '#dc2626' }}>Ngừng HĐ</span>}
                  </div>
                  {v.address && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.address}</div>}
                </td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${colorOf(v.category)}20`, color: colorOf(v.category) }}>{labelOf(v.category)}</span></td>
                <td>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.contactName || '—'}</div>
                  {v.phone && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.phone}</div>}
                </td>
                <td className="text-center"><span className="text-xs font-bold">{v._count.purchaseOrders}</span></td>
                <td className="text-center"><span className="text-xs font-bold">{v._count.invoices}</span></td>
                <td className="text-center"><span className="text-xs font-bold">{v._count.subcontracts}</span></td>
                <td className="text-right"><button onClick={() => openEdit(v)} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>✎ Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
