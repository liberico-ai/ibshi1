import { detectSectionType, normalizeDims, dimsMatch } from './section-type'

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
  matchedPrIndex: number | null
  matchedPrCode: string | null
}

export interface PrItem {
  stt?: string
  code?: string
  materialCode?: string
  description?: string
  materialName?: string
  name?: string
  profile?: string
  grade?: string
  unit?: string
  uom?: string
  quantity?: number
  qty?: number
}

// ── Helpers ──

const S = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const N = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n }

const SKIP_ROW = /^(total|tổng|sub\s*total|cộng|ghi\s*ch[úu]|note|remarks|priority|name\/|signature\/|date\/)/i
const CATEGORY_ROW = /^[A-Z]\.\s|^(VTC|VPK|VDK|VHN)\d{0,2}\b/i

// ── Parse quote Excel ──

export function parseQuoteExcel(data: unknown[][]): QuoteLine[] {
  const headerIdx = findHeaderRow(data)
  if (headerIdx < 0) return []

  const H = (data[headerIdx] as unknown[]).map(S)
  const find = (re: RegExp) => H.findIndex(h => re.test(h))

  const cCode = Math.max(0, find(/\bitem\b|\bstt\b|\bm[ãa]\b/i))
  const cDesc = find(/description|chi ti[ếê]t|di[ễê]n gi[ảa]i|t[êe]n\s*v[ậa]t\s*t[ưu]/i)
  const cProfile = find(/profile|quy\s*c[áa]ch/i)
  const cGrade = find(/grade|m[áa]c/i)
  const cUnit = find(/\bunit\b|[đd][ơo]n\s*v[ịi]|[đd]vt/i)
  const cQty = find(/s[ốo]\s*l[ưu][ợo]ng|quantity|\bq\.?ty\b|\bsl\b/i)
  const cUnitPrice = find(/[đd][ơo]n\s*gi[áa]|unit\s*price/i)
  const cAmount = find(/th[àa]nh\s*ti[ềe]n|amount|total/i)

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

    lines.push({
      code, description, profile, grade, unit,
      qty: Math.round(qty * 1000) / 1000,
      unitPrice: Math.round(unitPrice * 100) / 100,
      amount: Math.round(amount * 100) / 100,
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
  const getPrDesc = (p: PrItem) => p.description || p.materialName || p.name || ''
  const getPrProfile = (p: PrItem) => p.profile || ''
  const getPrGrade = (p: PrItem) => p.grade || ''
  const getPrUnit = (p: PrItem) => (p.unit || p.uom || '').toLowerCase()

  return lines.map(line => {
    // Strategy 1: exact code match
    const codeIdx = prItems.findIndex((p, i) => !prUsed.has(i) && getPrCode(p) && getPrCode(p) === line.code)
    if (codeIdx >= 0) {
      prUsed.add(codeIdx)
      return { ...line, matchedPrIndex: codeIdx, matchedPrCode: getPrCode(prItems[codeIdx]) }
    }

    // Strategy 2: section type + dimensions + grade + unit
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
