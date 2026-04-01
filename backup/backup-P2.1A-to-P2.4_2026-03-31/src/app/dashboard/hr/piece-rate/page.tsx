'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface PieceContract {
  id: string; contractCode: string; teamCode: string; workType: string;
  unitPrice: string; unit: string; contractValue: string | null; status: string; startDate: string;
  project: { projectCode: string; projectName: string } | null
}

export default function PieceRatePage() {
  const [contracts, setContracts] = useState<PieceContract[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [projects, setProjects] = useState<{ id: string; projectCode: string }[]>([])
  const [form, setForm] = useState({ projectId: '', teamCode: '', workType: '', unitPrice: '', unit: 'kg' })

  useEffect(() => {
    Promise.all([
      apiFetch('/api/hr/piece-rate-contracts'),
      apiFetch('/api/projects?limit=100'),
    ]).then(([c, p]) => {
      if (c.ok) setContracts(c.contracts || [])
      if (p.ok) setProjects(p.projects || [])
      setLoading(false)
    })
  }, [])

  const handleCreate = async () => {
    const res = await apiFetch('/api/hr/piece-rate-contracts', {
      method: 'POST', body: JSON.stringify(form),
    })
    if (res.ok) {
      setShowForm(false)
      const updated = await apiFetch('/api/hr/piece-rate-contracts')
      if (updated.ok) setContracts(updated.contracts || [])
    } else alert(res.error)
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🔨 Hợp đồng Khoán</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{contracts.length} hợp đồng</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-accent text-sm px-4 py-2">+ Tạo HĐ khoán</button>
      </div>

      {showForm && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Dự án</label>
              <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className="input mt-1">
                <option value="">— Chọn —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Tổ SX</label>
              <input value={form.teamCode} onChange={e => setForm({ ...form, teamCode: e.target.value })} className="input mt-1" placeholder="TO-01" />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Loại công việc</label>
              <input value={form.workType} onChange={e => setForm({ ...form, workType: e.target.value })} className="input mt-1" placeholder="welding, cutting..." />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Đơn giá</label>
              <input type="number" value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} className="input mt-1" placeholder="50000" />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Đơn vị</label>
              <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="input mt-1">
                <option value="kg">kg</option><option value="m">m</option><option value="pcs">pcs</option><option value="joint">joint</option><option value="m2">m²</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded" style={{ color: 'var(--text-muted)' }}>Hủy</button>
            <button onClick={handleCreate} className="btn-accent text-xs px-3 py-1.5">Tạo HĐ</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Mã HĐ</th><th>Dự án</th><th>Tổ SX</th><th>Loại CV</th><th>Đơn giá</th><th>Đơn vị</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có HĐ khoán</td></tr>
            ) : contracts.map(c => (
              <tr key={c.id}>
                <td className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{c.contractCode}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.project?.projectCode || '—'}</td>
                <td className="text-xs font-bold" style={{ color: 'var(--primary)' }}>{c.teamCode}</td>
                <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{c.workType}</td>
                <td className="text-xs font-bold text-right" style={{ color: '#16a34a' }}>{Number(c.unitPrice).toLocaleString('vi-VN')}₫</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.unit}</td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{
                  background: c.status === 'ACTIVE' ? '#16a34a20' : '#f59e0b20',
                  color: c.status === 'ACTIVE' ? '#16a34a' : '#f59e0b',
                }}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
