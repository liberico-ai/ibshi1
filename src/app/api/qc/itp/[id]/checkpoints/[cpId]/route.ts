import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { isProjectPm } from '@/lib/project-pm'
import { isWorkOrderQcPassed } from '@/lib/qc-gate'
import { syncWorkOrdersOfItp } from '@/lib/itp-wo-sync'
import { validateBody } from '@/lib/api-helpers'
import { updateCheckpointSchema } from '@/lib/schemas'
import { createModuleTask } from '@/lib/module-tasks'

// PUT /api/qc/itp/[id]/checkpoints/[cpId] — Update checkpoint status
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cpId: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id: itpId, cpId } = await params
  const result = await validateBody(req, updateCheckpointSchema)
  if (!result.success) return result.response
  const { status, remarks, createNcr, side } = result.data

  try {
    const checkpoint = await prisma.iTPCheckpoint.findFirst({
      where: { id: cpId, itpId },
      include: { itp: { select: { projectId: true, name: true } } },
    })
    if (!checkpoint) return errorResponse('Checkpoint không tồn tại', 404)

    // Chịu trách nhiệm nghiệm thu là ĐÚNG HAI người: PM phụ trách dự án và Trưởng phòng QAQC.
    // Kiểm tra viên (R09a) và BGĐ (R01) KHÔNG ký thay — ký hộ là mất ý nghĩa của hai chữ ký.
    // Riêng việc chấm LỖI thì kiểm tra viên vẫn làm được: phát hiện lỗi là việc của họ.
    const isPm = await isProjectPm(user.userId, checkpoint.itp.projectId)
    const canQc = user.roleCode === 'R09'
    const canPm = isPm
    const canFlagFail = ['R09', 'R09a'].includes(user.roleCode) || isPm
    if (!canFlagFail) {
      return errorResponse('Chỉ QAQC hoặc PM phụ trách dự án được nghiệm thu điểm kiểm này', 403)
    }

    // Vai đang ký: lấy theo yêu cầu nếu có, không thì suy từ quyền.
    const actingSide: 'QC' | 'PM' = side ?? (canQc ? 'QC' : 'PM')
    if (status === 'PASSED') {
      if (actingSide === 'QC' && !canQc) {
        return errorResponse('Chỉ Trưởng phòng QAQC được xác nhận vai QAQC', 403)
      }
      if (actingSide === 'PM' && !canPm) return errorResponse('Bạn không phải PM phụ trách dự án này', 403)
    }

    // Chấm ĐẠT phải có biên bản nghiệm thu đính kèm — không có hồ sơ thì không nghiệm thu.
    // Chấm LỖI thì không bắt buộc: lỗi còn phải mở NCR, chưa có biên bản là chuyện thường.
    if (status === 'PASSED') {
      const evidence = await prisma.fileAttachment.count({
        where: { entityType: 'ITPCheckpoint', entityId: cpId },
      })
      if (evidence === 0) {
        return errorResponse('Phải đính kèm biên bản nghiệm thu trước khi chấm Đạt', 400)
      }
    }

    let ncrId: string | null = null

    if (status === 'FAILED' && createNcr) {
      const year = new Date().getFullYear().toString().slice(-2)
      const count = await prisma.nonConformanceReport.count()
      const ncrCode = `NCR-${year}-${String(count + 1).padStart(3, '0')}`

      const ncr = await prisma.nonConformanceReport.create({
        data: {
          ncrCode,
          projectId: checkpoint.itp.projectId,
          category: 'process',
          severity: checkpoint.inspectionType === 'HOLD' ? 'MAJOR' : 'MINOR',
          description: `ITP checkpoint #${checkpoint.checkpointNo} FAILED: ${checkpoint.activity}${remarks ? ` — ${remarks}` : ''}`,
          raisedBy: user.userId,
        },
      })
      ncrId = ncr.id

      const sev = checkpoint.inspectionType === 'HOLD' ? 'MAJOR' : 'MINOR'
      const deadlineDays = sev === 'MAJOR' ? 3 : 7
      const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000).toISOString()

      const taskId = await createModuleTask('QC_NCR', ncrCode, {
        projectId: checkpoint.itp.projectId,
        taskType: 'QC_NCR',
        title: `Xử lý NCR ${ncrCode} — process [${sev}]`,
        description: ncr.description,
        priority: sev === 'MAJOR' ? 'HIGH' : 'NORMAL',
        deadline,
        assigneeRoles: ['R09', 'R09a', 'R06'],
      }, user.userId)

      if (taskId) {
        await prisma.nonConformanceReport.update({ where: { id: ncr.id }, data: { taskId } })
      }
    }

    // ĐẠT = ghi chữ ký của MỘT vai. Chỉ khi đủ cả hai chữ ký thì điểm kiểm mới thật sự PASSED;
    // thiếu một bên thì vẫn để PENDING để ITP chưa vội nhảy sang Hoàn thành.
    const now = new Date()
    const qcAt = status === 'PASSED' && actingSide === 'QC' ? now : checkpoint.qcConfirmedAt
    const pmAt = status === 'PASSED' && actingSide === 'PM' ? now : checkpoint.pmConfirmedAt
    const confirmData = status === 'PASSED'
      ? actingSide === 'QC'
        ? { qcConfirmedBy: user.userId, qcConfirmedAt: now }
        : { pmConfirmedBy: user.userId, pmConfirmedAt: now }
      // Chấm LỖI thì xoá sạch chữ ký cũ — phải nghiệm thu lại từ đầu sau khi khắc phục.
      : { qcConfirmedBy: null, qcConfirmedAt: null, pmConfirmedBy: null, pmConfirmedAt: null }

    const bothConfirmed = !!qcAt && !!pmAt
    const nextStatus = status === 'PASSED' ? (bothConfirmed ? 'PASSED' : 'PENDING') : status

    const updated = await prisma.iTPCheckpoint.update({
      where: { id: cpId },
      data: {
        status: nextStatus,
        inspectedBy: user.userId,
        inspectedAt: now,
        remarks: remarks || null,
        ...confirmData,
        ...(ncrId ? { ncrId } : {}),
      },
    })

    const allCheckpoints = await prisma.iTPCheckpoint.findMany({
      where: { itpId },
      select: { status: true },
    })

    const total = allCheckpoints.length
    const passed = allCheckpoints.filter(c => c.status === 'PASSED').length
    const failed = allCheckpoints.filter(c => c.status === 'FAILED').length
    const pending = allCheckpoints.filter(c => c.status === 'PENDING').length

    let itpStatus: string
    if (total > 0 && pending === 0 && failed === 0) itpStatus = 'COMPLETED'
    else if (passed > 0 || failed > 0) itpStatus = 'IN_PROGRESS'
    else itpStatus = 'DRAFT'

    await prisma.inspectionTestPlan.update({
      where: { id: itpId },
      data: { status: itpStatus },
    })

    // Nghiệm thu ở đây LÀ kết quả QC của lệnh sản xuất — không bấm Đạt/Không đạt ở màn WO nữa.
    // Dùng hàm dùng chung để lần bấm này và lần tự so lại ở màn Sản xuất không bao giờ lệch nhau.
    const [woSync = null] = await syncWorkOrdersOfItp(itpId, user.userId)

    // Đủ chữ ký mà WO vẫn chưa sang QC_PASSED → còn vướng cổng QC khác, nói rõ cho người ký biết.
    let woBlocked: string | null = null
    if (!woSync && itpStatus === 'COMPLETED') {
      const itpWo = await prisma.inspectionTestPlan.findUnique({
        where: { id: itpId }, select: { workOrder: { select: { id: true, status: true } } },
      })
      if (itpWo?.workOrder && itpWo.workOrder.status !== 'QC_PASSED') {
        const gate = await isWorkOrderQcPassed(itpWo.workOrder.id, { ignoreReQcFlag: true })
        if (!gate.passed) woBlocked = gate.reasons.join('; ')
      }
    }

    return successResponse({
      checkpoint: updated,
      itpStatus,
      ncrId,
      side: actingSide,
      bothConfirmed,
      woSync,
      woBlocked,
      // Nói rõ còn thiếu chữ ký của ai, để giao diện báo đúng thay vì im lặng
      waitingFor: status === 'PASSED' && !bothConfirmed ? (qcAt ? 'PM' : 'QC') : null,
      progress: { total, passed, failed, pending },
    })
  } catch (err: unknown) {
    return errorResponse(err instanceof Error ? err.message : 'Lỗi server', 500)
  }
}
