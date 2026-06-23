'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import MultiFileUpload, { UploadedFile } from '@/components/MultiFileUpload'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { QUOTE_EDIT_ROLES } from '@/lib/constants'
import { parseQuoteExcel, matchQuoteLinesToPr, type QuoteLine, type PrItem } from '@/lib/quote-parser'

export interface QuoteFile { id: string; fileName: string; fileUrl: string; kind: 'Báo giá' | 'Hợp đồng' | 'Khác' }

export interface SupplierQuote {
  id: string
  vendorId?: string
  vendorName: string
  vendorCode?: string
  quoteDate: string
  totalAmount: number
  currency: string
  leadTimeDays: number
  paymentTerms: string
  note: string
  files: QuoteFile[]
  selected: boolean
  selectReason: string
  lines?: QuoteLine[]
}

interface Vendor { id: string; vendorCode: string; name: string; category: string }

interface Props {
  taskId: string
  isEditable: boolean
  bomPrData?: string
  value?: SupplierQuote[]
  onChange: (quotes: SupplierQuote[]) => void
}

function uid() { return Math.random().toString(36).slice(2, 10) }

function emptyQuote(): SupplierQuote {
  return {
    id: uid(), vendorName: '', quoteDate: new Date().toISOString().slice(0, 10),
    totalAmount: 0, currency: 'VND', leadTimeDays: 0, paymentTerms: '', note: '',
    files: [], selected: false, selectReason: '', lines: [],
  }
}

function fmt(n: number, cur = 'VND') {
  return cur === 'VND' ? formatCurrency(n) : formatNumber(n) + ` ${cur}`
}

export default function SupplierQuoteUI({ taskId, isEditable: isEditableProp, bomPrData, value, onChange }: Props) {
  const roleCode = useAuthStore(s => s.user?.roleCode || '')
  const canEditQuote = (QUOTE_EDIT_ROLES as readonly string[]).includes(roleCode)
  const isEditable = isEditableProp && canEditQuote

  const [quotes, setQuotes] = useState<SupplierQuote[]>(value || [])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorSearch, setVendorSearch] = useState<Record<string, string>>({})
  const [showNewVendor, setShowNewVendor] = useState<string | null>(null)
  const [newVendor, setNewVendor] = useState({ name: '', vendorCode: '', category: 'NCC', contact: '', phone: '' })
  const [creatingVendor, setCreatingVendor] = useState(false)
  const [reasonError, setReasonError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/vendors').then(r => {
      if (r.ok && r.vendors) setVendors(r.vendors)
    }).catch(() => {})
  }, [])

  const fire = useCallback((updated: SupplierQuote[]) => {
    setQuotes(updated)
    onChange(updated)
  }, [onChange])

  const addRow = () => fire([...quotes, emptyQuote()])

  const updateRow = (id: string, patch: Partial<SupplierQuote>) => {
    fire(quotes.map(q => q.id === id ? { ...q, ...patch } : q))
  }

  const removeRow = (id: string) => fire(quotes.filter(q => q.id !== id))

  const selectRow = (id: string) => {
    const target = quotes.find(q => q.id === id)
    const priced = quotes.filter(q => q.totalAmount > 0)
    const min = priced.length > 0 ? Math.min(...priced.map(q => q.totalAmount)) : 0
    if (target && min > 0 && target.totalAmount > min && !target.selectReason?.trim()) {
      setReasonError(id)
      return
    }
    setReasonError(null)
    fire(quotes.map(q => ({ ...q, selected: q.id === id })))
  }

  const handleFileUploaded = (rowId: string, file: UploadedFile) => {
    const qf: QuoteFile = { id: file.id, fileName: file.fileName, fileUrl: file.fileUrl, kind: 'Báo giá' }
    updateRow(rowId, { files: [...(quotes.find(q => q.id === rowId)?.files || []), qf] })
  }

  const handleFileDeleted = (rowId: string, fileId: string) => {
    const row = quotes.find(q => q.id === rowId)
    if (row) updateRow(rowId, { files: row.files.filter(f => f.id !== fileId) })
  }

  const handleFileKind = (rowId: string, fileId: string, kind: QuoteFile['kind']) => {
    const row = quotes.find(q => q.id === rowId)
    if (row) updateRow(rowId, { files: row.files.map(f => f.id === fileId ? { ...f, kind } : f) })
  }

  const [parseStatus, setParseStatus] = useState<Record<string, string>>({})

  const handleParseQuoteFile = async (rowId: string, file: File) => {
    setParseStatus(p => ({ ...p, [rowId]: 'parsing' }))
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheetName = wb.SheetNames.find(n => /^bg$/i.test(n.trim())) || wb.SheetNames[0]
      const sheet = wb.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

      let lines = parseQuoteExcel(data)
      if (lines.length === 0) {
        setParseStatus(p => ({ ...p, [rowId]: 'empty' }))
        return
      }

      if (Array.isArray(parsedPrItems) && parsedPrItems.length > 0) {
        lines = matchQuoteLinesToPr(lines, parsedPrItems)
      }

      const total = lines.reduce((s, l) => s + l.amount, 0)
      updateRow(rowId, { lines, totalAmount: Math.round(total * 100) / 100 })
      setParseStatus(p => ({ ...p, [rowId]: `ok:${lines.length}` }))
    } catch {
      setParseStatus(p => ({ ...p, [rowId]: 'error' }))
    }
  }

  const handleCreateVendor = async (rowId: string) => {
    if (!newVendor.name || !newVendor.vendorCode) return
    setCreatingVendor(true)
    try {
      const r = await apiFetch('/api/vendors', {
        method: 'POST',
        body: JSON.stringify({
          name: newVendor.name, vendorCode: newVendor.vendorCode,
          category: newVendor.category, contactName: newVendor.contact, phone: newVendor.phone,
        }),
      })
      if (r.ok && r.vendor) {
        const v = r.vendor as Vendor
        setVendors(prev => [...prev, v])
        updateRow(rowId, { vendorId: v.id, vendorName: v.name, vendorCode: v.vendorCode })
        setShowNewVendor(null)
        setNewVendor({ name: '', vendorCode: '', category: 'NCC', contact: '', phone: '' })
      }
    } catch { /* ignore */ }
    setCreatingVendor(false)
  }

  const filteredVendors = (rowId: string) => {
    const q = (vendorSearch[rowId] || '').toLowerCase()
    if (!q) return vendors.slice(0, 20)
    return vendors.filter(v =>
      v.name.toLowerCase().includes(q) || v.vendorCode.toLowerCase().includes(q) || v.category.toLowerCase().includes(q)
    ).slice(0, 20)
  }

  // PR reference table
  const prItems = bomPrData ? (() => { try { return JSON.parse(bomPrData) } catch { return null } })() : null
  const parsedPrItems: PrItem[] = useMemo(() => {
    if (!Array.isArray(prItems)) return []
    return prItems.map((it: Record<string, unknown>) => ({
      stt: String(it.stt || it.code || it.materialCode || ''),
      description: String(it.description || it.materialName || it.name || ''),
      profile: String(it.profile || ''),
      grade: String(it.grade || ''),
      unit: String(it.unit || it.uom || ''),
      quantity: Number(it.quantity || it.qty || 0),
    }))
  }, [bomPrData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Comparison
  const sorted = [...quotes].filter(q => q.totalAmount > 0).sort((a, b) => a.totalAmount - b.totalAmount)
  const minAmount = sorted.length > 0 ? sorted[0].totalAmount : 0
  const chosen = quotes.find(q => q.selected)

  const prRef = Array.isArray(prItems) && prItems.length > 0 ? (
    <div className="rounded-xl p-4" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
      <div className="text-sm font-semibold mb-2" style={{ color: '#0369a1' }}>📦 Vật tư cần mua (từ PR)</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr style={{ background: '#e0f2fe' }}>
            {['#', 'Mã VT', 'Tên vật tư', 'ĐVT', 'SL', 'Ghi chú'].map(h => (
              <th key={h} className="text-left px-2 py-1.5 font-semibold" style={{ color: '#0c4a6e' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {(prItems as Record<string, unknown>[]).slice(0, 50).map((item, i) => (
              <tr key={i} style={{ borderTop: '1px solid #bae6fd' }}>
                <td className="px-2 py-1" style={{ color: '#64748b' }}>{i + 1}</td>
                <td className="px-2 py-1 font-mono">{String(item.materialCode || item.code || '—')}</td>
                <td className="px-2 py-1">{String(item.materialName || item.name || item.description || '—')}</td>
                <td className="px-2 py-1">{String(item.unit || item.uom || '—')}</td>
                <td className="px-2 py-1 font-semibold">{String(item.quantity || item.qty || '—')}</td>
                <td className="px-2 py-1" style={{ color: '#64748b' }}>{String(item.note || item.remark || '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(prItems as unknown[]).length > 50 && <div className="text-xs mt-1" style={{ color: '#64748b' }}>... và {(prItems as unknown[]).length - 50} dòng nữa</div>}
    </div>
  ) : null

  // ── READ-ONLY REVIEW MODE ──
  if (!isEditable) {
    const chosenNotMin = chosen && minAmount > 0 && chosen.totalAmount > minAmount
    return (
      <div className="space-y-4">
        {prRef}

        {quotes.length === 0 && (
          <div className="text-sm" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có báo giá NCC</div>
        )}

        {quotes.length > 0 && (
          <>
            {/* Banner */}
            {chosen ? (
              <div className="rounded-xl p-4" style={{ background: '#f0fdf4', border: '2px solid #22c55e' }}>
                <div className="text-sm font-bold" style={{ color: '#15803d' }}>
                  ✅ NCC được chọn: {chosen.vendorName}{chosen.vendorCode ? ` (${chosen.vendorCode})` : ''} — {fmt(chosen.totalAmount, chosen.currency)}
                </div>
                {chosen.selectReason && <div className="text-xs mt-1" style={{ color: '#166534' }}>Lý do: {chosen.selectReason}</div>}
                {chosenNotMin && (
                  <div className="text-xs mt-1 px-2 py-1 rounded inline-block" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                    ⚠ Không phải giá thấp nhất (thấp nhất: {fmt(minAmount, sorted[0]?.currency)})
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl p-4" style={{ background: '#fef3c7', border: '2px solid #fbbf24' }}>
                <div className="text-sm font-bold" style={{ color: '#92400e' }}>⚠️ Chưa chọn NCC</div>
              </div>
            )}

            {/* Comparison table */}
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>📊 So sánh báo giá ({sorted.length} NCC)</div>
              {sorted.length < 3 && (
                <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                  ⚠️ Chỉ có {sorted.length} báo giá (nên có ít nhất 3)
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
                    {['NCC', 'Ngày BG', 'Tổng tiền', 'Giao (ngày)', 'Điều kiện TT', 'File', 'Ghi chú'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {sorted.map(q => {
                      const isMin = q.totalAmount === minAmount
                      const isSel = q.selected
                      return (
                        <tr key={q.id} style={{ borderTop: '1px solid var(--border)', background: isSel ? '#f0fdf4' : isMin ? '#eff6ff' : undefined }}>
                          <td className="px-3 py-2 font-semibold">
                            {isSel && <span style={{ color: '#f59e0b' }}>★ </span>}
                            {q.vendorName || '—'}
                            {q.vendorCode && <span className="ml-1" style={{ color: '#64748b' }}>({q.vendorCode})</span>}
                          </td>
                          <td className="px-3 py-2">{q.quoteDate || '—'}</td>
                          <td className="px-3 py-2 font-bold" style={{ color: isMin ? '#1d4ed8' : 'var(--text-primary)' }}>
                            {fmt(q.totalAmount, q.currency)}
                            {isMin && <span className="ml-1" style={{ color: '#1d4ed8' }}>(thấp nhất)</span>}
                            {isSel && !isMin && <span className="ml-1" style={{ color: '#dc2626' }}>(⚠ không phải giá thấp nhất)</span>}
                          </td>
                          <td className="px-3 py-2">{q.leadTimeDays || '—'}</td>
                          <td className="px-3 py-2">{q.paymentTerms || '—'}</td>
                          <td className="px-3 py-2">
                            <ReviewFileList taskId={taskId} quoteId={q.id} savedFiles={q.files} />
                          </td>
                          <td className="px-3 py-2" style={{ color: '#64748b' }}>{q.note || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Material matrix (review mode) */}
            <MaterialMatrix quotes={quotes} prItems={parsedPrItems} chosen={chosen} />
          </>
        )}
      </div>
    )
  }

  // ── EDITABLE MODE ──
  return (
    <div className="space-y-4">
      {prRef}

      {/* B: Supplier rows */}
      {quotes.map((q, idx) => (
        <div key={q.id} className="rounded-xl p-4" style={{
          background: q.selected ? '#f0fdf4' : 'var(--surface)',
          border: q.selected ? '2px solid #22c55e' : '1px solid var(--border)',
        }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold" style={{ color: q.selected ? '#15803d' : 'var(--text-primary)' }}>
              {q.selected && '★ '}NCC #{idx + 1}: {q.vendorName || '(chưa chọn)'}
            </div>
            <div className="flex gap-2">
              {!q.selected && (
                <button onClick={() => selectRow(q.id)} className="text-xs px-2 py-1 rounded-lg" style={{ background: '#ecfdf5', color: '#15803d', border: '1px solid #86efac' }}>
                  Chọn NCC này
                </button>
              )}
              {q.selected && (
                <span className="text-xs px-2 py-1 rounded-lg font-semibold" style={{ background: '#22c55e', color: '#fff' }}>✓ Đã chọn</span>
              )}
              <button onClick={() => removeRow(q.id)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#dc2626', border: '1px solid #fecaca', background: '#fef2f2' }}>Xóa</button>
            </div>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {/* Vendor picker */}
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Nhà cung cấp</label>
              <div className="relative">
                <input
                  type="text"
                  value={vendorSearch[q.id] ?? q.vendorName}
                  onChange={e => {
                    setVendorSearch(prev => ({ ...prev, [q.id]: e.target.value }))
                    if (!e.target.value) updateRow(q.id, { vendorId: undefined, vendorName: '', vendorCode: undefined })
                  }}
                  placeholder="Tìm NCC..."
                  className="w-full text-sm px-2 py-1.5 rounded-lg"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
                />
                {vendorSearch[q.id] !== undefined && (
                  <div className="absolute z-10 w-full mt-1 rounded-lg shadow-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxHeight: 200, overflowY: 'auto' }}>
                    {filteredVendors(q.id).map(v => (
                      <div key={v.id} className="px-3 py-2 text-xs cursor-pointer hover:bg-blue-50"
                        onClick={() => {
                          updateRow(q.id, { vendorId: v.id, vendorName: v.name, vendorCode: v.vendorCode })
                          setVendorSearch(prev => { const n = { ...prev }; delete n[q.id]; return n })
                        }}>
                        <span className="font-semibold">{v.name}</span>
                        <span className="ml-2" style={{ color: '#64748b' }}>{v.vendorCode} · {v.category}</span>
                      </div>
                    ))}
                    {filteredVendors(q.id).length === 0 && <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Không tìm thấy</div>}
                    <div className="px-3 py-2 text-xs cursor-pointer font-semibold hover:bg-blue-50" style={{ color: '#1d4ed8', borderTop: '1px solid var(--border)' }}
                      onClick={() => { setShowNewVendor(q.id); setVendorSearch(prev => { const n = { ...prev }; delete n[q.id]; return n }) }}>
                      + Tạo NCC mới
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Ngày báo giá</label>
              <input type="date" value={q.quoteDate}
                onChange={e => updateRow(q.id, { quoteDate: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Tổng tiền</label>
              <div className="flex gap-1">
                <input type="number" value={q.totalAmount || ''}
                  onChange={e => updateRow(q.id, { totalAmount: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="flex-1 text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }} />
                <select value={q.currency}
                  onChange={e => updateRow(q.id, { currency: e.target.value })}
                  className="text-xs px-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  <option value="VND">VND</option><option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Thời gian giao (ngày)</label>
              <input type="number" value={q.leadTimeDays || ''}
                onChange={e => updateRow(q.id, { leadTimeDays: Number(e.target.value) || 0 })}
                className="w-full text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Điều kiện thanh toán</label>
              <input type="text" value={q.paymentTerms}
                onChange={e => updateRow(q.id, { paymentTerms: e.target.value })}
                placeholder="VD: 50% trước, 50% sau giao"
                className="w-full text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Ghi chú</label>
              <input type="text" value={q.note}
                onChange={e => updateRow(q.id, { note: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }} />
            </div>
          </div>

          {/* File upload + kind label */}
          <div className="mt-3">
            <MultiFileUpload
              label="Đính kèm báo giá / hợp đồng"
              entityType="TaskQuote"
              entityId={`${taskId}_${q.id}`}
              compact
              onUploaded={(f) => handleFileUploaded(q.id, f)}
              onDeleted={(fid) => handleFileDeleted(q.id, fid)}
            />
            {q.files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {q.files.map(f => (
                  <div key={f.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b' }}>{f.fileName.slice(0, 20)}</span>
                    <select value={f.kind} onChange={e => handleFileKind(q.id, f.id, e.target.value as QuoteFile['kind'])}
                      className="text-xs px-1 rounded" style={{ border: '1px solid #cbd5e1', background: '#fff' }}>
                      <option value="Báo giá">Báo giá</option>
                      <option value="Hợp đồng">Hợp đồng</option>
                      <option value="Khác">Khác</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
            {/* Parse Excel quote file */}
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
                style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
                📄 Upload file báo giá Excel
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleParseQuoteFile(q.id, f); e.target.value = '' }} />
              </label>
              {parseStatus[q.id] === 'parsing' && <span className="text-xs" style={{ color: '#64748b' }}>Đang parse...</span>}
              {parseStatus[q.id] === 'empty' && <span className="text-xs" style={{ color: '#dc2626' }}>Không tìm thấy dòng báo giá</span>}
              {parseStatus[q.id] === 'error' && <span className="text-xs" style={{ color: '#dc2626' }}>Lỗi đọc file</span>}
              {parseStatus[q.id]?.startsWith('ok:') && <span className="text-xs" style={{ color: '#15803d' }}>✓ {parseStatus[q.id].split(':')[1]} dòng</span>}
            </div>
            {q.lines && q.lines.length > 0 && (
              <div className="mt-2 text-xs" style={{ color: '#64748b' }}>
                {q.lines.filter(l => l.matchedPrIndex !== null).length}/{q.lines.length} dòng khớp PR
                {q.lines.some(l => l.matchedPrIndex === null) && (
                  <span className="ml-2" style={{ color: '#f59e0b' }}>⚠ {q.lines.filter(l => l.matchedPrIndex === null).length} dòng ngoài PR</span>
                )}
              </div>
            )}
          </div>

          {/* Select reason */}
          {(q.selected || reasonError === q.id) && (
            <div className="mt-3">
              <label className="text-xs font-semibold" style={{ color: reasonError === q.id ? '#dc2626' : '#15803d' }}>
                {reasonError === q.id ? 'Phải nhập lý do khi chọn NCC không phải giá thấp nhất' : 'Lý do chọn NCC này'}
              </label>
              <input type="text" value={q.selectReason}
                onChange={e => { updateRow(q.id, { selectReason: e.target.value }); if (reasonError === q.id) setReasonError(null) }}
                placeholder="VD: Giao nhanh, uy tín, chất lượng tốt hơn..."
                className="w-full text-sm px-2 py-1.5 rounded-lg mt-1"
                style={{ border: `1px solid ${reasonError === q.id ? '#fca5a5' : '#86efac'}`, background: reasonError === q.id ? '#fef2f2' : '#f0fdf4' }} />
            </div>
          )}

          {/* New vendor form */}
          {showNewVendor === q.id && (
            <div className="mt-3 p-3 rounded-lg" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div className="text-xs font-semibold mb-2" style={{ color: '#92400e' }}>Tạo NCC mới</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                <input placeholder="Tên NCC *" value={newVendor.name} onChange={e => setNewVendor(v => ({ ...v, name: e.target.value }))}
                  className="text-xs px-2 py-1.5 rounded" style={{ border: '1px solid #fde68a' }} />
                <input placeholder="Mã NCC *" value={newVendor.vendorCode} onChange={e => setNewVendor(v => ({ ...v, vendorCode: e.target.value }))}
                  className="text-xs px-2 py-1.5 rounded" style={{ border: '1px solid #fde68a' }} />
                <input placeholder="Danh mục" value={newVendor.category} onChange={e => setNewVendor(v => ({ ...v, category: e.target.value }))}
                  className="text-xs px-2 py-1.5 rounded" style={{ border: '1px solid #fde68a' }} />
                <input placeholder="Người liên hệ" value={newVendor.contact} onChange={e => setNewVendor(v => ({ ...v, contact: e.target.value }))}
                  className="text-xs px-2 py-1.5 rounded" style={{ border: '1px solid #fde68a' }} />
                <input placeholder="SĐT" value={newVendor.phone} onChange={e => setNewVendor(v => ({ ...v, phone: e.target.value }))}
                  className="text-xs px-2 py-1.5 rounded" style={{ border: '1px solid #fde68a' }} />
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => handleCreateVendor(q.id)} disabled={creatingVendor || !newVendor.name || !newVendor.vendorCode}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#f59e0b', color: '#fff', opacity: creatingVendor ? 0.5 : 1 }}>
                  {creatingVendor ? '...' : 'Tạo'}
                </button>
                <button onClick={() => setShowNewVendor(null)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid #e2e8f0', color: '#64748b' }}>Hủy</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <button onClick={addRow} className="w-full text-sm py-2.5 rounded-xl font-semibold" style={{ border: '2px dashed var(--border)', color: '#1d4ed8', background: 'none', cursor: 'pointer' }}>
        + Thêm nhà cung cấp
      </button>

      {/* C: Comparison */}
      {quotes.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>📊 So sánh báo giá</div>
          {quotes.filter(q => q.totalAmount > 0).length < 3 && (
            <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
              ⚠️ Nên có ít nhất 3 báo giá để so sánh
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
                {['NCC', 'Tổng tiền', 'Giao (ngày)', 'Thanh toán', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sorted.map(q => {
                  const isMin = q.totalAmount === minAmount
                  const isSel = q.selected
                  return (
                    <tr key={q.id} style={{ borderTop: '1px solid var(--border)', background: isSel ? '#f0fdf4' : isMin ? '#eff6ff' : undefined }}>
                      <td className="px-3 py-2 font-semibold">
                        {isSel && <span style={{ color: '#f59e0b' }}>★ </span>}
                        {q.vendorName || '—'}
                        {q.vendorCode && <span className="ml-1" style={{ color: '#64748b' }}>({q.vendorCode})</span>}
                      </td>
                      <td className="px-3 py-2 font-bold" style={{ color: isMin ? '#1d4ed8' : 'var(--text-primary)' }}>
                        {fmt(q.totalAmount, q.currency)}
                        {isMin && <span className="ml-1 text-xs" style={{ color: '#1d4ed8' }}>(thấp nhất)</span>}
                      </td>
                      <td className="px-3 py-2">{q.leadTimeDays || '—'}</td>
                      <td className="px-3 py-2">{q.paymentTerms || '—'}</td>
                      <td className="px-3 py-2">
                        {isSel && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#22c55e', color: '#fff' }}>Đã chọn</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {chosen && chosen.selectReason && (
            <div className="mt-2 text-xs" style={{ color: '#15803d' }}>
              <span className="font-semibold">Lý do chọn:</span> {chosen.selectReason}
            </div>
          )}
        </div>
      )}

      {/* D: Material comparison matrix */}
      <MaterialMatrix quotes={quotes} prItems={parsedPrItems} chosen={chosen} />

      {canEditQuote && quotes.length === 0 && (
        <div className="text-center py-6 rounded-xl" style={{ background: '#f0f9ff', border: '2px dashed #93c5fd' }}>
          <div className="text-3xl mb-2">💰</div>
          <div className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>Bắt đầu tìm nhà cung cấp</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>Nhấn &quot;+ Thêm nhà cung cấp&quot; để thêm báo giá</div>
        </div>
      )}
    </div>
  )
}

// ── Sub-component: Material comparison matrix ──
function MaterialMatrix({ quotes, prItems, chosen }: { quotes: SupplierQuote[]; prItems: PrItem[]; chosen?: SupplierQuote }) {
  const quotesWithLines = quotes.filter(q => q.lines && q.lines.length > 0)
  if (quotesWithLines.length === 0 || prItems.length === 0) return null

  type Row = { prIdx: number; code: string; desc: string; profile: string; unit: string; qty: number; prices: Record<string, number> }

  const rows: Row[] = []
  const extraRows: { quoteId: string; vendorName: string; line: QuoteLine }[] = []

  for (let pi = 0; pi < prItems.length; pi++) {
    const p = prItems[pi]
    const prices: Record<string, number> = {}
    for (const q of quotesWithLines) {
      const match = q.lines!.find(l => l.matchedPrIndex === pi)
      if (match) prices[q.id] = match.unitPrice
    }
    rows.push({
      prIdx: pi,
      code: p.stt || p.code || p.materialCode || '',
      desc: p.description || p.materialName || p.name || '',
      profile: p.profile || '',
      unit: p.unit || p.uom || '',
      qty: p.quantity || p.qty || 0,
      prices,
    })
  }

  for (const q of quotesWithLines) {
    for (const l of q.lines!) {
      if (l.matchedPrIndex === null) {
        extraRows.push({ quoteId: q.id, vendorName: q.vendorName, line: l })
      }
    }
  }

  const nccTotals: Record<string, number> = {}
  for (const q of quotesWithLines) {
    nccTotals[q.id] = q.lines!.reduce((s, l) => s + l.amount, 0)
  }

  let cheapestId = ''
  let cheapestTotal = Infinity
  for (const [qid, total] of Object.entries(nccTotals)) {
    if (total > 0 && total < cheapestTotal) { cheapestTotal = total; cheapestId = qid }
  }

  return (
    <div className="rounded-xl p-4 mt-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        📋 So sánh theo vật tư ({rows.length} dòng PR × {quotesWithLines.length} NCC)
      </div>
      {cheapestId && (
        <div className="text-xs mb-2 px-2 py-1.5 rounded-lg inline-block" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
          NCC rẻ nhất toàn gói: <strong>{quotesWithLines.find(q => q.id === cheapestId)?.vendorName}</strong> — {formatCurrency(cheapestTotal)}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 60 }}>#</th>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 120 }}>Vật tư</th>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 60 }}>ĐVT</th>
              <th className="text-right px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 50 }}>SL</th>
              {quotesWithLines.map(q => (
                <th key={q.id} className="text-right px-2 py-1.5 font-semibold" style={{ color: q.selected ? '#15803d' : 'var(--text-muted)', minWidth: 100 }}>
                  {q.selected && '★ '}{q.vendorName || '—'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const priceVals = Object.values(r.prices).filter(p => p > 0)
              const minPrice = priceVals.length > 0 ? Math.min(...priceVals) : 0
              const missingCount = quotesWithLines.length - Object.keys(r.prices).length
              return (
                <tr key={ri} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: '#64748b' }}>{r.code || (ri + 1)}</td>
                  <td className="px-2 py-1">
                    {r.desc}{r.profile ? <span className="ml-1" style={{ color: '#64748b' }}>{r.profile}</span> : ''}
                    {missingCount > 0 && <span className="ml-1" style={{ color: '#f59e0b' }} title={`${missingCount} NCC thiếu báo giá`}>⚠</span>}
                  </td>
                  <td className="px-2 py-1">{r.unit || '—'}</td>
                  <td className="px-2 py-1 text-right font-semibold">{r.qty || '—'}</td>
                  {quotesWithLines.map(q => {
                    const price = r.prices[q.id]
                    const isMin = price !== undefined && price > 0 && price === minPrice
                    return (
                      <td key={q.id} className="px-2 py-1 text-right font-mono"
                        style={{ color: price === undefined ? '#94a3b8' : isMin ? '#1d4ed8' : 'var(--text-primary)', fontWeight: isMin ? 700 : 400, background: isMin ? '#eff6ff' : undefined }}>
                        {price !== undefined ? formatNumber(price) : '—'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {/* Totals row */}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td className="px-2 py-1.5" colSpan={4} style={{ color: 'var(--text-primary)' }}>Tổng</td>
              {quotesWithLines.map(q => {
                const total = nccTotals[q.id] || 0
                const isCheapest = q.id === cheapestId
                return (
                  <td key={q.id} className="px-2 py-1.5 text-right font-mono"
                    style={{ color: isCheapest ? '#1d4ed8' : 'var(--text-primary)', background: isCheapest ? '#eff6ff' : undefined }}>
                    {formatCurrency(total)}
                    {isCheapest && <span className="ml-1" style={{ fontSize: '0.65rem' }}>(thấp nhất)</span>}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {/* Extra rows (not in PR) */}
      {extraRows.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold mb-1" style={{ color: '#f59e0b' }}>⚠ Dòng ngoài PR ({extraRows.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ background: '#fef3c7' }}>
                {['NCC', 'Mã', 'Mô tả', 'Profile', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền'].map(h => (
                  <th key={h} className="text-left px-2 py-1 font-semibold" style={{ color: '#92400e' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {extraRows.map((er, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #fde68a' }}>
                    <td className="px-2 py-1">{er.vendorName}</td>
                    <td className="px-2 py-1 font-mono">{er.line.code}</td>
                    <td className="px-2 py-1">{er.line.description}</td>
                    <td className="px-2 py-1">{er.line.profile}</td>
                    <td className="px-2 py-1">{er.line.unit}</td>
                    <td className="px-2 py-1 text-right">{er.line.qty}</td>
                    <td className="px-2 py-1 text-right">{formatNumber(er.line.unitPrice)}</td>
                    <td className="px-2 py-1 text-right font-semibold">{formatCurrency(er.line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-component: fetch & render files for review mode ──
function ReviewFileList({ taskId, quoteId, savedFiles }: { taskId: string; quoteId: string; savedFiles: QuoteFile[] }) {
  const [files, setFiles] = useState<{ id: string; fileName: string; fileUrl: string; kind: string }[]>(
    savedFiles.map(f => ({ ...f }))
  )
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    apiFetch(`/api/upload?entityType=TaskQuote&entityId=${encodeURIComponent(`${taskId}_${quoteId}`)}`)
      .then(r => {
        if (r.ok && r.attachments?.length) {
          const kindMap = new Map(savedFiles.map(f => [f.id, f.kind]))
          setFiles(r.attachments.map((a: { id: string; fileName: string; fileUrl: string }) => ({
            id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, kind: kindMap.get(a.id) || 'Báo giá',
          })))
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [taskId, quoteId, savedFiles, loaded])

  if (files.length === 0) return <span style={{ color: '#94a3b8' }}>—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {files.map(f => (
        <a key={f.id} href={f.fileUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs hover:underline" style={{ color: '#1d4ed8' }}>
          {f.kind !== 'Khác' ? `[${f.kind}] ` : ''}{f.fileName.length > 25 ? f.fileName.slice(0, 22) + '...' : f.fileName}
        </a>
      ))}
    </div>
  )
}
