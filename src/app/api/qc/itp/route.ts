import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createItpSchema } from '@/lib/schemas'
import { getProjectIdsOfPm } from '@/lib/project-pm'
import { itpMinutesGate } from '@/lib/process-gates'
import { createWithCode } from '@/lib/next-code'
import { getWoAcceptance, getWoAcceptanceOne, blockReason, stageBlockReason } from '@/lib/wo-acceptance'

// GET /api/qc/itp — List ITPs
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (status) where.status = status

  const itps = await prisma.inspectionTestPlan.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      checkpoints: {
        orderBy: { sortOrder: 'asc' },
        // Công đoạn của dòng — thẻ ITP hiện tên công đoạn thay vì chỉ một mô tả trơ.
        include: { stage: { select: { id: true, stageCode: true, name: true, category: true, qty: true, unit: true } } },
      },
      // Lệnh mà ITP này kiểm tra, kèm các phiếu xưởng đã báo — để thẻ ITP nói rõ kiểm tra cái gì.
      workOrder: {
        select: {
          id: true, woCode: true, description: true, pieceMark: true, teamCode: true,
          plannedWeight: true, completedQty: true,
          jobCards: { select: { actualQty: true, workDate: true }, orderBy: { workDate: 'desc' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Biên bản nghiệm thu đính theo từng điểm kiểm (FileAttachment không có quan hệ trực tiếp,
  // tra bằng entityType + entityId nên phải lấy rời rồi ghép).
  const cpIds = itps.flatMap(itp => itp.checkpoints.map(cp => cp.id))
  const files = cpIds.length > 0
    ? await prisma.fileAttachment.findMany({
        where: { entityType: 'ITPCheckpoint', entityId: { in: cpIds } },
        select: { id: true, entityId: true, fileName: true, fileUrl: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const filesByCp = files.reduce<Record<string, typeof files>>((acc, f) => {
    (acc[f.entityId] ||= []).push(f)
    return acc
  }, {})

  // Tên người đã ký hai vai QAQC / PM
  const signerIds = [...new Set(itps.flatMap(itp =>
    itp.checkpoints.flatMap(cp => [cp.qcConfirmedBy, cp.pmConfirmedBy]).filter(Boolean) as string[]
  ))]
  const signers = signerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, fullName: true } })
    : []
  const nameOf = new Map(signers.map(u => [u.id, u.fullName]))

  // Người đang xem ký được vai nào — giao diện dựa vào đây để hiện nút, không tự đoán theo role.
  // Ký nghiệm thu: CHỈ Trưởng phòng QAQC (R09) và PM phụ trách dự án.
  // Chấm lỗi: kiểm tra viên (R09a) cũng được — phát hiện lỗi là việc của họ.
  // Biên bản nghiệm thu có bắt buộc không — giao diện đọc cờ từ server, không tự đoán.
  const requireMinutes = await itpMinutesGate.enabled()
  const canQcSign = user.roleCode === 'R09'
  const canFlagFail = ['R09', 'R09a'].includes(user.roleCode)
  const pmProjectIds = new Set(await getProjectIdsOfPm(user.userId))

  // Tình hình nghiệm thu của các lệnh có ITP — để thẻ nói rõ đã nghiệm thu bao nhiêu / còn bao nhiêu.
  const accMap = await getWoAcceptance([...new Set(itps.map(i => i.workOrderId).filter(Boolean) as string[])])

  const result = itps.map(itp => {
    const wo = itp.workOrder
    const cards = wo?.jobCards || []
    const reportedQty = cards.reduce((s, c) => s + Number(c.actualQty || 0), 0)
    return {
      ...itp,
      canQcSign,
      canPmSign: pmProjectIds.has(itp.projectId),
      canFlagFail: canFlagFail || pmProjectIds.has(itp.projectId),
      checkpoints: itp.checkpoints.map(cp => ({
        ...cp,
        // Dòng công đoạn: mỗi điểm kiểm mang khối lượng riêng của công đoạn đó.
        acceptedQty: cp.acceptedQty !== null ? Number(cp.acceptedQty) : null,
        stage: cp.stage ? { ...cp.stage, qty: Number(cp.stage.qty) } : null,
        attachments: filesByCp[cp.id] || [],
        qcConfirmedName: cp.qcConfirmedBy ? nameOf.get(cp.qcConfirmedBy) ?? null : null,
        pmConfirmedName: cp.pmConfirmedBy ? nameOf.get(cp.pmConfirmedBy) ?? null : null,
      })),
      totalCheckpoints: itp.checkpoints.length,
      passedCheckpoints: itp.checkpoints.filter(cp => cp.status === 'PASSED').length,
      failedCheckpoints: itp.checkpoints.filter(cp => cp.status === 'FAILED').length,
      // KL của riêng đợt này
      acceptedQty: itp.acceptedQty !== null ? Number(itp.acceptedQty) : null,
      acceptance: wo ? accMap.get(wo.id) ?? null : null,
      workOrder: wo ? {
        id: wo.id, woCode: wo.woCode, description: wo.description,
        pieceMark: wo.pieceMark, teamCode: wo.teamCode,
        plannedWeight: wo.plannedWeight ? Number(wo.plannedWeight) : null,
        reportedQty,
        // Ngày hoàn thành = lần báo gần nhất của lệnh
        lastReportDate: cards[0]?.workDate ?? null,
        reportCount: cards.length,
      } : null,
    }
  })

  return successResponse({ itps: result, requireMinutes })
}

// POST /api/qc/itp — Create ITP
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền tạo ITP', 403)
  }

  const result = await validateBody(req, createItpSchema)
  if (!result.success) return result.response
  const { projectId, name, workOrderId, stageLines, inspectionDate, checkpoints, acceptedQty } = result.data

  // ITP gắn với một lệnh sản xuất: lệnh phải thuộc đúng dự án đang chọn.
  let woOfItp: { id: string; woCode: string; pieceMark: string | null; description: string; projectId: string } | null = null
  if (workOrderId) {
    woOfItp = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, woCode: true, pieceMark: true, description: true, projectId: true },
    })
    if (!woOfItp) return errorResponse('Không tìm thấy lệnh sản xuất')
    if (woOfItp.projectId !== projectId) {
      return errorResponse('Lệnh sản xuất không thuộc dự án đã chọn')
    }
  }

  // ĐỢT nghiệm thu: chỉ nghiệm thu được phần đã báo mà chưa nghiệm thu và chưa nằm trong đợt đang chờ ký.
  // Bỏ trống thì lấy trọn phần còn lại — QAQC nghiệm thu ít hơn thì tự điền số nhỏ hơn.
  let batchQty: number | null = null
  // Các dòng công đoạn của ITP này: MỘT ITP cho cả lệnh, bên trong mỗi công đoạn một dòng
  // mang khối lượng riêng và cặp chữ ký riêng. Không gộp khối lượng các công đoạn lại.
  let dongCongDoan: {
    stageId: string; stageCode: string; name: string; category: string | null
    unit: string; qty: number
  }[] = []
  if (woOfItp) {
    const acc = await getWoAcceptanceOne(woOfItp.id)
    if (acc) {
      if (acc.stageCount > 0) {
        const moiDuoc = acc.stages.filter(s => s.availableQty > 0)
        if (moiDuoc.length === 0) {
          return errorResponse(blockReason(acc) ?? 'Không còn khối lượng nào chờ nghiệm thu', 422)
        }
        // Không chỉ định thì lấy TRỌN các công đoạn đang chờ — mỗi cái một dòng.
        const chon = stageLines?.length
          ? stageLines.map(l => ({ st: acc.stages.find(s => s.id === l.stageId), qty: l.qty }))
          : moiDuoc.map(s => ({ st: s, qty: s.availableQty }))
        const trung = chon.map(c => c.st?.id)
        if (new Set(trung).size !== trung.length) {
          return errorResponse('Một công đoạn bị khai hai lần trong cùng một ITP', 422)
        }
        for (const { st, qty } of chon) {
          if (!st) return errorResponse('Công đoạn được nghiệm thu không thuộc lệnh này', 422)
          const vuong = stageBlockReason(st)
          if (vuong) return errorResponse(`${st.stageCode} ${st.name}: ${vuong}`, 422)
          if (qty > st.availableQty) {
            return errorResponse(
              `${st.stageCode} ${st.name} chỉ còn ${st.availableQty.toLocaleString('vi-VN')} ${st.unit} chưa nghiệm thu`, 422)
          }
          dongCongDoan.push({
            stageId: st.id, stageCode: st.stageCode, name: st.name,
            category: st.category, unit: st.unit, qty,
          })
        }
        // KHÔNG ghi tổng ở cấp ITP: cộng hai công đoạn lại ra một khối lượng không có thật
        // (10.000 pha cắt + 5.000 bảo ôn ≠ 15.000 của lệnh). Số thật nằm ở TỪNG DÒNG.
        batchQty = null
      } else {
        const blocked = blockReason(acc)
        if (blocked) return errorResponse(blocked, 422)
        batchQty = acceptedQty ?? acc.availableQty
        if (batchQty > acc.availableQty) {
          return errorResponse(
            `Chỉ còn ${acc.availableQty.toLocaleString('vi-VN')} ${acc.unit} chưa nghiệm thu — không nghiệm thu quá phần xưởng đã báo`, 422)
        }
      }
    }
  }

  // Lệnh chia công đoạn: nói rõ đợt này đi kiểm công đoạn nào. QAQC cầm phiếu ra xưởng mà chỉ
  // thấy mã lệnh thì không biết đang nghiệm thu pha cắt hay bảo ôn.
  const year = new Date().getFullYear().toString().slice(-2)

  const woIds = [...new Set(checkpoints?.map(cp => cp.workOrderId).filter(Boolean) as string[] || [])]
  const woMap = new Map<string, string | null>()
  if (woIds.length > 0) {
    const wos = await prisma.workOrder.findMany({ where: { id: { in: woIds } }, select: { id: true, pieceMark: true } })
    wos.forEach(wo => woMap.set(wo.id, wo.pieceMark))
  }

  // Màn tạo ITP không nhập điểm kiểm tra nữa. Vẫn sinh MỘT điểm gắn với lệnh, vì toàn bộ
  // luồng phía sau (Đạt/Lỗi, tự mở NCR, đếm tiến độ) chạy trên checkpoint — không có thì ITP nằm chết.
  // Lệnh chia công đoạn → MỖI công đoạn một dòng, khối lượng riêng, ký riêng.
  // Lệnh nguyên khối → một dòng như cũ.
  const autoCheckpoint = !checkpoints?.length && woOfItp
    ? (dongCongDoan.length > 0
      ? dongCongDoan.map((d, i) => ({
        checkpointNo: i + 1,
        activity: 'visual',
        description: `${d.stageCode} ${d.name}${d.category ? ' · ' + d.category : ''}`
          + ` — ${d.qty.toLocaleString('vi-VN')} ${d.unit}`,
        standard: null,
        acceptCriteria: null,
        inspectionType: 'MONITOR',
        sortOrder: i + 1,
        workOrderId: woOfItp.id,
        pieceMark: woOfItp.pieceMark,
        stageId: d.stageId,
        acceptedQty: d.qty,
      }))
      : [{
        checkpointNo: 1,
        activity: 'visual',
        description: `Kiểm tra ${woOfItp.woCode}${woOfItp.description ? ` — ${woOfItp.description}` : ''}`,
        standard: null,
        acceptCriteria: null,
        inspectionType: 'MONITOR',
        sortOrder: 1,
        workOrderId: woOfItp.id,
        pieceMark: woOfItp.pieceMark,
        stageId: null,
        acceptedQty: null,
      }])
    : null

  // Mã ITP: cùng lý do với mã phiếu công việc — mỗi xưởng một đợt nghiệm thu riêng nên
  // nhiều ITP sinh ra sát nhau.
  const itp = await createWithCode({
    prefix: `ITP-${year}-`,
    findLatest: async prefix => (await prisma.inspectionTestPlan.findFirst({
      where: { itpCode: { startsWith: prefix } },
      orderBy: { itpCode: 'desc' }, select: { itpCode: true },
    }))?.itpCode ?? null,
  }, itpCode => prisma.inspectionTestPlan.create({
    data: {
      itpCode, projectId, name,
      workOrderId: workOrderId || null,
      // Công đoạn nằm ở từng DÒNG bên trong, không ở cấp ITP.
      stageId: null,
      acceptedQty: batchQty,
      inspectionDate: inspectionDate ? new Date(inspectionDate) : null,
      checkpoints: checkpoints && checkpoints.length > 0 ? {
        create: checkpoints.map((cp, i) => ({
          checkpointNo: cp.checkpointNo ?? i + 1,
          activity: cp.activity,
          description: cp.description,
          standard: cp.standard || null,
          acceptCriteria: cp.acceptCriteria || null,
          inspectionType: cp.inspectionType || 'MONITOR',
          sortOrder: i + 1,
          workOrderId: cp.workOrderId || null,
          pieceMark: cp.pieceMark || (cp.workOrderId ? woMap.get(cp.workOrderId) ?? null : null),
        })),
      } : autoCheckpoint ? { create: autoCheckpoint } : undefined,
    },
    include: { checkpoints: true },
  }))

  // Lời mời của các công đoạn vừa đưa vào ITP coi như đã dùng — QAQC đã lập đợt kiểm tra rồi.
  // Không xoá thì lệnh giữ nguyên 'Chờ QC' mãi dù chẳng còn gì phải mời.
  if (dongCongDoan.length > 0) {
    await prisma.workOrderStage.updateMany({
      where: { id: { in: dongCongDoan.map(d => d.stageId) } },
      data: { qcInvitedQty: null, qcInvitedAt: null, qcInvitedBy: null },
    })
  }

  return successResponse({ itp, message: 'Đã tạo ITP' })
}
