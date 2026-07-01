import prisma from './db'

interface QcResult {
  passed: boolean
  reasons: string[]
}

export async function isWorkOrderQcPassed(workOrderId: string): Promise<QcResult> {
  const reasons: string[] = []

  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, woCode: true, status: true },
  })
  if (!wo) return { passed: false, reasons: ['Work Order không tồn tại'] }

  // C3: WO đang ở trạng thái QC_FAILED
  if (wo.status === 'QC_FAILED') {
    reasons.push(`${wo.woCode} đang ở trạng thái QC_FAILED — cần sửa chữa lại`)
  }

  // C1: Mối hàn NDT FAILED chưa lập NCR
  const ndtFailedNoNcr = await prisma.weldJoint.count({
    where: { workOrderId, ndtStatus: 'FAILED', ncrId: null },
  })
  if (ndtFailedNoNcr > 0) {
    reasons.push(`${ndtFailedNoNcr} mối hàn NDT lỗi chưa có NCR`)
  }

  // C2: Mối hàn có NCR mở (chưa CLOSED/CANCELLED)
  const openNcrJoints = await prisma.weldJoint.findMany({
    where: {
      workOrderId,
      ncrId: { not: null },
      ncr: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
    },
    select: { jointNo: true, ncr: { select: { ncrCode: true, status: true } } },
  })
  if (openNcrJoints.length > 0) {
    const ncrList = openNcrJoints
      .map(j => `${j.ncr?.ncrCode} (${j.ncr?.status})`)
      .filter(Boolean)
    reasons.push(`NCR chưa đóng: ${[...new Set(ncrList)].join(', ')}`)
  }

  // C4: ITP checkpoint HOLD/WITNESS đã FAILED (theo workOrderId)
  const itpFailed = await prisma.iTPCheckpoint.count({
    where: {
      workOrderId,
      inspectionType: { in: ['HOLD', 'WITNESS'] },
      status: 'FAILED',
    },
  })
  if (itpFailed > 0) {
    reasons.push(`${itpFailed} điểm dừng ITP (HOLD/WITNESS) chưa đạt`)
  }

  // C5: ITP checkpoint HOLD/WITNESS còn PENDING (ITP cha không phải DRAFT)
  const itpPending = await prisma.iTPCheckpoint.findMany({
    where: {
      workOrderId,
      inspectionType: { in: ['HOLD', 'WITNESS'] },
      status: 'PENDING',
      itp: { status: { not: 'DRAFT' } },
    },
    select: { id: true },
  })
  if (itpPending.length > 0) {
    reasons.push(`${itpPending.length} điểm dừng ITP (HOLD/WITNESS) chưa kiểm tra`)
  }

  // C6: Inspection gắn WO bị FAILED hoặc có checklistItem FAIL
  const failedInspections = await prisma.inspection.findMany({
    where: {
      workOrderId,
      OR: [
        { status: 'FAILED' },
        { checklistItems: { some: { result: 'FAIL' } } },
      ],
    },
    select: { inspectionCode: true },
  })
  if (failedInspections.length > 0) {
    const codes = failedInspections.map(i => i.inspectionCode).join(', ')
    reasons.push(`Biên bản QC lỗi: ${codes}`)
  }

  return { passed: reasons.length === 0, reasons }
}

export type PieceMarkQcStatus = 'PASSED' | 'FAILED' | 'PENDING'

export async function getPieceMarkQcStatus(workOrderId: string): Promise<PieceMarkQcStatus> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { status: true },
  })
  if (!wo) return 'PENDING'

  if (wo.status === 'QC_FAILED') return 'FAILED'

  if (wo.status === 'QC_PASSED' || wo.status === 'COMPLETED') {
    const { passed } = await isWorkOrderQcPassed(workOrderId)
    return passed ? 'PASSED' : 'FAILED'
  }

  return 'PENDING'
}
