'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'

interface Material {
  id: string; materialCode: string; name: string; unit: string;
  category: string; minStock: number; currentStock: number;
  unitPrice: number | null; currency: string;
  stockMovements: Movement[];
}

interface Movement {
  id: string; type: string; quantity: number; reason: string;
  referenceNo: string | null; performedBy: string; notes: string | null; createdAt: string;
}

const CATEGORIES: Record<string, string> = {
  steel: 'Thép', pipe: 'Ống', valve: 'Van', bolt: 'Bu-lông', paint: 'Sơn', welding: 'Que hàn',
}

export default function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [material, setMaterial] = useState<Material | null>(null)
  const [loading, setLoading] = useState(true)
  const [movementForm, setMovementForm] = useState({ type: 'IN' as 'IN' | 'OUT', quantity: '', reason: 'po_receipt', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadMaterial() }, [id])

  async function loadMaterial() {
    const res = await apiFetch(`/api/warehouse/${id}`)
    if (res.ok) setMaterial(res.material)
    setLoading(false)
  }

  async function handleMovement(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch(`/api/warehouse/${id}`, {
      method: 'POST',
      body: JSON.stringify(movementForm),
    })
    setSubmitting(false)
    if (res.ok) { setMovementForm({ ...movementForm, quantity: '', notes: '' }); loadMaterial() }
    else setError(res.error)
  }

  if (loading) return <div className="animate-fade-in"><div className="h-48 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} /></div>
  if (!material) return <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Không tìm thấy vật tư</div>

  const lowStock = material.currentStock < material.minStock

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => router.push('/dashboard/warehouse')} className="text-sm flex items-center gap-1" style={{ color: 'var(--primary)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        Quay lại Kho
      </button>

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-lg font-bold" style={{ color: 'var(--primary)' }}>{material.materialCode}</span>
              <span className="badge" style={{ background: '#f0fdfa', color: '#0f766e', borderColor: '#99f6e4', borderWidth: '1px' }}>{CATEGORIES[material.category] || material.category}</span>
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{material.name}</h1>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" style={{ color: lowStock ? '#dc2626' : 'var(--text-primary)' }}>
              {material.currentStock.toLocaleString()}
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{material.unit}</div>
            {lowStock && <div className="text-xs mt-1" style={{ color: '#dc2626' }}>⚠ Dưới mức tối thiểu ({material.minStock})</div>}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đơn vị</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{material.unit}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tồn tối thiểu</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{material.minStock}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đơn giá</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{material.unitPrice ? formatCurrency(material.unitPrice, material.currency) : '—'}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tổng giao dịch</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{material.stockMovements.length}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Movement form */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Nhập / Xuất kho</h3>
          {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
          <form onSubmit={handleMovement} className="space-y-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setMovementForm({ ...movementForm, type: 'IN', reason: 'po_receipt' })} className="flex-1 py-2 text-sm rounded-lg font-medium" style={{ background: movementForm.type === 'IN' ? '#f0fdf4' : 'var(--bg-secondary)', color: movementForm.type === 'IN' ? '#16a34a' : 'var(--text-secondary)', border: `1px solid ${movementForm.type === 'IN' ? '#bbf7d0' : 'var(--border)'}` }}>Nhập</button>
              <button type="button" onClick={() => setMovementForm({ ...movementForm, type: 'OUT', reason: 'production_issue' })} className="flex-1 py-2 text-sm rounded-lg font-medium" style={{ background: movementForm.type === 'OUT' ? '#fef2f2' : 'var(--bg-secondary)', color: movementForm.type === 'OUT' ? '#dc2626' : 'var(--text-secondary)', border: `1px solid ${movementForm.type === 'OUT' ? '#fecaca' : 'var(--border)'}` }}>Xuất</button>
            </div>
            <input className="input" type="number" step="0.01" placeholder="Số lượng" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} required />
            <select className="input" value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}>
              {movementForm.type === 'IN' ? (
                <><option value="po_receipt">Nhận từ PO</option><option value="return">Trả lại</option><option value="adjustment">Điều chỉnh</option></>
              ) : (
                <><option value="production_issue">Cấp sản xuất</option><option value="adjustment">Điều chỉnh</option></>
              )}
            </select>
            <input className="input" placeholder="Ghi chú" value={movementForm.notes} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} />
            <button type="submit" disabled={submitting} className="btn-accent w-full disabled:opacity-50">{submitting ? '...' : movementForm.type === 'IN' ? 'Xác nhận nhập' : 'Xác nhận xuất'}</button>
          </form>
        </div>

        {/* Movement history */}
        <div className="col-span-2 card overflow-hidden">
          <div className="p-4 font-semibold text-sm" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>Lịch sử giao dịch</div>
          <table className="data-table">
            <thead><tr><th>Loại</th><th>Số lượng</th><th>Lý do</th><th>Ref</th><th>Ghi chú</th><th>Thời gian</th></tr></thead>
            <tbody>
              {material.stockMovements.map((mv) => (
                <tr key={mv.id}>
                  <td><span className="badge" style={{ background: mv.type === 'IN' ? '#f0fdf4' : '#fef2f2', color: mv.type === 'IN' ? '#16a34a' : '#dc2626', borderWidth: '1px', borderColor: mv.type === 'IN' ? '#bbf7d0' : '#fecaca' }}>{mv.type === 'IN' ? 'Nhập' : 'Xuất'}</span></td>
                  <td className="font-semibold" style={{ color: mv.type === 'IN' ? '#16a34a' : '#dc2626' }}>{mv.type === 'IN' ? '+' : '-'}{mv.quantity}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{mv.reason}</td>
                  <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{mv.referenceNo || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{mv.notes || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(mv.createdAt).toLocaleString('vi-VN')}</td>
                </tr>
              ))}
              {material.stockMovements.length === 0 && <tr><td colSpan={6} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>Chưa có giao dịch</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
