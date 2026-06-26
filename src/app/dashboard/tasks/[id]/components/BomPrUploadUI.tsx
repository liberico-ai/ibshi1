'use client'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import QuickCreateMaterialDialog from './QuickCreateMaterialDialog'
import { resolveCodes, type ResolvedLite } from './material-resolve-client'
import { detectSectionType, normalizeDims, dimsMatch } from '@/lib/section-type'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate, formatNumber } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────

export interface PrMaterialItem {
  stt: string           // PR line reference e.g. I104-VTC01-001 (NOT a material code)
  description: string   // e.g. THÉP HÌNH C
  profile: string       // e.g. C100X50X5X7.5-12000L
  grade: string         // e.g. SS400
  type: string          // e.g. "Thép đen", "Inox" (cột Loại)
  thickness: number     // mm (cột Chiều dày) — from dedicated column, NOT parsed from profile
  length: number        // mm (cột Chiều dài) — from dedicated column, NOT parsed from profile
  width: number         // mm (cột Chiều rộng) — from dedicated column, NOT parsed from profile
  unit: string          // m, m2, cái, bộ, kg, etc.
  unitWeight: number    // kg per unit
  netQty: number        // net quantity (BOM)
  netWeight: number     // net weight
  prevQty: number       // previously ordered qty
  prevWeight: number    // previously ordered weight
  quantity: number      // current ordered quantity
  weight: number        // current ordered weight (kg)
  totalQty: number      // total ordered qty
  totalWeight: number   // total ordered weight
  remarks: string       // ghi chú
  category: string      // e.g. VTC01, VTC03, VPK, VDK
  categoryName: string  // e.g. "Vật tư chính thép đen"
  canonicalCode?: string // assigned material code (only set when user picks/creates)
  materialId?: string    // linked Material.id once assigned
  provisionalCode?: boolean // true = mã tạm (tạo mới), false/undefined = mã kho (chọn từ kho)
  requiredDate?: string  // Ngày cần hàng về (YYYY-MM-DD) — PM điền để theo dõi tiến độ mua
  procureStatus?: string // Tiến độ mua: '' | 'Chưa mua' | 'Đang mua' | 'Đã về'
  neededQty?: number
  availableQty?: number
  needToBuyQty?: number
  stockUnit?: string
  stockConvertedFromKg?: boolean
  stockUnitMismatch?: boolean
}

interface ProjectWarehouse {
  projectCode: string
  warehouseCode: string
  quantity: number
}

interface InventoryItem {
  id: string
  materialCode: string
  name: string
  unit: string
  specification: string | null
  grade: string | null
  groupCode: string | null
  currentStock: number
  reusableStock?: number
  projectStock?: number
  customerStock?: number
  projectWarehouses?: ProjectWarehouse[]
  category: string
}

interface StockMatch {
  inventoryId: string | null
  inventoryCode: string | null
  inventoryName: string | null
  inventoryUnit?: string
  currentStock: number
  reusableStock: number
  projectStock: number
  projectWarehouses: ProjectWarehouse[]
  matched: boolean
  viaCode?: boolean
  viaSectionType?: boolean
  gradeWarning?: string
  sectionCandidates?: number
}

// ── Props ──────────────────────────────────────────────────

interface BomPrUploadUIProps {
  isEditable: boolean
  bomPrData: string | undefined  // JSON string of PrMaterialItem[]
  onChange: (val: string) => void
  projectCode?: string
  roleCode?: string
  taskId?: string
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
  return formatNumber(n)
}

// ── Parse PR Excel ─────────────────────────────────────────

function parsePrExcel(data: any[][]): PrMaterialItem[] {
  const S = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
  const N = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n }

  // Find header row: require BOTH "Item/STT" AND "Description/Chi tiết/Vật tư" to avoid noise rows
  let headerIdx = -1
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i] || []
    const hasItem = row.some((c: any) => /\bitem\b|\bstt\b/i.test(S(c)))
    const hasDesc = row.some((c: any) => /description|chi ti[ếê]t|di[ễê]n gi[ảa]i/i.test(S(c)))
    if (hasItem && hasDesc) { headerIdx = i; break }
  }
  if (headerIdx < 0) return []

  // Dynamic column mapping from header text
  const H = (data[headerIdx] || []).map(S)
  const find = (re: RegExp) => H.findIndex(h => re.test(h))
  const findAll = (re: RegExp) => H.map((h, i) => (re.test(h) ? i : -1)).filter(i => i >= 0)

  const cStt = Math.max(0, find(/\bitem\b|\bstt\b/i))
  const cDesc = find(/description|chi ti[ếê]t|di[ễê]n gi[ảa]i/i)
  const cProfile = find(/profile/i)
  const cGrade = find(/grade|m[áa]c/i)
  const cType = find(/^lo[ạa]i$/i)
  const cThick = find(/chi[ềe]u\s*d[àa]y/i)
  const cLength = find(/chi[ềe]u\s*d[àa]i/i)
  const cWidth = find(/chi[ềe]u\s*r[ộo]ng/i)
  const cUnit = find(/\bunit\b|[đd][ơo]n\s*v[ịi]|[đd]vt/i)
  const cUnitWt = find(/u\.?\s*weight|[đd]\.?\s*tr[ọo]ng/i)
  const cNetQty = find(/net\s*quantity|s[ốo]\s*l[ưượơ]ng\s*tinh/i)
  const cPrev = find(/previous\s*ordered|[đd][ãa]\s*d[ựu]\s*tr[ùu]/i)
  const cTotal = find(/total\s*ordered|t[ổo]ng\s*d[ựu]\s*tr[ùu]/i)
  const cCurrentAll = findAll(/current\s*ordered|d[ựu]\s*tr[ùu]\s*l[ầa]n/i)
  const cRemarks = find(/^remarks|ghi\s*ch[úu]/i)

  // Data start: skip sub-header (Q.Ty/Weight) and number-index rows
  let actualStart = headerIdx + 1
  while (actualStart < data.length) {
    const row = data[actualStart] || []
    if (row.some((c: any) => /^q\.?ty|^weight|^s[ốo]\s*l[ưượơ]ng|^kh[ốo]i\s*l[ưượơ]ng/i.test(S(c)))) { actualStart++; continue }
    if (typeof row[0] === 'number' && row[0] >= 1 && row[0] <= 20 && typeof row[1] === 'number') { actualStart++; continue }
    break
  }

  const items: PrMaterialItem[] = []
  let currentCategory = ''
  let currentCategoryName = ''

  for (let i = actualStart; i < data.length; i++) {
    const row = data[i]
    if (!row || row.every((c: any) => c == null || c === '')) continue

    const stt = S(row[cStt])
    if (!stt) continue
    if (isFooterRow(stt)) break

    const description = cDesc >= 0 ? S(row[cDesc]) : ''
    const profile = cProfile >= 0 ? S(row[cProfile]) : ''
    const grade = cGrade >= 0 ? S(row[cGrade]) : ''
    const type = cType >= 0 ? S(row[cType]) : ''
    const thickness = cThick >= 0 ? N(row[cThick]) : 0
    const length = cLength >= 0 ? N(row[cLength]) : 0
    const width = cWidth >= 0 ? N(row[cWidth]) : 0
    const unit = cUnit >= 0 ? S(row[cUnit]) : ''
    const unitWeight = cUnitWt >= 0 ? N(row[cUnitWt]) : 0

    if (description && !/[a-zA-ZÀ-ỹ]/.test(description)) continue

    if (isCategoryRow(stt, unit)) {
      currentCategory = extractCategory(stt)
      currentCategoryName = description || currentCategory
      continue
    }

    // Quantities: each header column is Q.Ty, the next column (+1) is Weight
    const netQty = cNetQty >= 0 ? N(row[cNetQty]) : 0
    const netWeight = cNetQty >= 0 ? N(row[cNetQty + 1]) : 0
    const prevQty = cPrev >= 0 ? N(row[cPrev]) : 0
    const prevWeight = cPrev >= 0 ? N(row[cPrev + 1]) : 0
    const totalQty = cTotal >= 0 ? N(row[cTotal]) : 0
    const totalWeight = cTotal >= 0 ? N(row[cTotal + 1]) : 0

    // Current ordered: find the last revision with a non-zero value
    let curQty = 0, curWeight = 0
    for (const ci of cCurrentAll) {
      const q = N(row[ci])
      if (q !== 0) { curQty = q; curWeight = N(row[ci + 1]) }
    }

    // Final quantity: prefer Total Ordered, then last Current, then Net
    const quantity = totalQty || curQty || netQty
    const weight = totalWeight || curWeight || netWeight
    if (quantity === 0 && weight === 0) continue

    const cat = currentCategory || extractCategory(stt)
    const remarks = cRemarks >= 0 ? S(row[cRemarks]) : ''

    items.push({
      stt,
      description,
      profile,
      grade,
      type,
      thickness,
      length,
      width,
      unit: unit.toLowerCase(),
      unitWeight: Math.round(unitWeight * 100) / 100,
      netQty: Math.round(netQty * 1000) / 1000,
      netWeight: Math.round(netWeight * 100) / 100,
      prevQty: Math.round(prevQty * 1000) / 1000,
      prevWeight: Math.round(prevWeight * 100) / 100,
      quantity: Math.round(quantity * 1000) / 1000,
      weight: Math.round(weight * 100) / 100,
      totalQty: Math.round(totalQty * 1000) / 1000,
      totalWeight: Math.round(totalWeight * 100) / 100,
      remarks,
      category: cat,
      categoryName: currentCategoryName || CATEGORY_LABELS[cat] || cat,
    })
  }

  return items
}

// ── Match with inventory ───────────────────────────────────

// Build a dimension-based search key from a steel profile so the dedupe dialog
// finds catalog codes regardless of the section letter (Thiết kế gọi "C", kho gọi "U")
// and of formatting. e.g. "C100X50X5X7.5-12000L" → "100x50x5x7.5"
function profileSearchKey(it?: PrMaterialItem): string {
  if (!it) return ''
  const p = (it.profile || '').toLowerCase().replace(/[×*]/g, 'x').split('-')[0].replace(/^[a-z]+/, '').trim()
  return p || it.description || ''
}

// Map PR description keywords → material group codes for detail matching
const PR_TYPE_TO_GROUP: [RegExp, string[]][] = [
  [/t[oô]n\s*t[aấ]m|th[eé]p\s*t[aấ]m/i, ['1.1', '2.1']],
  [/th[eé]p\s*h[iì]nh/i, ['1.2', '2.2']],
  [/grating/i, ['3.1']],
  [/inox/i, ['2.1', '2.2']],
  [/th[eé]p\s*[oô]ng/i, ['1.5']],
  [/th[eé]p\s*x[eẹ]p|flat\s*bar/i, ['1.3']],
  [/m[aạ]\s*k[eẽ]m/i, ['1.4']],
  [/bu\s*l[oô]ng|[eê]\s*cu/i, ['4.1']],
  [/b[ií]ch|c[uú]t/i, ['4.2']],
]

// Normalize a dimension string for fuzzy comparison: lowercase, collapse whitespace, unify separators
const normDim = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[×*]/g, 'x')

// Extract numeric dimensions from a material name like "Thép tấm 10" or "Thép H252x203x8x13.5"
function extractDimsFromName(name: string): number[] {
  const nums: number[] = []
  const cleaned = name.replace(/[×*]/g, 'x')
  for (const m of cleaned.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const n = parseFloat(m[1])
    if (n > 0 && n < 100000) nums.push(n)
  }
  return nums
}

function matchInventory(items: PrMaterialItem[], inventory: InventoryItem[], codeResolved?: Map<string, ResolvedLite>): Map<number, StockMatch> {
  const matches = new Map<number, StockMatch>()
  const toMatch = (inv: InventoryItem): StockMatch => ({
    inventoryId: inv.id, inventoryCode: inv.materialCode, inventoryName: inv.name,
    inventoryUnit: inv.unit, currentStock: Number(inv.currentStock),
    reusableStock: inv.reusableStock ?? Number(inv.currentStock),
    projectStock: inv.projectStock ?? 0,
    projectWarehouses: inv.projectWarehouses ?? [],
    matched: true,
  })

  // Pre-compute section type index for inventory items
  type SectionEntry = { inv: InventoryItem; dims: string; grade: string }
  const sectionIndex = new Map<string, SectionEntry[]>()
  for (const inv of inventory) {
    const text = `${inv.name} ${inv.specification || ''}`
    const st = detectSectionType(text)
    if (!st) continue
    const dims = normalizeDims(inv.specification || inv.name)
    if (!dims) continue
    if (!sectionIndex.has(st)) sectionIndex.set(st, [])
    sectionIndex.get(st)!.push({ inv, dims, grade: (inv.grade || '').trim().toLowerCase() })
  }

  for (let i = 0; i < items.length; i++) {
    const pr = items[i]
    const noMatch: StockMatch = { inventoryId: null, inventoryCode: null, inventoryName: null, currentStock: 0, reusableStock: 0, projectStock: 0, projectWarehouses: [], matched: false }

    // Strategy 0: resolve by assigned canonical code — highest priority.
    const resolved = pr.canonicalCode ? codeResolved?.get(pr.canonicalCode) : undefined
    if (resolved) {
      const fullInv = inventory.find(m => m.id === resolved.id)
      matches.set(i, {
        inventoryId: resolved.id, inventoryCode: resolved.materialCode, inventoryName: resolved.name,
        inventoryUnit: fullInv?.unit, currentStock: resolved.currentStock,
        reusableStock: fullInv?.reusableStock ?? resolved.currentStock,
        projectStock: fullInv?.projectStock ?? 0,
        projectWarehouses: fullInv?.projectWarehouses ?? [],
        matched: true, viaCode: true,
      })
      continue
    }

    // Strategy 1: exact specification match on profile
    let inv = pr.profile ? inventory.find(m =>
      m.specification?.trim().toLowerCase() === pr.profile.toLowerCase() &&
      (m.unit || '').toLowerCase() === (pr.unit || '').toLowerCase()
    ) : undefined

    // Strategy 2: profile key contained in specification/name
    if (!inv && pr.profile) {
      const profileKey = normDim(pr.profile.split('-')[0])
      if (profileKey) {
        inv = inventory.find(m =>
          normDim(m.specification || '').includes(profileKey) ||
          normDim(m.name).includes(profileKey)
        )
      }
    }

    // Strategy 2.5: section type + dims matching (PR notation ↔ inventory naming)
    if (!inv && pr.profile) {
      const prText = `${pr.description} ${pr.profile}`.trim()
      const prSection = detectSectionType(prText)
      if (prSection) {
        const prDims = normalizeDims(pr.profile)
        if (prDims) {
          const candidates = sectionIndex.get(prSection) || []
          const dimMatches = candidates.filter(c => dimsMatch(prDims, c.dims))
          if (dimMatches.length > 0) {
            const prGrade = (pr.grade || '').trim().toLowerCase()
            const gradeExact = dimMatches.filter(c => c.grade === prGrade)
            if (gradeExact.length === 1) {
              inv = gradeExact[0].inv
              matches.set(i, { ...toMatch(inv), viaSectionType: true })
              continue
            } else if (gradeExact.length > 1) {
              const best = gradeExact.reduce((a, b) => Number(b.inv.currentStock) > Number(a.inv.currentStock) ? b : a)
              matches.set(i, { ...toMatch(best.inv), viaSectionType: true, sectionCandidates: gradeExact.length })
              continue
            } else if (dimMatches.length === 1) {
              inv = dimMatches[0].inv
              const warn = prGrade && dimMatches[0].grade && prGrade !== dimMatches[0].grade
                ? `PR: ${pr.grade} ≠ Kho: ${dimMatches[0].inv.grade}` : undefined
              matches.set(i, { ...toMatch(inv), viaSectionType: true, gradeWarning: warn })
              continue
            } else {
              const best = dimMatches.reduce((a, b) => Number(b.inv.currentStock) > Number(a.inv.currentStock) ? b : a)
              matches.set(i, { ...toMatch(best.inv), viaSectionType: true, gradeWarning: 'cần xác nhận mác', sectionCandidates: dimMatches.length })
              continue
            }
          }
        }
      }
    }

    // Strategy 3: detail matching by group + dimensions (from columns, NOT profile) + grade
    if (!inv && (pr.thickness > 0 || pr.width > 0 || pr.length > 0)) {
      const descAndProfile = `${pr.description} ${pr.profile} ${pr.grade}`.toLowerCase()
      const candidateGroups: string[] = []
      for (const [re, groups] of PR_TYPE_TO_GROUP) {
        if (re.test(descAndProfile)) candidateGroups.push(...groups)
      }

      if (candidateGroups.length > 0) {
        const gradeNorm = normDim(pr.grade || '')
        const groupInv = inventory.filter(m =>
          m.groupCode && candidateGroups.includes(m.groupCode)
        )

        let bestMatch: InventoryItem | null = null
        let bestScore = 0

        for (const m of groupInv) {
          const dims = extractDimsFromName(m.name + ' ' + (m.specification || ''))
          let score = 0

          if (pr.thickness > 0 && dims.includes(pr.thickness)) score += 3
          if (pr.width > 0 && dims.includes(pr.width)) score += 2
          if (pr.length > 0 && dims.includes(pr.length)) score += 1
          if (gradeNorm && normDim(m.name + ' ' + (m.specification || '') + ' ' + (m.grade || '')).includes(gradeNorm)) score += 2

          if (score > bestScore) {
            bestScore = score
            bestMatch = m
          }
        }

        if (bestMatch && bestScore >= 3) {
          inv = bestMatch
        }
      }
    }

    // Strategy 4: name similarity
    if (!inv && pr.description) {
      const descLower = pr.description.toLowerCase()
      const prUnitLower = (pr.unit || '').toLowerCase()
      inv = inventory.find(m =>
        m.name.toLowerCase() === descLower ||
        (m.name.toLowerCase().includes(descLower) && (m.unit || '').toLowerCase() === prUnitLower)
      )
    }

    matches.set(i, inv ? toMatch(inv) : noMatch)
  }

  return matches
}

// ── Freeze stock breakdown into items ─────────────────────────

function enrichItems(
  items: PrMaterialItem[],
  matches: Map<number, StockMatch>,
  projectCode?: string,
): PrMaterialItem[] {
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  const r2 = (n: number) => Math.round(n * 100) / 100
  return items.map((item, idx) => {
    const m = matches.get(idx)
    const needed = item.quantity

    if (!m?.matched) {
      return { ...item, neededQty: needed, availableQty: 0, needToBuyQty: needed, stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
    }

    const base = { ...item, ...(m.inventoryCode && !item.canonicalCode ? { canonicalCode: m.inventoryCode, materialId: m.inventoryId ?? undefined } : {}) }

    const sameUnit = !!(m.inventoryUnit && item.unit &&
      m.inventoryUnit.toLowerCase() === item.unit.toLowerCase())
    const needKg = item.weight > 0 ? item.weight :
      item.unitWeight > 0 ? item.quantity * item.unitWeight : 0
    const canKg = !sameUnit && m.inventoryUnit?.toLowerCase() === 'kg' && needKg > 0

    const reusable = m.reusableStock ?? 0
    const whs = m.projectWarehouses ?? []
    const thisProj = whs
      .filter(p => projectCode && p.projectCode === projectCode)
      .reduce((s, p) => s + p.quantity, 0)
    const avail = reusable + thisProj

    if (sameUnit) {
      const a = r3(avail)
      return { ...base, neededQty: needed, availableQty: a, needToBuyQty: r3(Math.max(0, needed - a)), stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
    }

    if (canKg && item.unitWeight > 0) {
      const a = r3(avail / item.unitWeight)
      return { ...base, neededQty: needed, availableQty: a, needToBuyQty: r3(Math.max(0, needed - a)), stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
    }

    if (canKg) {
      const nk = r2(needKg)
      const ak = r2(avail)
      return { ...base, neededQty: nk, availableQty: ak, needToBuyQty: r2(Math.max(0, nk - ak)), stockUnit: 'kg', stockConvertedFromKg: true, stockUnitMismatch: false }
    }

    return { ...base, neededQty: needed, availableQty: 0, needToBuyQty: needed, stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: true }
  })
}

// ══════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════

const REQUIRED_DATE_ROLES = ['R01', 'R02', 'R02a']

export default function BomPrUploadUI({ isEditable, bomPrData, onChange, projectCode, roleCode, taskId }: BomPrUploadUIProps) {
  const canSetRequiredDate = REQUIRED_DATE_ROLES.includes(roleCode || '')
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
  // Newly assigned material codes for unmatched rows (globalIdx → code + provisional flag)
  const [newCodes, setNewCodes] = useState<Map<number, { code: string; provisional: boolean }>>(new Map())
  const [dialogIdx, setDialogIdx] = useState<number | null>(null)
  // Codes resolved via API (canonical or old/alias) → canonical material
  const [codeResolved, setCodeResolved] = useState<Map<string, ResolvedLite>>(new Map())

  // Fetch inventory on mount
  useEffect(() => {
    (async () => {
      try {
        const json = await apiFetch(`/api/materials?forMatch=true&t=${Date.now()}`)
        if (json.ok && json.materials) setInventory(json.materials)
      } catch { /* ignore */ }
    })()
  }, [])

  // Resolve assigned codes (canonical + old aliases) whenever they change
  const codesKey = items.map((i) => i.canonicalCode || '').join('|')
  useEffect(() => {
    const codes = items.map((i) => i.canonicalCode).filter(Boolean) as string[]
    if (codes.length === 0) { setCodeResolved(new Map()); return }
    let cancelled = false
    resolveCodes(codes).then((m) => { if (!cancelled) setCodeResolved(m) })
    return () => { cancelled = true }
  }, [codesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-match when items, inventory, or resolved codes change
  useEffect(() => {
    if (items.length > 0) {
      setStockMatches(matchInventory(items, inventory, codeResolved))
    }
  }, [items.length, inventory.length, codeResolved]) // eslint-disable-line react-hooks/exhaustive-deps

  // Freeze stock breakdown into bomPr items (only when Thiết kế is editing)
  useEffect(() => {
    if (!isEditable || items.length === 0 || stockMatches.size === 0) return
    const enriched = enrichItems(items, stockMatches, projectCode)
    const enrichedJson = JSON.stringify(enriched)
    if (enrichedJson !== JSON.stringify(items)) {
      onChange(enrichedJson)
    }
  }, [stockMatches, projectCode, isEditable]) // eslint-disable-line react-hooks/exhaustive-deps

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
          } else {
            alert(`Không đọc được dữ liệu PR từ sheet "${sheetName}". Kiểm tra lại định dạng (cần có header với STT/Item, Description, Profile, Grade, Unit, Q.ty).`)
          }
        } catch (err) {
          console.error('PR Excel parse error:', err)
          alert(`Lỗi đọc file Excel: ${err instanceof Error ? err.message : 'không rõ'}`)
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
    const headers = ['STT', 'Ref PR', 'Mã VT', 'Chi tiết', 'Profile / Vật tư', 'Mác VL', 'Loại', 'Chiều dày (mm)', 'Chiều dài (mm)', 'Chiều rộng (mm)', 'ĐVT', 'Đ.Trọng', 'SL tịnh', 'KL tịnh', 'Đã dự trù (SL)', 'Đã dự trù (KL)', 'Lần này (SL)', 'Lần này (KL)', 'Tổng DT (SL)', 'Tổng DT (KL)', 'Nhóm', 'Tồn kho', 'Ngày cần hàng', 'Tiến độ mua', 'Mã kho', 'Trạng thái', 'Ghi chú']
    const rows = items.map((m, idx) => {
      const match = stockMatches.get(idx)
      return [
        idx + 1, m.stt, m.canonicalCode || '', m.description, m.profile, m.grade,
        m.type || '', m.thickness || '', m.length || '', m.width || '',
        m.unit, m.unitWeight || '',
        m.netQty || '', m.netWeight || '', m.prevQty || '', m.prevWeight || '',
        m.quantity, m.weight, m.totalQty || m.quantity, m.totalWeight || m.weight,
        m.category,
        match?.matched ? match.currentStock : 0,
        m.requiredDate || '',
        (match?.matched && match.currentStock >= m.quantity) ? 'Đủ kho · xuất kho' : (m.procureStatus || ''),
        match?.matched ? match.inventoryCode : '',
        match?.matched ? 'Có trong kho' : (m.canonicalCode ? (m.provisionalCode ? 'Mã tạm' : 'Mã kho') : 'Chưa có mã'),
        m.remarks || '',
      ]
    })
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 5 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 15 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BOM-PR')
    XLSX.writeFile(wb, `BOM-PR_${projectCode || 'P2.1'}.xlsx`)
  }, [items, stockMatches, projectCode])

  // ── Cập nhật 1 dòng (Ngày cần hàng / Tiến độ mua) ─────────
  const patchItem = useCallback((globalIdx: number, patch: Partial<PrMaterialItem>) => {
    const next = items.map((it, i) => (i === globalIdx ? { ...it, ...patch } : it))
    onChange(JSON.stringify(next))
  }, [items, onChange])

  const saveRequiredDateServer = useCallback(async (globalIdx: number, value: string) => {
    if (!taskId) return
    try {
      await apiFetch(`/api/work/tasks/${taskId}/bom-pr`, {
        method: 'POST',
        body: JSON.stringify({ action: 'set-required-dates', requiredDates: { [String(globalIdx)]: value } }),
      })
    } catch { /* best-effort */ }
  }, [taskId])

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
  const zeroStockMatched = matchedItems.filter((item) => {
    const idx = items.indexOf(item)
    const match = stockMatches.get(idx)
    return match?.currentStock === 0
  }).length
  const unmatchedTypes = totalTypes - matchedTypes
  const needToBuyWeight = items.reduce((s, item, _) => {
    const idx = items.indexOf(item)
    const match = stockMatches.get(idx)
    if (!match?.matched) return s + (item.weight || 0)
    const pWhs = match.projectWarehouses || []
    const thisPrj = pWhs.filter(p => projectCode && p.projectCode === projectCode).reduce((a, p) => a + p.quantity, 0)
    const avail = match.reusableStock + thisPrj
    const sameU = match.inventoryUnit?.toLowerCase() === item.unit?.toLowerCase()
    const nKg = (item.weight > 0) ? item.weight : (item.unitWeight > 0 ? item.quantity * item.unitWeight : 0)
    const canKg = !sameU && match.inventoryUnit?.toLowerCase() === 'kg' && nKg > 0
    if (sameU) {
      if (avail >= item.quantity) return s
      return s + (item.weight || 0)
    }
    if (canKg) {
      if (avail >= nKg) return s
      return s + Math.max(0, nKg - avail)
    }
    return s + (item.weight || 0)
  }, 0)

  // ── Filter by search ──────────────────────────────────────
  const searchLower = search.toLowerCase().trim()
  const filteredItems = searchLower
    ? items.filter(i =>
        (i.stt || '').toLowerCase().includes(searchLower) ||
        (i.description || '').toLowerCase().includes(searchLower) ||
        (i.profile || '').toLowerCase().includes(searchLower) ||
        (i.grade || '').toLowerCase().includes(searchLower)
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

  // ── Duplicate detection ────────────────────────────────────
  // Group by description+profile+grade to find duplicates within the PR
  const duplicateMap = useMemo(() => {
    const map = new Map<string, number[]>()
    items.forEach((item, idx) => {
      const key = `${item.description}||${item.profile}||${item.grade}`.toLowerCase()
      const existing = map.get(key) || []
      existing.push(idx)
      map.set(key, existing)
    })
    const dupes = new Map<number, { count: number; indices: number[] }>()
    for (const [, indices] of map) {
      if (indices.length > 1) {
        for (const idx of indices) {
          dupes.set(idx, { count: indices.length, indices })
        }
      }
    }
    return dupes
  }, [items])

  const duplicateGroups = useMemo(() => {
    const seen = new Set<string>()
    const groups: { description: string; profile: string; grade: string; count: number; totalQty: number; unit: string; indices: number[] }[] = []
    items.forEach((item, idx) => {
      const key = `${item.description}||${item.profile}||${item.grade}`.toLowerCase()
      if (duplicateMap.has(idx) && !seen.has(key)) {
        seen.add(key)
        const info = duplicateMap.get(idx)!
        const totalQty = info.indices.reduce((s, i) => s + items[i].quantity, 0)
        groups.push({ description: item.description, profile: item.profile, grade: item.grade, count: info.count, totalQty, unit: item.unit, indices: info.indices })
      }
    })
    return groups
  }, [items, duplicateMap])

  // ── Table header styles (shared) ────────────────────────
  const thStyle: React.CSSProperties = { fontSize: '0.66rem', fontWeight: 700, color: '#fff', padding: '6px 5px', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '2px solid #163a5f' }
  const thSubStyle: React.CSSProperties = { fontSize: '0.62rem', fontWeight: 600, color: '#93c5fd', padding: '4px 5px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '2px solid #163a5f' }

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

      {/* ── Duplicate Warning ─────────────────────────────── */}
      {duplicateGroups.length > 0 && (
        <div style={{ marginBottom: 16, padding: '14px 18px', borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span style={{ fontWeight: 700, color: '#991b1b', fontSize: '0.85rem' }}>
              Phát hiện {duplicateGroups.length} nhóm vật tư trùng lặp ({duplicateGroups.reduce((s, g) => s + g.count, 0)} dòng)
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {duplicateGroups.map((g, gi) => (
              <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#fff', border: '1px solid #fde8e8' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                  ×{g.count}
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1a202c' }}>
                  {g.description}
                </span>
                <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#475569' }}>
                  {g.profile}
                </span>
                {g.grade && <span style={{ fontSize: '0.68rem', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>{g.grade}</span>}
                <span style={{ fontSize: '0.72rem', color: '#991b1b', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  Tổng: {fmtNum(g.totalQty, 2)} {g.unit}
                </span>
                <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>
                  (dòng {g.indices.map(i => i + 1).join(', ')})
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#b91c1c' }}>
            Kiểm tra lại file PR: có thể trùng giữa các đợt dự trù hoặc nhầm profile.
          </div>
        </div>
      )}

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
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: 1750 }}>
                  <thead>
                    {/* Group header row */}
                    <tr style={{ background: '#0a2540' }}>
                      <th rowSpan={2} style={thStyle}>#</th>
                      <th rowSpan={2} style={thStyle}>Mã Item</th>
                      <th rowSpan={2} style={thStyle}>Mã vật tư</th>
                      <th rowSpan={2} style={thStyle}>Chi tiết</th>
                      <th rowSpan={2} style={thStyle}>Profile / Vật tư</th>
                      <th rowSpan={2} style={thStyle}>Mác VL</th>
                      <th rowSpan={2} style={{ ...thStyle, textAlign: 'center' }}>ĐVT</th>
                      <th rowSpan={2} style={thStyle}>Đ.Trọng</th>
                      <th colSpan={2} style={{ ...thStyle, textAlign: 'center', borderLeft: '1px solid #1e3a5f', background: '#163a5f' }}>SL tịnh (Net)</th>
                      <th colSpan={2} style={{ ...thStyle, textAlign: 'center', borderLeft: '1px solid #1e3a5f', background: '#1a4a6f' }}>Đã dự trù (Prev)</th>
                      <th colSpan={2} style={{ ...thStyle, textAlign: 'center', borderLeft: '1px solid #1e3a5f', background: '#0d4f8a' }}>Dự trù lần này</th>
                      <th colSpan={2} style={{ ...thStyle, textAlign: 'center', borderLeft: '1px solid #1e3a5f', background: '#163a5f' }}>Tổng dự trù</th>
                      <th rowSpan={2} style={{ ...thStyle, borderLeft: '1px solid #1e3a5f' }}>Tồn kho</th>
                      <th rowSpan={2} style={{ ...thStyle, borderLeft: '1px solid #1e3a5f', background: '#0d4f8a' }}>Ngày cần hàng</th>
                      <th rowSpan={2} style={{ ...thStyle, background: '#0d4f8a' }}>Tiến độ mua</th>
                      <th rowSpan={2} style={thStyle}>Ghi chú</th>
                      <th rowSpan={2} style={thStyle}>Trạng thái</th>
                    </tr>
                    {/* Sub header row */}
                    <tr style={{ background: '#122d47' }}>
                      <th style={{ ...thSubStyle, borderLeft: '1px solid #1e3a5f' }}>SL</th>
                      <th style={thSubStyle}>KL (kg)</th>
                      <th style={{ ...thSubStyle, borderLeft: '1px solid #1e3a5f' }}>SL</th>
                      <th style={thSubStyle}>KL (kg)</th>
                      <th style={{ ...thSubStyle, borderLeft: '1px solid #1e3a5f', color: '#fbbf24' }}>SL</th>
                      <th style={{ ...thSubStyle, color: '#fbbf24' }}>KL (kg)</th>
                      <th style={{ ...thSubStyle, borderLeft: '1px solid #1e3a5f' }}>SL</th>
                      <th style={thSubStyle}>KL (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catItems.map((item, catIdx) => {
                      const globalIdx = items.indexOf(item)
                      const match = stockMatches.get(globalIdx)
                      const sameUnit = !!(match?.matched && match.inventoryUnit && item.unit && match.inventoryUnit.toLowerCase() === item.unit.toLowerCase())
                      const needKg = (item.weight > 0) ? item.weight : (item.unitWeight > 0 ? item.quantity * item.unitWeight : 0)
                      const canConvertKg = !!(match?.matched && !sameUnit && match.inventoryUnit?.toLowerCase() === 'kg' && needKg > 0)
                      const unitMismatch = !!(match?.matched && !sameUnit && !canConvertKg && match.inventoryUnit && item.unit)
                      const matchedByWeight = canConvertKg
                      const reusable = match?.reusableStock ?? 0
                      const projWhs = match?.projectWarehouses ?? []
                      const thisProj = projWhs.filter(p => projectCode && p.projectCode === projectCode).reduce((s, p) => s + p.quantity, 0)
                      const otherProj = projWhs.filter(p => !projectCode || p.projectCode !== projectCode).reduce((s, p) => s + p.quantity, 0)
                      const available = reusable + thisProj
                      const stockSufficient = !!(match?.matched && available > 0 && (sameUnit ? available >= item.quantity : canConvertKg ? available >= needKg : false))
                      const cellPad = '5px 8px'

                      return (
                        <tr key={globalIdx} style={{ borderBottom: '1px solid var(--border)', background: duplicateMap.has(globalIdx) ? '#fef2f2' : catIdx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                          <td style={{ padding: cellPad, color: 'var(--text-muted)', fontSize: '0.68rem', textAlign: 'center' }}>{catIdx + 1}</td>
                          <td style={{ padding: cellPad, fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.stt}>{item.stt}</td>
                          <td style={{ padding: cellPad, minWidth: 140 }}>
                            {newCodes.has(globalIdx) ? (() => {
                              const nc = newCodes.get(globalIdx)!
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap',
                                    background: nc.provisional ? '#e0e7ff' : '#dcfce7', color: nc.provisional ? '#3730a3' : '#166534' }}>
                                    {nc.code}
                                  </span>
                                  <span style={{ fontSize: '0.6rem', color: nc.provisional ? '#6366f1' : '#166534' }}>
                                    {nc.provisional ? 'Mã tạm — chờ chuẩn hóa' : 'Mã kho'}
                                  </span>
                                </div>
                              )
                            })() : item.canonicalCode ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap',
                                  background: item.provisionalCode ? '#e0e7ff' : '#dcfce7', color: item.provisionalCode ? '#3730a3' : '#166534' }}>
                                  {item.canonicalCode}
                                </span>
                                <span style={{ fontSize: '0.6rem', color: item.provisionalCode ? '#6366f1' : '#166534' }}>
                                  {item.provisionalCode ? 'Mã tạm — chờ chuẩn hóa' : 'Mã kho'}
                                </span>
                              </div>
                            ) : match?.matched ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap',
                                  background: '#dcfce7', color: '#166534' }}>
                                  {match.inventoryCode}
                                </span>
                                <span style={{ fontSize: '0.58rem', color: '#6b7280' }}>
                                  {match.viaSectionType ? 'khớp tiết diện' : 'khớp spec'}
                                </span>
                                {match.gradeWarning && (
                                  <span style={{ fontSize: '0.56rem', color: '#b45309' }}>⚠ {match.gradeWarning}</span>
                                )}
                                {(match.sectionCandidates ?? 0) > 1 && (
                                  <span style={{ fontSize: '0.56rem', color: '#6b7280' }}>({match.sectionCandidates} ứng viên)</span>
                                )}
                                {isEditable && (
                                  <button type="button" onClick={() => patchItem(globalIdx, { canonicalCode: match.inventoryCode!, materialId: match.inventoryId! })}
                                    style={{ padding: '2px 8px', fontSize: '0.62rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    Dùng mã này
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280', whiteSpace: 'nowrap' }}>
                                  Chưa có mã
                                </span>
                                {isEditable && (
                                  <button type="button" onClick={() => setDialogIdx(globalIdx)}
                                    style={{ padding: '2px 8px', fontSize: '0.65rem', background: '#0a2540', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    + Tạo / gán mã
                                  </button>
                                )}
                              </div>
                            )}
                            {duplicateMap.has(globalIdx) && (
                              <span style={{ display: 'inline-block', marginTop: 2, fontSize: '0.6rem', fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '0 4px', borderRadius: 3 }}
                                title={`Trùng ${duplicateMap.get(globalIdx)!.count} dòng`}>
                                TRÙNG
                              </span>
                            )}
                          </td>
                          <td style={{ padding: cellPad, fontWeight: 600, fontSize: '0.75rem' }}>{item.description}</td>
                          <td style={{ padding: cellPad, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            {item.profile}{item.type ? ` · ${item.type}` : ''}
                            {(item.thickness > 0 || item.length > 0 || item.width > 0) && (
                              <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#64748b', marginTop: 2 }}
                                title="dày × rộng × dài (mm)">
                                {[item.thickness, item.width, item.length].filter(v => v > 0).join('×')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: cellPad, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{item.grade}</td>
                          <td style={{ padding: cellPad, fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{item.unit}</td>
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.unitWeight > 0 ? fmtNum(item.unitWeight, 2) : '—'}</td>
                          {/* Net Qty + Weight */}
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', borderLeft: '1px solid var(--border)' }}>{item.netQty > 0 ? fmtNum(item.netQty, 2) : '—'}</td>
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.netWeight > 0 ? fmtNum(item.netWeight, 1) : '—'}</td>
                          {/* Previous Qty + Weight */}
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', color: '#9ca3af', borderLeft: '1px solid var(--border)' }}>{item.prevQty > 0 ? fmtNum(item.prevQty, 2) : '—'}</td>
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', color: '#9ca3af' }}>{item.prevWeight > 0 ? fmtNum(item.prevWeight, 1) : '—'}</td>
                          {/* Current Qty + Weight (highlighted) */}
                          <td style={{ padding: cellPad, textAlign: 'right', fontWeight: 700, color: '#0a2540', borderLeft: '1px solid var(--border)' }}>{fmtNum(item.quantity, 2)}</td>
                          <td style={{ padding: cellPad, textAlign: 'right', fontWeight: 700, color: '#1e40af' }}>{item.weight > 0 ? fmtNum(item.weight, 1) : '—'}</td>
                          {/* Total Qty + Weight */}
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', borderLeft: '1px solid var(--border)' }}>{item.totalQty > 0 ? fmtNum(item.totalQty, 2) : fmtNum(item.quantity, 2)}</td>
                          <td style={{ padding: cellPad, textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{item.totalWeight > 0 ? fmtNum(item.totalWeight, 1) : (item.weight > 0 ? fmtNum(item.weight, 1) : '—')}</td>
                          <td style={{ padding: cellPad, textAlign: 'right', fontWeight: 600, color: available > 0 ? '#16a34a' : (match?.matched ? '#6366f1' : '#9ca3af') }}>
                            {match?.matched ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                <span title={`Tổng: ${fmtNum(match.currentStock, 0)} | Khả dụng: ${fmtNum(available, 0)} (chung: ${fmtNum(reusable, 0)} + DA này: ${fmtNum(thisProj, 0)}) | DA khác: ${fmtNum(otherProj, 0)}`}>
                                  {match.currentStock === 0 ? '0' : fmtNum(match.currentStock, 0)}
                                </span>
                                {available !== match.currentStock && (
                                  <span style={{ fontSize: '0.5rem', color: '#6b7280', fontWeight: 500 }}>
                                    {thisProj > 0 ? `DA này: ${fmtNum(thisProj, 0)}` : ''}{thisProj > 0 && reusable > 0 ? ' · ' : ''}{reusable > 0 ? `chung: ${fmtNum(reusable, 0)}` : ''}{(thisProj > 0 || reusable > 0) && otherProj > 0 ? ' · ' : ''}{otherProj > 0 ? `DA khác: ${fmtNum(otherProj, 0)}` : ''}
                                  </span>
                                )}
                                {(matchedByWeight || unitMismatch) && (
                                  <span style={{ fontSize: '0.52rem', color: matchedByWeight ? '#6b7280' : '#b45309', fontWeight: 600 }}>({match.inventoryUnit})</span>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          {/* Ngày cần hàng về (PM điền ngay cả khi form khoá) */}
                          <td style={{ padding: cellPad, borderLeft: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            {isEditable || canSetRequiredDate
                              ? <input type="date" value={item.requiredDate || ''} onChange={(e) => {
                                  if (isEditable) { patchItem(globalIdx, { requiredDate: e.target.value }) }
                                  else { saveRequiredDateServer(globalIdx, e.target.value); patchItem(globalIdx, { requiredDate: e.target.value }) }
                                }} style={{ fontSize: '0.68rem', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4 }} />
                              : <span style={{ fontSize: '0.7rem', color: item.requiredDate ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{item.requiredDate ? formatDate(item.requiredDate) : '—'}</span>}
                          </td>
                          {/* Tiến độ mua — tính theo khả dụng (chung + DA này) */}
                          <td style={{ padding: cellPad, whiteSpace: 'nowrap' }}>
                            {(() => {
                              const stt = item.procureStatus || ''
                              const cmap: Record<string, { c: string; b: string }> = { 'Đã về': { c: '#166534', b: '#dcfce7' }, 'Đang mua': { c: '#854d0e', b: '#fef9c3' }, 'Chưa mua': { c: '#991b1b', b: '#fee2e2' } }
                              const statusSelect = isEditable ? (
                                <select value={stt} onChange={(e) => patchItem(globalIdx, { procureStatus: e.target.value })} style={{ fontSize: '0.68rem', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4 }}>
                                  <option value="">— cần mua —</option><option>Chưa mua</option><option>Đang mua</option><option>Đã về</option>
                                </select>
                              ) : (cmap[stt] ? <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: cmap[stt].b, color: cmap[stt].c }}>{stt}</span> : null)
                              if (unitMismatch) {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ fontSize: '0.58rem', color: '#b45309', fontWeight: 600 }}>⚠ khác ĐVT ({item.unit}↔{match?.inventoryUnit})</span>
                                    <span style={{ fontSize: '0.56rem', color: '#92400e' }}>cần quy đổi</span>
                                    {statusSelect}
                                  </div>
                                )
                              }
                              if (match?.matched && stockSufficient) {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>✓ Đủ kho · xuất kho</span>
                                    {matchedByWeight && <span style={{ fontSize: '0.54rem', color: '#6b7280' }}>(so theo kg)</span>}
                                  </div>
                                )
                              }
                              if (match?.matched) {
                                const useKg = matchedByWeight
                                const demand = useKg ? needKg : item.quantity
                                const need = Math.max(0, demand - available)
                                const displayUnit = useKg ? 'kg' : item.unit
                                const onlyOtherProj = available === 0 && otherProj > 0
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {onlyOtherProj
                                      ? <span style={{ fontSize: '0.56rem', color: '#6366f1' }}>Có ở DA khác · không dùng</span>
                                      : available > 0
                                        ? <span style={{ fontSize: '0.6rem', color: '#854d0e' }}>Khả dụng {fmtNum(available, 0)} · thiếu {fmtNum(need, 1)} {displayUnit}</span>
                                        : null}
                                    <span style={{ fontSize: '0.6rem', color: '#991b1b', fontWeight: 600 }}>Cần mua: {fmtNum(need, 1)} {displayUnit}</span>
                                    {otherProj > 0 && available > 0 && <span style={{ fontSize: '0.5rem', color: '#6b7280' }}>(DA khác: {fmtNum(otherProj, 0)})</span>}
                                    {useKg && <span style={{ fontSize: '0.54rem', color: '#6b7280' }}>(so theo kg)</span>}
                                    {statusSelect}
                                  </div>
                                )
                              }
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ fontSize: '0.6rem', color: '#991b1b', fontWeight: 600 }}>Cần mua: {fmtNum(item.weight > 0 ? item.weight : item.quantity, 1)} {item.weight > 0 ? 'kg' : item.unit}</span>
                                  {statusSelect}
                                </div>
                              )
                            })()}
                          </td>
                          <td style={{ padding: cellPad, fontSize: '0.68rem', color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.remarks}>{item.remarks || '—'}</td>
                          <td style={{ padding: cellPad }}>
                            {match?.matched ? (() => {
                              const onlyOtherProj = available === 0 && otherProj > 0
                              const statusLabel = unitMismatch ? 'Khác ĐVT'
                                : stockSufficient ? 'Đủ kho'
                                : onlyOtherProj ? 'Có ở DA khác · cần mua'
                                : available === 0 && otherProj === 0 ? 'Đủ mã · Hết tồn'
                                : 'Thiếu'
                              const bg = unitMismatch ? '#fef3c7'
                                : stockSufficient ? '#dcfce7'
                                : onlyOtherProj ? '#ede9fe'
                                : available === 0 && otherProj === 0 ? '#e0e7ff'
                                : '#fef9c3'
                              const fg = unitMismatch ? '#92400e'
                                : stockSufficient ? '#166534'
                                : onlyOtherProj ? '#5b21b6'
                                : available === 0 && otherProj === 0 ? '#3730a3'
                                : '#854d0e'
                              return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color: fg, whiteSpace: 'nowrap' }}>
                                  {statusLabel}
                                  {match.viaSectionType && <span style={{ fontSize: '0.58rem', opacity: 0.8 }}> (tiết diện)</span>}
                                </span>
                                <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 600, color: '#0a2540', whiteSpace: 'nowrap' }}
                                  title={`${match.inventoryCode} — ${match.inventoryName}`}>
                                  {match.inventoryCode}
                                </span>
                                {unitMismatch && (
                                  <span style={{ fontSize: '0.56rem', color: '#b45309', fontWeight: 600 }}>⚠ {item.unit}↔{match.inventoryUnit}</span>
                                )}
                                {!unitMismatch && !stockSufficient && (
                                  <span style={{ fontSize: '0.58rem', color: '#4338ca', fontWeight: 600 }}>cần mua</span>
                                )}
                                {matchedByWeight && (
                                  <span style={{ fontSize: '0.54rem', color: '#6b7280' }}>(so theo kg)</span>
                                )}
                                {match.gradeWarning && (
                                  <span style={{ fontSize: '0.58rem', color: '#b45309', fontStyle: 'italic' }} title={match.gradeWarning}>
                                    ⚠ {match.gradeWarning}
                                  </span>
                                )}
                                {(match.sectionCandidates ?? 0) > 1 && (
                                  <span style={{ fontSize: '0.56rem', color: '#6b7280' }}>
                                    ({match.sectionCandidates} ứng viên)
                                  </span>
                                )}
                              </div>
                              )
                            })() : (
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' }}>
                                Chưa khớp kho
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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

      <QuickCreateMaterialDialog
        open={dialogIdx !== null}
        initialName={dialogIdx !== null ? [items[dialogIdx]?.description, items[dialogIdx]?.profile].filter(Boolean).join(' ') : ''}
        initialUnit={dialogIdx !== null ? items[dialogIdx]?.unit : ''}
        initialSpec={dialogIdx !== null ? (items[dialogIdx]?.grade || items[dialogIdx]?.profile) : ''}
        initialSearch={dialogIdx !== null ? profileSearchKey(items[dialogIdx]) : ''}
        defaultPrefix="VLC"
        onClose={() => setDialogIdx(null)}
        onPicked={(m) => {
          if (dialogIdx === null) return
          const provisional = !!m.isProvisional
          setNewCodes((prev) => new Map(prev).set(dialogIdx, { code: m.materialCode, provisional }))
          const updated = items.map((it, i) => i === dialogIdx ? { ...it, canonicalCode: m.materialCode, materialId: m.id, provisionalCode: provisional || undefined } : it)
          onChange(JSON.stringify(updated))
        }}
      />
    </div>
  )
}
