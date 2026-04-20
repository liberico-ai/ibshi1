'use client'

import { useEffect, useState, useMemo } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'

interface TrackingGroup {
  taskId: string
  projectId: string
  projectName: string
  projectCode: string
  groupId: string
  groupName: string
  prCode: string
  supplier: string | null
  totalValue?: number
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

const PAYMENT_STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  PENDING: { label: 'Pending', bg: '#f1f5f9', color: '#64748b' },
  PAYMENT_REQUESTED: { label: 'Đã yêu cầu', bg: '#fef9c3', color: '#ca8a04' },
  PAID: { label: 'Đã thanh toán', bg: '#dcfce7', color: '#16a34a' },
}

export default function ProcurementPage() {
  const [tab, setTab] = useState<'pr' | 'po'>('pr')
  const [groups, setGroups] = useState<TrackingGroup[]>([])
  const [loading, setLoading] = useState(true)
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/procurement-tracking?t=${Date.now()}`)
      if (res.success || res.ok) {
        setGroups(res.trackingList || [])
      }
    } catch (e: any) {
      console.error(e)
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

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Đề nghị mua hàng (PR)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Quản lý Đề nghị mua hàng đã được BGĐ phê duyệt & Theo dõi thanh toán</p>
        </div>
      </div>

      <div className="space-y-6">
        {groupedByProject.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có Đề nghị mua hàng nào được duyệt</p>
          </div>
        )}

        {groupedByProject.map(([projectId, projectGrp]) => (
          <div key={projectId} className="card overflow-hidden" style={{ borderRadius: 12 }}>
            <div className="px-4 py-3" style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--accent)' }}>
              <h3 className="font-bold text-[1rem]" style={{ color: 'var(--accent)' }}>Dự án: {projectGrp.projectName}</h3>
            </div>
            
            <div className="p-0">
              <table className="w-full text-sm text-left">
                <thead style={{ background: 'var(--bg-tertiary, #f8fafc)' }}>
                  <tr>
                    <th className="px-4 py-3 font-semibold text-xs tracking-wider" style={{ color: 'var(--text-secondary)' }}>Mã PR</th>
                    <th className="px-4 py-3 font-semibold text-xs tracking-wider" style={{ color: 'var(--text-secondary)' }}>Tên Nhóm</th>
                    <th className="px-4 py-3 font-semibold text-xs tracking-wider" style={{ color: 'var(--text-secondary)' }}>Trạng thái</th>
                    <th className="px-4 py-3 font-semibold text-xs tracking-wider" style={{ color: 'var(--text-secondary)' }}>Giá trị</th>
                    <th className="px-4 py-3 font-semibold text-xs tracking-wider" style={{ color: 'var(--text-secondary)' }}>Ngày thanh toán</th>
                    <th className="px-4 py-3 font-semibold text-xs tracking-wider text-right" style={{ color: 'var(--text-secondary)' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {projectGrp.items.map(g => (
                    <ExpandableRow key={g.groupId} group={g} onReload={loadData} userRole={user?.roleCode} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExpandableRow({ group, onReload, userRole }: { group: TrackingGroup, onReload: () => void, userRole?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(group.deliveryDate ? group.deliveryDate.split('T')[0] : '')
  const [saving, setSaving] = useState(false)
  const [localStatus, setLocalStatus] = useState(group.paymentStatus || 'PENDING')
  
  useEffect(() => {
    setLocalStatus(group.paymentStatus || 'PENDING')
  }, [group.paymentStatus])

  const statusMenu = PAYMENT_STATUS_MAP[localStatus] || PAYMENT_STATUS_MAP['PENDING']

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
      body: JSON.stringify({ taskId: group.taskId, groupId: group.groupId, action: 'request_payment', deliveryDate })
    })
    setSaving(false)
    if (res.success || res.ok) {
      alert('Đã gửi Yêu cầu thanh toán thành công!')
      setLocalStatus('PAYMENT_REQUESTED')
    } else {
      alert('Lỗi: ' + res.error)
    }
  }

  const totalVal = group.totalValue || 0

  return (
    <>
      {/* Main Row */}
      <tr 
        className="hover:bg-slate-50 cursor-pointer transition-colors" 
        style={{ borderBottom: '1px solid var(--border-light)' }}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 font-mono font-bold" style={{ color: 'var(--accent)' }}>
          {expanded ? '▼' : '▶'} {group.prCode}
        </td>
        <td className="px-4 py-3 font-medium flex items-center gap-2">
          {group.groupName}
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold border border-slate-200">
            {group.supplier || 'Chưa chốt NCC'}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="px-2 py-1 rounded-md text-[11px] font-bold shadow-sm" style={{ background: statusMenu.bg, color: statusMenu.color }}>
            {statusMenu.label}
          </span>
        </td>
        <td className="px-4 py-3 font-bold" style={{ color: 'var(--text-primary)' }}>
          {totalVal > 0 ? formatCurrency(totalVal) : '—'}
        </td>
        <td className="px-4 py-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {group.paymentDate ? new Date(group.paymentDate).toLocaleDateString('vi-VN') : 'N/A'}
        </td>
        <td className="px-4 py-3 text-right">
          <button 
            disabled={localStatus !== 'PENDING' || saving}
            onClick={(e) => { e.stopPropagation(); handleRequestPayment(); }}
            className="px-3 py-1.5 rounded-md text-[11px] font-bold text-white transition-opacity disabled:opacity-50 shadow-sm"
            style={{ background: localStatus === 'PENDING' ? '#0ea5e9' : '#94a3b8' }}
          >
            {localStatus === 'PENDING' ? 'YÊU CẦU THANH TOÁN' : (localStatus === 'PAID' ? 'ĐÃ HOÀN TẤT' : 'ĐANG CHỜ KT')}
          </button>
        </td>
      </tr>

      {/* Expanded Details Form */}
      {expanded && (
        <tr style={{ background: 'var(--bg-tertiary, #f8fafc)', borderBottom: '2px solid var(--border)' }}>
          <td colSpan={6} className="p-4 px-6 relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-sky-400"></div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
              <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-sm col-span-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 pb-2 border-b border-slate-100">
                  <span className="mr-2">📦</span> Chi tiết Vật Tư Nhập
                </h4>
                <table className="w-full text-[12px]">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left font-semibold pb-2">Vật tư</th>
                      <th className="text-right font-semibold pb-2">Số lượng</th>
                      {group.supplier && group.supplier !== 'Chưa chốt NCC' && <th className="text-right font-semibold pb-2">Đơn giá NCC</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, i) => (
                      <tr key={i} className="border-t border-slate-50">
                        <td className="py-1.5 text-slate-700">
                          <strong className="text-sky-600 font-mono mr-2">{item.materialCode}</strong> 
                          {item.name}
                        </td>
                        <td className="text-right py-1.5 font-medium">{item.quantity} {item.unit}</td>
                        {group.supplier && group.supplier !== 'Chưa chốt NCC' && (
                          <td className="text-right py-1.5 text-slate-500">
                            <span className="text-slate-500 italic font-semibold">
                              {(item as any).quotes?.[(item as any).selectedQuoteIndex || 0]?.price ? formatCurrency((item as any).quotes[(item as any).selectedQuoteIndex || 0].price) : 'Theo báo giá'}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-sm flex flex-col justify-center">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 pb-2 border-b border-slate-100">
                  <span className="mr-2">🚚</span> Thông tin Giao Hàng
                </h4>
                
                <div className="mt-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Dự kiến ngày hàng về <span className="text-red-500">*</span></label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="date" 
                      value={deliveryDate}
                      onChange={e => setDeliveryDate(e.target.value)}
                      disabled={localStatus !== 'PENDING'}
                      className="border border-slate-300 rounded px-3 py-1.5 text-sm flex-1 focus:outline-sky-500 focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-600"
                    />
                    {localStatus === 'PENDING' && (
                      <button 
                        onClick={handleUpdateDelivery}
                        disabled={saving || deliveryDate === (group.deliveryDate ? group.deliveryDate.split('T')[0] : '')}
                        className="px-3 py-1.5 bg-slate-800 text-white font-semibold text-[11px] rounded transition-opacity disabled:opacity-40"
                      >
                        Lưu
                      </button>
                    )}
                  </div>
                  {localStatus === 'PENDING' && (
                    <p className="text-[10px] text-slate-400 mt-2 italic">
                      Vui lòng chốt Ngày hàng về trước khi tạo Yêu cầu thanh toán.
                    </p>
                  )}
                </div>
              </div>
            </div>
            
          </td>
        </tr>
      )}
    </>
  )
}
