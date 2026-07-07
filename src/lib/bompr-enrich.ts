import prisma from '@/lib/db'
import { detectSectionType, normalizeDims, dimsMatch } from './section-type'
import { generateMaterialCode } from './material-code'

// ── Types (mirror FE BomPrUploadUI) ──

interface PrItem {
  stt: string
  description: string
  profile: string
  grade: string
  unit: string
  quantity: number
  weight: number
  unitWeight: number
  thickness: number
  length: number
  width: number
  canonicalCode?: string
  materialId?: string
  neededQty?: number
  availableQty?: number
  needToBuyQty?: number
  stockUnit?: string
  stockConvertedFromKg?: boolean
  stockUnitMismatch?: boolean
  provisionalCode?: boolean
  [key: string]: unknown
}

export interface InventoryRow {
  id: string
  materialCode: string
  name: string
  unit: string
  specification: string | null
  grade: string | null
  groupCode: string | null
  currentStock: number
  reusableStock: number
  projectStock: number
  projectWarehouses: { projectCode: string; quantity: number }[]
}

interface MatchResult {
  inv: InventoryRow | null
  viaCode?: boolean
}

// ── Shared helpers (same as FE matchInventory) ──

const normDim = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[×*]/g, 'x')

function extractDimsFromName(name: string): number[] {
  const nums: number[] = []
  const cleaned = name.replace(/[×*]/g, 'x')
  for (const m of cleaned.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const n = parseFloat(m[1])
    if (n > 0 && n < 100000) nums.push(n)
  }
  return nums
}

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

// ── Load all active inventory from DB ──

const REUSABLE_KINDS = new Set(['COMMON', 'RETURN'])

async function loadInventory(): Promise<InventoryRow[]> {
  const materials = await prisma.material.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, materialCode: true, name: true, unit: true,
      category: true, groupCode: true, specification: true, grade: true, currentStock: true,
      stocks: {
        where: { quantity: { gt: 0 } },
        select: { quantity: true, warehouse: { select: { code: true, kind: true, projectCode: true } } },
      },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return materials.map((m: any) => {
    let reusableStock = 0, projectStock = 0
    const projectWarehouses: { projectCode: string; quantity: number }[] = []
    for (const s of m.stocks || []) {
      const qty = Number(s.quantity)
      if (REUSABLE_KINDS.has(s.warehouse.kind)) reusableStock += qty
      else if (s.warehouse.kind === 'PROJECT') {
        projectStock += qty
        projectWarehouses.push({ projectCode: s.warehouse.projectCode || s.warehouse.code, quantity: qty })
      }
    }
    return {
      id: m.id, materialCode: m.materialCode, name: m.name, unit: m.unit,
      specification: m.specification, grade: m.grade, groupCode: m.groupCode,
      currentStock: Number(m.currentStock), reusableStock, projectStock, projectWarehouses,
    }
  })
}

async function loadCodeResolved(codes: string[]): Promise<Map<string, InventoryRow>> {
  const clean = codes.filter(Boolean)
  if (clean.length === 0) return new Map()
  const out = new Map<string, InventoryRow>()

  const mats = await prisma.material.findMany({
    where: { materialCode: { in: clean }, status: 'ACTIVE' },
    select: {
      id: true, materialCode: true, name: true, unit: true,
      specification: true, grade: true, groupCode: true, currentStock: true,
      stocks: {
        where: { quantity: { gt: 0 } },
        select: { quantity: true, warehouse: { select: { code: true, kind: true, projectCode: true } } },
      },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildRow(code: string, m: any) {
    let reusableStock = 0, projectStock = 0
    const projectWarehouses: { projectCode: string; quantity: number }[] = []
    for (const s of m.stocks || []) {
      const qty = Number(s.quantity)
      if (REUSABLE_KINDS.has(s.warehouse.kind)) reusableStock += qty
      else if (s.warehouse.kind === 'PROJECT') {
        projectStock += qty
        projectWarehouses.push({ projectCode: s.warehouse.projectCode || s.warehouse.code, quantity: qty })
      }
    }
    out.set(code, {
      id: m.id, materialCode: m.materialCode, name: m.name, unit: m.unit,
      specification: m.specification, grade: m.grade, groupCode: m.groupCode,
      currentStock: Number(m.currentStock), reusableStock, projectStock, projectWarehouses,
    })
  }

  for (const m of mats) buildRow(m.materialCode, m)

  const remaining = clean.filter(c => !out.has(c))
  if (remaining.length > 0) {
    const aliases = await prisma.materialCodeAlias.findMany({
      where: { aliasCode: { in: remaining } },
      select: {
        aliasCode: true,
        material: {
          select: {
            id: true, materialCode: true, name: true, unit: true,
            specification: true, grade: true, groupCode: true, currentStock: true,
            stocks: {
              where: { quantity: { gt: 0 } },
              select: { quantity: true, warehouse: { select: { code: true, kind: true, projectCode: true } } },
            },
          },
        },
      },
    })
    for (const a of aliases) {
      if (a.material) buildRow(a.aliasCode, a.material)
    }
  }

  return out
}

// ── Match PR items ↔ inventory (same strategies as FE matchInventory) ──

export function matchInventoryServer(
  items: PrItem[],
  inventory: InventoryRow[],
  codeResolved: Map<string, InventoryRow>,
): Map<number, MatchResult> {
  const matches = new Map<number, MatchResult>()

  // Pre-compute section type index
  type SectionEntry = { inv: InventoryRow; dims: string; grade: string }
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

    // Strategy 0: canonicalCode
    if (pr.canonicalCode) {
      const resolved = codeResolved.get(pr.canonicalCode)
      if (resolved) {
        matches.set(i, { inv: resolved, viaCode: true })
        continue
      }
    }

    // Strategy 1: exact specification match on profile
    let inv: InventoryRow | undefined
    if (pr.profile) {
      inv = inventory.find(m =>
        m.specification?.trim().toLowerCase() === pr.profile.toLowerCase() &&
        (m.unit || '').toLowerCase() === (pr.unit || '').toLowerCase()
      )
    }

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

    // Strategy 2.5: section type + dims matching
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
              matches.set(i, { inv: gradeExact[0].inv })
              continue
            } else if (gradeExact.length > 1) {
              const best = gradeExact.reduce((a, b) => b.inv.currentStock > a.inv.currentStock ? b : a)
              matches.set(i, { inv: best.inv })
              continue
            } else if (dimMatches.length === 1) {
              matches.set(i, { inv: dimMatches[0].inv })
              continue
            } else {
              const best = dimMatches.reduce((a, b) => b.inv.currentStock > a.inv.currentStock ? b : a)
              matches.set(i, { inv: best.inv })
              continue
            }
          }
        }
      }
    }

    // Strategy 3: detail matching by group + dimensions + grade
    if (!inv && (pr.thickness > 0 || pr.width > 0 || pr.length > 0)) {
      const descAndProfile = `${pr.description} ${pr.profile} ${pr.grade}`.toLowerCase()
      const candidateGroups: string[] = []
      for (const [re, groups] of PR_TYPE_TO_GROUP) {
        if (re.test(descAndProfile)) candidateGroups.push(...groups)
      }

      if (candidateGroups.length > 0) {
        const gradeNorm = normDim(pr.grade || '')
        const groupInv = inventory.filter(m => m.groupCode && candidateGroups.includes(m.groupCode))

        let bestMatch: InventoryRow | null = null
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

    matches.set(i, { inv: inv || null })
  }

  return matches
}

// ── Enrichment (same formula as FE enrichItems) ──

const r3 = (n: number) => Math.round(n * 1000) / 1000
const r2 = (n: number) => Math.round(n * 100) / 100

function computeEnrichment(
  item: PrItem,
  inv: InventoryRow | null,
  projectCode: string | undefined,
): Partial<PrItem> {
  const needed = item.quantity

  if (!inv) {
    return { neededQty: needed, availableQty: 0, needToBuyQty: needed, stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
  }

  const sameUnit = !!(inv.unit && item.unit && inv.unit.toLowerCase() === item.unit.toLowerCase())
  const needKg = item.weight > 0 ? item.weight : item.unitWeight > 0 ? item.quantity * item.unitWeight : 0
  const canKg = !sameUnit && inv.unit?.toLowerCase() === 'kg' && needKg > 0

  const reusable = inv.reusableStock
  const thisProj = inv.projectWarehouses
    .filter(p => projectCode && p.projectCode === projectCode)
    .reduce((s, p) => s + p.quantity, 0)
  const avail = reusable + thisProj

  if (sameUnit) {
    const a = r3(avail)
    return { neededQty: needed, availableQty: a, needToBuyQty: r3(Math.max(0, needed - a)), stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
  }

  if (canKg && item.unitWeight > 0) {
    const a = r3(avail / item.unitWeight)
    return { neededQty: needed, availableQty: a, needToBuyQty: r3(Math.max(0, needed - a)), stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
  }

  if (canKg) {
    const nk = r2(needKg)
    const ak = r2(avail)
    return { neededQty: nk, availableQty: ak, needToBuyQty: r2(Math.max(0, nk - ak)), stockUnit: 'kg', stockConvertedFromKg: true, stockUnitMismatch: false }
  }

  return { neededQty: needed, availableQty: 0, needToBuyQty: needed, stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: true }
}

// ── Auto-create provisional material codes ──

export function detectPrefixSubgroup(item: { description?: string; profile?: string }): { prefix: string; subgroup: string } {
  const desc = `${item.description || ''} ${item.profile || ''}`.toLowerCase()
  if (/grating/i.test(desc)) return { prefix: 'GRT', subgroup: 'GRTN' }
  if (/bu[\s-]?l[oô]ng/i.test(desc)) return { prefix: 'BAH', subgroup: 'BULO' }
  if (/[eê][\s-]?cu|đai\s*[oố]c/i.test(desc)) return { prefix: 'BAH', subgroup: 'ECUA' }
  if (/b[ií]ch|flange/i.test(desc)) return { prefix: 'BAH', subgroup: 'BICH' }
  if (/inox|stainless/i.test(desc)) return { prefix: 'VLI', subgroup: 'INOX' }
  if (/t[oô]n|plate|t[aấ]m/i.test(desc)) return { prefix: 'VLC', subgroup: 'TAM' }
  if (/h[iì]nh|beam|channel|angle/i.test(desc)) return { prefix: 'VLC', subgroup: 'HINH' }
  if (/[oôố]ng|pipe|tube/i.test(desc)) return { prefix: 'VLC', subgroup: 'ONG' }
  if (/flat[\s-]?bar|x[eẹ]p|d[eẹ]t/i.test(desc)) return { prefix: 'VLC', subgroup: 'DEP' }
  if (/s[oơ]n|paint/i.test(desc)) return { prefix: 'VLP', subgroup: 'SON' }
  if (/que\s*h[aà]n|d[aâ]y\s*h[aà]n|weld/i.test(desc)) return { prefix: 'VLH', subgroup: 'HAN' }
  if (/th[eé]p/i.test(desc)) return { prefix: 'VLC', subgroup: 'THEP' }
  return { prefix: 'VLP', subgroup: 'KHAC' }
}

function provisionalDedupeKey(item: PrItem): string {
  return [
    (item.profile || '').trim().toLowerCase(),
    (item.grade || '').trim().toLowerCase(),
    (item.unit || '').trim().toLowerCase(),
  ].join('|')
}

async function autoCreateProvisionalCodes(
  items: PrItem[],
  matchMap: Map<number, MatchResult>,
): Promise<Map<number, { code: string; materialId: string }>> {
  const result = new Map<number, { code: string; materialId: string }>()

  const needsCode: { idx: number; item: PrItem; key: string }[] = []
  for (let i = 0; i < items.length; i++) {
    if (matchMap.get(i)?.inv) continue
    if (items[i].canonicalCode) continue
    if (!items[i].profile && !items[i].description) continue
    needsCode.push({ idx: i, item: items[i], key: provisionalDedupeKey(items[i]) })
  }

  if (needsCode.length === 0) return result

  const groups = new Map<string, typeof needsCode>()
  for (const entry of needsCode) {
    if (!groups.has(entry.key)) groups.set(entry.key, [])
    groups.get(entry.key)!.push(entry)
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const [, entries] of groups) {
        const rep = entries[0].item
        const spec = (rep.profile || '').trim()
        const grade = (rep.grade || '').trim()
        const unit = (rep.unit || '').trim()

        const existing = await tx.material.findFirst({
          where: {
            isProvisional: true,
            specification: spec || null,
            unit: unit || undefined,
            grade: grade || null,
          },
          select: { id: true, materialCode: true },
        })

        if (existing) {
          for (const e of entries) {
            result.set(e.idx, { code: existing.materialCode, materialId: existing.id })
          }
          continue
        }

        const { prefix, subgroup } = detectPrefixSubgroup(rep)
        let code: string | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = await generateMaterialCode(tx, prefix, subgroup)
          const clash = await tx.material.findUnique({ where: { materialCode: candidate }, select: { id: true } })
          if (!clash) { code = candidate; break }
        }
        if (!code) continue

        const material = await tx.material.create({
          data: {
            materialCode: code,
            name: (rep.description || '').trim() || spec || 'Vật tư tạm',
            unit: unit || 'cái',
            category: prefix,
            specification: spec || undefined,
            grade: grade || undefined,
            status: 'PENDING',
            isProvisional: true,
            createdByUnit: 'SYSTEM',
          },
        })

        for (const e of entries) {
          result.set(e.idx, { code: material.materialCode, materialId: material.id })
        }
      }
    })
  } catch (err) {
    console.error('autoCreateProvisionalCodes error:', err)
  }

  return result
}

// ── Public API ──

export async function enrichBomPrItems(
  items: PrItem[],
  projectCode: string | undefined,
  opts?: { matchOnly?: boolean },
): Promise<PrItem[]> {
  const codes = items.map(it => it.canonicalCode).filter(Boolean) as string[]
  const [inventory, codeResolved] = await Promise.all([
    loadInventory(),
    loadCodeResolved(codes),
  ])

  const matchMap = matchInventoryServer(items, inventory, codeResolved)

  // matchOnly: chỉ gắn materialId khi khớp kho, KHÔNG tạo mã tạm (dùng cho import lô — item không khớp để materialId=null)
  const provisionalMap = opts?.matchOnly
    ? new Map<number, { code: string; materialId: string }>()
    : await autoCreateProvisionalCodes(items, matchMap)

  return items.map((item, idx) => {
    const match = matchMap.get(idx)
    const inv = match?.inv || null
    const patch = computeEnrichment(item, inv, projectCode)
    const provisional = provisionalMap.get(idx)
    return {
      ...item,
      ...patch,
      ...(inv ? { materialId: inv.id, canonicalCode: item.canonicalCode || inv.materialCode } : {}),
      ...(!inv && provisional ? { materialId: provisional.materialId, canonicalCode: provisional.code, provisionalCode: true } : {}),
    }
  })
}
