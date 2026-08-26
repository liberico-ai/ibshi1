'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'
import { formatCurrency } from '@/lib/utils'

interface Stats {
  pr: { pending: number; approved: number; draft: number }
  rfq: { open: number; contracted: number }
  po: { pending: number; approved: number; totalValue: number }
  contract: { draft: number; active: number; mtcPending: number }
  payment: { pending: number; approved: number }
  vendor: { aslApproved: number; openViolations: number }
}

export default function DashboardMuaSamPage() {
  const [s, setS] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; projectCode: string }>>([])

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch(`/api/procurement/dashboard-stats${projectId ? `?projectId=${projectId}` : ''}`)
    setLoading(false)
    if (r.ok) setS(r as never); else notify(r.error || 'Lỗi tải', 'error')
  }, [projectId])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const Card = ({ title, href, items, accent }: { title: string; href: string; items: Array<[string, number, string?]>; accent: string }) => (
    <Link href={href} className="card p-4 block" style={{ borderTop: `3px solid ${accent}`, textDecoration: 'none' }}>
      <div className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{title} →</div>
      <div className="flex gap-4 flex-wrap">
        {items.map(([l, v, c]) => <div key={l}><div className="text-xl font-bold" style={{ color: c || 'var(--text-primary)' }}>{v}</div><div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l}</div></div>)}
      </div>
    </Link>
  )

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Bảng điều khiển mua sắm" subtitle="Tổng quan quy trình — PR · Báo giá · PO · Hợp đồng · Thanh toán · NCC" />
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 240 }}>
          <option value="">— Tất cả dự án —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
        </select>
      </div>
      {loading || !s ? <div className="text-center py-16 text-slate-400 text-sm">Đang tải…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Card title="Yêu cầu mua (PR)" href="/dashboard/warehouse/purchase-requests" accent="#0f9089"
            items={[['Chờ duyệt', s.pr.pending, '#b45309'], ['Đã duyệt', s.pr.approved, '#166534'], ['Nháp', s.pr.draft]]} />
          <Card title="Báo giá (RFQ)" href="/dashboard/warehouse/bidding" accent="#4f46e5"
            items={[['Đang mở', s.rfq.open, '#4338ca'], ['Đã ký HĐ', s.rfq.contracted, '#166534']]} />
          <Card title="Đơn hàng (PO)" href="/dashboard/warehouse/purchase-orders" accent="#2563eb"
            items={[['Chờ duyệt', s.po.pending, '#b45309'], ['Đã duyệt', s.po.approved, '#166534']]} />
          <Card title="Hợp đồng" href="/dashboard/warehouse/hop-dong" accent="#c2740c"
            items={[['Nháp', s.contract.draft], ['Hiệu lực', s.contract.active, '#166534'], ['MTC chờ', s.contract.mtcPending, '#b45309']]} />
          <Card title="Đề nghị thanh toán" href="/dashboard/warehouse/de-nghi-thanh-toan" accent="#c62a58"
            items={[['Chờ duyệt', s.payment.pending, '#b45309'], ['Đã duyệt', s.payment.approved, '#166534']]} />
          <Card title="Nhà cung cấp (ASL)" href="/dashboard/warehouse/danh-gia-ncc" accent="#7e22ce"
            items={[['Trong ASL', s.vendor.aslApproved, '#166534'], ['Vi phạm mở', s.vendor.openViolations, '#dc2626']]} />
          <div className="card p-4" style={{ borderTop: '3px solid #166534' }}>
            <div className="text-sm font-bold mb-2">Tổng giá trị PO (chưa hủy)</div>
            <div className="text-2xl font-bold" style={{ color: '#166534' }}>{formatCurrency(s.po.totalValue)}</div>
          </div>
        </div>
      )}
    </div>
  )
}
