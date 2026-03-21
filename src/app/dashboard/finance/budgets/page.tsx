'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface BudgetCat {
  id: string; category: string; planned: string; actual: string; committed: string; forecast: string; notes: string | null
}
interface ProjectBudget {
  projectId: string; projectCode: string; projectName: string; contractValue: number;
  categories: BudgetCat[]; totalPlanned: number; totalActual: number; totalCommitted: number;
  variance: number; variancePct: number;
}

const CATEGORIES = ['MATERIAL', 'LABOR', 'EQUIPMENT', 'SUBCONTRACT', 'OVERHEAD']
const catLabel: Record<string, string> = {
  MATERIAL: 'Vật tư', LABOR: 'Nhân công', EQUIPMENT: 'Thiết bị', SUBCONTRACT: 'Thầu phụ', OVERHEAD: 'Quản lý chung',
}

export default function BudgetsPage() {
  const [projects, setProjects] = useState<ProjectBudget[]>([])
  const [totals, setTotals] = useState({ planned: 0, actual: 0, committed: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])

  const load = () => {
    apiFetch('/api/finance/budgets').then(res => {
      if (res.ok) { setProjects(res.projects); setTotals(res.totals) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  const openForm = async () => {
    const res = await apiFetch('/api/projects?page=1&limit=50')
    if (res.ok) setProjectList(res.projects || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/finance/budgets', {
      method: 'POST',
      body: JSON.stringify({
        projectId: fd.get('projectId'),
        category: fd.get('category'),
        planned: Number(fd.get('planned') || 0),
        actual: Number(fd.get('actual') || 0),
        committed: Number(fd.get('committed') || 0),
        notes: fd.get('notes') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const fmt = (v: number | string) => Number(v).toLocaleString('vi-VN')

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📊 Ngân sách dự án</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{projects.length} dự án • Dự toán: {fmt(totals.planned)} • Thực tế: {fmt(totals.actual)}</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm ngân sách</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4" style={{ borderTop: '3px solid #0ea5e9' }}>
          <p className="text-lg font-extrabold" style={{ color: '#0ea5e9' }}>{fmt(totals.planned)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Dự toán (Planned)</p>
        </div>
        <div className="card p-4" style={{ borderTop: '3px solid #f59e0b' }}>
          <p className="text-lg font-extrabold" style={{ color: '#f59e0b' }}>{fmt(totals.actual)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Thực tế (Actual)</p>
        </div>
        <div className="card p-4" style={{ borderTop: `3px solid ${totals.planned - totals.actual >= 0 ? '#16a34a' : '#dc2626'}` }}>
          <p className="text-lg font-extrabold" style={{ color: totals.planned - totals.actual >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(totals.planned - totals.actual)}</p>
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Chênh lệch (Variance)</p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm/Cập nhật ngân sách</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <select name="projectId" required className="input-field text-sm">
              <option value="">— Chọn dự án —</option>
              {projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
            <select name="category" required className="input-field text-sm">
              <option value="">— Danh mục —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{catLabel[c]}</option>)}
            </select>
            <input name="planned" type="number" placeholder="Dự toán" className="input-field text-sm" />
            <input name="actual" type="number" placeholder="Thực tế" className="input-field text-sm" />
            <input name="committed" type="number" placeholder="Cam kết (PO)" className="input-field text-sm" />
            <input name="notes" placeholder="Ghi chú" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Budget per project */}
      {projects.length === 0 ? (
        <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có ngân sách. Nhấn "+ Thêm ngân sách" để bắt đầu.</div>
      ) : projects.map(proj => (
        <div key={proj.projectId} className="card overflow-hidden">
          <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div>
              <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{proj.projectCode}</span>
              <span className="ml-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{proj.projectName}</span>
            </div>
            <div className="flex gap-3 text-xs">
              <span style={{ color: 'var(--text-muted)' }}>HĐ: {fmt(proj.contractValue)}</span>
              <span className="font-bold" style={{ color: proj.variancePct >= 0 ? '#16a34a' : '#dc2626' }}>
                Chênh lệch: {proj.variancePct}%
              </span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Danh mục</th><th className="text-right">Dự toán</th>
                <th className="text-right">Thực tế</th><th className="text-right">Cam kết</th>
                <th className="text-right">Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {proj.categories.map(c => {
                const v = Number(c.planned) - Number(c.actual)
                return (
                  <tr key={c.id}>
                    <td><span className="badge">{catLabel[c.category] || c.category}</span></td>
                    <td className="text-right font-mono text-xs">{fmt(c.planned)}</td>
                    <td className="text-right font-mono text-xs" style={{ color: '#f59e0b' }}>{fmt(c.actual)}</td>
                    <td className="text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(c.committed)}</td>
                    <td className="text-right font-mono text-xs font-bold" style={{ color: v >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(v)}</td>
                  </tr>
                )
              })}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-light)' }}>
                <td>TỔNG</td>
                <td className="text-right font-mono text-xs">{fmt(proj.totalPlanned)}</td>
                <td className="text-right font-mono text-xs" style={{ color: '#f59e0b' }}>{fmt(proj.totalActual)}</td>
                <td className="text-right font-mono text-xs">{fmt(proj.totalCommitted)}</td>
                <td className="text-right font-mono text-xs" style={{ color: proj.variance >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(proj.variance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
