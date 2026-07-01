import prisma from './db'

export interface MrbGateResult {
  canRelease: boolean
  blockers: string[]
  warnings: string[]
}

export async function computeMrbGate(projectId: string): Promise<MrbGateResult> {
  const blockers: string[] = []
  const warnings: string[] = []

  const [ncrs, checkpoints, inspections] = await Promise.all([
    prisma.nonConformanceReport.findMany({
      where: { projectId, status: { notIn: ['CLOSED', 'CANCELLED'] } },
      select: { ncrCode: true, status: true },
    }),
    prisma.iTPCheckpoint.findMany({
      where: { itp: { projectId } },
      select: { id: true, status: true, checkpointNo: true, activity: true, itp: { select: { itpCode: true } } },
    }),
    prisma.inspection.findMany({
      where: { projectId },
      select: { id: true, inspectionCode: true, type: true, status: true },
    }),
  ])

  // B1: NCR mở
  if (ncrs.length > 0) {
    blockers.push(`${ncrs.length} NCR chưa đóng: ${ncrs.map(n => n.ncrCode).join(', ')}`)
  }

  // B2: ITP checkpoint FAILED
  const itpFailed = checkpoints.filter(c => c.status === 'FAILED')
  if (itpFailed.length > 0) {
    blockers.push(`${itpFailed.length} ITP checkpoint FAILED`)
  }

  // B3: ITP checkpoint PENDING
  const itpPending = checkpoints.filter(c => c.status === 'PENDING')
  if (itpPending.length > 0) {
    blockers.push(`${itpPending.length} ITP checkpoint PENDING`)
  }

  // B4: Inspection FAILED
  const inspFailed = inspections.filter(i => i.status === 'FAILED')
  if (inspFailed.length > 0) {
    blockers.push(`${inspFailed.length} inspection FAILED: ${inspFailed.map(i => i.inspectionCode).join(', ')}`)
  }

  // B5: Inspection PENDING
  const inspPending = inspections.filter(i => i.status === 'PENDING')
  if (inspPending.length > 0) {
    blockers.push(`${inspPending.length} inspection PENDING`)
  }

  // B6: Thiếu FAT PASSED
  const fatPassed = inspections.filter(i => i.type === 'FAT' && i.status === 'PASSED')
  if (fatPassed.length === 0) {
    blockers.push('Chưa có Inspection FAT đạt (PASSED)')
  }

  // W1: Kiểm cert thợ hàn/WPS của mối hàn trong dự án
  const projectJoints = await prisma.weldJoint.findMany({
    where: { workOrder: { projectId }, status: { not: 'PENDING' } },
    select: { jointNo: true, welderCertId: true, wpsCertId: true },
  })
  if (projectJoints.length > 0) {
    const certIds = [
      ...projectJoints.filter(j => j.welderCertId).map(j => j.welderCertId!),
      ...projectJoints.filter(j => j.wpsCertId).map(j => j.wpsCertId!),
    ]
    if (certIds.length > 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      const expiredCerts = await prisma.certificateRegistry.findMany({
        where: { id: { in: certIds }, OR: [{ expiryDate: { lt: now } }, { isActive: false }] },
        select: { id: true, certNumber: true, certType: true },
      })
      if (expiredCerts.length > 0) {
        warnings.push(`${expiredCerts.length} chứng chỉ hàn hết hạn/thu hồi: ${expiredCerts.map(c => c.certNumber).join(', ')}`)
      }
    }
    const noCert = projectJoints.filter(j => !j.welderCertId && !j.wpsCertId)
    if (noCert.length > 0) {
      warnings.push(`${noCert.length} mối hàn chưa gắn chứng chỉ: ${noCert.map(j => j.jointNo).slice(0, 5).join(', ')}`)
    }
  }

  return { canRelease: blockers.length === 0, blockers, warnings }
}
