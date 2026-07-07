/**
 * parsePrExcel — COPY NGUYÊN VĂN từ src/app/dashboard/tasks/[id]/components/BomPrUploadUI.tsx
 * (hàm parse THẬT của ERP — KHÔNG viết lại). Dùng chung cho các script import lô BOM/PR.
 */
import * as XLSX from 'xlsx'
import * as fs from 'fs'
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PrMaterialItem {
  stt: string; description: string; profile: string; grade: string; type: string
  thickness: number; length: number; width: number; unit: string; unitWeight: number
  netQty: number; netWeight: number; prevQty: number; prevWeight: number
  quantity: number; weight: number; totalQty: number; totalWeight: number
  remarks: string; category: string; categoryName: string
  canonicalCode?: string; materialId?: string; provisionalCode?: boolean
  [key: string]: unknown
}

function isCategoryRow(stt: string, unit: string | undefined): boolean {
  if (!stt) return false
  if (unit && unit.trim()) return false
  if (/^[A-Z]\.$/.test(stt.trim())) return true
  if (/^[A-Z0-9-]+-[A-Z]+\d{2}$/.test(stt.trim())) return true
  if (/^[A-Z]+\d{2}$/.test(stt.trim())) return true
  return false
}

function isFooterRow(stt: string): boolean {
  const lower = (stt || '').toLowerCase().trim()
  return ['priority', 'remarks', 'assign', 'purpose', 'for in-house', 'lost', 'consumables', 'name/', 'position/', 'signature/', 'date/'].some(k => lower.startsWith(k))
}

function extractCategory(stt: string): string {
  const parts = stt.split('-')
  if (parts.length >= 3) return parts[parts.length - 2]
  if (parts.length === 2) return parts[0]
  return 'OTHER'
}

const CATEGORY_LABELS: Record<string, string> = {
  VTC01: 'Vật tư chính — Thép đen', VTC02: 'Vật tư chính — Khác',
  VTC03: 'Vật tư Grating', VTC04: 'Vật tư bảo ôn (Insulation)',
  VPK: 'Bu lông, đai ốc, phụ kiện', VDK: 'Vật tư đóng kiện',
}

export function parsePrExcel(data: any[][]): PrMaterialItem[] {
  const S = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
  const N = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n }

  let headerIdx = -1
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i] || []
    const hasItem = row.some((c: any) => /\bitem\b|\bstt\b/i.test(S(c)))
    const hasDesc = row.some((c: any) => /description|chi ti[ếê]t|di[ễê]n gi[ảa]i/i.test(S(c)))
    if (hasItem && hasDesc) { headerIdx = i; break }
  }
  if (headerIdx < 0) return []

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

    const netQty = cNetQty >= 0 ? N(row[cNetQty]) : 0
    const netWeight = cNetQty >= 0 ? N(row[cNetQty + 1]) : 0
    const prevQty = cPrev >= 0 ? N(row[cPrev]) : 0
    const prevWeight = cPrev >= 0 ? N(row[cPrev + 1]) : 0
    const totalQty = cTotal >= 0 ? N(row[cTotal]) : 0
    const totalWeight = cTotal >= 0 ? N(row[cTotal + 1]) : 0

    let curQty = 0, curWeight = 0
    for (const ci of cCurrentAll) {
      const q = N(row[ci])
      if (q !== 0) { curQty = q; curWeight = N(row[ci + 1]) }
    }

    const quantity = totalQty || curQty || netQty
    const weight = totalWeight || curWeight || netWeight
    if (quantity === 0 && weight === 0) continue

    const cat = currentCategory || extractCategory(stt)
    const remarks = cRemarks >= 0 ? S(row[cRemarks]) : ''

    items.push({
      stt, description, profile, grade, type, thickness, length, width,
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
      remarks, category: cat,
      categoryName: currentCategoryName || CATEGORY_LABELS[cat] || cat,
    })
  }
  return items
}

/** Đọc 1 file xlsx → parse (giống BomPrUploadUI: ưu tiên sheet 'PR', else sheet cuối) */
export function parseFile(filePath: string): PrMaterialItem[] {
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' })
  const sheetName = wb.SheetNames.includes('PR') ? 'PR' : wb.SheetNames[wb.SheetNames.length - 1]
  const data = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1 })
  return parsePrExcel(data)
}
