'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface CashflowEntry {
  id: string; entryCode: string; type: string; category: string; amount: string;
  description: string | null; entryDate: string; reference: string | null; status: string;
  project: { projectCode: string; projectName: string } | null
}

const catLabel: Record<string, string> = {
  REVENUE: 'Doanh thu', MATERIAL_COST: 'Vật tư', LABOR: 'Nhân công',
  EQUIPMENT: 'Thiết bị', OVERHEAD: 'Chi phí chung', TAX: 'Thuế', OTHER: 'Khác',
}

export default function CashflowEntriesPage() {
  const [entries, setEntries] = useState<CashflowEntry[]>([])
  const [summary, setSummary] = useState({ inflow: 0, outflow: 0, net: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'INFLOW' | 'OUTFLOW'>('all')
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])

  const load = () => {
    const url = filter !== 'all' ? `/api/finance/cashflow-entries?type=${filter}` : '/api/finance/cashflow-entries'
    apiFetch(url).then(res => {
      if (res.ok) { setEntries(res.entries); setSummary(res.summary) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [filter])

  const openForm = async () => {
    const res = await apiFetch('/api/projects?page=1&limit=50')
    if (res.ok) setProjectList(res.projects || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/finance/cashflow-entries', {
      method: 'POST',
      body: JSON.stringify({
        entryCode: fd.get('entryCode'), type: fd.get('type'), category: fd.get('category'),
        amount: Number(fd.get('amount')), entryDate: fd.get('entryDate'),
        description: fd.get('description') || null, reference: fd.get('reference') || null,
        projectId: fd.get('projectId') || null,
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
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>💰 Dòng tiền chi tiết</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{entries.length} bút toán</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Ghi nhận</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Thu vào</p><p className="text-lg font-bold" style={{ color: '#16a34a' }}>{fmt(summary.inflow)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Chi ra</p><p className="text-lg font-bold" style={{ color: '#dc2626' }}>{fmt(summary.outflow)} ₫</p></div>
        <div className="card p-4"><p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Ròng</p><p className="text-lg font-bold" style={{ color: summary.net >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(summary.net)} ₫</p></div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'INFLOW', 'OUTFLOW'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === f ? (f === 'INFLOW' ? '#16a34a' : f === 'OUTFLOW' ? '#dc2626' : 'var(--accent)') : 'var(--surface-hover)', color: filter === f ? '#fff' : 'var(--text-muted)' }}>
            {f === 'all' ? 'Tất cả' : f === 'INFLOW' ? '↑ Thu' : '↓ Chi'}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ghi nhận dòng tiền</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="entryCode" required placeholder="Mã bút toán *" className="input-field text-sm" />
            <select name="type" required className="input-field text-sm">
              <option value="INFLOW">Thu vào</option><option value="OUTFLOW">Chi ra</option>
            </select>
            <select name="category" required className="input-field text-sm">
              {Object.entries(catLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input name="amount" type="number" required placeholder="Số tiền *" className="input-field text-sm" />
            <input name="entryDate" type="date" required className="input-field text-sm" />
            <select name="projectId" className="input-field text-sm">
              <option value="">— Dự án (tùy chọn) —</option>
              {projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
            </select>
            <input name="reference" placeholder="Tham chiếu" className="input-field text-sm" />
            <input name="description" placeholder="Mô tả" className="input-field text-sm" />
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
          <thead><tr><th>Mã</th><th>Loại</th><th>Danh mục</th><th>Dự án</th><th className="text-right">Số tiền</th><th>Ngày</th><th>Mô tả</th></tr></thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có bút toán</td></tr>
            ) : entries.map(e => (
              <tr key={e.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.entryCode}</span></td>
                <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: e.type === 'INFLOW' ? '#16a34a20' : '#dc262620', color: e.type === 'INFLOW' ? '#16a34a' : '#dc2626' }}>{e.type === 'INFLOW' ? '↑ Thu' : '↓ Chi'}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{catLabel[e.category] || e.category}</td>
                <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{e.project?.projectCode || '—'}</td>
                <td className="text-right font-mono text-xs font-bold" style={{ color: e.type === 'INFLOW' ? '#16a34a' : '#dc2626' }}>{e.type === 'INFLOW' ? '+' : '-'}{fmt(e.amount)}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(e.entryDate).toLocaleDateString('vi-VN')}</td>
                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{e.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
