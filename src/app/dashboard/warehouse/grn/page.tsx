'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate, formatNumber } from '@/lib/utils'
import { PageHeader, Button, EmptyState, Modal, KPICard, SelectField } from '@/components/ui'
import { Package, BarChart3, Wrench, CheckCircle2 } from 'lucide-react'

interface GRN {
  id: string; type: string; reason: string; quantity: number; referenceNo: string | null;
  heatNumber: string | null; lotNumber: string | null; notes: string | null; createdAt: string;
  material: { materialCode: string; name: string; unit: string } | null
}

interface PO {
  id: string; poCode: string; status: string;
  vendor: { name: string } | null;
  items: Array<{
    id: string; materialId: string | null; quantity: number; receivedQty: number;
    material: { materialCode: string; name: string; unit: string } | null;
    itemCode?: string; description?: string; unit?: string;
  }>
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
    // POs that Finance has PAID are ready for goods receiving;
    // PARTIAL_RECEIVED ones can continue receiving remaining items.
    const res = await apiFetch('/api/purchase-orders?status=PAID,PARTIAL_RECEIVED')
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
        materialName: item.material ? `${item.material.materialCode} — ${item.material.name}` : (item.itemCode ? `${item.itemCode} — ${item.description || ''}` : item.description || '—'),
        unit: item.material?.unit || item.unit || '',
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
      alert(`Đã nhận ${validItems.length} mục. PO status: ${res.poStatus}`)
      setShowReceiveForm(false)
      loadReceipts()
    } else {
      alert('Lỗi: ' + (res.message || 'Không rõ'))
    }
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalQty = receipts.reduce((s, r) => s + Number(r.quantity), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Nhận hàng (GRN)"
        subtitle={`${receipts.length} phiếu nhận`}
        actions={
          <Button variant="accent" onClick={openReceiveForm}>
            + Nhận hàng từ PO
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KPICard
          label="Phiếu nhận"
          value={receipts.length}
          icon={<Package size={20} />}
        />
        <KPICard
          label="Tổng SL nhận"
          value={formatNumber(totalQty)}
          icon={<BarChart3 size={20} />}
          accentColor="var(--success)"
        />
        <KPICard
          label="Vật tư đã nhận"
          value={new Set(receipts.map(r => r.material?.materialCode).filter(Boolean)).size}
          icon={<Wrench size={20} />}
          accentColor="var(--info)"
        />
      </div>

      {/* Receive Form Modal */}
      <Modal
        open={showReceiveForm}
        onClose={() => setShowReceiveForm(false)}
        title="Nhận hàng theo PO"
        size="lg"
        actions={
          selectedPO && receiveItems.length > 0 ? (
            <Button variant="accent" onClick={submitReceive} loading={submitting}>
              Xác nhận nhận hàng
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          {/* PO Selector */}
          <SelectField
            label="Chọn PO"
            value=""
            onChange={e => selectPO(e.target.value)}
            options={[
              { value: '', label: '— Chọn PO —' },
              ...poList.map(po => ({
                value: po.id,
                label: `${po.poCode} — ${po.vendor?.name || 'N/A'} (${po.status})`,
              })),
            ]}
          />

          {/* Items Table */}
          {selectedPO && receiveItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-heading text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                Danh sách vật tư ({selectedPO.poCode})
              </h3>
              <div className="dt-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      <th>Còn lại</th>
                      <th>SL Nhận</th>
                      <th>Heat No.</th>
                      <th>Lot No.</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiveItems.map((item, idx) => (
                      <tr key={item.poItemId}>
                        <td className="text-xs">{item.materialName}</td>
                        <td>
                          <span className="font-mono text-xs font-bold">
                            {item.maxQty} {item.unit}
                          </span>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={item.maxQty}
                            value={item.receivedQty || ''}
                            onChange={e => updateItem(idx, 'receivedQty', Math.min(Number(e.target.value), item.maxQty))}
                            className="input font-mono"
                            style={{ width: '80px', padding: '4px 8px', fontSize: '0.8rem' }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={item.heatNumber}
                            placeholder="Heat"
                            onChange={e => updateItem(idx, 'heatNumber', e.target.value)}
                            className="input font-mono"
                            style={{ width: '90px', padding: '4px 8px', fontSize: '0.8rem' }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={item.lotNumber}
                            placeholder="Lot"
                            onChange={e => updateItem(idx, 'lotNumber', e.target.value)}
                            className="input font-mono"
                            style={{ width: '90px', padding: '4px 8px', fontSize: '0.8rem' }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={item.notes}
                            placeholder="Ghi chú"
                            onChange={e => updateItem(idx, 'notes', e.target.value)}
                            className="input"
                            style={{ width: '120px', padding: '4px 8px', fontSize: '0.8rem' }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedPO && receiveItems.length === 0 && (
            <EmptyState
              icon={<CheckCircle2 />}
              title="PO đã nhận đủ"
              description="PO này đã nhận đủ tất cả vật tư."
            />
          )}
        </div>
      </Modal>

      {/* Receipt History Table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>PO</th>
              <th>Vật tư</th>
              <th>SL</th>
              <th>ĐVT</th>
              <th>Heat No.</th>
              <th>Lot No.</th>
              <th>Ghi chú</th>
              <th>Ngày</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState icon={<Package />} title="Chưa có phiếu nhận" description="Chưa có phiếu nhận hàng nào" />
                </td>
              </tr>
            ) : receipts.map(r => (
              <tr key={r.id}>
                <td>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    {r.referenceNo || '—'}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>
                  {r.material ? `${r.material.materialCode} — ${r.material.name}` : '—'}
                </td>
                <td>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--success)' }}>
                    {formatNumber(r.quantity)}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.material?.unit || '—'}</td>
                <td>
                  <span className="font-mono text-xs" style={{ color: 'var(--info)' }}>
                    {r.heatNumber || '—'}
                  </span>
                </td>
                <td>
                  <span className="font-mono text-xs" style={{ color: 'var(--warning)' }}>
                    {r.lotNumber || '—'}
                  </span>
                </td>
                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
