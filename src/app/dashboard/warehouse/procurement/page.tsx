'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'
import { RBAC } from '@/lib/rbac-rules'

interface PR {
  id: string; prCode: string; status: string; urgency: string; notes: string | null;
  createdAt: string; approvedAt: string | null; itemCount: number;
  project: { projectCode: string; projectName: string };
  items: Array<{ id: string; quantity: number; material: { materialCode: string; name: string; unit: string } }>;
}

interface PO {
  id: string; poCode: string; status: string; totalValue: number; currency: string;
  orderDate: string | null; deliveryDate: string | null; createdAt: string; itemCount: number;
  vendor: { code: string; name: string };
  items: Array<{ id: string; quantity: number; unitPrice: number; receivedQty: number; material: { materialCode: string; name: string; unit: string } }>;
}

interface Material { id: string; materialCode: string; name: string; unit: string; currentStock: number }
interface Project { id: string; projectCode: string; projectName: string }
interface Vendor { id: string; code: string; name: string }

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT: { label: 'Nháp', bg: '#f1f5f9', color: '#64748b' },
  SUBMITTED: { label: 'Đã gửi', bg: '#dbeafe', color: '#2563eb' },
  APPROVED: { label: 'Đã duyệt', bg: '#dcfce7', color: '#16a34a' },
  REJECTED: { label: 'Từ chối', bg: '#fef2f2', color: '#dc2626' },
  CONVERTED: { label: 'Đã chuyển PO', bg: '#f0fdf4', color: '#059669' },
  SENT: { label: 'Đã gửi NCC', bg: '#dbeafe', color: '#2563eb' },
  CONFIRMED: { label: 'NCC xác nhận', bg: '#dcfce7', color: '#16a34a' },
  PARTIAL_RECEIVED: { label: 'Nhận 1 phần', bg: '#fef9c3', color: '#ca8a04' },
  RECEIVED: { label: 'Đã nhận', bg: '#dcfce7', color: '#16a34a' },
  CANCELLED: { label: 'Đã hủy', bg: '#fef2f2', color: '#dc2626' },
}

const URGENCY_MAP: Record<string, { label: string; color: string }> = {
  NORMAL: { label: 'Bình thường', color: '#64748b' },
  URGENT: { label: 'Khẩn', color: '#f59e0b' },
  CRITICAL: { label: 'Rất khẩn', color: '#dc2626' },
}

export default function ProcurementPage() {
  const [tab, setTab] = useState<'pr' | 'po'>('pr')
  const [prs, setPrs] = useState<PR[]>([])
  const [pos, setPos] = useState<PO[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [materials, setMaterials] = useState<Material[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const user = useAuthStore((s) => s.user)

  const loadData = async () => {
    setLoading(true)
    const [prRes, poRes] = await Promise.all([
      apiFetch('/api/purchase-requests'),
      apiFetch('/api/purchase-orders'),
    ])
    if (prRes.ok) setPrs(prRes.purchaseRequests || [])
    if (poRes.ok) setPos(poRes.purchaseOrders || [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const openCreateForm = async () => {
    const [matRes, projRes, vendRes] = await Promise.all([
      apiFetch('/api/warehouse?limit=100'),
      apiFetch('/api/projects'),
      apiFetch('/api/vendors'),
    ])
    if (matRes.ok) setMaterials(matRes.materials || [])
    if (projRes.ok) setProjects(projRes.projects || [])
    if (vendRes.ok) setVendors(vendRes.vendors || [])
    setShowCreate(true)
  }

  const handleAction = async (prId: string, action: string, extra?: Record<string, unknown>) => {
    const res = await apiFetch(`/api/purchase-requests/${prId}`, {
      method: 'PUT',
      body: JSON.stringify({ action, ...extra }),
    })
    if (res.ok) loadData()
    else alert(res.error || res.message || 'Lỗi thao tác')
  }

  const canApprove = RBAC.PR_APPROVAL.includes(user?.roleCode || '')
  const canCreate = ['R01', 'R02', 'R03', 'R05'].includes(user?.roleCode || '')

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Mua hàng</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Quản lý PR → PO → Nhận hàng</p>
        </div>
        {canCreate && (
          <button onClick={openCreateForm}
            className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg"
            style={{ background: 'var(--accent)' }}>
            + Tạo PR
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
        {(['pr', 'po'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: tab === t ? 'var(--bg-card)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: tab === t ? 'var(--shadow-xs)' : 'none',
            }}>
            {t === 'pr' ? `Yêu cầu mua hàng (${prs.length})` : `Đơn đặt hàng (${pos.length})`}
          </button>
        ))}
      </div>

      {/* PR Tab */}
      {tab === 'pr' && (
        <div className="space-y-3">
          {prs.length === 0 && (
            <div className="card p-12 text-center">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có yêu cầu mua hàng</p>
            </div>
          )}
          {prs.map(pr => {
            const st = STATUS_MAP[pr.status] || STATUS_MAP.DRAFT
            const ug = URGENCY_MAP[pr.urgency] || URGENCY_MAP.NORMAL
            return (
              <div key={pr.id} className="card p-5 transition-all hover:shadow-md">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{pr.prCode}</span>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: st.bg, color: st.color }}>{st.label}</span>
                      {pr.urgency !== 'NORMAL' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: '#fef2f2', color: ug.color }}>⚡ {ug.label}</span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      DA: {pr.project.projectCode} — {pr.project.projectName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{pr.itemCount}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>vật tư</p>
                  </div>
                </div>

                {/* Items preview */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {pr.items.slice(0, 4).map(item => (
                    <span key={item.id} className="text-[11px] px-2 py-1 rounded-lg"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                      {item.material.materialCode} × {Number(item.quantity)} {item.material.unit}
                    </span>
                  ))}
                  {pr.items.length > 4 && (
                    <span className="text-[11px] px-2 py-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                      +{pr.items.length - 4} khác
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(pr.createdAt).toLocaleDateString('vi-VN')}
                  </span>
                  <div className="flex-1" />
                  {pr.status === 'SUBMITTED' && canApprove && (
                    <>
                      <button onClick={() => handleAction(pr.id, 'approve')}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white"
                        style={{ background: '#16a34a' }}>✓ Duyệt</button>
                      <button onClick={() => handleAction(pr.id, 'reject', { reason: 'Từ chối bởi quản lý' })}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                        style={{ background: '#fef2f2', color: '#dc2626' }}>✗ Từ chối</button>
                    </>
                  )}
                  {pr.status === 'SUBMITTED' && !canApprove && (
                    <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded">🔒 Chỉ BGĐ/PM</span>
                  )}
                  {pr.status === 'APPROVED' && (
                    <button onClick={() => {
                      const vendorId = vendors[0]?.id
                      if (vendorId) handleAction(pr.id, 'convert', { vendorId })
                      else alert('Chưa có nhà cung cấp')
                    }}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white"
                      style={{ background: '#2563eb' }}>→ Chuyển PO</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* PO Tab */}
      {tab === 'po' && (
        <div className="space-y-3">
          {pos.length === 0 && (
            <div className="card p-12 text-center">
              <p className="text-4xl mb-3">📦</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có đơn đặt hàng</p>
            </div>
          )}
          {pos.map(po => {
            const st = STATUS_MAP[po.status] || STATUS_MAP.DRAFT
            return (
              <div key={po.id} className="card p-5 transition-all hover:shadow-md">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-bold" style={{ color: '#2563eb' }}>{po.poCode}</span>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      NCC: <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{po.vendor.name}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(po.totalValue, po.currency)}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{po.itemCount} vật tư</p>
                  </div>
                </div>

                {/* Items */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left py-1.5 font-medium">Vật tư</th>
                        <th className="text-right py-1.5 font-medium">SL</th>
                        <th className="text-right py-1.5 font-medium">Đơn giá</th>
                        <th className="text-right py-1.5 font-medium">Đã nhận</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map(item => (
                        <tr key={item.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                          <td className="py-1.5" style={{ color: 'var(--text-primary)' }}>
                            <span className="font-mono text-xs mr-1" style={{ color: 'var(--accent)' }}>{item.material.materialCode}</span>
                            {item.material.name}
                          </td>
                          <td className="text-right py-1.5">{Number(item.quantity)} {item.material.unit}</td>
                          <td className="text-right py-1.5">{formatCurrency(Number(item.unitPrice))}</td>
                          <td className="text-right py-1.5">
                            <span style={{ color: Number(item.receivedQty) >= Number(item.quantity) ? '#16a34a' : '#f59e0b' }}>
                              {Number(item.receivedQty)}/{Number(item.quantity)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {po.orderDate ? new Date(po.orderDate).toLocaleDateString('vi-VN') : '—'}
                    {po.deliveryDate && ` → ${new Date(po.deliveryDate).toLocaleDateString('vi-VN')}`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create PR Modal */}
      {showCreate && (
        <CreatePRModal
          projects={projects}
          materials={materials}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData() }}
        />
      )}
    </div>
  )
}

/* ═══ Create PR Modal ═══ */
function CreatePRModal({ projects, materials, onClose, onCreated }: {
  projects: Project[]; materials: Material[]; onClose: () => void; onCreated: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [urgency, setUrgency] = useState('NORMAL')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<Array<{ materialId: string; quantity: number }>>([{ materialId: '', quantity: 1 }])
  const [submitting, setSubmitting] = useState(false)

  const addItem = () => setItems([...items, { materialId: '', quantity: 1 }])
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))
  const updateItem = (i: number, field: string, value: string | number) => {
    const next = [...items]
    next[i] = { ...next[i], [field]: value }
    setItems(next)
  }

  const submit = async () => {
    if (!projectId) return alert('Chọn dự án')
    const validItems = items.filter(i => i.materialId && i.quantity > 0)
    if (validItems.length === 0) return alert('Thêm ít nhất 1 vật tư')

    setSubmitting(true)
    const res = await apiFetch('/api/purchase-requests', {
      method: 'POST',
      body: JSON.stringify({ projectId, urgency, notes, items: validItems }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || res.message || 'Lỗi tạo PR')
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '14px', outline: 'none',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-xl max-h-[85vh] overflow-y-auto animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Tạo Yêu cầu Mua hàng</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* Project */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Dự án *</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
            <option value="">Chọn dự án...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
          </select>
        </div>

        {/* Urgency */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Độ khẩn</label>
          <div className="flex gap-2">
            {Object.entries(URGENCY_MAP).map(([key, val]) => (
              <button key={key} onClick={() => setUrgency(key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: urgency === key ? val.color : 'var(--bg-primary)',
                  color: urgency === key ? 'white' : 'var(--text-muted)',
                }}>
                {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Items */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Vật tư *</label>
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <select value={item.materialId} onChange={e => updateItem(i, 'materialId', e.target.value)}
                style={{ ...inputStyle, flex: 2 }}>
                <option value="">Chọn vật tư...</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>{m.materialCode} — {m.name} (tồn: {m.currentStock})</option>
                ))}
              </select>
              <input type="number" min={1} value={item.quantity} onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                placeholder="SL" style={{ ...inputStyle, flex: 0.5, textAlign: 'right' as const }} />
              {items.length > 1 && (
                <button onClick={() => removeItem(i)} className="px-2 text-sm" style={{ color: '#dc2626' }}>✕</button>
              )}
            </div>
          ))}
          <button onClick={addItem} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>+ Thêm vật tư</button>
        </div>

        {/* Notes */}
        <div className="mb-5">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ghi chú</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ ...inputStyle, resize: 'none' as const }} placeholder="Lý do, yêu cầu đặc biệt..." />
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang tạo...' : 'Gửi Yêu cầu'}
          </button>
        </div>
      </div>
    </div>
  )
}
