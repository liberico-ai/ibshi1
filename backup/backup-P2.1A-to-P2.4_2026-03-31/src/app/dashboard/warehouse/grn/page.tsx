'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface GRN {
  id: string; type: string; reason: string; quantity: number; referenceNo: string | null;
  heatNumber: string | null; lotNumber: string | null; notes: string | null; createdAt: string;
  material: { materialCode: string; name: string; unit: string }
}

interface PO {
  id: string; poCode: string; status: string;
  vendor: { name: string } | null;
  items: Array<{ id: string; materialId: string; quantity: number; receivedQty: number; material: { materialCode: string; name: string; unit: string } }>
}

interface ReceiveItem {
  poItemId: string; receivedQty: number; heatNumber: string; lotNumber: string; notes: string;
  maxQty: number; materialName: string; unit: string;
}

export default function GRNPage() {
  const [receipts, setReceipts] = useState<GRN[]>([])
  const [loading, setLoading] = useState(true)
  const [showReceiveForm, setShowReceiveForm] = useState(false)
  const [poList, setPOList] = useState<PO[]>([])
  const [selectedPO, setSelectedPO] = useState<PO | null>(null)
  const [receiveItems, setReceiveItems] = useState<ReceiveItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  const loadReceipts = () => {
    apiFetch('/api/grn').then(res => {
      if (res.ok) setReceipts(res.receipts || [])
      setLoading(false)
    })
  }

  useEffect(() => { loadReceipts() }, [])

  const openReceiveForm = async () => {
    const res = await apiFetch('/api/purchase-orders?status=APPROVED,PARTIAL_RECEIVED,SENT')
    if (res.ok) {
      setPOList(res.purchaseOrders || res.data || [])
    }
    setShowReceiveForm(true)
    setSelectedPO(null)
    setReceiveItems([])
  }

  const selectPO = async (poId: string) => {
    const po = poList.find(p => p.id === poId)
    if (!po) return
    const detail = await apiFetch(`/api/purchase-orders/${poId}`)
    const fullPO = detail.ok ? (detail.purchaseOrder || detail.data || po) : po
    setSelectedPO(fullPO)
    setReceiveItems(
      (fullPO.items || []).map((item: PO['items'][0]) => ({
        poItemId: item.id,
        receivedQty: 0,
        heatNumber: '',
        lotNumber: '',
        notes: '',
        maxQty: Number(item.quantity) - Number(item.receivedQty),
        materialName: `${item.material.materialCode} — ${item.material.name}`,
        unit: item.material.unit,
      })).filter((i: ReceiveItem) => i.maxQty > 0)
    )
  }

  const updateItem = (idx: number, field: keyof ReceiveItem, value: string | number) => {
    setReceiveItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const submitReceive = async () => {
    if (!selectedPO) return
    const validItems = receiveItems.filter(i => i.receivedQty > 0)
    if (validItems.length === 0) return alert('Nhập số lượng nhận cho ít nhất 1 mục')

    setSubmitting(true)
    const res = await apiFetch('/api/grn', {
      method: 'POST',
      body: JSON.stringify({
        poId: selectedPO.id,
        items: validItems.map(i => ({
          poItemId: i.poItemId,
          receivedQty: i.receivedQty,
          heatNumber: i.heatNumber || undefined,
          lotNumber: i.lotNumber || undefined,
          notes: i.notes || undefined,
        })),
      }),
    })
    setSubmitting(false)

    if (res.ok) {
      alert(`✅ Đã nhận ${validItems.length} mục. PO status: ${res.poStatus}`)
      setShowReceiveForm(false)
      loadReceipts()
    } else {
      alert('❌ Lỗi: ' + (res.message || 'Không rõ'))
    }
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalQty = receipts.reduce((s, r) => s + Number(r.quantity), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📦 Nhận hàng (GRN)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{receipts.length} phiếu nhận • Tổng SL: {totalQty.toLocaleString('vi-VN')}</p>
        </div>
        <button onClick={openReceiveForm} className="btn-primary">+ Nhận hàng từ PO</button>
      </div>

      {/* ── Receive Form Modal ── */}
      {showReceiveForm && (
        <div className="card p-6 space-y-4" style={{ border: '2px solid var(--accent)', background: 'var(--ibs-red-50)' }}>
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold" style={{ color: 'var(--accent)' }}>Nhận hàng theo PO</h2>
            <button onClick={() => setShowReceiveForm(false)} className="btn-ghost text-sm">✕ Đóng</button>
          </div>

          {/* PO Selector */}
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Chọn PO</label>
            <select className="input" onChange={e => selectPO(e.target.value)} defaultValue="">
              <option value="" disabled>— Chọn PO —</option>
              {poList.map(po => (
                <option key={po.id} value={po.id}>{po.poCode} — {po.vendor?.name || 'N/A'} ({po.status})</option>
              ))}
            </select>
          </div>

          {/* Items */}
          {selectedPO && receiveItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Danh sách vật tư ({selectedPO.poCode})</h3>
              <table className="data-table">
                <thead>
                  <tr><th>Vật tư</th><th>Còn lại</th><th>SL Nhận</th><th>Heat No.</th><th>Lot No.</th><th>Ghi chú</th></tr>
                </thead>
                <tbody>
                  {receiveItems.map((item, idx) => (
                    <tr key={item.poItemId}>
                      <td className="text-xs">{item.materialName}</td>
                      <td className="text-xs font-bold">{item.maxQty} {item.unit}</td>
                      <td>
                        <input type="number" min={0} max={item.maxQty} value={item.receivedQty || ''}
                          onChange={e => updateItem(idx, 'receivedQty', Math.min(Number(e.target.value), item.maxQty))}
                          className="input" style={{ width: '80px', padding: '4px 8px', fontSize: '0.8rem' }} />
                      </td>
                      <td>
                        <input type="text" value={item.heatNumber} placeholder="Heat"
                          onChange={e => updateItem(idx, 'heatNumber', e.target.value)}
                          className="input" style={{ width: '90px', padding: '4px 8px', fontSize: '0.8rem' }} />
                      </td>
                      <td>
                        <input type="text" value={item.lotNumber} placeholder="Lot"
                          onChange={e => updateItem(idx, 'lotNumber', e.target.value)}
                          className="input" style={{ width: '90px', padding: '4px 8px', fontSize: '0.8rem' }} />
                      </td>
                      <td>
                        <input type="text" value={item.notes} placeholder="Ghi chú"
                          onChange={e => updateItem(idx, 'notes', e.target.value)}
                          className="input" style={{ width: '120px', padding: '4px 8px', fontSize: '0.8rem' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={submitReceive} disabled={submitting} className="btn-accent">
                {submitting ? '⏳ Đang xử lý...' : '✅ Xác nhận nhận hàng'}
              </button>
            </div>
          )}

          {selectedPO && receiveItems.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--success)' }}>✅ PO này đã nhận đủ tất cả vật tư.</p>
          )}
        </div>
      )}

      {/* ── Receipt History ── */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>PO</th><th>Vật tư</th><th>SL</th><th>ĐVT</th><th>Heat No.</th><th>Lot No.</th><th>Ghi chú</th><th>Ngày</th></tr></thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có phiếu nhận</td></tr>
            ) : receipts.map(r => (
              <tr key={r.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{r.referenceNo || '—'}</span></td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{r.material.materialCode} — {r.material.name}</td>
                <td className="text-xs font-bold" style={{ color: '#16a34a' }}>{Number(r.quantity).toLocaleString('vi-VN')}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.material.unit}</td>
                <td className="text-xs font-mono" style={{ color: '#0ea5e9' }}>{r.heatNumber || '—'}</td>
                <td className="text-xs font-mono" style={{ color: '#f59e0b' }}>{r.lotNumber || '—'}</td>
                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(r.createdAt).toLocaleDateString('vi-VN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
