'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'
import { FINANCE_WRITE_ROLES } from '@/lib/constants'

interface SettlementData {
  id: string
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  revenueContract: number
  revenueInvoiced: number
  revenueCollected: number
  costMaterial: number
  costLabor: number
  costService: number
  costOther: number
  totalCost: number
  profit: number
  marginPct: number
  notes?: string | null
  submittedAt?: string | null
  approvedAt?: string | null
}

interface BudgetLine { category: string; planned: number; actual: number; committed: number }

const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  DRAFT: { label: 'Nháp (DRAFT)', bg: 'rgba(148,163,184,.15)', fg: '#64748b' },
  SUBMITTED: { label: 'Chờ duyệt (SUBMITTED)', bg: 'rgba(245,158,11,.15)', fg: '#f59e0b' },
  APPROVED: { label: 'Đã duyệt (APPROVED)', bg: 'rgba(22,163,74,.15)', fg: '#16a34a' },
  REJECTED: { label: 'Từ chối (REJECTED)', bg: 'rgba(220,38,38,.15)', fg: '#dc2626' },
}

const CATEGORY_LABELS: Record<string, string> = {
  MATERIAL: 'Vật tư', LABOR: 'Nhân công (khoán)', SERVICE: 'Dịch vụ / thuê ngoài',
  EQUIPMENT: 'Thiết bị', SUBCONTRACT: 'Thầu phụ', OVERHEAD: 'Chi phí chung',
}

export default function SettlementPage() {
  const user = useAuthStore(s => s.user)
  const canWrite = !!user && (FINANCE_WRITE_ROLES as readonly string[]).includes(user.roleCode)
  const canApprove = user?.roleCode === 'R01'

  const [projects, setProjects] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [projectId, setProjectId] = useState('')
  const [settlement, setSettlement] = useState<SettlementData | null>(null)
  const [live, setLive] = useState<SettlementData | null>(null)
  const [budgets, setBudgets] = useState<BudgetLine[]>([])
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    apiFetch('/api/projects?limit=100').then(res => {
      if (res.ok) setProjects(res.projects || [])
    })
  }, [])

  const load = useCallback(async (pid: string) => {
    if (!pid) { setSettlement(null); setLive(null); setBudgets([]); return }
    setLoading(true)
    const res = await apiFetch(`/api/finance/settlement?projectId=${pid}`)
    if (res.ok) {
      setSettlement(res.settlement)
      setLive(res.live)
      setBudgets(res.budgets || [])
    } else {
      setSettlement(null); setLive(null); setBudgets([])
      setMessage(res.error || 'Không tải được dữ liệu')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load(projectId) }, [projectId, load])

  const doAction = async (action: 'REFRESH' | 'SUBMIT' | 'APPROVE' | 'REJECT') => {
    if (!projectId || acting) return
    let reason: string | undefined
    if (action === 'REJECT') {
      reason = window.prompt('Lý do từ chối quyết toán?') || undefined
      if (reason === undefined) return
    }
    setActing(true)
    try {
      const res = await apiFetch('/api/finance/settlement', {
        method: 'POST',
        body: JSON.stringify({ projectId, action, ...(reason ? { reason } : {}) }),
      })
      setMessage(res.ok ? (res.message || 'Thành công') : (res.error || 'Có lỗi xảy ra'))
      if (res.ok) await load(projectId)
    } catch {
      setMessage('Có lỗi xảy ra khi gọi máy chủ')
    } finally {
      // Luôn nhả nút — fetch lỗi trên prod từng làm nút kẹt vĩnh viễn
      setActing(false)
    }
  }

  const badge = settlement ? STATUS_BADGE[settlement.status] : null
  const shown = settlement || live // ưu tiên số đã chốt, chưa có thì hiện live

  const revenueRows: { label: string; key: keyof SettlementData }[] = [
    { label: 'Giá trị hợp đồng', key: 'revenueContract' },
    { label: 'Đã xuất hóa đơn (AR)', key: 'revenueInvoiced' },
    { label: 'Đã thu tiền', key: 'revenueCollected' },
  ]
  const costRows: { label: string; key: keyof SettlementData }[] = [
    { label: 'Vật tư (GRN nhập kho)', key: 'costMaterial' },
    { label: 'Nhân công khoán (đã nghiệm thu)', key: 'costLabor' },
    { label: 'Dịch vụ / thuê ngoài (đã chi)', key: 'costService' },
    { label: 'Chi phí khác', key: 'costOther' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quyết toán Tài chính Dự án</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Phase 6.2 — Financial Settlement (bắt buộc APPROVED trước khi đóng dự án)</p>
      </div>

      <div className="card p-4">
        <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Chọn dự án</label>
        <select
          value={projectId} onChange={e => { setMessage(''); setProjectId(e.target.value) }}
          className="mt-1 w-full p-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          <option value="">— Chọn —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>

      {message && (
        <div className="card p-3 text-sm" style={{ color: 'var(--text-primary)' }}>{message}</div>
      )}

      {loading && <div className="h-32 skeleton rounded-xl" />}

      {!loading && projectId && shown && (
        <>
          {/* Trạng thái + hành động */}
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs px-3 py-1 rounded-full font-bold"
                style={{ background: badge?.bg || 'rgba(148,163,184,.15)', color: badge?.fg || '#64748b' }}>
                {badge?.label || 'Chưa có quyết toán'}
              </span>
              {settlement?.notes && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ghi chú: {settlement.notes}</span>
              )}
            </div>
            <div className="flex gap-2">
              {canWrite && (!settlement || settlement.status === 'DRAFT' || settlement.status === 'REJECTED') && (
                <button onClick={() => doAction('REFRESH')} disabled={acting} className="btn-primary text-xs px-3 py-2 rounded-lg">
                  Tính lại (REFRESH)
                </button>
              )}
              {canWrite && settlement?.status === 'DRAFT' && (
                <button onClick={() => doAction('SUBMIT')} disabled={acting} className="btn-primary text-xs px-3 py-2 rounded-lg">
                  Trình duyệt
                </button>
              )}
              {canApprove && settlement?.status === 'SUBMITTED' && (
                <>
                  <button onClick={() => doAction('APPROVE')} disabled={acting}
                    className="text-xs px-3 py-2 rounded-lg font-bold"
                    style={{ background: 'rgba(22,163,74,.15)', color: '#16a34a', border: '1px solid #16a34a' }}>
                    Duyệt
                  </button>
                  <button onClick={() => doAction('REJECT')} disabled={acting}
                    className="text-xs px-3 py-2 rounded-lg font-bold"
                    style={{ background: 'rgba(220,38,38,.15)', color: '#dc2626', border: '1px solid #dc2626' }}>
                    Từ chối
                  </button>
                </>
              )}
            </div>
          </div>

          {/* KPI tổng quan */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Doanh thu HĐ', value: shown.revenueContract, color: '#0ea5e9' },
              { label: 'Tổng chi phí', value: shown.totalCost, color: '#f59e0b' },
              { label: 'Lợi nhuận', value: shown.profit, color: shown.profit >= 0 ? '#16a34a' : '#dc2626' },
              { label: 'Margin', value: null, color: shown.marginPct >= 0 ? '#16a34a' : '#dc2626', text: `${shown.marginPct}%` },
            ].map((c, i) => (
              <div key={i} className="card p-4 text-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                <p className="text-xl font-bold" style={{ color: c.color }}>
                  {c.text ?? formatCurrency(c.value || 0)}
                </p>
              </div>
            ))}
          </div>

          {/* Bảng quyết toán: số đã chốt vs live */}
          <div className="card overflow-hidden">
            <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bảng quyết toán</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Chỉ tiêu</th>
                  <th className="text-right">Số đã chốt{settlement ? '' : ' (chưa có)'}</th>
                  <th className="text-right">Số liệu live</th>
                </tr>
              </thead>
              <tbody>
                <tr><td colSpan={3} className="text-xs font-bold" style={{ color: 'var(--primary)' }}>DOANH THU</td></tr>
                {revenueRows.map(r => (
                  <tr key={r.key}>
                    <td className="text-xs">{r.label}</td>
                    <td className="text-right text-xs font-bold" style={{ color: '#0ea5e9' }}>{settlement ? formatCurrency(Number(settlement[r.key] || 0)) : '—'}</td>
                    <td className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{live ? formatCurrency(Number(live[r.key] || 0)) : '—'}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="text-xs font-bold" style={{ color: 'var(--primary)' }}>CHI PHÍ</td></tr>
                {costRows.map(r => (
                  <tr key={r.key}>
                    <td className="text-xs">{r.label}</td>
                    <td className="text-right text-xs font-bold" style={{ color: '#f59e0b' }}>{settlement ? formatCurrency(Number(settlement[r.key] || 0)) : '—'}</td>
                    <td className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{live ? formatCurrency(Number(live[r.key] || 0)) : '—'}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="text-xs font-bold">Tổng chi phí</td>
                  <td className="text-right text-xs font-bold" style={{ color: '#f59e0b' }}>{settlement ? formatCurrency(settlement.totalCost) : '—'}</td>
                  <td className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{live ? formatCurrency(live.totalCost) : '—'}</td>
                </tr>
                <tr>
                  <td className="text-xs font-bold">Lợi nhuận</td>
                  <td className="text-right text-xs font-bold" style={{ color: (settlement?.profit ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>{settlement ? formatCurrency(settlement.profit) : '—'}</td>
                  <td className="text-right text-xs" style={{ color: (live?.profit ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>{live ? formatCurrency(live.profit) : '—'}</td>
                </tr>
                <tr>
                  <td className="text-xs font-bold">Margin (%)</td>
                  <td className="text-right text-xs font-bold" style={{ color: (settlement?.marginPct ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>{settlement ? `${settlement.marginPct}%` : '—'}</td>
                  <td className="text-right text-xs" style={{ color: (live?.marginPct ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>{live ? `${live.marginPct}%` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Đối chiếu dự toán vs thực tế theo category (ProjectBudget) */}
          {budgets.length > 0 && (
            <div className="card overflow-hidden">
              <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Đối chiếu dự toán (planned) vs thực tế (actual)</h3>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Hạng mục</th><th className="text-right">Dự toán</th><th className="text-right">Thực tế</th><th className="text-right">Chênh lệch</th></tr>
                </thead>
                <tbody>
                  {budgets.map((b, i) => {
                    const variance = b.planned - b.actual
                    return (
                      <tr key={i}>
                        <td className="text-xs font-bold" style={{ color: 'var(--primary)' }}>{CATEGORY_LABELS[b.category] || b.category}</td>
                        <td className="text-right text-xs font-bold" style={{ color: '#16a34a' }}>{formatCurrency(b.planned)}</td>
                        <td className="text-right text-xs font-bold" style={{ color: '#f59e0b' }}>{formatCurrency(b.actual)}</td>
                        <td className="text-right text-xs font-bold" style={{ color: variance >= 0 ? '#16a34a' : '#dc2626' }}>{formatCurrency(variance)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && projectId && !shown && (
        <div className="card p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Không có dữ liệu.</div>
      )}
    </div>
  )
}
