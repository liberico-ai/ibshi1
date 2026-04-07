'use client'
import React, { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

// ── Types ──────────────────────────────────────────────────

export interface PrMaterialItem {
  stt: string           // e.g. I104-VTC01-001
  description: string   // e.g. THÉP HÌNH C
  profile: string       // e.g. C100X50X5X7.5-12000L
  grade: string         // e.g. SS400
  unit: string          // m, m2, cái, bộ, kg, etc.
  unitWeight: number    // kg per unit
  quantity: number      // ordered quantity
  weight: number        // total weight (kg)
  category: string      // e.g. VTC01, VTC03, VPK, VDK
  categoryName: string  // e.g. "Vật tư chính thép đen"
}

interface InventoryItem {
  id: string
  materialCode: string
  name: string
  unit: string
  specification: string | null
  currentStock: number
  category: string
}

interface StockMatch {
  inventoryId: string | null
  inventoryCode: string | null
  inventoryName: string | null
  currentStock: number
  matched: boolean
}

// ── Props ──────────────────────────────────────────────────

interface BomPrUploadUIProps {
  isEditable: boolean
  bomPrData: string | undefined  // JSON string of PrMaterialItem[]
  onChange: (val: string) => void
  projectCode?: string
}

// ── Helpers ────────────────────────────────────────────────

function isCategoryRow(stt: string, unit: string | undefined): boolean {
  if (!stt) return false
  // Category rows have no unit and their STT is like "VTC01", "I104-VTC01", "I104-VPK"
  if (unit && unit.trim()) return false
  // Matches: A., B., or codes ending without -NNN suffix
  if (/^[A-Z]\.$/.test(stt.trim())) return true
  // Matches codes like VTC01, I104-VTC01 (no trailing -NNN)
  if (/^[A-Z0-9-]+-[A-Z]+\d{2}$/.test(stt.trim())) return true
  if (/^[A-Z]+\d{2}$/.test(stt.trim())) return true
  return false
}

function isFooterRow(stt: string): boolean {
  const lower = (stt || '').toLowerCase().trim()
  return ['priority', 'remarks', 'assign', 'purpose', 'for in-house', 'lost', 'consumables', 'name/', 'position/', 'signature/', 'date/'].some(k => lower.startsWith(k))
}

function extractCategory(stt: string): string {
  // I104-VTC01-001 → VTC01, I104-VPK-023 → VPK, I104-VDK-005 → VDK
  const parts = stt.split('-')
  if (parts.length >= 3) return parts[parts.length - 2]
  if (parts.length === 2) return parts[0]
  return 'OTHER'
}

const CATEGORY_LABELS: Record<string, string> = {
  VTC01: 'Vật tư chính — Thép đen',
  VTC02: 'Vật tư chính — Khác',
  VTC03: 'Vật tư Grating',
  VTC04: 'Vật tư bảo ôn (Insulation)',
  VPK: 'Bu lông, đai ốc, phụ kiện',
  VDK: 'Vật tư đóng kiện',
}

function fmtNum(n: number, decimals = 1): string {
  if (n === 0) return '0'
  if (n >= 1000) return n.toLocaleString('vi-VN', { maximumFractionDigits: decimals })
  return n.toFixed(decimals)
}

// ── Parse PR Excel ─────────────────────────────────────────

function parsePrExcel(data: any[][]): PrMaterialItem[] {
  // Find header row: look for "Item" or "STT" in first column
  let headerIdx = -1
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const cell = String(data[i]?.[0] || '').toLowerCase()
    if (cell.includes('item') || cell.includes('stt')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return []

  // Check if next row is sub-header (Q.Ty / Weight)
  const subHeader = data[headerIdx + 1]
  const hasSubHeader = subHeader && String(subHeader[6] || '').toLowerCase().includes('q.ty')
  const dataStartIdx = hasSubHeader ? headerIdx + 2 : headerIdx + 1

  // Skip number-only rows (like row [1,2,3,4,...])
  let actualStart = dataStartIdx
  if (data[actualStart]) {
    const firstCell = data[actualStart][0]
    if (typeof firstCell === 'number' && firstCell === 1 && typeof data[actualStart][1] === 'number') {
      actualStart++
    }
  }

  // Determine which columns hold "current ordered" qty & weight
  // Standard format: col 6-7 = net, 8-9 = previous, 10-11 = current, 12-13 = total
  // Some files: col 10-11 = current rev0, 12-13 = current this rev
  // Strategy: prefer col 10 (current ordered qty), fallback to col 6 (net qty)
  const items: PrMaterialItem[] = []
  let currentCategory = ''
  let currentCategoryName = ''

  for (let i = actualStart; i < data.length; i++) {
    const row = data[i]
    if (!row || row.every((c: any) => c == null || c === '')) continue

    const stt = String(row[0] || '').trim()
    if (!stt) continue
    if (isFooterRow(stt)) break

    const description = String(row[1] || '').trim()
    const profile = String(row[2] || '').trim()
    const grade = String(row[3] || '').trim()
    const unit = String(row[4] || '').trim()
    const unitWeight = Number(row[5]) || 0

    // Detect category header rows
    if (isCategoryRow(stt, unit)) {
      currentCategory = extractCategory(stt)
      currentCategoryName = description || currentCategory
      continue
    }

    // Get quantity: prefer "current ordered" (col 10), then "total ordered" (col 12), then "net" (col 6)
    let qty = Number(row[10]) || 0
    let wt = Number(row[11]) || 0
    if (qty === 0) {
      qty = Number(row[12]) || Number(row[6]) || 0
      wt = Number(row[13]) || Number(row[7]) || 0
    }
    if (qty === 0 && wt === 0) continue // skip empty rows

    const cat = currentCategory || extractCategory(stt)

    items.push({
      stt,
      description,
      profile,
      grade,
      unit: unit.toLowerCase(),
      unitWeight,
      quantity: Math.round(qty * 1000) / 1000,
      weight: Math.round(wt * 100) / 100,
      category: cat,
      categoryName: currentCategoryName || CATEGORY_LABELS[cat] || cat,
    })
  }

  return items
}

// ── Match with inventory ───────────────────────────────────

function matchInventory(items: PrMaterialItem[], inventory: InventoryItem[]): Map<number, StockMatch> {
  const matches = new Map<number, StockMatch>()

  for (let i = 0; i < items.length; i++) {
    const pr = items[i]
    const noMatch: StockMatch = { inventoryId: null, inventoryCode: null, inventoryName: null, currentStock: 0, matched: false }

    // Strategy 1: exact materialCode match on profile
    let inv = inventory.find(m =>
      m.specification?.trim().toLowerCase() === pr.profile.toLowerCase() &&
      m.unit.toLowerCase() === pr.unit.toLowerCase()
    )
    // Strategy 2: materialCode contains profile key parts
    if (!inv && pr.profile) {
      const profileKey = pr.profile.split('-')[0].toLowerCase() // e.g. C100X50X5X7.5
      inv = inventory.find(m =>
        (m.specification || '').toLowerCase().includes(profileKey) ||
        m.name.toLowerCase().includes(profileKey)
      )
    }
    // Strategy 3: name similarity
    if (!inv && pr.description) {
      const descLower = pr.description.toLowerCase()
      inv = inventory.find(m =>
        m.name.toLowerCase() === descLower ||
        (m.name.toLowerCase().includes(descLower) && m.unit.toLowerCase() === pr.unit.toLowerCase())
      )
    }

    if (inv) {
      matches.set(i, {
        inventoryId: inv.id,
        inventoryCode: inv.materialCode,
        inventoryName: inv.name,
        currentStock: Number(inv.currentStock),
        matched: true,
      })
    } else {
      matches.set(i, noMatch)
    }
  }

  return matches
}

// ══════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════

export default function BomPrUploadUI({ isEditable, bomPrData, onChange, projectCode }: BomPrUploadUIProps) {
  // Parse stored data
  let items: PrMaterialItem[] = []
  try {
    items = bomPrData ? JSON.parse(bomPrData) : []
  } catch { items = [] }

  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [stockMatches, setStockMatches] = useState<Map<number, StockMatch>>(new Map())
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)

  // Fetch inventory on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/materials?t=${Date.now()}`)
        const json = await res.json()
        if (json.ok && json.materials) setInventory(json.materials)
      } catch { /* ignore */ }
    })()
  }, [])

  // Re-match when items or inventory change
  useEffect(() => {
    if (items.length > 0 && inventory.length > 0) {
      setStockMatches(matchInventory(items, inventory))
    }
  }, [items.length, inventory.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand all categories on first load
  useEffect(() => {
    if (items.length > 0 && expandedCats.size === 0) {
      const cats = new Set(items.map(i => i.category))
      setExpandedCats(cats)
    }
  }, [items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Import handler ────────────────────────────────────────
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      setUploading(true)
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, { type: 'binary' })
          // Try "PR" sheet first, then last sheet, then first sheet
          const sheetName = wb.SheetNames.includes('PR')
            ? 'PR'
            : wb.SheetNames[wb.SheetNames.length - 1]
          const ws = wb.Sheets[sheetName]
          const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 })
          const parsed = parsePrExcel(data)
          if (parsed.length > 0) {
            onChange(JSON.stringify(parsed))
            // Expand all categories
            setExpandedCats(new Set(parsed.map(i => i.category)))
          }
        } catch (err) {
          console.error('PR Excel parse error:', err)
        }
        setUploading(false)
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }, [onChange])

  // ── Export handler ────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (items.length === 0) return
    const headers = ['STT', 'Mã VT', 'Chi tiết', 'Vật tư (Profile)', 'Mác VL', 'ĐVT', 'Đ.Trọng', 'Số lượng', 'Khối lượng (Kg)', 'Nhóm', 'Tồn kho', 'Trạng thái']
    const rows = items.map((m, idx) => {
      const match = stockMatches.get(idx)
      return [
        m.stt, m.description, m.profile, m.grade, m.unit, m.unitWeight || '',
        m.quantity, m.weight, m.category,
        match?.matched ? match.currentStock : 0,
        match?.matched ? 'Có trong kho' : 'Cần mua',
      ]
    })
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 25 }, { wch: 35 }, { wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BOM-PR')
    XLSX.writeFile(wb, `BOM-PR_${projectCode || 'P2.1'}.xlsx`)
  }, [items, stockMatches, projectCode])

  // ── Remove data ───────────────────────────────────────────
  const handleClear = useCallback(() => {
    onChange('')
    setStockMatches(new Map())
    setExpandedCats(new Set())
  }, [onChange])

  // ── Summary calculations ──────────────────────────────────
  const categories = [...new Set(items.map(i => i.category))]
  const totalTypes = items.length
  const totalWeight = items.reduce((s, i) => s + (i.weight || 0), 0)
  const matchedItems = items.filter((_, idx) => stockMatches.get(idx)?.matched)
  const matchedTypes = matchedItems.length
  const matchedStock = matchedItems.reduce((s, item, _) => {
    const idx = items.indexOf(item)
    const match = stockMatches.get(idx)
    return s + (match?.currentStock || 0)
  }, 0)
  const unmatchedTypes = totalTypes - matchedTypes
  const needToBuyWeight = items.reduce((s, item, _) => {
    const idx = items.indexOf(item)
    const match = stockMatches.get(idx)
    if (!match?.matched) return s + (item.weight || 0)
    return s
  }, 0)

  // ── Filter by search ──────────────────────────────────────
  const searchLower = search.toLowerCase().trim()
  const filteredItems = searchLower
    ? items.filter(i =>
        i.stt.toLowerCase().includes(searchLower) ||
        i.description.toLowerCase().includes(searchLower) ||
        i.profile.toLowerCase().includes(searchLower) ||
        i.grade.toLowerCase().includes(searchLower)
      )
    : items

  // ── Toggle category ───────────────────────────────────────
  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  // ── Empty state: show upload prompt ───────────────────────
  if (items.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', marginTop: '1rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 12 }}>📐</div>
        <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', color: 'var(--text-heading)' }}>
          Đề nghị mua vật tư (PR) — Thiết kế
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 20, maxWidth: 500, margin: '0 auto 20px' }}>
          Upload file PR Excel từ phòng Thiết kế (biểu mẫu ENG-001). Hệ thống sẽ tự động phân tích danh sách vật tư, so khớp với tồn kho hiện trường.
        </p>
        {isEditable ? (
          <button type="button" onClick={handleImport} disabled={uploading}
            style={{ padding: '12px 32px', fontSize: '1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? '...Đang xử lý' : '📤 Upload file PR Excel'}
          </button>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu PR.</div>
        )}
      </div>
    )
  }

  // ── Has data: show summary + detail ───────────────────────
  return (
    <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
      {/* ── Header ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-heading)' }}>
          📐 Đề nghị mua vật tư (PR) — Thiết kế
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
            {totalTypes} loại VT
          </span>
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={handleExport}
            style={{ padding: '6px 14px', fontSize: '0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            📥 Export
          </button>
          {isEditable && (
            <>
              <button type="button" onClick={handleImport} disabled={uploading}
                style={{ padding: '6px 14px', fontSize: '0.8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                📤 Upload lại
              </button>
              <button type="button" onClick={handleClear}
                style={{ padding: '6px 14px', fontSize: '0.8rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Xóa
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Summary Cards ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {/* Card 1: Total types */}
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '1px solid #93c5fd' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Loại VT cần mua</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1e40af', marginTop: 2 }}>{totalTypes}</div>
          <div style={{ fontSize: '0.75rem', color: '#3b82f6' }}>{fmtNum(totalWeight, 0)} kg tổng KL</div>
        </div>
        {/* Card 2: Matched in stock */}
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #86efac' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Khớp tồn kho</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#166534', marginTop: 2 }}>{matchedTypes}</div>
          <div style={{ fontSize: '0.75rem', color: '#22c55e' }}>{fmtNum(matchedStock, 0)} đơn vị có sẵn</div>
        </div>
        {/* Card 3: Need to buy */}
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #fef2f2, #fde8e8)', border: '1px solid #fca5a5' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chưa có trong kho</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#991b1b', marginTop: 2 }}>{unmatchedTypes}</div>
          <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>{fmtNum(needToBuyWeight, 0)} kg cần mua</div>
        </div>
        {/* Card 4: Categories */}
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)', border: '1px solid #d8b4fe' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#7e22ce', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nhóm vật tư</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#6b21a8', marginTop: 2 }}>{categories.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#a855f7' }}>{categories.join(', ')}</div>
        </div>
      </div>

      {/* ── Search ────────────────────────────────────────── */}
      <div style={{ marginBottom: 16, position: 'relative' }}>
        <input type="text" className="input" placeholder="Tìm kiếm mã VT, tên, profile, mác VL..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: 400, fontSize: '0.85rem', padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid var(--border)' }} />
        <span style={{ position: 'absolute', left: 10, top: 9, fontSize: '0.85rem', color: 'var(--text-muted)' }}>🔍</span>
      </div>

      {/* ── Detail Table (grouped by category) ────────────── */}
      {categories.map(cat => {
        const catItems = filteredItems.filter(i => i.category === cat)
        if (catItems.length === 0) return null
        const catName = catItems[0]?.categoryName || CATEGORY_LABELS[cat] || cat
        const isExpanded = expandedCats.has(cat)
        const catWeight = catItems.reduce((s, i) => s + (i.weight || 0), 0)
        const catMatched = catItems.filter(i => {
          const idx = items.indexOf(i)
          return stockMatches.get(idx)?.matched
        }).length

        return (
          <div key={cat} style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Category header */}
            <button type="button" onClick={() => toggleCat(cat)}
              style={{
                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', border: 'none', cursor: 'pointer',
                background: 'var(--bg-secondary)', fontWeight: 700, fontSize: '0.85rem',
                color: 'var(--text-heading)', textAlign: 'left',
              }}>
              <span>
                <span style={{ marginRight: 6, transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>&#9654;</span>
                {cat} — {catName}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>({catItems.length} loại)</span>
              </span>
              <span style={{ display: 'flex', gap: 12, fontSize: '0.75rem', fontWeight: 500 }}>
                <span style={{ color: '#2563eb' }}>{fmtNum(catWeight, 0)} kg</span>
                <span style={{ color: catMatched > 0 ? '#16a34a' : '#dc2626' }}>
                  {catMatched}/{catItems.length} khớp kho
                </span>
              </span>
            </button>

            {/* Category items */}
            {isExpanded && (
              <div style={{ overflowX: 'auto' }}>
                {/* Table header */}
                <div style={{ display: 'grid', gridTemplateColumns: '40px 160px minmax(120px,1fr) minmax(180px,1.5fr) 100px 50px 80px 100px 100px 100px', gap: 4, padding: '6px 10px', background: 'var(--bg-tertiary, #f0f0f0)', borderBottom: '1px solid var(--border)', minWidth: 1000 }}>
                  {['#', 'Mã VT', 'Chi tiết', 'Profile / Vật tư', 'Mác VL', 'ĐVT', 'Số lượng', 'KL (kg)', 'Tồn kho', 'Trạng thái'].map(h => (
                    <span key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</span>
                  ))}
                </div>
                {/* Rows */}
                {catItems.map((item, catIdx) => {
                  const globalIdx = items.indexOf(item)
                  const match = stockMatches.get(globalIdx)
                  const hasStock = match?.matched && match.currentStock > 0
                  const stockSufficient = hasStock && match!.currentStock >= item.quantity

                  return (
                    <div key={item.stt} style={{
                      display: 'grid', gridTemplateColumns: '40px 160px minmax(120px,1fr) minmax(180px,1.5fr) 100px 50px 80px 100px 100px 100px',
                      gap: 4, padding: '5px 10px', fontSize: '0.8rem', alignItems: 'center',
                      borderBottom: '1px solid var(--border)',
                      background: catIdx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)',
                      minWidth: 1000,
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{catIdx + 1}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)' }} title={item.stt}>{item.stt}</span>
                      <span style={{ fontWeight: 600 }}>{item.description}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} title={item.profile}>{item.profile}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.grade}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{item.unit}</span>
                      <span style={{ fontWeight: 600, textAlign: 'right' }}>{fmtNum(item.quantity, 2)}</span>
                      <span style={{ fontWeight: 600, textAlign: 'right', color: '#1e40af' }}>{item.weight > 0 ? fmtNum(item.weight, 1) : '—'}</span>
                      {/* Stock column */}
                      <span style={{ textAlign: 'right', fontWeight: 600, color: hasStock ? '#16a34a' : '#9ca3af' }}>
                        {match?.matched ? (
                          <span title={`${match.inventoryCode} — ${match.inventoryName}`}>
                            {fmtNum(match.currentStock, 0)}
                          </span>
                        ) : '—'}
                      </span>
                      {/* Status */}
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 700, textAlign: 'center',
                        padding: '2px 6px', borderRadius: 6,
                        background: stockSufficient ? '#dcfce7' : match?.matched ? '#fef9c3' : '#fee2e2',
                        color: stockSufficient ? '#166534' : match?.matched ? '#854d0e' : '#991b1b',
                      }}>
                        {stockSufficient ? 'Đủ kho' : match?.matched ? 'Thiếu' : 'Cần mua'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Footer ────────────────────────────────────────── */}
      <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        Tổng: <strong>{totalTypes}</strong> loại vật tư | <strong>{fmtNum(totalWeight, 0)}</strong> kg |
        Khớp kho: <strong>{matchedTypes}</strong> | Cần mua: <strong>{unmatchedTypes}</strong>
        {search && <span style={{ marginLeft: 8 }}> | Đang lọc: {filteredItems.length} kết quả</span>}
      </div>
    </div>
  )
}
