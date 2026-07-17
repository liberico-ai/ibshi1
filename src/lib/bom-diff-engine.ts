import prisma from './db'

// ── Types ──

export type BomCategory = 'MAIN' | 'WELD' | 'PAINT' | 'AUX' | 'CONSUMABLE'
export type BomLayer = 'HARD' | 'NORM' | 'STOCK'

const CATEGORY_TO_LAYER: Record<BomCategory, BomLayer> = {
  MAIN: 'HARD',
  WELD: 'NORM',
  PAINT: 'NORM',
  AUX: 'STOCK',
  CONSUMABLE: 'STOCK',
}

export function layerFromCategory(category: string): BomLayer {
  return CATEGORY_TO_LAYER[category as BomCategory] || 'HARD'
}

export interface BomLineSnapshot {
  id: string
  bomVersionId: string
  materialId: string
  materialCode: string
  materialName: string
  category: BomCategory
  pieceMark: string | null
  profile: string | null
  grade: string | null
  quantity: number
  unit: string
  surfaceAreaM2: number | null
  weldLengthM: number | null
}

export type DiffAction = 'ADDED' | 'REMOVED' | 'QTY_CHANGED' | 'SPEC_CHANGED'

export interface DiffLine {
  action: DiffAction
  category: BomCategory
  materialId: string
  materialCode: string
  materialName: string
  pieceMark: string | null
  profile: string | null
  grade: string | null
  unit: string
  qtyOld: number
  qtyNew: number
  qtyDelta: number
  oldLineId: string | null
  newLineId: string | null
}

export interface DiffResult {
  oldVersionId: string
  newVersionId: string
  lines: DiffLine[]
  summary: {
    added: number
    removed: number
    qtyChanged: number
    specChanged: number
    byCategory: Record<BomCategory, { added: number; removed: number; qtyChanged: number; specChanged: number; deltaQty: number }>
    totalDeltaQty: number
  }
}

export type ProcurementStatus = 'NOT_PURCHASED' | 'IN_PR' | 'IN_PO' | 'IN_STOCK' | 'ISSUED' | 'FABRICATED'

export interface ImpactLine {
  diffLine: DiffLine
  procurementStatus: ProcurementStatus
  currentPrQty: number
  currentPoQty: number
  currentStockQty: number
  suggestedAction: string
  suggestedActionCode: 'UPDATE_PR' | 'ADD_PR' | 'REDUCE_PR' | 'CANCEL_PR' | 'ALERT_PO' | 'RETURN_STOCK' | 'USE_STOCK' | 'NCR' | 'NONE'
}

export interface ImpactResult {
  versionId: string
  projectId: string
  lines: ImpactLine[]
  summary: {
    totalChanges: number
    needPurchase: number
    canUseStock: number
    needPOAlert: number
    needNCR: number
  }
}

// ── Diff Engine ──

function lineKey(line: { pieceMark: string | null; materialCode: string; category: string }): string {
  return `${line.pieceMark || '_'}::${line.materialCode}::${line.category}`
}

async function loadVersionLines(versionId: string): Promise<BomLineSnapshot[]> {
  const items = await prisma.bomItem.findMany({
    where: { bomVersionId: versionId },
    include: { material: { select: { materialCode: true, name: true } } },
    orderBy: { sortOrder: 'asc' },
  })

  return items.map(item => ({
    id: item.id,
    bomVersionId: versionId,
    materialId: item.materialId,
    materialCode: item.material.materialCode,
    materialName: item.material.name,
    category: (item.category || 'MAIN') as BomCategory,
    pieceMark: item.pieceMark,
    profile: item.profile,
    grade: item.grade,
    quantity: Number(item.quantity),
    unit: item.unit,
    surfaceAreaM2: item.surfaceAreaM2 ? Number(item.surfaceAreaM2) : null,
    weldLengthM: item.weldLengthM ? Number(item.weldLengthM) : null,
  }))
}

export async function diffBomVersions(oldVersionId: string, newVersionId: string): Promise<DiffResult> {
  const [oldLines, newLines] = await Promise.all([
    loadVersionLines(oldVersionId),
    loadVersionLines(newVersionId),
  ])

  const oldMap = new Map<string, BomLineSnapshot>()
  for (const line of oldLines) oldMap.set(lineKey(line), line)

  const newMap = new Map<string, BomLineSnapshot>()
  for (const line of newLines) newMap.set(lineKey(line), line)

  const diffLines: DiffLine[] = []
  const categories: BomCategory[] = ['MAIN', 'WELD', 'PAINT', 'AUX', 'CONSUMABLE']

  const catSummary = Object.fromEntries(
    categories.map(c => [c, { added: 0, removed: 0, qtyChanged: 0, specChanged: 0, deltaQty: 0 }])
  ) as Record<BomCategory, { added: number; removed: number; qtyChanged: number; specChanged: number; deltaQty: number }>

  for (const [key, newLine] of newMap) {
    const oldLine = oldMap.get(key)
    if (!oldLine) {
      diffLines.push({
        action: 'ADDED', category: newLine.category,
        materialId: newLine.materialId, materialCode: newLine.materialCode,
        materialName: newLine.materialName, pieceMark: newLine.pieceMark,
        profile: newLine.profile, grade: newLine.grade, unit: newLine.unit,
        qtyOld: 0, qtyNew: newLine.quantity, qtyDelta: newLine.quantity,
        oldLineId: null, newLineId: newLine.id,
      })
      catSummary[newLine.category].added++
      catSummary[newLine.category].deltaQty += newLine.quantity
    } else {
      const specChanged = oldLine.profile !== newLine.profile || oldLine.grade !== newLine.grade
      const qtyChanged = oldLine.quantity !== newLine.quantity

      if (specChanged) {
        diffLines.push({
          action: 'SPEC_CHANGED', category: newLine.category,
          materialId: newLine.materialId, materialCode: newLine.materialCode,
          materialName: newLine.materialName, pieceMark: newLine.pieceMark,
          profile: newLine.profile, grade: newLine.grade, unit: newLine.unit,
          qtyOld: oldLine.quantity, qtyNew: newLine.quantity,
          qtyDelta: newLine.quantity - oldLine.quantity,
          oldLineId: oldLine.id, newLineId: newLine.id,
        })
        catSummary[newLine.category].specChanged++
        catSummary[newLine.category].deltaQty += newLine.quantity - oldLine.quantity
      } else if (qtyChanged) {
        diffLines.push({
          action: 'QTY_CHANGED', category: newLine.category,
          materialId: newLine.materialId, materialCode: newLine.materialCode,
          materialName: newLine.materialName, pieceMark: newLine.pieceMark,
          profile: newLine.profile, grade: newLine.grade, unit: newLine.unit,
          qtyOld: oldLine.quantity, qtyNew: newLine.quantity,
          qtyDelta: newLine.quantity - oldLine.quantity,
          oldLineId: oldLine.id, newLineId: newLine.id,
        })
        catSummary[newLine.category].qtyChanged++
        catSummary[newLine.category].deltaQty += newLine.quantity - oldLine.quantity
      }
    }
  }

  for (const [key, oldLine] of oldMap) {
    if (!newMap.has(key)) {
      diffLines.push({
        action: 'REMOVED', category: oldLine.category,
        materialId: oldLine.materialId, materialCode: oldLine.materialCode,
        materialName: oldLine.materialName, pieceMark: oldLine.pieceMark,
        profile: oldLine.profile, grade: oldLine.grade, unit: oldLine.unit,
        qtyOld: oldLine.quantity, qtyNew: 0, qtyDelta: -oldLine.quantity,
        oldLineId: oldLine.id, newLineId: null,
      })
      catSummary[oldLine.category].removed++
      catSummary[oldLine.category].deltaQty -= oldLine.quantity
    }
  }

  const totalDeltaQty = Object.values(catSummary).reduce((s, c) => s + c.deltaQty, 0)

  return {
    oldVersionId, newVersionId,
    lines: diffLines,
    summary: {
      added: diffLines.filter(l => l.action === 'ADDED').length,
      removed: diffLines.filter(l => l.action === 'REMOVED').length,
      qtyChanged: diffLines.filter(l => l.action === 'QTY_CHANGED').length,
      specChanged: diffLines.filter(l => l.action === 'SPEC_CHANGED').length,
      byCategory: catSummary,
      totalDeltaQty,
    },
  }
}

// ── Impact Analysis ──

async function determineProcurementStatus(
  materialId: string, projectId: string
): Promise<{ status: ProcurementStatus; prQty: number; poQty: number; stockQty: number }> {
  const [prItems, poItems, material] = await Promise.all([
    prisma.purchaseRequestItem.findMany({
      where: {
        materialId,
        purchaseRequest: { projectId, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
      },
      select: { quantity: true },
    }),
    prisma.purchaseOrderItem.findMany({
      where: {
        materialId,
        purchaseOrder: { projectId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PAID', 'PARTIAL_RECEIVED'] } },
      },
      select: { quantity: true },
    }),
    prisma.material.findUnique({
      where: { id: materialId },
      select: { currentStock: true },
    }),
  ])

  const prQty = prItems.reduce((s, i) => s + Number(i.quantity), 0)
  const poQty = poItems.reduce((s, i) => s + Number(i.quantity), 0)
  const stockQty = Number(material?.currentStock || 0)

  let status: ProcurementStatus = 'NOT_PURCHASED'
  if (poQty > 0 && stockQty > 0) status = 'IN_STOCK'
  else if (poQty > 0) status = 'IN_PO'
  else if (prQty > 0) status = 'IN_PR'

  return { status, prQty, poQty, stockQty }
}

function suggestAction(
  diffLine: DiffLine,
  procurement: { status: ProcurementStatus; prQty: number; poQty: number; stockQty: number }
): { action: string; code: ImpactLine['suggestedActionCode'] } {
  const isIncrease = diffLine.qtyDelta > 0 || diffLine.action === 'ADDED'
  const isDecrease = diffLine.qtyDelta < 0 || diffLine.action === 'REMOVED'

  if (diffLine.action === 'SPEC_CHANGED') {
    if (procurement.status === 'IN_STOCK' || procurement.status === 'ISSUED') {
      return { action: 'Đổi quy cách — VT đã nhập kho, cần NCR đánh giá', code: 'NCR' }
    }
    if (procurement.status === 'IN_PO') {
      return { action: 'Đổi quy cách — đã PO, cảnh báo TM để điều chỉnh/huỷ PO + tạo PO mới', code: 'ALERT_PO' }
    }
    if (procurement.status === 'IN_PR') {
      return { action: 'Đổi quy cách — cập nhật PR hiện tại', code: 'UPDATE_PR' }
    }
    return { action: 'Đổi quy cách — tạo PR mới', code: 'ADD_PR' }
  }

  if (isIncrease) {
    if (procurement.stockQty >= diffLine.qtyDelta) {
      return { action: `Dùng tồn kho (${procurement.stockQty} ${diffLine.unit} có sẵn)`, code: 'USE_STOCK' }
    }
    if (procurement.status === 'IN_PR') {
      return { action: 'Tăng SL trên PR hiện tại', code: 'UPDATE_PR' }
    }
    return { action: 'Tạo PR bổ sung', code: 'ADD_PR' }
  }

  if (isDecrease) {
    if (procurement.status === 'NOT_PURCHASED') {
      return { action: 'Không cần hành động (chưa mua)', code: 'NONE' }
    }
    if (procurement.status === 'IN_PR') {
      if (diffLine.action === 'REMOVED') {
        return { action: 'Huỷ dòng khỏi PR', code: 'CANCEL_PR' }
      }
      return { action: 'Giảm SL trên PR', code: 'REDUCE_PR' }
    }
    if (procurement.status === 'IN_PO') {
      return { action: 'Cảnh báo TM — đã PO, đề nghị giảm/huỷ', code: 'ALERT_PO' }
    }
    if (procurement.status === 'IN_STOCK') {
      return { action: 'Dư tồn kho — trả về kho chung (reusable)', code: 'RETURN_STOCK' }
    }
    return { action: 'Cần đánh giá NCR (đã cấp phát/chế tạo)', code: 'NCR' }
  }

  return { action: 'Không thay đổi', code: 'NONE' }
}

/**
 * Tính impact của version so với baseline.
 * - baselineVersionId KHÔNG truyền (mặc định): so với version ACTIVE hiện tại — dùng cho PREVIEW khi version còn DRAFT.
 * - baselineVersionId truyền tường minh: so với đúng version đó — BẮT BUỘC khi gọi SAU khi activate
 *   (lúc đó version chính là ACTIVE, so mặc định ra rỗng → cascade 0 task — bug #V2 bắt được).
 */
export async function computeImpact(versionId: string, baselineVersionId?: string): Promise<ImpactResult> {
  const version = await prisma.bomVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { bom: { select: { projectId: true, id: true } } },
  })

  const baseline = baselineVersionId
    ? { id: baselineVersionId }
    : await prisma.bomVersion.findFirst({
        where: { bomId: version.bom.id, status: 'ACTIVE' },
        select: { id: true },
      })

  if (!baseline || baseline.id === versionId) {
    // Finding D: baseline trùng chính version (thường do gọi computeImpact SAU khi version đã ACTIVE
    // mà không truyền baselineVersionId) → impact rỗng. Cảnh báo để không "im lặng 0 thay đổi".
    if (baseline && baseline.id === versionId) {
      console.warn(
        `[computeImpact] ⚠️ baseline trùng chính version ${versionId} — impact rỗng. Truyền baselineVersionId tường minh khi gọi sau activate (vd runCascade dùng oldVersionId).`,
      )
    }
    return {
      versionId, projectId: version.bom.projectId,
      lines: [], summary: { totalChanges: 0, needPurchase: 0, canUseStock: 0, needPOAlert: 0, needNCR: 0 },
    }
  }

  const diff = await diffBomVersions(baseline.id, versionId)
  const projectId = version.bom.projectId

  const impactLines: ImpactLine[] = []

  for (const diffLine of diff.lines) {
    const procurement = await determineProcurementStatus(diffLine.materialId, projectId)
    const suggestion = suggestAction(diffLine, procurement)

    impactLines.push({
      diffLine,
      procurementStatus: procurement.status,
      currentPrQty: procurement.prQty,
      currentPoQty: procurement.poQty,
      currentStockQty: procurement.stockQty,
      suggestedAction: suggestion.action,
      suggestedActionCode: suggestion.code,
    })
  }

  return {
    versionId, projectId,
    lines: impactLines,
    summary: {
      totalChanges: impactLines.length,
      needPurchase: impactLines.filter(l => ['ADD_PR', 'UPDATE_PR'].includes(l.suggestedActionCode)).length,
      canUseStock: impactLines.filter(l => l.suggestedActionCode === 'USE_STOCK').length,
      needPOAlert: impactLines.filter(l => l.suggestedActionCode === 'ALERT_PO').length,
      needNCR: impactLines.filter(l => l.suggestedActionCode === 'NCR').length,
    },
  }
}

// ── Norm-based Calculation ──

export type NormResult = {
  category: BomCategory
  materialCode: string
  materialName: string
  quantity: number
  unit: string
  normCode: string
  basisValue: number
  basisUnit: string
  rate: number
  estimated?: boolean
}

export type NormWarning = {
  normCode: string
  message: string
}

export async function computeNormLines(
  mainLines: BomLineSnapshot[],
  projectId?: string | null
): Promise<{ results: NormResult[]; warnings: NormWarning[] }> {
  const norms = await prisma.norm.findMany({
    where: projectId ? { OR: [{ projectId }, { projectId: null }] } : { projectId: null },
    orderBy: [{ projectId: 'desc' }, { category: 'asc' }],
  })

  if (norms.length === 0) {
    return { results: [], warnings: [{ normCode: '-', message: 'Chưa có định mức nào trong hệ thống. Vào Quản lý Định mức để tạo.' }] }
  }

  const totalWeightKg = mainLines
    .filter(l => l.category === 'MAIN')
    .reduce((s, l) => s + l.quantity, 0)

  const totalWeightTon = totalWeightKg / 1000

  const results: NormResult[] = []
  const warnings: NormWarning[] = []
  const seen = new Set<string>()

  for (const norm of norms) {
    if (seen.has(norm.category + '::' + norm.code)) continue
    seen.add(norm.category + '::' + norm.code)

    const rate = Number(norm.rate)
    let basisValue = 0
    let estimated = false

    switch (norm.basisUnit) {
      case 'ton':
        basisValue = totalWeightTon
        break
      case 'kg':
        basisValue = totalWeightKg
        break
      case 'm²': {
        const sumArea = mainLines
          .filter(l => l.category === 'MAIN')
          .reduce((s, l) => s + (l.surfaceAreaM2 ?? 0), 0)
        if (sumArea > 0) {
          basisValue = sumArea
        } else {
          basisValue = totalWeightTon * 0.15
          estimated = true
          warnings.push({
            normCode: norm.code,
            message: `Chưa có diện tích bề mặt (surfaceAreaM2) trên BOM → ước lượng ${Math.round(basisValue * 100) / 100} m² (0.15 m²/tấn). Nhập diện tích thực để chính xác hơn.`,
          })
        }
        break
      }
      case 'm': {
        const sumLen = mainLines
          .filter(l => l.category === 'MAIN')
          .reduce((s, l) => s + (l.weldLengthM ?? 0), 0)
        if (sumLen > 0) {
          basisValue = sumLen
        } else {
          basisValue = totalWeightKg * 0.02
          estimated = true
          warnings.push({
            normCode: norm.code,
            message: `Chưa có chiều dài đường hàn (weldLengthM) trên BOM → ước lượng ${Math.round(basisValue * 100) / 100} m (0.02 m/kg). Nhập chiều dài thực để chính xác hơn.`,
          })
        }
        break
      }
      default:
        warnings.push({
          normCode: norm.code,
          message: `Đơn vị cơ sở "${norm.basisUnit}" chưa hỗ trợ tính tự động cho ${norm.name}. Chỉ hỗ trợ: ton, kg, m², m.`,
        })
        continue
    }

    if (basisValue <= 0) {
      warnings.push({
        normCode: norm.code,
        message: `Không có KL vật tư chính (MAIN) để tính ${norm.name}`,
      })
      continue
    }

    const quantity = basisValue * rate

    if (quantity > 0) {
      results.push({
        category: norm.category as BomCategory,
        materialCode: norm.code,
        materialName: norm.name,
        quantity: Math.round(quantity * 100) / 100,
        unit: norm.unit,
        normCode: norm.code,
        basisValue: Math.round(basisValue * 100) / 100,
        basisUnit: norm.basisUnit,
        rate,
        estimated,
      })
    }
  }

  return { results, warnings }
}
