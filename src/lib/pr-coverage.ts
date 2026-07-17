/**
 * PR Coverage — kiểm tra PR đã duyệt được PO "phủ" đủ chưa (P2-đợt2 B1).
 *
 * Logic: với mỗi dòng vật tư của PR, cộng tổng quantity các PO item CÙNG materialId
 * thuộc PO của CÙNG dự án (loại PO ở trạng thái DRAFT/CANCELLED/REJECTED — chưa cam
 * kết mua hoặc đã hủy). Dòng "thiếu" khi coveredQty < quantity yêu cầu.
 * Coverage của PR = % dòng vật tư đã phủ đủ.
 *
 * GIỚI HẠN: PO item có materialId = null (item snapshot từ flow create-po báo giá
 * NCC — chỉ có itemCode/description) bị BỎ QUA khi cộng coverage → coverage có thể
 * THẤP hơn thực tế nếu PO được tạo từ báo giá không link vật tư kho.
 */

import prisma from '@/lib/db'

/** Trạng thái PO KHÔNG được tính vào coverage */
export const PO_EXCLUDED_STATUSES = ['DRAFT', 'CANCELLED', 'REJECTED']

export interface PrItemCoverage {
  materialId: string | null
  materialCode: string | null
  materialName: string | null
  unit: string | null
  /** Số lượng PR yêu cầu */
  needed: number
  /** Tổng quantity PO item cùng materialId, cùng dự án (PO hợp lệ) */
  covered: number
  /** Còn thiếu = max(0, needed - covered) */
  shortage: number
  isCovered: boolean
}

export interface PrCoverageSummary {
  totalItems: number
  coveredItems: number
  shortageItems: number
  /** % dòng vật tư đã phủ đủ (0–100, làm tròn) */
  coveragePct: number
  fullyCovered: boolean
}

interface PrItemLike {
  // NULL khi dòng PR chưa khớp được mã vật tư (vật tư tiêu hao / mã tạm).
  // Dòng như vậy không đối chiếu PO theo materialId được → covered = 0 (coi như còn thiếu).
  materialId: string | null
  quantity: unknown // Prisma Decimal | number
  material?: { materialCode: string; name: string; unit: string } | null
}

/** Key gộp theo (projectId, materialId) */
export function coverageKey(projectId: string, materialId: string): string {
  return `${projectId}::${materialId}`
}

/**
 * Gom tổng quantity PO item theo (projectId, materialId) trong 1 query duy nhất —
 * dùng chung cho detail (1 PR) và list (nhiều PR, tránh N+1).
 */
export async function fetchPoCoverageMap(
  projectIds: string[],
  materialIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (projectIds.length === 0 || materialIds.length === 0) return map

  const poItems = await prisma.purchaseOrderItem.findMany({
    where: {
      materialId: { in: materialIds },
      purchaseOrder: {
        projectId: { in: projectIds },
        status: { notIn: PO_EXCLUDED_STATUSES },
      },
    },
    select: {
      materialId: true,
      quantity: true,
      purchaseOrder: { select: { projectId: true } },
    },
  })

  for (const item of poItems) {
    // materialId null (PO snapshot không link vật tư) → bỏ qua (giới hạn đã ghi chú)
    if (!item.materialId || !item.purchaseOrder?.projectId) continue
    const key = coverageKey(item.purchaseOrder.projectId, item.materialId)
    map.set(key, (map.get(key) || 0) + Number(item.quantity || 0))
  }
  return map
}

/** Tính coverage per-item + summary cho 1 PR từ map PO đã gom */
export function computePrCoverage(
  projectId: string,
  items: PrItemLike[],
  poMap: Map<string, number>,
): { items: PrItemCoverage[]; summary: PrCoverageSummary } {
  const itemCoverages: PrItemCoverage[] = items.map(it => {
    const needed = Number(it.quantity || 0)
    // materialId null → không có khoá đối chiếu PO → covered = 0 (báo còn thiếu, không báo nhầm là đã phủ)
    const covered = it.materialId ? (poMap.get(coverageKey(projectId, it.materialId)) || 0) : 0
    const shortage = Math.max(0, needed - covered)
    return {
      materialId: it.materialId,
      materialCode: it.material?.materialCode ?? null,
      materialName: it.material?.name ?? null,
      unit: it.material?.unit ?? null,
      needed,
      covered,
      shortage,
      isCovered: shortage === 0,
    }
  })

  const totalItems = itemCoverages.length
  const coveredItems = itemCoverages.filter(i => i.isCovered).length
  const summary: PrCoverageSummary = {
    totalItems,
    coveredItems,
    shortageItems: totalItems - coveredItems,
    coveragePct: totalItems === 0 ? 100 : Math.round((coveredItems / totalItems) * 100),
    fullyCovered: coveredItems === totalItems,
  }
  return { items: itemCoverages, summary }
}
