import { detectSectionType, normalizeDims, dimsMatch } from './section-type'
import { toQty } from './pr-normalizer'

// ── Types ──

export interface QuoteLine {
  code: string
  description: string
  profile: string
  grade: string
  unit: string
  qty: number
  unitPrice: number
  amount: number
  vatPercent?: number
  matchedPrIndex: number | null
  matchedPrCode: string | null
}

export interface PrItem {
  stt?: string
  code?: string
  materialCode?: string
  canonicalCode?: string
  description?: string
  materialName?: string
  name?: string
  profile?: string
  grade?: string
  unit?: string
  uom?: string
  quantity?: number
  qty?: number
  neededQty?: number
  availableQty?: number
  needToBuyQty?: number
  requiredDate?: string
}

// ── Helpers ──

const S = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const N = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n }

export function normSpec(s: string): string {
  return s.toUpperCase().replace(/[\s\-\.\/]/g, '')
}

function normSpecMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return long.includes(short) && short.length >= long.length * 0.5
}

const SKIP_ROW = /^(total|tổng|sub\s*total|cộng|ghi\s*ch[úu]|note|remarks|priority|name\/|signature\/|date\/)/i
const CATEGORY_ROW = /^[A-Z]\.\s|^(VTC|VPK|VDK|VHN)\d{0,2}\b/i

// ── Parse quote Excel ──

export function parseQuoteExcel(data: unknown[][]): QuoteLine[] {
  const isStd = data.slice(0, 10).some(row =>
    Array.isArray(row) && row.some(cell => /BG\s*chu[ẩa]n\s*h[oó]a/i.test(S(cell)))
  )

  const headerIdx = findHeaderRow(data)
  if (headerIdx < 0) return []

  const H = (data[headerIdx] as unknown[]).map(S)
  const find = (re: RegExp) => H.findIndex(h => re.test(h))
  const findLast = (re: RegExp) => { for (let i = H.length - 1; i >= 0; i--) if (re.test(H[i])) return i; return -1 }

  const cCode = Math.max(0, find(/\bitem\b|\bstt\b|\bm[ãa]\b/i))
  const cDesc = find(/description|chi ti[ếê]t|di[ễê]n gi[ảa]i|t[êe]n\s*v[ậa]t\s*t[ưu]/i)
  const cProfile = find(/profile|quy\s*c[áa]ch/i)
  const cGrade = find(/grade|m[áa]c/i)
  const cUnit = find(/\bunit\b|[đd][ơo]n\s*v[ịi]|[đd]vt/i)
  const qtyRe = /s[ốo]\s*l[ưu][ợo]ng|quantity|\bq\.?ty\b|\bsl\b/i
  const cQty = isStd ? findLast(qtyRe) : find(qtyRe)
  const cUnitPrice = find(/[đd][ơo]n\s*gi[áa]|unit\s*price/i)
  const cAmount = find(/th[àa]nh\s*ti[ềe]n|amount|total/i)
  const cVat = find(/\bvat\b/i)

  let start = headerIdx + 1
  while (start < data.length) {
    const row = data[start] as unknown[] | undefined
    if (!row) { start++; continue }
    if (row.some(c => /^q\.?ty|^weight|^s[ốo]\s*l[ưượơ]ng|^kh[ốo]i\s*l[ưượơ]ng/i.test(S(c)))) { start++; continue }
    break
  }

  const lines: QuoteLine[] = []
  for (let i = start; i < data.length; i++) {
    const row = data[i] as unknown[] | undefined
    if (!row || row.every(c => c == null || c === '')) continue

    const code = S(row[cCode])
    if (!code) continue
    if (SKIP_ROW.test(code)) break
    if (CATEGORY_ROW.test(code)) continue

    const description = cDesc >= 0 ? S(row[cDesc]) : ''
    if (description && !/[a-zA-ZÀ-ỹ]/.test(description)) continue

    const profile = cProfile >= 0 ? S(row[cProfile]) : ''
    const grade = cGrade >= 0 ? S(row[cGrade]) : ''
    const unit = cUnit >= 0 ? S(row[cUnit]).toLowerCase() : ''
    const qty = cQty >= 0 ? N(row[cQty]) : 0
    const unitPrice = cUnitPrice >= 0 ? N(row[cUnitPrice]) : 0
    const amount = cAmount >= 0 ? N(row[cAmount]) : (qty * unitPrice)

    if (qty === 0 && unitPrice === 0 && amount === 0) continue

    const rawVat = cVat >= 0 ? N(row[cVat]) : undefined
    const vatPercent = rawVat !== undefined && rawVat > 0 ? (rawVat < 1 ? Math.round(rawVat * 100) : rawVat <= 100 ? rawVat : undefined) : undefined

    lines.push({
      code, description, profile, grade, unit,
      qty: Math.round(qty * 1000) / 1000,
      unitPrice: Math.round(unitPrice * 100) / 100,
      amount: Math.round(amount * 100) / 100,
      vatPercent,
      matchedPrIndex: null,
      matchedPrCode: null,
    })
  }

  return lines
}

function findHeaderRow(data: unknown[][]): number {
  for (let i = 0; i < Math.min(30, data.length); i++) {
    const row = data[i] as unknown[] | undefined
    if (!row) continue
    const cells = row.map(S)
    const hasItem = cells.some(c => /\bitem\b|\bstt\b|\bm[ãa]\b/i.test(c))
    const hasPrice = cells.some(c => /[đd][ơo]n\s*gi[áa]|unit\s*price|th[àa]nh\s*ti[ềe]n|amount/i.test(c))
    if (hasItem && hasPrice) return i
  }
  return -1
}

// ── Match quote lines ↔ PR items ──

export function matchQuoteLinesToPr(lines: QuoteLine[], prItems: PrItem[]): QuoteLine[] {
  const prUsed = new Set<number>()

  const getPrCode = (p: PrItem) => p.stt || p.code || p.materialCode || ''
  const getCanonical = (p: PrItem) => p.canonicalCode || ''
  const getPrDesc = (p: PrItem) => p.description || p.materialName || p.name || ''
  const getPrProfile = (p: PrItem) => p.profile || ''
  const getPrGrade = (p: PrItem) => p.grade || ''
  const getPrUnit = (p: PrItem) => (p.unit || p.uom || '').toLowerCase()

  return lines.map(line => {
    // Strategy 0: match by canonicalCode (VLC-* material code assigned from inventory)
    const canonIdx = prItems.findIndex((p, i) => !prUsed.has(i) && getCanonical(p) && getCanonical(p) === line.code)
    if (canonIdx >= 0) {
      prUsed.add(canonIdx)
      return { ...line, matchedPrIndex: canonIdx, matchedPrCode: getCanonical(prItems[canonIdx]) }
    }

    // Strategy 1: exact STT/code match
    const codeIdx = prItems.findIndex((p, i) => !prUsed.has(i) && getPrCode(p) && getPrCode(p) === line.code)
    if (codeIdx >= 0) {
      prUsed.add(codeIdx)
      return { ...line, matchedPrIndex: codeIdx, matchedPrCode: getPrCode(prItems[codeIdx]) }
    }

    // Strategy 1.5: quote line code matches a PR item's canonicalCode
    const revIdx = prItems.findIndex((p, i) => !prUsed.has(i) && getCanonical(p) && line.code && getCanonical(p) === line.code)
    if (revIdx >= 0) {
      prUsed.add(revIdx)
      return { ...line, matchedPrIndex: revIdx, matchedPrCode: getCanonical(prItems[revIdx]) }
    }

    // Strategy 1.7: normalized specification match (bolts, nuts, washers, misc)
    const lineNorm = normSpec(line.profile || line.description)
    if (lineNorm.length >= 3) {
      for (let i = 0; i < prItems.length; i++) {
        if (prUsed.has(i)) continue
        const p = prItems[i]
        const pNorm = normSpec(getPrProfile(p) || getPrDesc(p))
        if (!pNorm || pNorm.length < 3) continue
        if (normSpecMatch(lineNorm, pNorm)) {
          const pUnit = getPrUnit(p)
          if (line.unit && pUnit && line.unit !== pUnit) continue
          prUsed.add(i)
          return { ...line, matchedPrIndex: i, matchedPrCode: getPrCode(p) }
        }
      }
    }

    // Strategy 2: profile+grade matching via section type + dimensions
    const lineText = `${line.description} ${line.profile}`
    const lineSection = detectSectionType(lineText)
    const lineDims = normalizeDims(line.profile || line.description)

    for (let i = 0; i < prItems.length; i++) {
      if (prUsed.has(i)) continue
      const p = prItems[i]
      const pText = `${getPrDesc(p)} ${getPrProfile(p)}`
      const pSection = detectSectionType(pText)
      const pDims = normalizeDims(getPrProfile(p) || getPrDesc(p))
      const pUnit = getPrUnit(p)

      if (!lineSection || !pSection || lineSection !== pSection) continue
      if (!lineDims || !pDims || !dimsMatch(lineDims, pDims)) continue
      if (line.unit && pUnit && line.unit !== pUnit) continue

      const gradeOk = !line.grade || !getPrGrade(p) || line.grade.toLowerCase() === getPrGrade(p).toLowerCase()
      if (gradeOk) {
        prUsed.add(i)
        return { ...line, matchedPrIndex: i, matchedPrCode: getPrCode(p) }
      }
    }

    // Strategy 3: section type + dims only (ignore grade)
    if (lineSection && lineDims) {
      for (let i = 0; i < prItems.length; i++) {
        if (prUsed.has(i)) continue
        const p = prItems[i]
        const pText = `${getPrDesc(p)} ${getPrProfile(p)}`
        const pSection = detectSectionType(pText)
        const pDims = normalizeDims(getPrProfile(p) || getPrDesc(p))

        if (lineSection === pSection && pDims && dimsMatch(lineDims, pDims)) {
          prUsed.add(i)
          return { ...line, matchedPrIndex: i, matchedPrCode: getPrCode(p) }
        }
      }
    }

    return line
  })
}

// ── Quote coverage analysis ──

export interface CoverageResult {
  totalNeedToBuy: number
  coveredCount: number
  coveragePercent: number
  missingItems: Array<{ index: number; stt: string; canonicalCode: string; description: string; needToBuyQty: number }>
  perItemVendorCount: Record<number, number>
}

export function computeQuoteCoverage(prItems: PrItem[], allQuotes: Array<{ lines?: QuoteLine[] }>): CoverageResult {
  // toQty: dòng lưu số dạng CHUỖI ({"needToBuyQty":"1"}) trước đây bị `typeof === 'number'`
  // lọc văng khỏi ma trận báo giá → R07 không nhìn thấy vật tư để đi hỏi giá.
  const needToBuyItems = prItems
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => toQty(p.needToBuyQty) > 0)

  const totalNeedToBuy = needToBuyItems.length
  const perItemVendorCount: Record<number, number> = {}

  for (const { i } of needToBuyItems) {
    let count = 0
    for (const q of allQuotes) {
      if (!q.lines) continue
      const hasPrice = q.lines.some(l => l.matchedPrIndex === i && l.unitPrice > 0)
      if (hasPrice) count++
    }
    perItemVendorCount[i] = count
  }

  const coveredCount = needToBuyItems.filter(({ i }) => perItemVendorCount[i] > 0).length
  const coveragePercent = totalNeedToBuy > 0 ? Math.round((coveredCount / totalNeedToBuy) * 100) : 100

  const missingItems = needToBuyItems
    .filter(({ i }) => !perItemVendorCount[i])
    .map(({ p, i }) => ({
      index: i,
      stt: p.stt || '',
      canonicalCode: p.canonicalCode || '',
      description: p.description || p.materialName || p.name || '',
      needToBuyQty: p.needToBuyQty!,
    }))

  return { totalNeedToBuy, coveredCount, coveragePercent, missingItems, perItemVendorCount }
}

export interface QtyMismatch {
  lineIndex: number
  qtyQuote: number
  qtyPr: number
  delta: number
}

export function computeQtyMismatches(lines: QuoteLine[], prItems: PrItem[]): QtyMismatch[] {
  const result: QtyMismatch[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.matchedPrIndex == null) continue
    const pr = prItems[l.matchedPrIndex]
    if (!pr || typeof pr.needToBuyQty !== 'number') continue
    if (l.qty !== pr.needToBuyQty) {
      result.push({ lineIndex: i, qtyQuote: l.qty, qtyPr: pr.needToBuyQty, delta: l.qty - pr.needToBuyQty })
    }
  }
  return result
}
