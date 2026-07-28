'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { notify } from '@/components/ui/Toast'

interface Movement {
  id: string; materialId: string; type: string; quantity: number | string;
  reason: string; referenceNo: string | null; heatNumber: string | null; lotNumber: string | null;
  notes: string | null; createdAt: string; performedBy: string;
  material: { materialCode: string; name: string; unit: string };
}

interface Material { id: string; materialCode: string; name: string; unit: string; currentStock: number }

const TYPE_MAP: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  IN: { label: 'Nhập kho', color: '#16a34a', bg: '#dcfce7', icon: 'IN' },
  OUT: { label: 'Xuất kho', color: '#dc2626', bg: '#fef2f2', icon: 'OUT' },
  RETURN: { label: 'Trả lại', color: '#2563eb', bg: '#dbeafe', icon: 'RT' },
  ADJUST: { label: 'Điều chỉnh', color: '#f59e0b', bg: '#fef9c3', icon: 'ADJ' },
}

const REASON_MAP: Record<string, string> = {
  po_receipt: 'Nhận từ PO',
  production_issue: 'Cấp phát SX',
  return: 'Trả hàng',
  adjustment: 'Kiểm kê',
  qc_reject: 'QC loại',
  manual: 'Thủ công',
}

export default function StockMovementsPage() {
  const [movements, setMovements] = useState<Movement[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showGrn, setShowGrn] = useState(false)
  const [filterType, setFilterType] = useState<string>('')
  const user = useAuthStore((s) => s.user)

  const loadData = async () => {
    setLoading(true)
    const params = filterType ? `?type=${filterType}` : ''
    const res = await apiFetch(`/api/stock-movements${params}`)
    if (res.ok) setMovements(res.movements || [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [filterType])

  const openForm = async () => {
    const matRes = await apiFetch('/api/warehouse?limit=100')
    if (matRes.ok) setMaterials(matRes.materials || [])
    setShowForm(true)
  }

  const canCreate = ['R01', 'R02', 'R05', 'R05a', 'R08', 'R08a'].includes(user?.roleCode || '')
  // Nhập hàng (GRN) từ PO đã QC Đạt: mặc định chỉ Kho (R05/R05a) + BGĐ (R01)
  const canGrnStockIn = ['R01', 'R05', 'R05a'].includes(user?.roleCode || '')

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1,2,3,4].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Xuất Nhập Kho</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Theo dõi mọi biến động vật tư</p>
        </div>
        <div className="flex gap-2">
          {canGrnStockIn && (
            <button onClick={() => setShowGrn(true)}
              className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg"
              style={{ background: 'var(--success)' }}>
              + Nhập hàng (GRN)
            </button>
          )}
          {canCreate && (
            <button onClick={openForm}
              className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:shadow-lg"
              style={{ background: 'var(--accent)' }}>
              + Nhập/Xuất
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <button onClick={() => setFilterType('')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: !filterType ? 'var(--accent)' : 'var(--bg-primary)', color: !filterType ? 'white' : 'var(--text-muted)' }}>
          Tất cả
        </button>
        {Object.entries(TYPE_MAP).map(([key, val]) => (
          <button key={key} onClick={() => setFilterType(key)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ background: filterType === key ? val.bg : 'var(--bg-primary)', color: filterType === key ? val.color : 'var(--text-muted)' }}>
            {val.icon} {val.label}
          </button>
        ))}
      </div>

      {/* Movement List */}
      <div className="space-y-2">
        {movements.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">--</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có biến động kho</p>
          </div>
        )}
        {movements.map(m => {
          const t = TYPE_MAP[m.type] || TYPE_MAP.ADJUST
          return (
            <div key={m.id} className="card p-4 transition-all hover:shadow-md">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: t.bg }}>{t.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>
                      {m.material.materialCode}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ background: t.bg, color: t.color }}>{t.label}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {REASON_MAP[m.reason] || m.reason}
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {m.material.name}
                    {m.heatNumber && <span className="ml-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Heat: {m.heatNumber}</span>}
                    {m.referenceNo && <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>Ref: {m.referenceNo}</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold" style={{ color: m.type === 'OUT' ? '#dc2626' : '#16a34a' }}>
                    {m.type === 'OUT' ? '-' : '+'}{Number(m.quantity)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.material.unit}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(m.createdAt)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && (
        <CreateMovementModal
          materials={materials}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadData() }}
        />
      )}

      {showGrn && (
        <GrnStockInModal
          onClose={() => setShowGrn(false)}
          onDone={() => { setShowGrn(false); loadData() }}
        />
      )}
    </div>
  )
}

// ── Nhập hàng (GRN): nhập kho cho PO đã QC Đạt ──
interface StockInItem {
  receiptId: string; poItemId: string | null; materialName: string; unit: string;
  claimedQty: number; heatNumber: string | null; lotNumber: string | null; millCert: string | null;
}
interface POReady { poId: string; poCode: string; vendorName: string; projectCode: string | null; items: StockInItem[] }
interface StockInRow extends StockInItem { actualQty: number; reason: string }

function GrnStockInModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pos, setPos] = useState<POReady[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPoId, setSelectedPoId] = useState('')
  const [rows, setRows] = useState<StockInRow[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    apiFetch('/api/warehouse/grn-stockin').then(res => {
      if (res.ok) setPos(res.purchaseOrders || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const selectedPO = pos.find(p => p.poId === selectedPoId) || null

  const onSelectPO = (poId: string) => {
    setSelectedPoId(poId)
    const po = pos.find(p => p.poId === poId)
    setRows((po?.items || []).map(it => ({ ...it, actualQty: it.claimedQty, reason: '' })))
  }

  const updateRow = (idx: number, field: 'actualQty' | 'reason', value: string | number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const submit = async () => {
    if (!selectedPO) return
    for (const r of rows) {
      if (!(r.actualQty > 0)) return notify(`Nhập SL thực nhận > 0 cho: ${r.materialName}`)
      if (r.actualQty !== r.claimedQty && !r.reason.trim()) {
        return notify(`SL thực nhận lệch so với TM báo — bắt buộc nhập lý do cho: ${r.materialName}`)
      }
    }
    setSubmitting(true)
    const res = await apiFetch('/api/warehouse/grn-stockin', {
      method: 'POST',
      body: JSON.stringify({
        poId: selectedPO.poId,
        items: rows.map(r => ({ receiptId: r.receiptId, actualQty: r.actualQty, reason: r.reason.trim() || undefined })),
      }),
    })
    setSubmitting(false)
    if (res.ok) { notify(res.message || 'Đã nhập kho'); onDone() }
    else notify('Lỗi: ' + (res.error || res.message || 'Không rõ'))
  }

  const cellInput = {
    width: '90px', padding: '4px 8px', borderRadius: '8px',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-auto animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Nhập hàng (GRN) — từ PO đã QC Đạt</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nhập số lượng thực nhận. Lệch so với TM báo thì bắt buộc nhập lý do.</p>
          </div>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {loading ? (
          <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>Đang tải danh sách PO...</div>
        ) : pos.length === 0 ? (
          <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có PO nào đã QC Đạt chờ nhập kho.</div>
        ) : (
          <div className="space-y-4">
            {/* Chọn PO */}
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Chọn PO *</label>
              <select value={selectedPoId} onChange={e => onSelectPO(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}>
                <option value="">— Chọn PO —</option>
                {pos.map(p => (
                  <option key={p.poId} value={p.poId}>{p.poCode} — {p.vendorName}{p.projectCode ? ` (${p.projectCode})` : ''} · {p.items.length} vật tư</option>
                ))}
              </select>
            </div>

            {/* Bảng vật tư */}
            {selectedPO && (
              <div className="dt-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      <th>SL TM báo về</th>
                      <th>SL thực nhận</th>
                      <th>Heat / Lot / Cert</th>
                      <th>Lý do (nếu lệch)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => {
                      const lech = r.actualQty !== r.claimedQty
                      return (
                        <tr key={r.receiptId}>
                          <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{r.materialName}</td>
                          <td>
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{r.claimedQty} {r.unit}</span>
                          </td>
                          <td>
                            <input type="number" min={0} value={r.actualQty || ''}
                              onChange={e => updateRow(idx, 'actualQty', Number(e.target.value))}
                              className="font-mono"
                              style={{ ...cellInput, borderColor: lech ? 'var(--warning)' : 'var(--border-light)' }} />
                          </td>
                          <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {r.heatNumber || '—'} / {r.lotNumber || '—'} / {r.millCert || '—'}
                          </td>
                          <td>
                            <input type="text" value={r.reason} placeholder={lech ? 'Bắt buộc *' : '—'}
                              onChange={e => updateRow(idx, 'reason', e.target.value)}
                              style={{ ...cellInput, width: '160px', borderColor: (lech && !r.reason.trim()) ? 'var(--danger)' : 'var(--border-light)' }} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
              <button onClick={submit} disabled={!selectedPO || submitting}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: (!selectedPO || submitting) ? '#94a3b8' : 'var(--success)' }}>
                {submitting ? 'Đang nhập kho...' : 'Xác nhận nhập kho'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CreateMovementModal({ materials, onClose, onCreated }: {
  materials: Material[]; onClose: () => void; onCreated: () => void
}) {
  const [type, setType] = useState('IN')
  const [materialId, setMaterialId] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [reason, setReason] = useState('manual')
  const [heatNumber, setHeatNumber] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!materialId || quantity <= 0) return notify('Chọn vật tư và nhập số lượng')
    setSubmitting(true)
    const res = await apiFetch('/api/stock-movements', {
      method: 'POST',
      body: JSON.stringify({ materialId, type, quantity, reason, heatNumber: heatNumber || undefined, referenceNo: referenceNo || undefined, notes }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else notify(res.error || 'Lỗi tạo phiếu')
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '14px', outline: 'none',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="card p-6 w-full max-w-lg animate-fade-in" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Phiếu Xuất/Nhập Kho</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* Type selector */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Loại *</label>
          <div className="flex gap-2">
            {Object.entries(TYPE_MAP).map(([key, val]) => (
              <button key={key} onClick={() => setType(key)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{ background: type === key ? val.bg : 'var(--bg-primary)', color: type === key ? val.color : 'var(--text-muted)' }}>
                {val.icon} {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Material */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Vật tư *</label>
          <select value={materialId} onChange={e => setMaterialId(e.target.value)} style={inputStyle}>
            <option value="">Chọn vật tư...</option>
            {materials.map(m => (
              <option key={m.id} value={m.id}>{m.materialCode} — {m.name} (tồn: {m.currentStock} {m.unit})</option>
            ))}
          </select>
        </div>

        {/* Quantity */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Số lượng *</label>
          <input type="number" min={1} value={quantity || ''} onChange={e => setQuantity(Number(e.target.value))}
            placeholder="Nhập số lượng" style={inputStyle} />
        </div>

        {/* Reason */}
        <div className="mb-4">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Lý do</label>
          <select value={reason} onChange={e => setReason(e.target.value)} style={inputStyle}>
            {Object.entries(REASON_MAP).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Heat Number + Reference */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Heat Number</label>
            <input value={heatNumber} onChange={e => setHeatNumber(e.target.value)} placeholder="VD: H-2026-001" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Số tham chiếu</label>
            <input value={referenceNo} onChange={e => setReferenceNo(e.target.value)} placeholder="PO-xxx" style={inputStyle} />
          </div>
        </div>

        {/* Notes */}
        <div className="mb-5">
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Ghi chú</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ ...inputStyle, resize: 'none' as const }} placeholder="Ghi chú..." />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Hủy</button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: submitting ? '#94a3b8' : 'var(--accent)' }}>
            {submitting ? 'Đang xử lý...' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  )
}
