/**
 * LÔ 2 — parse 8 file BOM/PR bằng HÀM PARSE THẬT của ERP (parsePrExcel copy nguyên văn
 * từ src/app/dashboard/tasks/[id]/components/BomPrUploadUI.tsx — KHÔNG viết lại logic).
 * Chỉ PARSE + VERIFY weight (chưa ghi DB). Gate: Σ VTC weight/dự án ≈ DTTC (lệch ≤20%).
 *
 * Chạy: npx tsx scripts/import-bom-parse-verify.ts
 */
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

const BOM_DIR = path.join(process.cwd(), 'docs/handoff/import/bom')

// file ↔ project (theo I<nnn>)
const FILE_PROJECT: { match: RegExp; projectCode: string }[] = [
  { match: /I-?095/i, projectCode: '25-VPI-I-095' },
  { match: /I-?078/i, projectCode: '25-VPI-078' },
  { match: /I-?090/i, projectCode: '26-BRA-I-090' },
  { match: /I-?097/i, projectCode: '25-WNC-I-097' },
  { match: /I-?104/i, projectCode: '25-WNC-I-104' },
  { match: /I-?109/i, projectCode: '26-WNC-I-109' },
  { match: /I-?111/i, projectCode: '26-WNC-I-111' },
  { match: /I-?112/i, projectCode: '26-WNC-I-112' },
]

// DTTC target (kg) — thép chính (VTC) — để verify không chọn nhầm cột weight
const DTTC_TARGET: Record<string, number> = {
  '25-VPI-I-095': 2_790_000,
  '25-WNC-I-097': 182_000,
  '25-WNC-I-104': 29_500,
  '26-WNC-I-109': 35_500,
  '26-WNC-I-111': 71_900,
  '26-WNC-I-112': 114_000,
}

// ═══════════════════════════════════════════════════════════════
//  ⇩⇩⇩ COPY NGUYÊN VĂN từ BomPrUploadUI.tsx (parse thật) ⇩⇩⇩
// ═══════════════════════════════════════════════════════════════
/* eslint-disable @typescript-eslint/no-explicit-any */

interface PrMaterialItem {
  stt: string; description: string; profile: string; grade: string; type: string
  thickness: number; length: number; width: number; unit: string; unitWeight: number
  netQty: number; netWeight: number; prevQty: number; prevWeight: number
  quantity: number; weight: number; totalQty: number; totalWeight: number
  remarks: string; category: string; categoryName: string
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
  VTC01: 'Vật tư chính — Thép đen',
  VTC02: 'Vật tư chính — Khác',
  VTC03: 'Vật tư Grating',
  VTC04: 'Vật tư bảo ôn (Insulation)',
  VPK: 'Bu lông, đai ốc, phụ kiện',
  VDK: 'Vật tư đóng kiện',
}

function parsePrExcel(data: any[][]): PrMaterialItem[] {
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
// ═══════════════════════════════════════════════════════════════
//  ⇧⇧⇧ HẾT PHẦN COPY NGUYÊN VĂN ⇧⇧⇧
// ═══════════════════════════════════════════════════════════════

function parseFile(filePath: string): PrMaterialItem[] {
  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  // giống component: ưu tiên sheet 'PR', else sheet cuối
  const sheetName = wb.SheetNames.includes('PR') ? 'PR' : wb.SheetNames[wb.SheetNames.length - 1]
  const ws = wb.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 })
  return parsePrExcel(data)
}

function main() {
  const files = fs.readdirSync(BOM_DIR).filter(f => /\.xlsx?$/i.test(f))
  console.log(`=== Parse ${files.length} file BOM/PR (hàm parsePrExcel thật) ===\n`)

  const results: { project: string; file: string; items: PrMaterialItem[]; byCat: Map<string, { n: number; wt: number }> }[] = []

  for (const f of files.sort()) {
    const map = FILE_PROJECT.find(m => m.match.test(f))
    if (!map) { console.log(`⚠️  Bỏ qua (không map được project): ${f}`); continue }
    const items = parseFile(path.join(BOM_DIR, f))
    const byCat = new Map<string, { n: number; wt: number }>()
    for (const it of items) {
      const c = byCat.get(it.category) || { n: 0, wt: 0 }
      c.n++; c.wt += it.weight
      byCat.set(it.category, c)
    }
    results.push({ project: map.projectCode, file: f, items, byCat })
  }

  // VTC (thép chính) = item có mã (stt) chứa VTC (VTC01/VTC02...) — KHÔNG dựa field category (ra OTHER)
  const isVTC = (it: PrMaterialItem) => /vtc/i.test(it.stt)
  const pct = (a: number, t: number) => Math.abs(a - t) / t * 100

  console.log('── Đối chiếu cột weight cho item VTC (thép chính) vs DTTC ──')
  console.log('   (tìm cột weight đúng: net / current-ordered / previous / total)\n')
  for (const r of results.sort((a, b) => a.project.localeCompare(b.project))) {
    const vtc = r.items.filter(isVTC)
    const sum = (f: (i: PrMaterialItem) => number) => vtc.reduce((s, i) => s + (f(i) || 0), 0)
    const sNet = sum(i => i.netWeight)
    const sCur = sum(i => i.weight)        // current-ordered (parsePrExcel primary)
    const sPrev = sum(i => i.prevWeight)
    const sTot = sum(i => i.totalWeight)
    const target = DTTC_TARGET[r.project]
    console.log(`▶ ${r.project}  (${r.file}) — ${r.items.length} item, VTC ${vtc.length}`)
    if (!target) { console.log(`   (không có DTTC target) net=${Math.round(sNet).toLocaleString()} cur=${Math.round(sCur).toLocaleString()}\n`); continue }
    const rowFmt = (label: string, v: number) => `      ${label.padEnd(16)} ${Math.round(v).toLocaleString().padStart(12)} kg   lệch ${pct(v, target).toFixed(1).padStart(5)}%  ${pct(v, target) <= 20 ? '✅' : '  '}`
    console.log(`   DTTC target: ${target.toLocaleString()} kg`)
    console.log(rowFmt('netWeight', sNet))
    console.log(rowFmt('current-ordered', sCur))
    console.log(rowFmt('previousOrdered', sPrev))
    console.log(rowFmt('totalOrdered', sTot))
    console.log('')
  }
}

main()
