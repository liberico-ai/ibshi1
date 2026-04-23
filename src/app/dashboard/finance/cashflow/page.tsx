'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import FinancePlanUploader from './components/FinancePlanUploader'

interface CashflowEntry {
  id: string; entryCode: string; type: string; category: string;
  amount: string; description: string | null; entryDate: string;
  reference: string | null; status: string;
  project: { projectCode: string; projectName: string } | null
}

const CATEGORY_LABELS: Record<string, string> = {
  REVENUE: 'Doanh thu', MATERIAL_COST: 'Vật tư', LABOR: 'Nhân công',
  EQUIPMENT: 'Thiết bị', OVERHEAD: 'Chi phí chung', TAX: 'Thuế', OTHER: 'Khác',
}

export default function CashflowPage() {
  const [activeTab, setActiveTab] = useState<'ENTRIES' | 'PLAN'>('ENTRIES')

  const [entries, setEntries] = useState<CashflowEntry[]>([])
  const [totals, setTotals] = useState({ inflow: 0, outflow: 0, net: 0 })
  const [byCategory, setByCategory] = useState<Record<string, { inflow: number; outflow: number }>>({})
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Plan tab specific state
  const [plans, setPlans] = useState<any[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const [planDetails, setPlanDetails] = useState<any>(null)

  useEffect(() => { 
    if (activeTab === 'ENTRIES') loadData() 
    else loadPlans()
  }, [month, year, activeTab])

  useEffect(() => {
    if (activeTab === 'PLAN' && selectedPlanId) loadPlanDetails(selectedPlanId)
  }, [selectedPlanId, activeTab])

  async function loadData() {
    setLoading(true)
    const res = await apiFetch(`/api/finance/cashflow?month=${month}&year=${year}`)
    if (res.ok) { setEntries(res.entries); setTotals(res.totals); setByCategory(res.byCategory) }
    setLoading(false)
  }

  async function loadPlans(defaultPid?: string) {
    const res = await apiFetch('/api/finance/cashflow/plan')
    if (res.ok) {
      setPlans(res.plans || [])
      if (defaultPid) {
        setSelectedPlanId(defaultPid)
      } else if (res.plans?.length > 0 && !selectedPlanId) {
        setSelectedPlanId(res.plans[0].projectId)
      }
    }
  }

  async function loadPlanDetails(projectId: string) {
    const res = await apiFetch(`/api/finance/cashflow/plan?projectId=${projectId}`)
    if (res.ok) setPlanDetails(res.plan)
  }

  const fmt = (v: number) => v.toLocaleString('vi-VN')

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Phương án & Dòng tiền dự án</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Quản lý kế hoạch tài chính và dòng tiền thực tế</p>
        </div>
      </div>

      <div className="border-b" style={{ borderColor: 'var(--border-light)' }}>
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('ENTRIES')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'ENTRIES' ? 'border-[#8b5cf6]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            style={{ color: activeTab === 'ENTRIES' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            Bút toán thực tế (Actual)
          </button>
          <button
            onClick={() => setActiveTab('PLAN')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'PLAN' ? 'border-[#8b5cf6]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            style={{ color: activeTab === 'PLAN' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            Kế hoạch Kế toán (Planned)
          </button>
        </nav>
      </div>

      {activeTab === 'ENTRIES' && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Luồng dòng tiền trong tháng</p>
            <div className="flex items-center gap-3">
              <select className="input w-24" value={month} onChange={e => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}
              </select>
              <select className="input w-28" value={year} onChange={e => setYear(Number(e.target.value))}>
                {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button onClick={() => setShowCreate(!showCreate)} className="btn-accent">+ Bút toán</button>
            </div>
          </div>

          {/* Cashflow Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 border-t-4 border-green-500">
              <p className="text-xl font-extrabold text-green-600">+{fmt(totals.inflow)}</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Thu vào (VNĐ)</p>
            </div>
            <div className="card p-4 border-t-4 border-red-500">
              <p className="text-xl font-extrabold text-red-600">-{fmt(totals.outflow)}</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Chi ra</p>
            </div>
            <div className={`card p-4 border-t-4 ${totals.net >= 0 ? 'border-green-500' : 'border-red-500'}`}>
              <p className={`text-xl font-extrabold ${totals.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{totals.net >= 0 ? '+' : ''}{fmt(totals.net)}</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Chênh lệch ròng</p>
            </div>
          </div>

          {/* Category breakdown */}
          {Object.keys(byCategory).length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>📊 Cơ cấu theo danh mục</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(byCategory).map(([cat, data]) => (
                  <div key={cat} className="p-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-light)]">
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{CATEGORY_LABELS[cat] || cat}</p>
                    <div className="flex justify-between text-xs font-mono">
                      {data.inflow > 0 && <span className="text-green-600">+{fmt(data.inflow)}</span>}
                      {data.outflow > 0 && <span className="text-red-600">-{fmt(data.outflow)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showCreate && <CreateCashflowForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}

          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th><th>Loại</th><th>Danh mục</th><th>Dự án</th>
                  <th className="text-right">Số tiền</th><th>Mô tả</th><th>Ngày</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Đang tải...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có bút toán trong tháng này</td></tr>
                ) : entries.map(e => (
                  <tr key={e.id}>
                    <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{e.entryCode}</span></td>
                    <td><span className="badge" style={{ background: e.type === 'INFLOW' ? '#f0fdf4' : '#fef2f2', color: e.type === 'INFLOW' ? '#16a34a' : '#dc2626' }}>
                      {e.type === 'INFLOW' ? '📥 Thu' : '📤 Chi'}
                    </span></td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{CATEGORY_LABELS[e.category] || e.category}</td>
                    <td className="text-xs" style={{ color: 'var(--accent)' }}>{e.project?.projectCode || '-'}</td>
                    <td className="text-right font-mono font-semibold" style={{ color: e.type === 'INFLOW' ? '#16a34a' : '#dc2626' }}>
                      {e.type === 'INFLOW' ? '+' : '-'}{fmt(Number(e.amount))}
                    </td>
                    <td className="text-xs truncate max-w-48" style={{ color: 'var(--text-muted)' }}>{e.description || '-'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(e.entryDate).toLocaleDateString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'PLAN' && (
        <div className="space-y-6 animate-fade-in">
          <FinancePlanUploader onUploaded={(pid) => { loadPlans(pid); loadPlanDetails(pid) }} />
          
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Dashboard Phương án Dự án</h2>
              {plans.length > 0 && (
                <select className="input max-w-xs" value={selectedPlanId} onChange={e => setSelectedPlanId(e.target.value)}>
                  {plans.map(p => (
                   <option key={p.project.id} value={p.projectId}>{p.project.projectCode} - {p.project.projectName}</option>
                  ))}
                </select>
              )}
            </div>

            {!planDetails ? (
              <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu kế hoạch dòng tiền. Hãy Upload file Excel để hệ thống tự động bóc tách.</p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-light)]">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Giá trị Hợp đồng</p>
                    <p className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{fmt(Number(planDetails.contractValue || 0))} ₫</p>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-light)]">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Tổng dòng tiền hoạch định (Phân bổ)</p>
                    <p className="text-xl font-bold font-mono text-blue-600">{fmt(planDetails.monthlyCashflows.reduce((sum: number, m: any) => sum + Number(m.amountVnd), 0))} ₫</p>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-light)]">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Khách hàng / Vĩ mô</p>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{planDetails.customerId || 'Chưa cập nhật'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Cấu trúc Ngân sách (Budget Lines)</h3>
                    <div className="overflow-y-auto max-h-64 rounded-lg border" style={{ borderColor: 'var(--border-light)' }}>
                      <table className="data-table text-xs">
                        <thead className="sticky top-0 bg-[var(--bg-primary)]">
                          <tr><th>Nhóm</th><th>Hạng mục</th><th className="text-right">Dự toán (VNĐ)</th></tr>
                        </thead>
                        <tbody>
                          {planDetails.budgetLines.map((b: any) => (
                            <tr key={b.id}>
                              <td><span className="badge bg-gray-100 text-gray-700">{b.sectionType}</span></td>
                              <td className="truncate max-w-xs">{b.itemName}</td>
                              <td className="text-right font-mono font-medium">{fmt(Number(b.totalBudget))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Phân bổ dòng tiền (Tháng)</h3>
                    <div className="overflow-y-auto max-h-64 rounded-lg border" style={{ borderColor: 'var(--border-light)' }}>
                      <table className="data-table text-xs">
                        <thead className="sticky top-0 bg-[var(--bg-primary)]">
                          <tr><th>Kỳ (Tháng/Năm)</th><th>Hạng mục</th><th className="text-right">Thành tiền (VNĐ)</th></tr>
                        </thead>
                        <tbody>
                          {planDetails.monthlyCashflows.map((m: any) => (
                            <tr key={m.id}>
                              <td className="font-semibold text-blue-600">Tháng {m.month}/{m.year}</td>
                              <td className="truncate max-w-[150px]">{m.category}</td>
                              <td className="text-right font-mono font-medium text-red-600">-{fmt(Number(m.amountVnd))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateCashflowForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    entryCode: `CF-${Date.now().toString(36).toUpperCase()}`,
    type: 'INFLOW', category: 'REVENUE', amount: '', description: '',
    entryDate: new Date().toISOString().split('T')[0],
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch('/api/finance/cashflow', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  return (
    <div className="card p-6 animate-fade-in">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Thêm bút toán</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Loại</label>
          <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="INFLOW">Thu vào</option><option value="OUTFLOW">Chi ra</option>
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Danh mục</label>
          <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Số tiền *</label>
          <input className="input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mô tả</label>
          <input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Ngày *</label>
          <input className="input" type="date" value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} required /></div>
        <div className="flex items-end">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Hủy</button>
            <button type="submit" disabled={submitting} className="btn-accent disabled:opacity-50">{submitting ? 'Đang tạo...' : 'Thêm'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
