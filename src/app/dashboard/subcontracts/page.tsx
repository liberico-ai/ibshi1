'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Contract {
  id: string; contractCode: string; description: string; contractValue: string; currency: string;
  startDate: string | null; endDate: string | null; status: string;
  project: { projectCode: string; projectName: string }
  vendor: { vendorCode: string; name: string; category: string }
}

const statusLabel: Record<string, string> = { ACTIVE: 'Đang thực hiện', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' }
const statusColor: Record<string, string> = { ACTIVE: '#0ea5e9', COMPLETED: '#16a34a', CANCELLED: '#dc2626' }

export default function SubcontractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [totalValue, setTotalValue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [vendorList, setVendorList] = useState<{ id: string; vendorCode: string; name: string }[]>([])

  const load = () => {
    apiFetch('/api/subcontracts').then(res => {
      if (res.ok) { setContracts(res.contracts); setTotalValue(res.totalValue) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  const openForm = async () => {
    const [pRes, vRes] = await Promise.all([
      apiFetch('/api/projects?page=1&limit=50'),
      apiFetch('/api/vendors'),
    ])
    if (pRes.ok) setProjectList(pRes.projects || [])
    if (vRes.ok) setVendorList(vRes.vendors || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/subcontracts', {
      method: 'POST',
      body: JSON.stringify({
        projectId: fd.get('projectId'), contractCode: fd.get('contractCode'), vendorId: fd.get('vendorId'),
        description: fd.get('description'), contractValue: Number(fd.get('contractValue')),
        startDate: fd.get('startDate') || null, endDate: fd.get('endDate') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const fmt = (v: number | string) => Number(v).toLocaleString('vi-VN')

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📋 Hợp đồng thầu phụ</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{contracts.length} hợp đồng • Tổng giá trị: {fmt(totalValue)} VNĐ</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm HĐ thầu phụ</button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tạo hợp đồng thầu phụ</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input name="contractCode" required placeholder="Mã HĐ *" className="input-field text-sm" />
            <select name="projectId" required className="input-field text-sm">
              <option value="">— Dự án —</option>
              {projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
            <select name="vendorId" required className="input-field text-sm">
              <option value="">— Nhà thầu —</option>
              {vendorList.map(v => <option key={v.id} value={v.id}>{v.vendorCode} — {v.name}</option>)}
            </select>
            <input name="description" required placeholder="Mô tả công việc *" className="input-field text-sm col-span-2" />
            <input name="contractValue" type="number" required placeholder="Giá trị HĐ *" className="input-field text-sm" />
            <input name="startDate" type="date" className="input-field text-sm" />
            <input name="endDate" type="date" className="input-field text-sm" />
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
              <th>Mã HĐ</th><th>Dự án</th><th>Nhà thầu</th><th>Mô tả</th>
              <th className="text-right">Giá trị</th><th>Thời gian</th><th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có hợp đồng thầu phụ</td></tr>
            ) : contracts.map(c => (
              <tr key={c.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{c.contractCode}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.project.projectCode}</td>
                <td>
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{c.vendor.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{c.vendor.vendorCode}</div>
                </td>
                <td className="text-xs max-w-48 truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</td>
                <td className="text-right font-mono text-xs font-bold" style={{ color: '#0ea5e9' }}>{fmt(c.contractValue)}</td>
                <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {c.startDate ? new Date(c.startDate).toLocaleDateString('vi-VN') : '—'} →
                  {c.endDate ? new Date(c.endDate).toLocaleDateString('vi-VN') : '—'}
                </td>
                <td>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: `${statusColor[c.status]}20`, color: statusColor[c.status] }}>
                    {statusLabel[c.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
