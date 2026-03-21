'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

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
    if (res.ok) { setShowForm(false); load() } else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📜 Mill Certificates (MTR)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{certs.length} chứng chỉ</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm MTR</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4"><p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Đã xác minh</p><p className="text-lg font-bold" style={{ color: '#16a34a' }}>{stats.verified}</p></div>
        <div className="card p-4"><p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Chưa xác minh</p><p className="text-lg font-bold" style={{ color: '#f59e0b' }}>{stats.unverified}</p></div>
      </div>

      <div className="flex gap-2">
        {([['', 'Tất cả'], ['true', '✓ Đã xác minh'], ['false', '⏳ Chưa xác minh']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v as '' | 'true' | 'false')} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === v ? 'var(--accent)' : 'var(--surface-hover)', color: filter === v ? '#fff' : 'var(--text-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm Mill Certificate</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input name="certNumber" required placeholder="Số chứng chỉ *" className="input-field text-sm" />
            <select name="materialId" required className="input-field text-sm"><option value="">— Vật tư —</option>{materialList.map(m => <option key={m.id} value={m.id}>{m.materialCode} — {m.name}</option>)}</select>
            <select name="vendorId" required className="input-field text-sm"><option value="">— Nhà cung cấp —</option>{vendorList.map(v => <option key={v.id} value={v.id}>{v.vendorCode} — {v.companyName}</option>)}</select>
            <input name="heatNumber" required placeholder="Heat Number *" className="input-field text-sm" />
            <input name="grade" placeholder="Grade" className="input-field text-sm" />
            <input name="thickness" placeholder="Thickness" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Số CC</th><th>Heat No.</th><th>Vật tư</th><th>NCC</th><th>Grade</th><th>Dày</th><th>Xác minh</th><th>Ngày</th></tr></thead>
          <tbody>
            {certs.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có MTR</td></tr>
            ) : certs.map(c => (
              <tr key={c.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{c.certNumber}</span></td>
                <td className="text-xs font-mono" style={{ color: '#0ea5e9' }}>{c.heatNumber}</td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{c.material.materialCode}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.vendor.companyName}</td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{c.grade || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.thickness || '—'}</td>
                <td><span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: c.isVerified ? '#16a34a20' : '#f59e0b20', color: c.isVerified ? '#16a34a' : '#f59e0b' }}>{c.isVerified ? '✓ Đã XM' : '⏳ Chờ'}</span></td>
                <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleDateString('vi-VN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
