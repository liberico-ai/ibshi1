'use client'
import React, { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

// ── Types ──────────────────────────────────────────────────

export interface PrMaterialItem {
  stt: string
  description: string
  spec: string        // Grade (welding) or Color (paint)
  unit: string
  quantity: number
  weight: number
  category: string    // 'weld' | 'paint'
}

interface InventoryItem {
  id: string
  materialCode: string
  name: string
  unit: string
  specification: string | null
  currentStock: number
}

interface StockMatch {
  inventoryCode: string | null
  inventoryName: string | null
  currentStock: number
  matched: boolean
}

// ── Props ──────────────────────────────────────────────────

interface WeldPaintUploadUIProps {
  isEditable: boolean
  weldData: string | undefined   // JSON of PrMaterialItem[]
  paintData: string | undefined  // JSON of PrMaterialItem[]
  onChangeWeld: (val: string) => void
  onChangePaint: (val: string) => void
  projectCode?: string
}

// ── Helpers ────────────────────────────────────────────────

function fmtNum(n: number, d = 1): string {
  if (n === 0) return '0'
  return n >= 1000 ? n.toLocaleString('vi-VN', { maximumFractionDigits: d }) : n.toFixed(d)
}

function isFooterRow(val: string): boolean {
  const l = (val || '').toLowerCase().trim()
  return ['priority', 'remarks', 'assign', 'purpose', 'for in-house', 'lost', 'consumables', 'name/', 'position/', 'signature/', 'date/', 'if the material'].some(k => l.startsWith(k))
}

// ── Parse PR Excel (flexible: welding or paint format) ─────

function parsePrExcel(data: any[][], category: 'weld' | 'paint'): PrMaterialItem[] {
  // Find header row
  let headerIdx = -1
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const cell = String(data[i]?.[0] || '').toLowerCase()
    if (cell.includes('item') || cell.includes('stt')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return []

  // Detect columns from header
  const headerRow = data[headerIdx]
  const colMap: Record<string, number> = {}
  for (let c = 0; c < (headerRow?.length || 0); c++) {
    const h = String(headerRow[c] || '').toLowerCase()
    if (h.includes('item') || h.includes('stt')) colMap.stt = c
    else if (h.includes('profile') || h.includes('description') || h.includes('chi tiết')) colMap.desc = c
    else if (h.includes('grade') || h.includes('mác') || h.includes('color') || h.includes('màu')) colMap.spec = c
    else if (h.includes('unit') || h.includes('đơn vị')) colMap.unit = c
    else if (h.includes('u.weight') || h.includes('đ.trọng')) colMap.uweight = c
    else if (h.includes('current ordered') || h.includes('dự trù lần này')) colMap.curQty = c
    else if (h.includes('total ordered') || h.includes('tổng dự trù')) colMap.totalQty = c
    else if (h.includes('remark') || h.includes('ghi chú')) colMap.remark = c
  }

  // Also check sub-header for Q.Ty/Weight columns
  const subRow = data[headerIdx + 1]
  const hasSubHeader = subRow && String(subRow[colMap.curQty] || subRow[5] || '').toLowerCase().includes('q.ty')

  // Find data start
  let dataStart = headerIdx + (hasSubHeader ? 2 : 1)
  // Skip number-only rows
  if (data[dataStart]) {
    const fc = data[dataStart][0]
    if (typeof fc === 'number' && fc === 1 && typeof data[dataStart][1] === 'number') dataStart++
  }

  const items: PrMaterialItem[] = []

  for (let i = dataStart; i < data.length; i++) {
    const row = data[i]
    if (!row || row.every((c: any) => c == null || c === '')) continue

    const sttRaw = String(row[colMap.stt ?? 0] || '').trim()
    if (!sttRaw) continue
    if (isFooterRow(sttRaw)) break
    // Skip category headers like "A.", "B."
    if (/^[A-Z]\.$/.test(sttRaw)) continue

    const descCol = colMap.desc ?? 1
    const specCol = colMap.spec ?? 2
    const unitCol = colMap.unit ?? 3

    const description = String(row[descCol] || '').trim()
    const spec = String(row[specCol] || '').trim()
    const unit = String(row[unitCol] || '').trim()
    if (!description) continue
    // Skip rows where description is purely numbers (e.g. number-index rows)
    if (!/[a-zA-ZÀ-ỹ]/.test(description)) continue

    // Get quantity: prefer current ordered, then total ordered, then scan cols 4-8
    let qty = 0
    let weight = 0
    if (colMap.curQty !== undefined) {
      // Current ordered might be a pair (qty, weight) in adjacent columns
      qty = Number(row[colMap.curQty]) || 0
      weight = Number(row[(colMap.curQty) + 1]) || 0
    }
    if (qty === 0 && colMap.totalQty !== undefined) {
      qty = Number(row[colMap.totalQty]) || 0
      weight = Number(row[(colMap.totalQty) + 1]) || 0
    }
    // Fallback: scan for first non-zero number after unit col
    if (qty === 0) {
      for (let c = (unitCol + 1); c < Math.min(row.length, 12); c++) {
        const v = Number(row[c])
        if (v > 0) { qty = v; break }
      }
    }
    if (qty === 0) continue

    items.push({
      stt: sttRaw,
      description,
      spec,
      unit: unit.toLowerCase().replace(/\s*\/.*/, '').trim() || (category === 'paint' ? 'lít' : 'kg'),
      quantity: Math.round(qty * 1000) / 1000,
      weight: Math.round(weight * 100) / 100,
      category,
    })
  }

  return items
}

// ── Match with inventory ───────────────────────────────────

function matchInventory(items: PrMaterialItem[], inventory: InventoryItem[]): Map<number, StockMatch> {
  const matches = new Map<number, StockMatch>()
  for (let i = 0; i < items.length; i++) {
    const pr = items[i]
    const noMatch: StockMatch = { inventoryCode: null, inventoryName: null, currentStock: 0, matched: false }
    // Match by name similarity
    const descLower = pr.description.toLowerCase()
    const inv = inventory.find(m =>
      m.name.toLowerCase() === descLower ||
      m.name.toLowerCase().includes(descLower) ||
      descLower.includes(m.name.toLowerCase())
    ) || inventory.find(m =>
      (m.specification || '').toLowerCase().includes(descLower) ||
      descLower.includes((m.specification || '').toLowerCase())
    )
    if (inv) {
      matches.set(i, { inventoryCode: inv.materialCode, inventoryName: inv.name, currentStock: Number(inv.currentStock), matched: true })
    } else {
      matches.set(i, noMatch)
    }
  }
  return matches
}

// ══════════════════════════════════════════════════════════════
// Sub-component: single material section (Hàn or Sơn)
// ══════════════════════════════════════════════════════════════

function MaterialSection({ label, icon, color, category, data, onChange, isEditable, inventory, projectCode }: {
  label: string
  icon: string
  color: string
  category: 'weld' | 'paint'
  data: string | undefined
  onChange: (val: string) => void
  isEditable: boolean
  inventory: InventoryItem[]
  projectCode?: string
}) {
  let items: PrMaterialItem[] = []
  try { items = data ? JSON.parse(data) : [] } catch { items = [] }

  const [stockMatches, setStockMatches] = useState<Map<number, StockMatch>>(new Map())
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (items.length > 0 && inventory.length > 0) {
      setStockMatches(matchInventory(items, inventory))
    }
  }, [items.length, inventory.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
          const ws = wb.Sheets[wb.SheetNames[0]]
          const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 })
          const parsed = parsePrExcel(raw, category)
          if (parsed.length > 0) onChange(JSON.stringify(parsed))
        } catch (err) { console.error(`${category} parse error:`, err) }
        setUploading(false)
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }, [onChange, category])

  const handleExport = useCallback(() => {
    if (items.length === 0) return
    const headers = ['STT', 'Tên vật tư', category === 'weld' ? 'Mác VL' : 'Màu', 'ĐVT', 'Số lượng', 'KL (kg)', 'Tồn kho', 'Trạng thái']
    const rows = items.map((m, idx) => {
      const match = stockMatches.get(idx)
      return [m.stt, m.description, m.spec, m.unit, m.quantity, m.weight || '', match?.matched ? match.currentStock : 0, match?.matched ? 'Có trong kho' : 'Cần mua']
    })
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 20 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, label)
    XLSX.writeFile(wb, `${label.replace(/\s/g, '_')}_${projectCode || 'P2.2'}.xlsx`)
  }, [items, stockMatches, projectCode, category, label])

  const totalTypes = items.length
  const totalQty = items.reduce((s, i) => s + i.quantity, 0)
  const matchedCount = items.filter((_, idx) => stockMatches.get(idx)?.matched).length

  // ── Empty state ─────────────────────────────────
  if (items.length === 0) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', border: `2px dashed ${color}40`, borderRadius: 12, background: `${color}08` }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>{icon}</div>
        <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', color }}>{label}</h4>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 14px' }}>
          Upload file PR Excel — {category === 'weld' ? 'Biểu mẫu vật tư hàn' : 'Biểu mẫu vật tư sơn'}
        </p>
        {isEditable ? (
          <button type="button" onClick={handleImport} disabled={uploading}
            style={{ padding: '8px 24px', fontSize: '0.85rem', background: color, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? '...Đang xử lý' : `📤 Upload ${label}`}
          </button>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>Chưa có dữ liệu.</div>
        )}
      </div>
    )
  }

  // ── Has data ────────────────────────────────────
  return (
    <div style={{ border: `1px solid ${color}40`, borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: `${color}10`, borderBottom: `1px solid ${color}30`, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color }}>
          {icon} {label}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 8 }}>{totalTypes} loại</span>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={handleExport}
            style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            📥 Export
          </button>
          {isEditable && (
            <>
              <button type="button" onClick={handleImport} disabled={uploading}
                style={{ padding: '4px 10px', fontSize: '0.75rem', background: color, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                📤 Upload lại
              </button>
              <button type="button" onClick={() => { onChange(''); setStockMatches(new Map()) }}
                style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Xóa
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary mini-cards */}
      <div style={{ display: 'flex', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #93c5fd', fontSize: '0.75rem' }}>
          <span style={{ color: '#1d4ed8', fontWeight: 700 }}>{totalTypes}</span> <span style={{ color: '#3b82f6' }}>loại VT</span>
        </div>
        <div style={{ padding: '6px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #93c5fd', fontSize: '0.75rem' }}>
          <span style={{ color: '#1d4ed8', fontWeight: 700 }}>{fmtNum(totalQty, 0)}</span> <span style={{ color: '#3b82f6' }}>tổng SL</span>
        </div>
        <div style={{ padding: '6px 14px', borderRadius: 8, background: matchedCount > 0 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${matchedCount > 0 ? '#86efac' : '#fca5a5'}`, fontSize: '0.75rem' }}>
          <span style={{ color: matchedCount > 0 ? '#166534' : '#991b1b', fontWeight: 700 }}>{matchedCount}/{totalTypes}</span> <span style={{ color: matchedCount > 0 ? '#22c55e' : '#ef4444' }}>khớp kho</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary, #f0f0f0)' }}>
              {['#', 'Tên vật tư', category === 'weld' ? 'Mác VL' : 'Màu', 'ĐVT', 'Số lượng', 'Tồn kho', 'Trạng thái'].map(h => (
                <th key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const match = stockMatches.get(idx)
              const hasStock = match?.matched && match.currentStock > 0
              const sufficient = hasStock && match!.currentStock >= item.quantity
              return (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: '0.7rem' }}>{idx + 1}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>{item.description}</td>
                  <td style={{ padding: '5px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.spec || '—'}</td>
                  <td style={{ padding: '5px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{item.unit}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 600, textAlign: 'right' }}>{fmtNum(item.quantity, 0)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: hasStock ? '#16a34a' : '#9ca3af' }}>
                    {match?.matched ? <span title={`${match.inventoryCode} — ${match.inventoryName}`}>{fmtNum(match.currentStock, 0)}</span> : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6, display: 'inline-block',
                      background: sufficient ? '#dcfce7' : match?.matched ? '#fef9c3' : '#fee2e2',
                      color: sufficient ? '#166534' : match?.matched ? '#854d0e' : '#991b1b',
                    }}>
                      {sufficient ? 'Đủ kho' : match?.matched ? 'Thiếu' : 'Cần mua'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════

export default function WeldPaintUploadUI({ isEditable, weldData, paintData, onChangeWeld, onChangePaint, projectCode }: WeldPaintUploadUIProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/materials?t=${Date.now()}`)
        const json = await res.json()
        if (json.ok && json.materials) setInventory(json.materials)
      } catch { /* ignore */ }
    })()
  }, [])

  return (
    <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', color: 'var(--text-heading)' }}>
        🔥 Đề xuất vật tư hàn & sơn
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
          Upload file PR từ PM
        </span>
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <MaterialSection
          label="Vật tư hàn"
          icon="🔩"
          color="#e67e22"
          category="weld"
          data={weldData}
          onChange={onChangeWeld}
          isEditable={isEditable}
          inventory={inventory}
          projectCode={projectCode}
        />
        <MaterialSection
          label="Vật tư sơn"
          icon="🎨"
          color="#8e44ad"
          category="paint"
          data={paintData}
          onChange={onChangePaint}
          isEditable={isEditable}
          inventory={inventory}
          projectCode={projectCode}
        />
      </div>
    </div>
  )
}
