'use client'

import { useEffect, useState, useMemo } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PageHeader, StatusBadge, Button, FilterBar, KPICard, EmptyState, InputField } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface TrackingGroup {
  taskId: string
  projectId: string
  projectName: string
  projectCode: string
  groupId: string
  groupName: string
  prCode: string
  supplier: { id: string; name: string; total: string; reason?: string } | null
  items: Array<{
    materialId: string
    materialCode: string
    name: string
    unit: string
    quantity: number
    unitPrice?: number
    totalPrice?: number
  }>
  paymentStatus: string
  deliveryDate: string | null
  paymentDate: string | null
}

export default function ProcurementPage() {
  const [tab, setTab] = useState<'pr' | 'po'>('pr')
  const [groups, setGroups] = useState<TrackingGroup[]>([])
  const [loading, setLoading] = useState(true)
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const res = await apiFetch('/api/procurement-tracking')
    if (res.ok) {
      setGroups(res.trackingList || [])
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  // Group the data by Project
  const groupedByProject = useMemo(() => {
    const map = new Map<string, { projectName: string, items: TrackingGroup[] }>()
    for (const g of groups) {
      const key = g.projectId
      if (!map.has(key)) map.set(key, { projectName: g.projectName, items: [] })
      map.get(key)!.items.push(g)
    }
    return Array.from(map.entries())
  }, [groups])

  // KPI calculations
  const kpis = useMemo(() => {
    const totalValue = groups.reduce((sum, g) => {
      const val = Number(g.supplier?.total?.toString().replace(/,/g, '') || 0)
      return sum + val
    }, 0)
    const pending = groups.filter(g => g.paymentStatus === 'PENDING').length
    const requested = groups.filter(g => g.paymentStatus === 'PAYMENT_REQUESTED').length
    const paid = groups.filter(g => g.paymentStatus === 'PAID').length
    return { totalValue, pending, requested, paid }
  }, [groups])

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Mua hàng"
        subtitle="Quản lý Đề nghị mua hàng (PR) & Thanh toán"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Tổng giá trị"
          value={formatCurrency(kpis.totalValue)}
          accentColor={SEMANTIC_COLORS.info.solid}
        />
        <KPICard
          label="Chờ xử lý"
          value={kpis.pending}
          accentColor={SEMANTIC_COLORS.neutral.solid}
        />
        <KPICard
          label="Đã yêu cầu TT"
          value={kpis.requested}
          accentColor={SEMANTIC_COLORS.warning.solid}
        />
        <KPICard
          label="Đã thanh toán"
          value={kpis.paid}
          accentColor={SEMANTIC_COLORS.success.solid}
        />
      </div>

      {/* Tabs */}
      <FilterBar
        filters={[
          { value: 'pr', label: 'Đề nghị mua hàng', count: groups.length },
          { value: 'po', label: 'Đơn đặt hàng', count: 0 },
        ]}
        value={tab}
        onChange={(v) => setTab(v as 'pr' | 'po')}
      />

      {tab === 'pr' && (
        <div className="space-y-6">
          {groupedByProject.length === 0 && (
            <EmptyState
              icon="📋"
              title="Chưa có Đề nghị mua hàng nào được duyệt"
            />
          )}

          {groupedByProject.map(([projectId, projectGrp]) => (
            <div key={projectId} className="dt-wrapper" style={{ overflow: 'visible' }}>
              <div style={{
                padding: '0.75rem 1rem',
                background: 'var(--bg-section-alt)',
                borderBottom: '2px solid var(--accent)',
              }}>
                <h3 className="font-heading" style={{
                  fontSize: 'var(--text-base)',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  margin: 0,
                }}>
                  Dự án: {projectGrp.projectName}
                </h3>
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã PR</th>
                    <th>Tên Nhóm</th>
                    <th>Trạng thái</th>
                    <th>Giá trị</th>
                    <th>Ngày thanh toán</th>
                    <th className="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {projectGrp.items.map(g => (
                    <ExpandableRow key={g.groupId} group={g} onReload={loadData} userRole={user?.roleCode} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExpandableRow({ group, onReload, userRole }: { group: TrackingGroup, onReload: () => void, userRole?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(group.deliveryDate ? group.deliveryDate.split('T')[0] : '')
  const [saving, setSaving] = useState(false)

  const handleUpdateDelivery = async () => {
    setSaving(true)
    await apiFetch('/api/procurement-tracking', {
      method: 'PUT',
      body: JSON.stringify({ taskId: group.taskId, groupId: group.groupId, action: 'update_delivery', deliveryDate })
    })
    setSaving(false)
    onReload()
  }

  const handleRequestPayment = async () => {
    if (!deliveryDate) {
      alert('Vui lòng cập nhật Ngày hàng về trước khi Yêu cầu thanh toán!')
      setExpanded(true)
      return
    }

    if (!confirm('Bạn có chắc muốn Yêu cầu thanh toán cho Nhóm báo giá này không? Kế toán sẽ nhận được Task thanh toán.')) return

    setSaving(true)
    const res = await apiFetch('/api/procurement-tracking', {
      method: 'PUT',
      body: JSON.stringify({ taskId: group.taskId, groupId: group.groupId, action: 'request_payment' })
    })
    setSaving(false)
    if (res.ok) {
      alert('Đã gửi Yêu cầu thanh toán thành công!')
      onReload()
    } else {
      alert('Lỗi: ' + res.error)
    }
  }

  const totalVal = Number(group.supplier?.total?.toString().replace(/,/g, '') || 0)

  const paymentButtonLabel = group.paymentStatus === 'PENDING'
    ? 'YÊU CẦU THANH TOÁN'
    : group.paymentStatus === 'PAID'
      ? 'ĐÃ HOÀN TẤT'
      : 'ĐANG CHỜ KT'

  const paymentButtonVariant = group.paymentStatus === 'PENDING' ? 'accent' as const : 'outline' as const

  return (
    <>
      {/* Main Row */}
      <tr
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td>
          <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>
            {expanded ? '▼' : '▶'} {group.prCode}
          </span>
        </td>
        <td>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {group.groupName}
          </span>
          <span className="badge badge-default" style={{ marginLeft: 8, fontSize: 'var(--text-2xs)' }}>
            {group.supplier?.name || 'Chưa chốt NCC'}
          </span>
        </td>
        <td>
          <StatusBadge category="payment" status={group.paymentStatus || 'PENDING'} />
        </td>
        <td>
          <span className="font-mono" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {totalVal > 0 ? formatCurrency(totalVal) : '—'}
          </span>
        </td>
        <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
          {group.paymentDate ? formatDate(group.paymentDate) : 'N/A'}
        </td>
        <td className="text-right">
          <Button
            variant={paymentButtonVariant}
            size="sm"
            disabled={group.paymentStatus !== 'PENDING' || saving}
            loading={saving}
            onClick={(e) => { e.stopPropagation(); handleRequestPayment(); }}
          >
            {paymentButtonLabel}
          </Button>
        </td>
      </tr>

      {/* Expanded Details */}
      {expanded && (
        <tr style={{ background: 'var(--bg-section-alt)' }}>
          <td colSpan={6} style={{ padding: '1rem 1.5rem', position: 'relative' }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: 'var(--accent)',
              borderRadius: '0 2px 2px 0',
            }} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Material detail sub-table */}
              <div className="col-span-2" style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '0.75rem 1rem',
              }}>
                <h4 className="font-heading" style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.75rem',
                  paddingBottom: '0.5rem',
                  borderBottom: '1px solid var(--border)',
                }}>
                  Chi tiết Vật Tư Nhập
                </h4>
                <table style={{ width: '100%', fontSize: 'var(--text-xs)' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'left', fontWeight: 600, paddingBottom: '0.5rem' }}>Vật tư</th>
                      <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: '0.5rem' }}>Số lượng</th>
                      {group.supplier && <th style={{ textAlign: 'right', fontWeight: 600, paddingBottom: '0.5rem' }}>Đơn giá NCC</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.375rem 0', color: 'var(--text-primary)' }}>
                          <span className="font-mono" style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}>{item.materialCode}</span>
                          {item.name}
                        </td>
                        <td style={{ textAlign: 'right', padding: '0.375rem 0', fontWeight: 500 }}>
                          <span className="font-mono">{item.quantity}</span> {item.unit}
                        </td>
                        {group.supplier && (
                          <td style={{ textAlign: 'right', padding: '0.375rem 0', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Theo báo giá
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Delivery info */}
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '0.75rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}>
                <h4 className="font-heading" style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.75rem',
                  paddingBottom: '0.5rem',
                  borderBottom: '1px solid var(--border)',
                }}>
                  Thông tin Giao Hàng
                </h4>

                <div style={{ marginTop: '0.5rem' }}>
                  <InputField
                    label="Dự kiến ngày hàng về"
                    type="date"
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                  />
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleUpdateDelivery}
                      disabled={saving || deliveryDate === (group.deliveryDate ? group.deliveryDate.split('T')[0] : '')}
                      loading={saving}
                    >
                      Lưu
                    </Button>
                  </div>
                  <p style={{
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--text-muted)',
                    marginTop: '0.5rem',
                    fontStyle: 'italic',
                  }}>
                    Vui lòng chốt Ngày hàng về trước khi tạo Yêu cầu thanh toán.
                  </p>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
