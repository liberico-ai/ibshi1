import prisma from '@/lib/db'

export const STAGE_WEIGHTS: Record<string, number> = {
  cutting:    0.10,
  assembly:   0.20,
  welding:    0.35,
  painting:   0.20,
  inspection: 0.15,
}

export const STAGES_ORDERED = ['cutting', 'assembly', 'welding', 'painting', 'inspection'] as const

export async function rollUpWorkOrder(workOrderId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, plannedWeight: true, status: true },
  })
  if (!wo) return

  const plannedKg = Number(wo.plannedWeight) || 0
  if (plannedKg <= 0) return

  // Hai kiểu báo cáo cùng tồn tại:
  //   • CÓ công đoạn (dữ liệu cũ + luồng phiếu công đoạn): tiến độ nhảy theo BẬC trọng số.
  //   • KHÔNG công đoạn ('production'): xưởng báo thẳng kg cho cả WO → cộng dồn kg thực tế.
  // APL không ghi công đoạn nên luồng báo khối lượng dùng kiểu thứ hai; giữ kiểu thứ nhất để
  // trang tiến độ và bảng điều khiển (đang đọc STAGE_WEIGHTS) không vỡ.
  const allCards = await prisma.jobCard.findMany({
    where: { workOrderId, status: { not: 'CANCELLED' } },
    select: { workType: true, actualQty: true, status: true },
  })
  // Có phiếu kiểu MỚI (báo thẳng kg, không gắn công đoạn) → chuyển cả WO sang tính kg lũy kế,
  // và cộng gộp CẢ phiếu cũ có công đoạn để không bỏ sót khối lượng đã báo.
  // Không phiếu nào kiểu mới → giữ nguyên cách tính theo bậc trọng số của dữ liệu cũ.
  const generic = allCards.filter(c => !STAGE_WEIGHTS[c.workType])
  if (generic.length > 0) {
    const reported = allCards.reduce((s, c) => s + (Number(c.actualQty) || 0), 0)
    const done = Math.min(Math.round(reported * 100) / 100, plannedKg)
    // Đạt từ 90% kế hoạch trở lên coi như xong (biên ±10% do cắt lẻ, hao hụt).
    const finished = plannedKg > 0 && reported >= plannedKg * 0.9
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { completedQty: done, earnedQty: finished ? plannedKg : 0 },
    })
    return { completedQty: done, earnedQty: finished ? plannedKg : 0, weightedPct: plannedKg ? done / plannedKg : 0 }
  }

  const jobCards = allCards.filter(c => c.status === 'COMPLETED')
  const completedStages = new Set(jobCards.map(jc => jc.workType))
  const weightedPct = STAGES_ORDERED.reduce((sum, stage) => {
    if (completedStages.has(stage)) return sum + (STAGE_WEIGHTS[stage] || 0)
    return sum
  }, 0)

  const completedQty = Math.min(Math.round(plannedKg * weightedPct * 100) / 100, plannedKg)

  const hasQcPass = completedStages.has('inspection')
  const earnedQty = hasQcPass ? plannedKg : 0

  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: { completedQty, earnedQty },
  })

  return { completedQty, earnedQty, weightedPct }
}
