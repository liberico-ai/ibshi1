'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { apiFetch, useAuthStore, openAuthedFile } from '@/hooks/useAuth'
import MultiFileUpload, { UploadedFile } from '@/components/MultiFileUpload'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { QUOTE_EDIT_ROLES } from '@/lib/constants'
import { parseQuoteExcel, matchQuoteLinesToPr, computeQuoteCoverage, computeQtyMismatches, type QuoteLine, type PrItem } from '@/lib/quote-parser'
import { exportQuoteTemplate } from '@/lib/quote-template-export'
import { toQty, toQtyOrNull } from '@/lib/pr-normalizer'

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
  projectCode?: string
  projectName?: string
  value?: SupplierQuote[]
  onChange: (quotes: SupplierQuote[]) => void
  // PO đã tạo ở phiên trước (task resultData.poId/poCode — nguồn create-po ghi vào).
  // Truyền vào để dải "Bước tiếp theo" đúng trạng thái sau khi tải lại trang.
  existingPoId?: string
  existingPoCode?: string
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

// ── Dải "Bước tiếp theo" — dẫn hướng R07 (mức 2, hiển thị thuần) ──
// Tách ra module-level: không dùng hook, tránh lint nested-component/IIFE-in-JSX.
type StepState = 'done' | 'active' | 'todo'

function StepChip({ n, label, state }: { n: number; label: string; state: StepState }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ background: state === 'done' ? '#22c55e' : state === 'active' ? '#0284c7' : '#cbd5e1' }}
      >
        {state === 'done' ? '✓' : n}
      </span>
      <span className="text-xs font-semibold" style={{ color: state === 'todo' ? '#94a3b8' : 'var(--text-primary)' }}>{label}</span>
    </div>
  )
}

function NextStepBanner({ hasSelected, hasPo }: { hasSelected: boolean; hasPo: boolean }) {
  const s1: StepState = hasSelected ? 'done' : 'active'
  const s2: StepState = hasPo ? 'done' : hasSelected ? 'active' : 'todo'
  const s3: StepState = hasPo ? 'active' : 'todo'
  return (
    <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>BƯỚC TIẾP THEO</span>
      <StepChip n={1} label="Nhập & chọn báo giá" state={s1} />
      <span style={{ color: '#cbd5e1' }}>→</span>
      <StepChip n={2} label="Tạo đơn đặt hàng (PO)" state={s2} />
      <span style={{ color: '#cbd5e1' }}>→</span>
      <StepChip n={3} label="Theo dõi đơn đặt hàng" state={s3} />
      {hasPo ? (
        <Link href="/dashboard/warehouse/purchase-orders" className="text-xs underline ml-auto" style={{ color: '#0369a1' }}>Xem đơn đặt hàng →</Link>
      ) : hasSelected ? (
        <span className="text-xs ml-auto" style={{ color: '#0284c7' }}>Bấm “Tạo đơn đặt hàng (PO)” bên dưới để tiếp tục</span>
      ) : (
        <span className="text-xs ml-auto" style={{ color: '#94a3b8' }}>Chọn NCC trước, rồi tạo đơn đặt hàng</span>
      )}
    </div>
  )
}

export default function SupplierQuoteUI({ taskId, isEditable: isEditableProp, bomPrData, projectCode, projectName, value, onChange, existingPoId, existingPoCode }: Props) {
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
  // Khởi tạo từ PO đã tạo trước đó → dải "Bước tiếp theo" đúng ngay sau khi tải lại trang.
  const [poState, setPoState] = useState<{ loading: boolean; poId?: string; poCode?: string; error?: string }>({ loading: false, poId: existingPoId, poCode: existingPoCode })
  const [prSearch, setPrSearch] = useState('')
  const [showAllPr, setShowAllPr] = useState(false)
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set())
  const toggleDetail = (id: string) => setExpandedDetails(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })


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
    if (target && priced.length >= 2 && target.totalAmount > min && !target.selectReason?.trim()) {
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

  const handleCreatePO = async () => {
    setPoState({ loading: true })
    try {
      const res = await apiFetch(`/api/work/tasks/${taskId}/create-po`, { method: 'POST' })
      if (res.ok) {
        setPoState({ loading: false, poId: res.poId, poCode: res.poCode })
      } else {
        setPoState({ loading: false, error: res.error || 'Lỗi tạo PO' })
      }
    } catch {
      setPoState({ loading: false, error: 'Lỗi kết nối' })
    }
  }

  const handleReEnrich = async () => {
    setEnriching(true)
    setEnrichMsg('')
    try {
      const res = await apiFetch(`/api/work/tasks/${taskId}/bom-pr`, { method: 'POST', body: JSON.stringify({ action: 'enrich' }) })
      if (res.ok) {
        setEnrichMsg(`Đã cập nhật tồn kho cho ${res.count || '?'} dòng`)
        window.location.reload()
      } else {
        setEnrichMsg(res.error || 'Lỗi')
      }
    } catch {
      setEnrichMsg('Lỗi kết nối')
    }
    setEnriching(false)
  }

  const handleExportTemplate = () => {
    if (parsedPrItems.length === 0) return
    const wb = exportQuoteTemplate(parsedPrItems, { projectCode, projectName })
    XLSX.writeFile(wb, `BG_${projectCode || 'template'}.xlsx`)
  }

  const resetQuoteData = (id: string) => {
    fire(quotes.map(q => q.id === id ? { ...q, lines: [], files: [], totalAmount: 0 } : q))
  }

  const resetAllQuotes = () => {
    if (!confirm('Xóa toàn bộ báo giá đã nhập? (Giữ danh sách NCC)')) return
    fire(quotes.map(q => ({ ...q, lines: [], files: [], totalAmount: 0, selected: false, selectReason: '' })))
  }

  // PR reference table
  const prItems = bomPrData ? (() => { try { return JSON.parse(bomPrData) } catch { return null } })() : null
  const [enriching, setEnriching] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState('')

  const parsedPrItems: PrItem[] = useMemo(() => {
    if (!Array.isArray(prItems)) return []
    return prItems.map((it: Record<string, unknown>) => ({
      stt: String(it.stt || it.code || it.materialCode || ''),
      canonicalCode: it.canonicalCode ? String(it.canonicalCode) : undefined,
      description: String(it.description || it.materialName || it.name || ''),
      profile: String(it.profile || ''),
      grade: String(it.grade || ''),
      unit: String(it.unit || it.uom || ''),
      // toQty: số trong resultData có thể lưu dạng CHUỖI ({"needToBuyQty":"1"}). Kiểm
      // `typeof === 'number'` như trước khiến các cột tồn/cần mua hiện TRỐNG với dòng đó.
      // Đây là điểm parse DUY NHẤT — mọi consumer bên dưới đều nhận parsedPrItems.
      quantity: toQty(it.quantity) || toQty(it.qty),
      neededQty: toQtyOrNull(it.neededQty) ?? undefined,
      availableQty: toQtyOrNull(it.availableQty) ?? undefined,
      needToBuyQty: toQtyOrNull(it.needToBuyQty) ?? undefined,
      requiredDate: typeof it.requiredDate === 'string' ? it.requiredDate : undefined,
    }))
  }, [bomPrData]) // eslint-disable-line react-hooks/exhaustive-deps

  const compactPrItems = useMemo(() => {
    let items = parsedPrItems
    if (!showAllPr) items = items.filter(p => ((p.needToBuyQty ?? p.quantity ?? p.qty ?? 0) > 0))
    if (prSearch) {
      const q = prSearch.toLowerCase()
      items = items.filter(p => {
        const code = (p.canonicalCode || p.stt || p.code || p.materialCode || '').toLowerCase()
        const desc = (p.description || p.materialName || p.name || '').toLowerCase()
        return code.includes(q) || desc.includes(q) || (p.profile || '').toLowerCase().includes(q)
      })
    }
    return items
  }, [parsedPrItems, prSearch, showAllPr])

  // Auto-enrich on mount when no item has availableQty yet
  useEffect(() => {
    if (!bomPrData || parsedPrItems.length === 0) return
    if (parsedPrItems.some(p => p.availableQty !== undefined)) return
    const key = `enrich-${taskId}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    apiFetch(`/api/work/tasks/${taskId}/bom-pr`, {
      method: 'POST',
      body: JSON.stringify({ action: 'enrich' }),
    }).then(r => { if (r.ok) window.location.reload() })
      .catch(() => {})
  }, [taskId, bomPrData, parsedPrItems])

  // Comparison
  const hasNeedToBuy = parsedPrItems.some(p => typeof p.needToBuyQty === 'number' || (p.quantity ?? 0) > 0)
  const hasItemsToBuy = parsedPrItems.some(p => ((p.needToBuyQty ?? p.quantity) ?? 0) > 0)
  const { needToBuyTotals, needToBuyPreVat } = useMemo((): { needToBuyTotals: Record<string, number>; needToBuyPreVat: Record<string, number> } => {
    if (!hasNeedToBuy) return { needToBuyTotals: {}, needToBuyPreVat: {} }
    const totals: Record<string, number> = {}
    const preVat: Record<string, number> = {}
    for (const q of quotes) {
      if (!q.lines || q.lines.length === 0) continue
      let total = 0, pre = 0
      for (const p of parsedPrItems) {
        const buyQty = p.needToBuyQty ?? (p.quantity || p.qty || 0)
        if (buyQty <= 0) continue
        const pi = parsedPrItems.indexOf(p)
        const match = q.lines.find(l => l.matchedPrIndex === pi)
        if (match && match.unitPrice > 0) {
          pre += buyQty * match.unitPrice
          total += buyQty * match.unitPrice * (1 + (match.vatPercent ?? 10) / 100)
        }
      }
      if (total > 0) { totals[q.id] = Math.round(total); preVat[q.id] = Math.round(pre) }
    }
    return { needToBuyTotals: totals, needToBuyPreVat: preVat }
  }, [quotes, parsedPrItems, hasNeedToBuy])

  const sortKey = (q: SupplierQuote) => hasNeedToBuy && needToBuyTotals[q.id] ? needToBuyTotals[q.id] : q.totalAmount
  const sorted = [...quotes].filter(q => sortKey(q) > 0).sort((a, b) => sortKey(a) - sortKey(b))
  const minAmount = sorted.length > 0 ? sortKey(sorted[0]) : 0
  const chosen = quotes.find(q => q.selected)

  const poButton = (() => {
    if (!canEditQuote || !chosen?.vendorId || !hasItemsToBuy) return null
    if (poState.poId) {
      return (
        <div className="rounded-xl p-4" style={{ background: '#f0fdf4', border: '2px solid #22c55e' }}>
          <div className="text-sm font-bold" style={{ color: '#15803d' }}>
            Đã tạo PO: <span className="font-mono">{poState.poCode}</span>
          </div>
          <a href={`/dashboard/warehouse/purchase-orders`} className="text-xs underline" style={{ color: '#0369a1' }}>Xem đơn đặt hàng →</a>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={handleCreatePO}
          disabled={poState.loading}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: poState.loading ? '#94a3b8' : '#0284c7' }}
        >
          {poState.loading ? 'Đang tạo PO...' : 'Tạo đơn đặt hàng (PO)'}
        </button>
        {poState.error && <span className="text-xs" style={{ color: '#dc2626' }}>{poState.error}</span>}
      </div>
    )
  })()

  const missingEnrichment = parsedPrItems.length > 0 && parsedPrItems.every(p => p.availableQty === undefined)

  const prReferenceSection = parsedPrItems.length > 0 ? (
    <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Vật tư cần mua ({compactPrItems.length}{!showAllPr && parsedPrItems.length !== compactPrItems.length ? `/${parsedPrItems.length}` : ''})
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Tìm vật tư..."
            value={prSearch}
            onChange={e => setPrSearch(e.target.value)}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)', width: 140 }}
          />
          <label className="text-xs flex items-center gap-1 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showAllPr} onChange={e => setShowAllPr(e.target.checked)} />
            Tất cả
          </label>
          <button
            onClick={handleReEnrich}
            disabled={enriching}
            className="px-2 py-1 rounded text-xs font-semibold"
            style={{ background: enriching ? '#94a3b8' : '#0284c7', color: '#fff' }}
          >
            {enriching ? '...' : 'Tính lại từ kho'}
          </button>
          {isEditable && (
            <button
              onClick={handleExportTemplate}
              className="px-2 py-1 rounded text-xs font-semibold"
              style={{ background: '#059669', color: '#fff' }}
            >
              Xuất mẫu BG cho NCC
            </button>
          )}
        </div>
      </div>
      {enrichMsg && <div className="text-xs mb-2" style={{ color: enrichMsg.startsWith('Đã') ? '#16a34a' : '#dc2626' }}>{enrichMsg}</div>}
      {missingEnrichment && <div className="text-xs mb-2" style={{ color: '#b45309' }}>Chưa tính tồn kho — nhấn &quot;Tính lại từ kho&quot;</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
              {['#', 'Mã Item', 'Mã vật tư', 'Chi tiết/Tên', 'Quy cách', 'Mác', 'ĐVT'].map(h => (
                <th key={h} className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
              {['SL cần mua', 'Tồn khả dụng'].map(h => (
                <th key={h} className="text-right px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Ngày cần</th>
            </tr>
          </thead>
          <tbody>
            {compactPrItems.map((p, i) => {
              const desc = p.description || p.materialName || p.name || ''
              const needToBuy = p.needToBuyQty ?? p.quantity ?? p.qty ?? 0
              const avail = typeof p.availableQty === 'number' ? p.availableQty : null
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: '#64748b' }}>{i + 1}</td>
                  <td className="px-2 py-1 font-mono text-xs" style={{ color: '#64748b' }}>{p.stt || p.code || p.materialCode || '—'}</td>
                  <td className="px-2 py-1 text-xs" style={{ color: p.canonicalCode ? '#1d4ed8' : '#94a3b8' }}>
                    {p.canonicalCode
                      ? <span className="font-mono">{p.canonicalCode}{!!(p as Record<string, unknown>).provisionalCode && <span className="ml-1 text-[10px] px-1 rounded" style={{ background: '#e0e7ff', color: '#3730a3' }}>tạm</span>}</span>
                      : <span style={{ fontStyle: 'italic' }}>—</span>}
                  </td>
                  <td className="px-2 py-1">{desc}</td>
                  <td className="px-2 py-1" style={{ color: '#64748b' }}>{p.profile || '—'}</td>
                  <td className="px-2 py-1" style={{ color: '#64748b' }}>{p.grade || '—'}</td>
                  <td className="px-2 py-1">{p.unit || p.uom || '—'}</td>
                  <td className="px-2 py-1 text-right font-semibold" style={{ color: needToBuy > 0 ? '#dc2626' : '#16a34a' }}>{needToBuy || '—'}</td>
                  <td className="px-2 py-1 text-right" style={{ color: avail !== null && avail > 0 ? '#16a34a' : '#94a3b8' }}>
                    {avail !== null ? avail : '—'}
                  </td>
                  <td className="px-2 py-1 text-xs" style={{ color: '#64748b' }}>{p.requiredDate || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  ) : null

  const warningLegend = quotes.length > 0 ? (
    <div className="flex flex-wrap gap-3 text-xs px-3 py-2 rounded-lg mt-2" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
      <span className="font-semibold" style={{ color: '#92400e' }}>Chú thích:</span>
      <span title="Dòng trong file báo giá NCC không khớp với dòng nào trong PR" style={{ color: '#f59e0b' }}>Dòng ngoài PR</span>
      <span title="Số dòng PR mà NCC này không có báo giá" style={{ color: '#f59e0b' }}>thiếu N dòng</span>
      <span title="NCC được chọn không phải là NCC có giá thấp nhất" style={{ color: '#dc2626' }}>không phải giá thấp nhất</span>
      <span title="Cần ít nhất 2 báo giá có giá để so sánh" style={{ color: '#f59e0b' }}>thiếu giá để so sánh</span>
    </div>
  ) : null

  // ── READ-ONLY REVIEW MODE ──
  if (!isEditable) {
    const chosenAmount = chosen ? sortKey(chosen) : 0
    const chosenNotMin = chosen && minAmount > 0 && chosenAmount > minAmount
    return (
      <div className="space-y-4">
        <NextStepBanner hasSelected={quotes.some(q => q.selected)} hasPo={!!poState.poCode} />
        {prReferenceSection}

        {quotes.length === 0 && (
          <div className="text-sm" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có báo giá NCC</div>
        )}

        {quotes.length > 0 && (
          <>
            {/* Banner */}
            {chosen ? (
              <div className="rounded-xl p-4" style={{ background: '#f0fdf4', border: '2px solid #22c55e' }}>
                <div className="text-sm font-bold" style={{ color: '#15803d' }}>
                  NCC được chọn: {chosen.vendorName}{chosen.vendorCode ? ` (${chosen.vendorCode})` : ''} — {fmt(chosenAmount, chosen.currency)}
                  {hasNeedToBuy && needToBuyTotals[chosen.id] && <span className="ml-1 font-normal text-xs" style={{ color: '#166534' }}>(sau VAT, phần cần mua)</span>}
                </div>
                {chosen.selectReason && <div className="text-xs mt-1" style={{ color: '#166534' }}>Lý do: {chosen.selectReason}</div>}
                {chosenNotMin && (
                  <div className="text-xs mt-1 px-2 py-1 rounded inline-block" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                    Không phải giá thấp nhất (thấp nhất: {fmt(minAmount, sorted[0]?.currency)})
                  </div>
                )}
                {sorted.length < 2 && (
                  <div className="text-xs mt-1 px-2 py-1 rounded inline-block" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                    Thiếu giá để so sánh (cần ít nhất 2 báo giá có giá)
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl p-4" style={{ background: '#fef3c7', border: '2px solid #fbbf24' }}>
                <div className="text-sm font-bold" style={{ color: '#92400e' }}>Chưa chọn NCC</div>
              </div>
            )}

            {/* Comparison table */}
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>So sánh báo giá ({sorted.length} NCC)</div>
              {sorted.length < 3 && (
                <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                  Chỉ có {sorted.length} báo giá (nên có ít nhất 3)
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
                    {['NCC', 'Ngày BG', hasNeedToBuy ? 'Tổng (sau VAT)' : 'Tổng tiền', 'Giao (ngày)', 'Điều kiện TT', 'File', 'Ghi chú'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {sorted.map(q => {
                      const qAmt = sortKey(q)
                      const isMin = qAmt === minAmount
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
                            {fmt(qAmt, q.currency)}
                            {isMin && <span className="ml-1" style={{ color: '#1d4ed8' }}>(thấp nhất)</span>}
                            {isSel && !isMin && <span className="ml-1" style={{ color: '#dc2626' }}>(không phải giá thấp nhất)</span>}
                            {hasNeedToBuy && needToBuyTotals[q.id] && q.totalAmount > 0 && q.totalAmount !== needToBuyTotals[q.id] && (
                              <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 400 }}>BG gốc: {fmt(q.totalAmount, q.currency)}</div>
                            )}
                            {hasNeedToBuy && needToBuyPreVat[q.id] && (
                              <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 400 }}>trước VAT: {fmt(needToBuyPreVat[q.id], q.currency)}</div>
                            )}
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

            {/* NCC detail panels (review mode) */}
            {quotes.some(q => q.lines && q.lines.length > 0) && (
              <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Chi tiết báo giá từng NCC</div>
                {quotes.filter(q => q.lines && q.lines.length > 0).map(q => (
                  <div key={q.id} className="mb-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>
                    <button type="button" onClick={() => toggleDetail(q.id)} className="w-full text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      {expandedDetails.has(q.id) ? '▾' : '▸'} {q.vendorName}: Chi tiết ({q.lines!.length} dòng)
                    </button>
                    {expandedDetails.has(q.id) && renderQuoteDetailTable(q.lines!, parsedPrItems)}
                  </div>
                ))}
              </div>
            )}

            {/* Quote coverage panel (review mode) */}
            <QuoteCoveragePanel quotes={quotes} prItems={parsedPrItems} />

            {/* Material matrix (review mode) */}
            <MaterialMatrix quotes={quotes} prItems={parsedPrItems} />

            {warningLegend}

            {poButton}
          </>
        )}
      </div>
    )
  }

  // ── EDITABLE MODE ──
  return (
    <div className="space-y-4">
      {/* Dải "Bước tiếp theo" — dẫn hướng R07 (mức 2) */}
      <NextStepBanner hasSelected={quotes.some(q => q.selected)} hasPo={!!poState.poCode} />
      {prReferenceSection}

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
              {((q.lines?.length ?? 0) > 0 || q.files.length > 0 || q.totalAmount > 0) && (
                <button onClick={() => resetQuoteData(q.id)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#b45309', border: '1px solid #fde68a', background: '#fffbeb' }}>
                  Xóa báo giá
                </button>
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
                Upload file báo giá Excel
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleParseQuoteFile(q.id, f); e.target.value = '' }} />
              </label>
              {parseStatus[q.id] === 'parsing' && <span className="text-xs" style={{ color: '#64748b' }}>Đang parse...</span>}
              {parseStatus[q.id] === 'empty' && <span className="text-xs" style={{ color: '#dc2626' }}>Không tìm thấy dòng báo giá</span>}
              {parseStatus[q.id] === 'error' && <span className="text-xs" style={{ color: '#dc2626' }}>Lỗi đọc file</span>}
              {parseStatus[q.id]?.startsWith('ok:') && <span className="text-xs" style={{ color: '#15803d' }}>✓ {parseStatus[q.id].split(':')[1]} dòng</span>}
            </div>
            {q.lines && q.lines.length > 0 && (
              <div className="mt-2">
                <div className="text-xs" style={{ color: '#64748b' }}>
                  {q.lines.filter(l => l.matchedPrIndex !== null).length}/{q.lines.length} dòng khớp PR
                  {q.lines.some(l => l.matchedPrIndex === null) && (
                    <span className="ml-2" style={{ color: '#f59e0b' }}>{q.lines.filter(l => l.matchedPrIndex === null).length} dòng ngoài PR</span>
                  )}
                  <button type="button" onClick={() => toggleDetail(q.id)} className="ml-2 underline" style={{ color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' }}>
                    {expandedDetails.has(q.id) ? 'Ẩn chi tiết' : `Chi tiết (${q.lines.length} dòng)`}
                  </button>
                </div>
                {expandedDetails.has(q.id) && renderQuoteDetailTable(q.lines!, parsedPrItems)}
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

      <div className="flex items-center gap-3">
        <button onClick={addRow} className="flex-1 text-sm py-2.5 rounded-xl font-semibold" style={{ border: '2px dashed var(--border)', color: '#1d4ed8', background: 'none', cursor: 'pointer' }}>
          + Thêm nhà cung cấp
        </button>
        {quotes.some(q => (q.lines?.length ?? 0) > 0 || q.totalAmount > 0) && (
          <button onClick={resetAllQuotes} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: '#dc2626', border: '1px solid #fecaca', background: '#fef2f2' }}>
            Xóa toàn bộ báo giá
          </button>
        )}
      </div>

      {/* C: Comparison */}
      {quotes.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>So sánh báo giá</div>
          {sorted.length < 2 && (
            <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
              Thiếu giá để so sánh (cần ít nhất 2 báo giá có giá)
            </div>
          )}
          {sorted.length >= 2 && sorted.length < 3 && (
            <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
              Nên có ít nhất 3 báo giá để so sánh
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
                {['NCC', hasNeedToBuy ? 'Tổng (sau VAT)' : 'Tổng tiền', 'Giao (ngày)', 'Thanh toán', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sorted.map(q => {
                  const qAmt = sortKey(q)
                  const isMin = qAmt === minAmount
                  const isSel = q.selected
                  return (
                    <tr key={q.id} style={{ borderTop: '1px solid var(--border)', background: isSel ? '#f0fdf4' : isMin ? '#eff6ff' : undefined }}>
                      <td className="px-3 py-2 font-semibold">
                        {isSel && <span style={{ color: '#f59e0b' }}>★ </span>}
                        {q.vendorName || '—'}
                        {q.vendorCode && <span className="ml-1" style={{ color: '#64748b' }}>({q.vendorCode})</span>}
                      </td>
                      <td className="px-3 py-2 font-bold" style={{ color: isMin ? '#1d4ed8' : 'var(--text-primary)' }}>
                        {fmt(qAmt, q.currency)}
                        {isMin && <span className="ml-1 text-xs" style={{ color: '#1d4ed8' }}>(thấp nhất)</span>}
                        {hasNeedToBuy && needToBuyTotals[q.id] && q.totalAmount > 0 && q.totalAmount !== needToBuyTotals[q.id] && (
                          <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 400 }}>BG gốc: {fmt(q.totalAmount, q.currency)}</div>
                        )}
                        {hasNeedToBuy && needToBuyPreVat[q.id] && (
                          <div style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 400 }}>trước VAT: {fmt(needToBuyPreVat[q.id], q.currency)}</div>
                        )}
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

      {/* D: Quote coverage panel */}
      <QuoteCoveragePanel quotes={quotes} prItems={parsedPrItems} />

      {/* D: Material comparison matrix */}
      <MaterialMatrix quotes={quotes} prItems={parsedPrItems} />

      {warningLegend}

      {poButton}

      {canEditQuote && quotes.length === 0 && (
        <div className="text-center py-6 rounded-xl" style={{ background: '#f0f9ff', border: '2px dashed #93c5fd' }}>
          <div className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>Bắt đầu tìm nhà cung cấp</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>Nhấn &quot;+ Thêm nhà cung cấp&quot; để thêm báo giá</div>
        </div>
      )}
    </div>
  )
}

// ── Helper: Quote detail table ──
function renderQuoteDetailTable(lines: QuoteLine[], prItems: PrItem[]) {
  if (lines.length === 0) return null
  const totalPre = lines.reduce((s, l) => s + l.amount, 0)
  const totalVatAmt = lines.reduce((s, l) => s + l.amount * ((l.vatPercent ?? 10) / 100), 0)
  const totalAfter = totalPre + totalVatAmt
  const vatRates = new Set(lines.map(l => l.vatPercent ?? 10))
  const mismatches = computeQtyMismatches(lines, prItems)
  const mismatchSet = new Set(mismatches.map(m => m.lineIndex))
  const matchedCount = lines.filter(l => l.matchedPrIndex != null).length
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {['Mã Item', 'Mã vật tư', 'Tên/Quy cách', 'ĐVT', 'SL (NCC)', 'SL cần (PR)', 'Đơn giá', 'Thành tiền', '%VAT', 'Sau VAT'].map(h => (
              <th key={h} className="text-left px-2 py-1 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, li) => {
            const vat = l.vatPercent ?? 10
            const afterVat = l.amount * (1 + vat / 100)
            const matchedPr = l.matchedPrIndex != null ? prItems[l.matchedPrIndex] : null
            const prNeed = matchedPr && typeof matchedPr.needToBuyQty === 'number' ? matchedPr.needToBuyQty : null
            const mm = mismatchSet.has(li) ? mismatches.find(m => m.lineIndex === li) : null
            return (
              <tr key={li} style={{ borderTop: '1px solid var(--border)', background: l.matchedPrIndex === null ? '#fffbeb' : undefined }}>
                <td className="px-2 py-1 font-mono">{l.code}{l.matchedPrIndex === null && <span className="ml-1" style={{ fontSize: '0.55rem', color: '#f59e0b' }}>ngoài PR</span>}</td>
                <td className="px-2 py-1 font-mono">{matchedPr?.canonicalCode ? <>{matchedPr.canonicalCode}{!!(matchedPr as Record<string, unknown>).provisionalCode && <span className="ml-1" style={{ fontSize: '0.55rem', background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '0 3px' }}>tạm</span>}</> : '—'}</td>
                <td className="px-2 py-1">{l.description}{l.profile ? ` ${l.profile}` : ''}</td>
                <td className="px-2 py-1">{l.unit}</td>
                <td className="px-2 py-1 text-right">{l.qty}{mm && <span className="ml-1" style={{ fontSize: '0.55rem', color: '#f59e0b' }}>{mm.delta > 0 ? `dư ${mm.delta}` : `thiếu ${Math.abs(mm.delta)}`}</span>}</td>
                <td className="px-2 py-1 text-right">{prNeed != null ? prNeed : '—'}</td>
                <td className="px-2 py-1 text-right">{formatNumber(l.unitPrice)}</td>
                <td className="px-2 py-1 text-right">{formatCurrency(Math.round(l.amount))}</td>
                <td className="px-2 py-1 text-center">{vat}%</td>
                <td className="px-2 py-1 text-right font-semibold">{formatCurrency(Math.round(afterVat))}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
            <td colSpan={7} className="px-2 py-1.5 text-right">
              TỔNG CỘNG:
              <span className="ml-2 font-normal" style={{ fontSize: '0.6rem', color: '#64748b' }}>
                {matchedCount}/{lines.length} dòng khớp PR
                {mismatches.length > 0 && <span style={{ color: '#f59e0b' }}> · {mismatches.length} dòng lệch SL</span>}
              </span>
            </td>
            <td className="px-2 py-1.5 text-right">{formatCurrency(Math.round(totalPre))}</td>
            <td className="px-2 py-1.5 text-center">{vatRates.size === 1 ? `${[...vatRates][0]}%` : 'hỗn hợp'}</td>
            <td className="px-2 py-1.5 text-right" style={{ color: '#1d4ed8' }}>{formatCurrency(Math.round(totalAfter))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Sub-component: Quote coverage panel ──
function QuoteCoveragePanel({ quotes, prItems }: { quotes: SupplierQuote[]; prItems: PrItem[] }) {
  const [showMissing, setShowMissing] = useState(false)
  const quotesWithLines = quotes.filter(q => q.lines && q.lines.length > 0)
  const coverage = useMemo(() => computeQuoteCoverage(prItems, quotesWithLines), [prItems, quotesWithLines])
  if (coverage.totalNeedToBuy === 0) return null

  const isFull = coverage.coveragePercent === 100
  const missingCount = coverage.missingItems.length
  const fewVendors = Object.entries(coverage.perItemVendorCount).filter(([, c]) => c === 1).length

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: `1px solid ${isFull ? '#86efac' : '#fde68a'}` }}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Độ phủ báo giá: {coverage.coveredCount}/{coverage.totalNeedToBuy} món ({coverage.coveragePercent}%)
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${coverage.coveragePercent}%`, borderRadius: 3, background: isFull ? '#22c55e' : '#f59e0b', transition: 'width 0.3s' }} />
      </div>
      {isFull ? (
        <div className="mt-2 text-xs" style={{ color: '#166534' }}>Đã đủ báo giá 100% vật tư cần mua</div>
      ) : (
        <div className="mt-2">
          <div className="text-xs" style={{ color: '#92400e' }}>
            Còn thiếu {missingCount} món chưa có báo giá
            <button type="button" onClick={() => setShowMissing(!showMissing)} className="ml-2 underline" style={{ color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' }}>
              {showMissing ? 'Ẩn' : 'Xem danh sách'}
            </button>
          </div>
          {showMissing && (
            <div className="mt-2 overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#fef3c7' }}>
                  {['Mã Item', 'Mã vật tư', 'Tên', 'SL cần'].map(h => (
                    <th key={h} className="text-left px-2 py-1 font-semibold" style={{ color: '#92400e' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {coverage.missingItems.map(m => (
                    <tr key={m.index} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-2 py-1 font-mono">{m.stt || '—'}</td>
                      <td className="px-2 py-1 font-mono">{m.canonicalCode || '—'}</td>
                      <td className="px-2 py-1">{m.description}</td>
                      <td className="px-2 py-1 text-right">{m.needToBuyQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {fewVendors > 0 && (
        <div className="mt-1 text-xs" style={{ color: '#64748b' }}>
          {fewVendors} món chỉ có 1 NCC báo giá — nên có ≥2-3 NCC để so sánh
        </div>
      )}
    </div>
  )
}

// ── Sub-component: Material comparison matrix ──
function MaterialMatrix({ quotes, prItems }: { quotes: SupplierQuote[]; prItems: PrItem[] }) {
  const quotesWithLines = quotes.filter(q => q.lines && q.lines.length > 0)
  if (quotesWithLines.length === 0 || prItems.length === 0) return null

  const hasBreakdown = prItems.some(p => typeof p.needToBuyQty === 'number' || (p.quantity ?? 0) > 0)

  type PriceInfo = { unitPrice: number; vatPct: number }
  type Row = { prIdx: number; stt: string; code: string; desc: string; profile: string; unit: string; qty: number; needToBuy: number; prices: Record<string, PriceInfo> }

  const allRows: Row[] = []
  const extraRows: { quoteId: string; vendorName: string; line: QuoteLine }[] = []

  for (let pi = 0; pi < prItems.length; pi++) {
    const p = prItems[pi]
    const prices: Record<string, PriceInfo> = {}
    for (const q of quotesWithLines) {
      const match = q.lines!.find(l => l.matchedPrIndex === pi)
      if (match) prices[q.id] = { unitPrice: match.unitPrice, vatPct: match.vatPercent ?? 10 }
    }
    allRows.push({
      prIdx: pi,
      stt: p.stt || p.code || p.materialCode || '',
      code: p.canonicalCode || '',
      desc: p.description || p.materialName || p.name || '',
      profile: p.profile || '',
      unit: p.unit || p.uom || '',
      qty: p.quantity || p.qty || 0,
      needToBuy: typeof p.needToBuyQty === 'number' ? p.needToBuyQty : (p.quantity || p.qty || 0),
      prices,
    })
  }

  const rows = hasBreakdown ? allRows.filter(r => r.needToBuy > 0) : allRows
  const skippedCount = allRows.length - rows.length

  for (const q of quotesWithLines) {
    for (const l of q.lines!) {
      if (l.matchedPrIndex === null) {
        extraRows.push({ quoteId: q.id, vendorName: q.vendorName, line: l })
      }
    }
  }

  const avPrice = (p: PriceInfo) => p.unitPrice * (1 + p.vatPct / 100)

  // Coverage per NCC
  const coverage: Record<string, { covered: number; total: number; full: boolean }> = {}
  for (const q of quotesWithLines) {
    const covered = rows.filter(r => r.prices[q.id]?.unitPrice > 0).length
    coverage[q.id] = { covered, total: rows.length, full: covered === rows.length }
  }

  // Totals per NCC (after VAT)
  const nccTotals: Record<string, number> = {}
  const nccTotalsPreVat: Record<string, number> = {}
  for (const q of quotesWithLines) {
    let total = 0, totalPre = 0
    for (const r of rows) {
      const p = r.prices[q.id]
      if (p && p.unitPrice > 0) {
        totalPre += r.needToBuy * p.unitPrice
        total += r.needToBuy * avPrice(p)
      }
    }
    nccTotals[q.id] = Math.round(total)
    nccTotalsPreVat[q.id] = Math.round(totalPre)
  }

  // Cheapest trọn gói (full coverage only)
  let cheapestFullId = ''
  let cheapestFullTotal = Infinity
  for (const [qid, total] of Object.entries(nccTotals)) {
    if (coverage[qid]?.full && total > 0 && total < cheapestFullTotal) {
      cheapestFullTotal = total
      cheapestFullId = qid
    }
  }

  // Split-cheapest: per item, pick cheapest NCC (after VAT)
  let splitTotal = 0
  const splitWinners: Record<number, string> = {}
  for (const r of rows) {
    let bestQId = ''
    let bestAv = Infinity
    for (const [qId, p] of Object.entries(r.prices)) {
      if (p.unitPrice <= 0) continue
      const av = avPrice(p)
      if (av < bestAv) { bestAv = av; bestQId = qId }
    }
    if (bestQId) {
      splitWinners[r.prIdx] = bestQId
      splitTotal += bestAv * r.needToBuy
    }
  }
  splitTotal = Math.round(splitTotal)
  const savings = cheapestFullId ? cheapestFullTotal - splitTotal : 0

  // VAT consistency check
  const allVatRates = new Set<number>()
  for (const q of quotesWithLines) {
    for (const r of rows) {
      const p = r.prices[q.id]
      if (p) allVatRates.add(p.vatPct)
    }
  }
  const vatMismatch = allVatRates.size > 1

  return (
    <div className="rounded-xl p-4 mt-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        So sánh theo vật tư ({rows.length} dòng cần mua × {quotesWithLines.length} NCC)
        {hasBreakdown && <span className="ml-1 font-normal" style={{ color: '#64748b' }}>(giá sau VAT)</span>}
      </div>

      {vatMismatch && (
        <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
          Các NCC có %VAT khác nhau ({[...allVatRates].sort().join('%, ')}%) — kiểm tra lại
        </div>
      )}

      {/* Coverage per NCC */}
      <div className="flex flex-wrap gap-2 mb-2">
        {quotesWithLines.map(q => (
          <span key={q.id} className="text-xs px-2 py-1 rounded" style={{
            background: coverage[q.id]?.full ? '#dcfce7' : '#fef3c7',
            color: coverage[q.id]?.full ? '#166534' : '#92400e',
            border: `1px solid ${coverage[q.id]?.full ? '#86efac' : '#fde68a'}`,
          }}>
            {q.vendorName}: {coverage[q.id]?.covered}/{coverage[q.id]?.total} món
            {coverage[q.id]?.full ? ' ✓' : ` (thiếu ${(coverage[q.id]?.total ?? 0) - (coverage[q.id]?.covered ?? 0)})`}
          </span>
        ))}
      </div>

      {skippedCount > 0 && (
        <div className="text-xs mb-2 px-2 py-1.5 rounded-lg inline-block" style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>
          ✓ {skippedCount} vật tư đủ kho (không cần mua)
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-hover, #f1f5f9)' }}>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 50 }}>Mã Item</th>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 50 }}>Mã VT</th>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 120 }}>Vật tư</th>
              <th className="text-left px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 60 }}>ĐVT</th>
              <th className="text-right px-2 py-1.5 font-semibold" style={{ color: 'var(--text-muted)', minWidth: 50 }}>{hasBreakdown ? 'Cần mua' : 'SL'}</th>
              {quotesWithLines.map(q => (
                <th key={q.id} className="text-right px-2 py-1.5 font-semibold" style={{ color: q.selected ? '#15803d' : 'var(--text-muted)', minWidth: 120 }}>
                  {q.selected && '★ '}{q.vendorName || '—'}
                  <div style={{ fontSize: '0.55rem', fontWeight: 400, color: coverage[q.id]?.full ? '#16a34a' : '#f59e0b' }}>
                    {coverage[q.id]?.covered}/{coverage[q.id]?.total} món
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const priceEntries = Object.entries(r.prices).filter(([, p]) => p.unitPrice > 0)
              const minAv = priceEntries.length > 0 ? Math.min(...priceEntries.map(([, p]) => avPrice(p))) : 0
              return (
                <tr key={ri} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono text-xs" style={{ color: '#64748b' }}>{r.stt || (ri + 1)}</td>
                  <td className="px-2 py-1 font-mono text-xs" style={{ color: r.code ? '#1d4ed8' : '#94a3b8' }}>{r.code || '—'}</td>
                  <td className="px-2 py-1">
                    {r.desc}{r.profile ? <span className="ml-1" style={{ color: '#64748b' }}>{r.profile}</span> : ''}
                  </td>
                  <td className="px-2 py-1">{r.unit || '—'}</td>
                  <td className="px-2 py-1 text-right font-semibold">{r.needToBuy || '—'}</td>
                  {quotesWithLines.map(q => {
                    const p = r.prices[q.id]
                    const av = p ? avPrice(p) : 0
                    const isMin = p && p.unitPrice > 0 && Math.abs(av - minAv) < 0.01
                    const isSplit = splitWinners[r.prIdx] === q.id
                    const lineTotal = p ? r.needToBuy * av : 0
                    return (
                      <td key={q.id} className="px-2 py-1 text-right"
                        style={{ color: !p ? '#94a3b8' : isMin ? '#1d4ed8' : 'var(--text-primary)', background: isMin ? '#eff6ff' : undefined }}>
                        {p ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: isMin ? 700 : 400 }}>
                              {formatNumber(Math.round(av))}
                              {isSplit && quotesWithLines.length >= 2 && <span style={{ fontSize: '0.55rem', color: '#16a34a', marginLeft: 2 }}>★</span>}
                            </span>
                            <span style={{ fontSize: '0.6rem', color: '#64748b' }}>{formatCurrency(Math.round(lineTotal))}</span>
                            {p.vatPct !== 10 && <span style={{ fontSize: '0.55rem', color: '#94a3b8' }}>VAT {p.vatPct}%</span>}
                          </div>
                        ) : '—'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {/* Totals row */}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td className="px-2 py-1.5" colSpan={4} style={{ color: 'var(--text-primary)' }}>
                Tổng {hasBreakdown ? '(sau VAT)' : ''}
              </td>
              {quotesWithLines.map(q => {
                const total = nccTotals[q.id] || 0
                const totalPre = nccTotalsPreVat[q.id] || 0
                const cov = coverage[q.id]
                const isCheapestFull = q.id === cheapestFullId
                return (
                  <td key={q.id} className="px-2 py-1.5 text-right font-mono"
                    style={{ color: isCheapestFull ? '#1d4ed8' : 'var(--text-primary)', background: isCheapestFull ? '#eff6ff' : undefined }}>
                    {formatCurrency(total)}
                    {isCheapestFull && cov?.full && <span className="ml-1" style={{ fontSize: '0.65rem' }}>(trọn gói rẻ nhất)</span>}
                    {!cov?.full && <div style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: 400 }}>thiếu {(cov?.total ?? 0) - (cov?.covered ?? 0)} món</div>}
                    {totalPre !== total && <div style={{ fontSize: '0.55rem', color: '#94a3b8', fontWeight: 400 }}>trước VAT: {formatCurrency(totalPre)}</div>}
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
          <div className="text-xs font-semibold mb-1" style={{ color: '#f59e0b' }}>Dòng ngoài PR ({extraRows.length})</div>
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

      {/* Khuyến nghị */}
      {rows.length > 0 && quotesWithLines.length >= 2 && (
        <div className="mt-3 p-3 rounded-lg" style={{ background: '#f0f9ff', border: '1px solid #93c5fd' }}>
          <div className="text-xs font-semibold mb-2" style={{ color: '#1d4ed8' }}>Khuyến nghị</div>
          {cheapestFullId ? (
            <>
              <div className="text-xs mb-1">
                <span className="font-semibold">Trọn gói rẻ nhất:</span>{' '}
                {quotesWithLines.find(q => q.id === cheapestFullId)?.vendorName} — {formatCurrency(cheapestFullTotal)}
                <span className="ml-1" style={{ color: '#64748b' }}>(sau VAT, phần còn phải mua)</span>
              </div>
              <div className="text-xs mb-1">
                <span className="font-semibold">Tách món rẻ nhất:</span> {formatCurrency(splitTotal)}
                <span className="ml-1" style={{ color: '#64748b' }}>(chọn NCC rẻ nhất mỗi món, ★ trong bảng)</span>
              </div>
              {savings > 0 && (
                <div className="text-xs" style={{ color: '#16a34a' }}>
                  ↓ Tiết kiệm {formatCurrency(savings)} ({Math.round(savings / cheapestFullTotal * 100)}%) nếu tách mua từ nhiều NCC
                </div>
              )}
              {savings <= 0 && (
                <div className="text-xs" style={{ color: '#64748b' }}>
                  Trọn gói = tách món (cùng NCC rẻ nhất toàn bộ)
                </div>
              )}
            </>
          ) : (
            <div className="text-xs" style={{ color: '#92400e' }}>
              Chưa có NCC phủ đủ {rows.length} món — không so sánh trọn gói được.
              {splitTotal > 0 && <span className="ml-1">Tách món rẻ nhất: {formatCurrency(splitTotal)}</span>}
            </div>
          )}
        </div>
      )}
      {quotesWithLines.length < 2 && (
        <div className="mt-3 text-xs px-2 py-1.5 rounded-lg" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
          Thiếu giá để so sánh (cần ít nhất 2 NCC có báo giá)
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
        <a key={f.id} href="#" onClick={(e) => { e.preventDefault(); openAuthedFile(f.id, f.fileName) }}
          className="text-xs hover:underline" style={{ color: '#1d4ed8', cursor: 'pointer' }}>
          {f.kind !== 'Khác' ? `[${f.kind}] ` : ''}{f.fileName.length > 25 ? f.fileName.slice(0, 22) + '...' : f.fileName}
        </a>
      ))}
    </div>
  )
}
