import prisma from '@/lib/db'

interface PrItem {
  stt: string
  description: string
  profile: string
  grade: string
  unit: string
  quantity: number
  weight: number
  unitWeight: number
  canonicalCode?: string
  materialId?: string
  neededQty?: number
  availableQty?: number
  needToBuyQty?: number
  stockUnit?: string
  stockConvertedFromKg?: boolean
  stockUnitMismatch?: boolean
  [key: string]: unknown
}

interface StockInfo {
  id: string
  materialCode: string
  name: string
  unit: string
  currentStock: number
  reusableStock: number
  projectWarehouses: { projectCode: string; quantity: number }[]
}

const REUSABLE_KINDS = new Set(['COMMON', 'RETURN'])

async function loadStockForCodes(codes: string[]): Promise<Map<string, StockInfo>> {
  const clean = codes.filter(Boolean)
  if (clean.length === 0) return new Map()

  const mats = await prisma.material.findMany({
    where: { materialCode: { in: clean }, status: 'ACTIVE' },
    select: {
      id: true, materialCode: true, name: true, unit: true, currentStock: true,
      stocks: {
        where: { quantity: { gt: 0 } },
        select: { quantity: true, warehouse: { select: { code: true, kind: true, projectCode: true } } },
      },
    },
  })

  // Also check aliases for codes not found by canonical
  const foundCodes = new Set(mats.map(m => m.materialCode))
  const remaining = clean.filter(c => !foundCodes.has(c))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aliasResults: any[] = []
  if (remaining.length > 0) {
    const aliases = await prisma.materialCodeAlias.findMany({
      where: { aliasCode: { in: remaining } },
      select: {
        aliasCode: true,
        material: {
          select: {
            id: true, materialCode: true, name: true, unit: true, currentStock: true,
            stocks: {
              where: { quantity: { gt: 0 } },
              select: { quantity: true, warehouse: { select: { code: true, kind: true, projectCode: true } } },
            },
          },
        },
      },
    })
    aliasResults.push(...aliases)
  }

  const out = new Map<string, StockInfo>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildStockInfo(code: string, m: any) {
    let reusableStock = 0
    const projectWarehouses: { projectCode: string; quantity: number }[] = []
    for (const s of m.stocks || []) {
      const qty = Number(s.quantity)
      if (REUSABLE_KINDS.has(s.warehouse.kind)) reusableStock += qty
      else if (s.warehouse.kind === 'PROJECT') {
        projectWarehouses.push({ projectCode: s.warehouse.projectCode || s.warehouse.code, quantity: qty })
      }
    }
    out.set(code, {
      id: m.id, materialCode: m.materialCode, name: m.name, unit: m.unit,
      currentStock: Number(m.currentStock), reusableStock, projectWarehouses,
    })
  }

  for (const m of mats) buildStockInfo(m.materialCode, m)
  for (const a of aliasResults) {
    if (a.material) buildStockInfo(a.aliasCode, a.material)
  }

  return out
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const r2 = (n: number) => Math.round(n * 100) / 100

function computeEnrichment(
  item: PrItem,
  stock: StockInfo | undefined,
  projectCode: string | undefined,
): Partial<PrItem> {
  const needed = item.quantity

  if (!stock) {
    return { neededQty: needed, availableQty: 0, needToBuyQty: needed, stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
  }

  const sameUnit = !!(stock.unit && item.unit && stock.unit.toLowerCase() === item.unit.toLowerCase())
  const needKg = item.weight > 0 ? item.weight : item.unitWeight > 0 ? item.quantity * item.unitWeight : 0
  const canKg = !sameUnit && stock.unit?.toLowerCase() === 'kg' && needKg > 0

  const reusable = stock.reusableStock
  const thisProj = stock.projectWarehouses
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

export async function enrichBomPrItems(
  items: PrItem[],
  projectCode: string | undefined,
): Promise<PrItem[]> {
  const codes = items.map(it => it.canonicalCode).filter(Boolean) as string[]
  const stockMap = await loadStockForCodes(codes)

  return items.map(item => {
    const stock = item.canonicalCode ? stockMap.get(item.canonicalCode) : undefined
    if (!item.canonicalCode) {
      return { ...item, neededQty: item.quantity, availableQty: 0, needToBuyQty: item.quantity, stockUnit: item.unit, stockConvertedFromKg: false, stockUnitMismatch: false }
    }
    const patch = computeEnrichment(item, stock, projectCode)
    return { ...item, ...patch, materialId: stock?.id || item.materialId }
  })
}
