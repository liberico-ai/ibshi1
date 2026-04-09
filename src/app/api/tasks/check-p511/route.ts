import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import prisma from '@/lib/db'
import { TASK_STATUS } from '@/lib/constants'

/**
 * POST /api/tasks/check-p511
 * 
 * Được gọi từ UI mỗi khi PM/QLSX bấm "Phát hành" LSX cho 1 tổ ở 1 công đoạn.
 * 
 * Logic "Đủ mâm mới bê ra":
 * - Nhận vào: projectId, sourceStep (P3.3 hoặc P3.4), rowIdx (hạng mục nào)
 * - Đọc cellAssignments + lsxIssuedDetails từ task P3.x
 * - Kiểm tra: TẤT CẢ các công đoạn (stage) active của hạng mục rowIdx 
 *   đã có TẤT CẢ teams được phát hành (issued = true) chưa?
 * - Nếu CÓ → tạo duy nhất 1 task P5.1.1 (với deterministic ID)
 * - Nếu CHƯA → trả về "chưa đủ" và không tạo gì
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const body = await req.json()
    const { projectId, sourceStep, rowIdx, taskId } = body

    if (!projectId || !sourceStep || rowIdx === undefined || !taskId) {
      return errorResponse('Thiếu projectId, sourceStep, rowIdx, hoặc taskId', 400)
    }

    // 1. Fetch BOTH P3.3 and P3.4 tasks for combined volume checking
    const [p33Task, p34Task] = await Promise.all([
      prisma.workflowTask.findFirst({
        where: { projectId, stepCode: 'P3.3' },
        orderBy: { createdAt: 'desc' },
        select: { resultData: true },
      }),
      prisma.workflowTask.findFirst({
        where: { projectId, stepCode: 'P3.4' },
        orderBy: { createdAt: 'desc' },
        select: { resultData: true },
      })
    ])

    // 2. Parse cellAssignments and lsxIssuedDetails for BOTH
    const p33Data = (p33Task?.resultData as Record<string, any>) || {}
    let p33Cells: Record<string, Record<string, any[]>> = {}
    let p33Issued: Record<string, Record<string, Record<string, boolean>>> = {}
    try { p33Cells = typeof p33Data.cellAssignments === 'string' ? JSON.parse(p33Data.cellAssignments) : (p33Data.cellAssignments || {}) } catch { /* */ }
    try { p33Issued = typeof p33Data.lsxIssuedDetails === 'string' ? JSON.parse(p33Data.lsxIssuedDetails) : (p33Data.lsxIssuedDetails || {}) } catch { /* */ }

    const p34Data = (p34Task?.resultData as Record<string, any>) || {}
    let p34Cells: Record<string, Record<string, any[]>> = {}
    let p34Issued: Record<string, Record<string, Record<string, boolean>>> = {}
    try { p34Cells = typeof p34Data.cellAssignments === 'string' ? JSON.parse(p34Data.cellAssignments) : (p34Data.cellAssignments || {}) } catch { /* */ }
    try { p34Issued = typeof p34Data.lsxIssuedDetails === 'string' ? JSON.parse(p34Data.lsxIssuedDetails) : (p34Data.lsxIssuedDetails || {}) } catch { /* */ }

    // 3. Parse WBS items để lấy thông tin hạng mục
    const planTask = await prisma.workflowTask.findFirst({
      where: { projectId, stepCode: 'P1.2A' },
      select: { resultData: true },
      orderBy: { createdAt: 'desc' },
    })
    let wbsList: any[] = []
    if (planTask?.resultData) {
      const pData = planTask.resultData as Record<string, any>
      try {
        wbsList = typeof pData.wbsItems === 'string'
          ? JSON.parse(pData.wbsItems)
          : (pData.wbsItems || [])
      } catch { wbsList = [] }
    }

    const rowKey = String(rowIdx)

    // 4. Kiểm tra "ĐỦ MÂM": tất cả công đoạn (stages) active, tất cả team (cả P3.3 & P3.4) đều đã phát hành & đủ KL
    const wbsRow = wbsList[Number(rowIdx)] || {}
    const ALL_STAGES = [
      'cutting', 'machining', 'fitup', 'welding', 'tryAssembly', 
      'dismantle', 'blasting', 'painting', 'insulation', 
      'commissioning', 'packing', 'delivery'
    ]

    // Công đoạn active là công đoạn được phân công trong bảng WBS
    const activeStages = ALL_STAGES.filter(s => (wbsRow[s] || '').trim() !== '')

    if (activeStages.length === 0) {
      return successResponse({ allIssued: false, reason: 'Hạng mục không có công đoạn nào active' })
    }

    const rowTotalKL = Number(wbsRow.khoiLuong) || 0

    let allStagesIssued = true
    let totalAssignedTeamsAcrossStages = 0

    for (const stageKey of activeStages) {
      const teamsP33 = p33Cells[rowKey]?.[stageKey] || []
      const teamsP34 = p34Cells[rowKey]?.[stageKey] || []
      
      let assignedKL = 0
      
      // Check P3.3
      for (let ti = 0; ti < teamsP33.length; ti++) {
        assignedKL += Number(teamsP33[ti].volume) || 0
        totalAssignedTeamsAcrossStages++
        if (!p33Issued[rowKey]?.[stageKey]?.[String(ti)]) {
          allStagesIssued = false
        }
      }
      
      // Check P3.4
      for (let ti = 0; ti < teamsP34.length; ti++) {
        assignedKL += Number(teamsP34[ti].volume) || 0
        totalAssignedTeamsAcrossStages++
        if (!p34Issued[rowKey]?.[stageKey]?.[String(ti)]) {
          allStagesIssued = false
        }
      }

      // Khối lượng chưa phân giao đủ (chưa xanh lá) -> chặn ngay
      if ((teamsP33.length === 0 && teamsP34.length === 0) || assignedKL < rowTotalKL) {
        allStagesIssued = false
        break
      }

      if (!allStagesIssued) break
    }

    if (!allStagesIssued || totalAssignedTeamsAcrossStages === 0) {
      return successResponse({
        allIssued: false,
        reason: 'Chưa đủ mâm. Có công đoạn chưa giao đủ khối lượng (chưa xanh lá) hoặc chưa Phát hành.',
      })
    }

    // 5. ĐỦ MÂM! 100% đã phát hành. Kiểm tra task P5.1.1 đã tồn tại chưa
    const uniqueId = `p511_${projectId}_row${rowIdx}`.replace(/[^a-zA-Z0-9_-]/g, '')

    const existing = await prisma.workflowTask.findUnique({ where: { id: uniqueId } })
    if (existing) {
      return successResponse({
        allIssued: true,
        alreadyCreated: true,
        taskId: existing.id,
        reason: 'P5.1.1 đã tồn tại cho hạng mục này.',
      })
    }

    // 6. Tạo P5.1.1
    const rule = WORKFLOW_RULES['P5.1']
    const hangMucName = wbsList[Number(rowIdx)]?.hangMuc || `Hạng mục #${Number(rowIdx) + 1}`
    const totalKL = wbsList[Number(rowIdx)]?.khoiLuong || ''
    const dvt = wbsList[Number(rowIdx)]?.dvt || 'kg'

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectName: true },
    })

    const stepName = `P5.1.1: Yêu cầu nghiệm thu — ${hangMucName}`

    try {
      const newTask = await prisma.workflowTask.create({
        data: {
          id: uniqueId,
          projectId,
          stepCode: 'P5.1.1',
          stepName,
          stepNameEn: `Quality Acceptance: ${hangMucName}`,
          assignedRole: rule?.role || 'R06',
          status: TASK_STATUS.IN_PROGRESS,
          startedAt: new Date(),
          deadline: rule?.deadlineDays
            ? new Date(Date.now() + rule.deadlineDays * 24 * 60 * 60 * 1000)
            : null,
          resultData: {
            sourceStep,
            rowIdx: Number(rowIdx),
            hangMucName,
            totalKL: `${totalKL} ${dvt}`,
            totalTeams: totalAssignedTeamsAcrossStages,
            projectName: project?.projectName || '',
            projectCode: project?.projectCode || '',
          },
        },
      })

      return successResponse({
        allIssued: true,
        created: true,
        taskId: newTask.id,
        reason: `🎉 Đã tạo P5.1.1 Yêu cầu nghiệm thu cho "${hangMucName}" (${totalKL} ${dvt}).`,
      })
    } catch (err) {
      // Unique constraint hoặc concurrent race → task đã tồn tại
      console.warn('P5.1.1 creation race prevented:', err)
      return successResponse({
        allIssued: true,
        alreadyCreated: true,
        reason: 'P5.1.1 đã được tạo bởi một request khác.',
      })
    }
  } catch (err) {
    console.error('POST /api/tasks/check-p511 error:', err)
    return errorResponse((err as Error).message || 'Lỗi hệ thống', 500)
  }
}
