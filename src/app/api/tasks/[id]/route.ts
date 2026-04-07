import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getTaskById, assignTask } from '@/lib/task-engine'
import { completeTask, processP45PartialIssue, WORKFLOW_RULES } from '@/lib/workflow-engine'
import prisma from '@/lib/db'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'
import type { PrevStepFile } from '@/lib/types'
import {
  aggregateBomItems, fetchEstimateData, fetchSupplierData,
  fetchPoData, fetchPlanData, fetchStepResult, fetchAllMaterials, fetchAvailableInventory
} from '@/lib/data-fetchers'

// GET /api/tasks/[id]
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const task = await getTaskById(id)
    if (!task) return errorResponse('Task không tồn tại', 404)

    // Fetch sibling context based on step
    let siblingFiles: Record<string, string> | null = null
    let rejectionInfo: { reason: string; rejectedBy: string; rejectedAt: string } | null = null

    // Check for recent rejection targeting this step
    const rejectEvent = await prisma.changeEvent.findFirst({
      where: {
        projectId: task.projectId,
        targetId: task.stepCode,
        eventType: 'REJECT',
      },
      orderBy: { createdAt: 'desc' },
    })
    if (rejectEvent) {
      const rejector = await prisma.user.findUnique({
        where: { id: rejectEvent.triggeredBy },
        select: { fullName: true },
      })
      rejectionInfo = {
        reason: rejectEvent.reason || '',
        rejectedBy: rejector?.fullName || 'Hệ thống',
        rejectedAt: rejectEvent.createdAt.toISOString(),
      }
    }

    // Helper: resolve attached files from resultData or legacy description metadata
    function resolveFiles(
      resultData: Record<string, unknown> | null,
      description: string | null
    ): Record<string, string> | null {
      // Check new format: resultData.attachedFiles
      if (resultData?.attachedFiles) {
        return resultData.attachedFiles as Record<string, string>
      }
      // Fallback: legacy <!--FILES:{...}--> in description
      if (description) {
        const match = description.match(/<!--FILES:(.*?)-->/)
        if (match) {
          try { return JSON.parse(match[1]) } catch { /* ignore */ }
        }
      }
      return null
    }

    if (task.stepCode === 'P1.1B' || task.stepCode === 'P2.1A') {
      // For P1.1B and P2.1A: fetch P1.1's attached files (Project Contract)
      const p1Task = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P1.1' },
        select: { resultData: true },
      })
      siblingFiles = resolveFiles(
        p1Task?.resultData as Record<string, unknown> | null,
        task.project?.description || null
      )
    }

    if (task.stepCode === 'P1.1') {
      // For P1.1: load its own attached files (from previous completion)
      const rd = task.resultData as Record<string, unknown> | null
      siblingFiles = resolveFiles(rd, task.project?.description || null)
    }

    // Generic rejection info lookup: find any step that rejects TO the current step
    const rejectingStepCodes = Object.entries(WORKFLOW_RULES)
      .filter(([, rule]) => rule.rejectTo === task.stepCode)
      .map(([code]) => code)

    if (rejectingStepCodes.length > 0) {
      const rejectedTask = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: { in: rejectingStepCodes }, status: 'REJECTED' },
        select: { stepCode: true, notes: true, completedBy: true, completedAt: true, resultData: true },
        orderBy: { completedAt: 'desc' },
      })
      if (rejectedTask?.notes) {
        const reason = rejectedTask.notes.replace(/^REJECTED:\s*/, '')
        let rejectedByName = 'BGĐ'
        if (rejectedTask.completedBy) {
          const user = await prisma.user.findUnique({
            where: { id: rejectedTask.completedBy },
            select: { fullName: true },
          })
          if (user) rejectedByName = user.fullName
        }
        const rd = rejectedTask.resultData as Record<string, unknown> | null
        rejectionInfo = {
          reason,
          rejectedBy: rejectedByName,
          rejectedAt: rejectedTask.completedAt?.toISOString() || '',
          fromStep: rejectedTask.stepCode,
          ...(rd?.qcItems ? { qcItems: rd.qcItems } : {}),
        } as typeof rejectionInfo & { fromStep: string; qcItems?: unknown }
      }
    }

    // For P3.2: fetch BOM items from P2.1/P2.2/P2.3 and compare with Materials stock
    let previousStepData: Record<string, unknown> | null = null
    if (task.stepCode === 'P3.2') {
      const allPrItems = await aggregateBomItems(task.projectId)

      // Fetch all materials for stock comparison
      const materials = await fetchAllMaterials()

      // Compare each PR item with stock
      const fromStock: unknown[] = []
      const toPurchase: unknown[] = []

      for (const pr of allPrItems) {
        const requestedQty = Number(pr.quantity) || 0
        // Match by material code (case-insensitive) or name similarity
        const matched = materials.find(m =>
          m.materialCode.toLowerCase() === (pr.code || '').toLowerCase() ||
          m.name.toLowerCase() === (pr.name || '').toLowerCase()
        )

        if (matched) {
          const inStock = Number(matched.currentStock)
          const specMatch = !pr.spec || !matched.specification ||
            matched.specification.toLowerCase().includes(pr.spec.toLowerCase()) ||
            pr.spec.toLowerCase().includes(matched.specification.toLowerCase())

          if (inStock >= requestedQty && specMatch) {
            fromStock.push({
              ...pr, requestedQty, inStock,
              matchedMaterial: { code: matched.materialCode, name: matched.name, spec: matched.specification, stock: inStock },
            })
          } else {
            toPurchase.push({
              ...pr, requestedQty, inStock,
              shortfall: Math.max(0, requestedQty - inStock),
              specMatch,
              matchedMaterial: { code: matched.materialCode, name: matched.name, spec: matched.specification },
            })
          }
        } else {
          // No material match found — needs purchasing
          toPurchase.push({
            ...pr, requestedQty, inStock: 0, shortfall: requestedQty,
            specMatch: false, matchedMaterial: null,
          })
        }
      }

      previousStepData = { prItems: allPrItems, fromStock, toPurchase }
    }

    // For P1.3: fetch both P1.2A (plan) and P1.2 (estimate) data
    if (task.stepCode === 'P1.3') {
      const [planData, estimateData] = await Promise.all([
        fetchPlanData(task.projectId),
        fetchEstimateData(task.projectId),
      ])
      previousStepData = { plan: planData, estimate: estimateData }
    }

    // For P2.3: fetch P2.2 (BOM) data + P1.2 (estimate) for comparison
    if (task.stepCode === 'P2.3') {
      const [p22Task, estimateData] = await Promise.all([
        fetchStepResult(task.projectId, 'P2.2'),
        fetchEstimateData(task.projectId),
      ])
      previousStepData = { bom: p22Task?.resultData || null, estimate: estimateData }
    }

    // For P2.4: fetch BOM data from P2.1 (VT chính), P2.2 (VT hàn/sơn), P2.3 (VT phụ) + P1.2 estimate
    if (task.stepCode === 'P2.4') {
      const [p21Task, p22Task, p23Task, estimateData] = await Promise.all([
        fetchStepResult(task.projectId, 'P2.1'),
        fetchStepResult(task.projectId, 'P2.2'),
        fetchStepResult(task.projectId, 'P2.3'),
        fetchEstimateData(task.projectId, { mergeP21A: true }),
      ])
      previousStepData = {
        bomMain: p21Task?.resultData || null,       // VT chính from Thiết kế
        bomWeldPaint: p22Task?.resultData || null,   // VT hàn/sơn from PM
        bomSupply: p23Task?.resultData || null,      // VT phụ from Kho
        estimate: estimateData,                      // Dự toán from P1.2 (DT02..06) & P2.1A (DT07)
      }
    }

    // For P2.5: fetch P2.4 (KH SX + dự toán điều chỉnh) + P1.2 estimate + BOM data
    if (task.stepCode === 'P2.5') {
      const [p24Task, p21Task, p22Task, p23Task, estimateData] = await Promise.all([
        fetchStepResult(task.projectId, 'P2.4'),
        fetchStepResult(task.projectId, 'P2.1'),
        fetchStepResult(task.projectId, 'P2.2'),
        fetchStepResult(task.projectId, 'P2.3'),
        fetchEstimateData(task.projectId, { mergeP21A: true }),
      ])
      previousStepData = {
        plan: p24Task?.resultData || null,
        estimate: estimateData,
        bomMain: p21Task?.resultData || null,
        bomWeldPaint: p22Task?.resultData || null,
        bomSupply: p23Task?.resultData || null,
      }
    }

    // For P3.1: fetch P1.2A (WBS plan) for PM reference
    if (task.stepCode === 'P3.1') {
      const planData = await fetchPlanData(task.projectId)
      previousStepData = { plan: planData }
    }
    // For P3.5: fetch BOM items from P2.1/P2.2/P2.3 (same PR list as P3.2)
    if (task.stepCode === 'P3.5') {
      const allPrItems = await aggregateBomItems(task.projectId)
      previousStepData = { prItems: allPrItems }
    }

    // For P3.3 and P3.4: fetch P1.2A (WBS plan) + BOM from P2.1/P2.2/P2.3
    if (task.stepCode === 'P3.3' || task.stepCode === 'P3.4') {
      const [planData, allBomItems] = await Promise.all([
        fetchPlanData(task.projectId),
        aggregateBomItems(task.projectId, 'descriptive'),
      ])
      previousStepData = { plan: planData, bomItems: allBomItems }
    }

    // For P3.6: fetch P3.5 (supplier quotes) + P1.2 (estimate for budget comparison)
    if (task.stepCode === 'P3.6') {
      const [supplierData, estimateData] = await Promise.all([
        fetchSupplierData(task.projectId),
        fetchEstimateData(task.projectId),
      ])
      previousStepData = { supplierData, estimate: estimateData }
    }

    // For P3.7: fetch P3.5 supplier quotes for best-price summary
    if (task.stepCode === 'P3.7') {
      const supplierData = await fetchSupplierData(task.projectId)
      previousStepData = { supplierData }
    }

    // For P4.1: fetch P3.7 (PO + payment terms + delivery plan) for Kế toán
    if (task.stepCode === 'P4.1') {
      const poData = await fetchPoData(task.projectId)
      previousStepData = { poData }
    }

    // For P4.2: fetch P3.7 (delivery plan) + P3.5 (supplier quotes) for tracking
    if (task.stepCode === 'P4.2') {
      const [poData, supplierData] = await Promise.all([
        fetchPoData(task.projectId),
        fetchSupplierData(task.projectId),
      ])
      previousStepData = { poData, supplierData }
    }

    // For P4.3: fetch P3.7 (PO + delivery data) + P3.5 (supplier quotes) for QC to see incoming goods
    if (task.stepCode === 'P4.3') {
      const [poData, supplierData] = await Promise.all([
        fetchPoData(task.projectId),
        fetchSupplierData(task.projectId),
      ])
      previousStepData = { poData, supplierData }
    }

    // For P4.4: fetch P4.3 (QC result) + P3.5 (supplier materials) + BOM (PR quantities) for Kho
    if (task.stepCode === 'P4.4') {
      const [p43Task, supplierData, allBomItems] = await Promise.all([
        fetchStepResult(task.projectId, 'P4.3'),
        fetchSupplierData(task.projectId),
        aggregateBomItems(task.projectId),
      ])
      previousStepData = {
        qcData: p43Task?.resultData || null,
        supplierData,
        prItems: allBomItems,
      }
    }

    // For P4.5: fetch P3.3 (subcontractor LSX) + P3.4 WO items + Materials inventory for material issue
    if (task.stepCode === 'P4.5') {
      const [p33Task, p34Task, materials] = await Promise.all([
        fetchStepResult(task.projectId, 'P3.3'),
        fetchStepResult(task.projectId, 'P3.4'),
        fetchAvailableInventory(),
      ])
      previousStepData = {
        lsxData: p33Task?.resultData || null,
        woData: p34Task?.resultData || null,
        inventory: materials.map(m => ({
          code: m.materialCode,
          name: m.name,
          spec: m.specification,
          stock: Number(m.currentStock),
          unit: m.unit,
          category: m.category,
        })),
      }
    }

    // For P5.1, P5.3, P5.4: dynamically load LSX data from parent P3.x task cellAssignments
    if (task.stepCode === 'P5.1' || task.stepCode === 'P5.3' || task.stepCode === 'P5.4') {
      const rd = (task.resultData as Record<string, unknown>) || {}
      const sourceStep = rd.sourceStep as string || 'P3.4'
      const sourceP45TaskId = rd.sourceP45TaskId as string

      // Get P4.5 to find sourceRow, stageKey, teamIdx + direct team data
      let stageKey = rd.stageKey as string || ''
      let sourceRow: number | null = null
      let teamIdx = 0
      let p45TeamData: { teamName?: string; volume?: string; startDate?: string; endDate?: string } | null = null

      if (sourceP45TaskId) {
        const p45 = await prisma.workflowTask.findUnique({
          where: { id: sourceP45TaskId },
          select: { resultData: true },
        })
        if (p45) {
          const p45rd = (p45.resultData as Record<string, unknown>) || {}
          const req = (p45rd.materialIssueRequests as Array<Record<string, unknown>>)?.[0]
          if (req) {
            sourceRow = req.sourceRow as number ?? null
            stageKey = stageKey || (req.stageKey as string) || ''
            teamIdx = (req.teamIdx as number) ?? 0
            // Direct team data from P4.5 (available when DNC VT passes it)
            if (req.teamName) {
              p45TeamData = {
                teamName: req.teamName as string,
                volume: req.volume as string,
                startDate: req.startDate as string,
                endDate: req.endDate as string,
              }
            }
          }
        }
      }

      // Try cellAssignments from parent P3.x first
      let found = false
      const parentTask = await prisma.workflowTask.findFirst({
        where: { stepCode: sourceStep, projectId: task.projectId },
        orderBy: { createdAt: 'desc' },
        select: { resultData: true },
      })

      if (parentTask) {
        const prd = (parentTask.resultData as Record<string, unknown>) || {}
        let cells: Record<string, Record<string, Array<{ teamName: string; volume: string; startDate: string; endDate: string }>>> = {}
        try {
          const raw = prd.cellAssignments
          cells = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof cells) || {}
        } catch { cells = {} }

        const rowKey = String(sourceRow)
        let teamData = cells[rowKey]?.[stageKey]?.[teamIdx] || null
        if (!teamData && teamIdx !== 0) teamData = cells[rowKey]?.[stageKey]?.[0] || null
        if (!teamData && stageKey) {
          for (const rk of Object.keys(cells)) {
            if (cells[rk]?.[stageKey]?.[0]) { teamData = cells[rk][stageKey][0]; break }
          }
        }

        let hangMucName = ''
        let phamVi = ''
        if (sourceRow !== null) {
          const planData = await fetchPlanData(task.projectId)
          try {
            const wbsRaw = planData?.wbsItems as string | undefined
            const wbsList = wbsRaw ? JSON.parse(wbsRaw) : []
            if (wbsList[Number(sourceRow)]) {
              hangMucName = wbsList[Number(sourceRow)].hangMuc || ''
              phamVi = wbsList[Number(sourceRow)].phamVi || ''
            }
          } catch { /* ignore */ }
        }

        if (teamData) {
          previousStepData = {
            ...previousStepData,
            lsxTeamData: {
              teamName: teamData.teamName,
              volume: rd.remainingVolume !== undefined ? String(rd.remainingVolume) : teamData.volume,
              startDate: teamData.startDate,
              endDate: teamData.endDate,
              stageKey,
              hangMuc: hangMucName,
              phamVi,
              rowIdx: sourceRow,
              teamIdx
            },
          }
          found = true
        }
      }

      // Fallback: use team data stored directly in P4.5 materialIssueRequests
      if (!found && p45TeamData) {
        let hangMucName = ''
        let phamVi = ''
        if (sourceRow !== null) {
          const planData = await fetchPlanData(task.projectId)
          try {
            const wbsRaw = planData?.wbsItems as string | undefined
            const wbsList = wbsRaw ? JSON.parse(wbsRaw) : []
            if (wbsList[Number(sourceRow)]) {
              hangMucName = wbsList[Number(sourceRow)].hangMuc || ''
              phamVi = wbsList[Number(sourceRow)].phamVi || ''
            }
          } catch { /* ignore */ }
        }

        previousStepData = {
          ...previousStepData,
          lsxTeamData: {
            teamName: p45TeamData.teamName || '',
            volume: rd.remainingVolume !== undefined ? String(rd.remainingVolume) : (p45TeamData.volume || ''),
            startDate: p45TeamData.startDate || '',
            endDate: p45TeamData.endDate || '',
            stageKey,
            hangMuc: hangMucName,
            phamVi,
            rowIdx: sourceRow,
            teamIdx
          },
        }
      }
    }

    if (task.stepCode === 'P5.2' || task.stepCode === 'P5.3') {
      const p51Task = await fetchStepResult(task.projectId, 'P5.1')
      previousStepData = { ...previousStepData, jobCardData: p51Task?.resultData || null }
    }

    // For P5.4: fetch P5.1 (job card data) + P5.2 (volume report with job cards) for PM review
    if (task.stepCode === 'P5.4') {
      const rd = (task.resultData as Record<string, unknown>) || {}
      
      let p51Task: any = null;
      if (rd.sourceP51TaskId) {
        p51Task = await prisma.workflowTask.findUnique({ where: { id: String(rd.sourceP51TaskId) } });
      } else {
        p51Task = await fetchStepResult(task.projectId, 'P5.1');
      }

      const p52Task = await fetchStepResult(task.projectId, 'P5.2')
      
      previousStepData = {
        ...previousStepData,
        jobCardData: p51Task?.resultData || null,
        volumeData: p52Task?.resultData || null,
      }
    }

    // P6.2: Fetch P1.2 estimate data for budget reference
    if (task.stepCode === 'P6.2') {
      const rd = await fetchEstimateData(task.projectId)
      if (rd) {
        // Use totalEstimate from P1.2 form fields
        const budgetTotal = Number(rd.totalEstimate || 0)
        previousStepData = { ...previousStepData, budgetTotal }
      }
    }

    // P6.5: Fetch P6.1-P6.4 status for BGĐ review
    if (task.stepCode === 'P6.5') {
      const [p61, p62, p63, p64] = await Promise.all([
        prisma.workflowTask.findFirst({ where: { projectId: task.projectId, stepCode: 'P6.1' }, select: { status: true, resultData: true } }),
        prisma.workflowTask.findFirst({ where: { projectId: task.projectId, stepCode: 'P6.2' }, select: { status: true, resultData: true } }),
        prisma.workflowTask.findFirst({ where: { projectId: task.projectId, stepCode: 'P6.3' }, select: { status: true, resultData: true } }),
        prisma.workflowTask.findFirst({ where: { projectId: task.projectId, stepCode: 'P6.4' }, select: { status: true, resultData: true } }),
      ])
      const statusLabel = (s: string | undefined) => s === 'DONE' ? '✅ Hoàn thành' : s === 'IN_PROGRESS' ? '🔄 Đang thực hiện' : '⏳ Chưa bắt đầu'
      const rd62 = p62?.resultData as Record<string, string> | null
      const rd63 = p63?.resultData as Record<string, string> | null
      previousStepData = {
        ...previousStepData,
        p61Status: statusLabel(p61?.status),
        p62Status: statusLabel(p62?.status),
        p62Total: rd62?.totalActualCost || null,
        p62Variance: rd62?.costVariance || null,
        p63Status: statusLabel(p63?.status),
        p63Profit: rd63?.grossProfit || null,
        p63Margin: rd63?.profitMargin || null,
        p64Status: statusLabel(p64?.status),
      }
    }

    // Fetch file attachments from all previous steps (completed or in-progress) in the same project
    const otherTasks = await prisma.workflowTask.findMany({
      where: {
        projectId: task.projectId,
        id: { not: task.id },
        status: { in: ['DONE', 'IN_PROGRESS'] },
      },
      select: { id: true, stepCode: true, stepName: true },
      orderBy: { stepCode: 'asc' },
    })

    let previousStepFiles: PrevStepFile[] = []

    if (otherTasks.length > 0) {
      const taskIds = otherTasks.map(t => t.id)
      const allFiles = await prisma.fileAttachment.findMany({
        where: {
          entityType: 'Task',
          OR: taskIds.map(tid => ({ entityId: { startsWith: tid } })),
        },
        select: { id: true, entityId: true, fileName: true, fileUrl: true, fileSize: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })

      // Group files by task ID (entityId format: "{taskId}_{attachmentKey}")
      const filesByTaskId = new Map<string, typeof allFiles>()
      for (const f of allFiles) {
        const tid = f.entityId.split('_')[0]
        if (!filesByTaskId.has(tid)) filesByTaskId.set(tid, [])
        filesByTaskId.get(tid)!.push(f)
      }

      previousStepFiles = otherTasks
        .filter(t => filesByTaskId.has(t.id))
        .map(t => ({
          stepCode: t.stepCode,
          stepName: t.stepName,
          files: filesByTaskId.get(t.id)!.map(f => ({
            id: f.id, fileName: f.fileName, fileUrl: f.fileUrl,
            fileSize: f.fileSize, mimeType: f.mimeType, createdAt: f.createdAt,
          })),
        }))
    }

    return successResponse({ task, siblingFiles, rejectionInfo, previousStepData, previousStepFiles })
})

// PUT /api/tasks/[id] — Complete or assign task
export const PUT = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data
  const body = await req.json()
  const { action } = body

  if (action === 'save') {
    // Save resultData without completing — used for partial approval state
    const updatedTask = await prisma.workflowTask.update({
      where: { id },
      data: { resultData: body.resultData ? JSON.parse(JSON.stringify(body.resultData)) : undefined },
    })
    return successResponse({ task: updatedTask }, 'Đã lưu dữ liệu')
  }

  if (action === 'partial_issue') {
    const result = await processP45PartialIssue(id, payload.userId, body.resultData || {})
    if (result.isPartial) {
      return successResponse({ isPartial: true, issuedAccumulated: result.issuedAccumulated }, 'Đã xuất kho một phần. Task vẫn mở để xuất tiếp.')
    }
    return successResponse({ isPartial: false, nextSteps: [] }, 'Đã xuất đủ 100%. Task hoàn thành!')
  }

  if (action === 'complete') {
    // Role-based authorization: only the assigned role (or admin) can complete
    const task = await prisma.workflowTask.findUnique({ where: { id } })
    if (!task) return errorResponse('Task không tồn tại', 404)
    const isGlobalAdmin = ['R00', 'R01', 'R02', 'R02a'].includes(payload.roleCode)
    const baseTaskRole = task.assignedRole.replace(/[a-zA-Z]$/, '')
    const baseUserRole = payload.roleCode.replace(/[a-zA-Z]$/, '')
    const isAssignedToMe = task.assignedTo === payload.userId

    const isAuthorized = isGlobalAdmin || isAssignedToMe || (baseUserRole === baseTaskRole && !task.assignedTo)

    if (!isAuthorized) {
      return errorResponse(`Bạn (${payload.roleCode}) không có quyền thực hiện bước này. Hãy yêu cầu quản lý phân công task cho bạn.`, 403)
    }
    const result = await completeTask(id, payload.userId, body.resultData, body.notes)

    // Invalidate dashboard and task caches after completion
    await Promise.all([
      cacheInvalidate(CACHE_KEYS.dashboard),
      cacheInvalidate(CACHE_KEYS.tasks),
    ])

    return successResponse({ nextSteps: result.nextSteps }, 'Task hoàn thành')
  }

  if (action === 'assign') {
    if (payload.userLevel > 1 && payload.roleCode !== 'R00') {
      return errorResponse('Chỉ L1 (trưởng phòng) hoặc Admin mới có quyền phân công', 403)
    }

    const task = await prisma.workflowTask.findUnique({ where: { id } })
    if (!task) return errorResponse('Task không tồn tại', 404)

    // Strict role check: PM (R02, R02a) and Admin (R00, R01) can bypass, otherwise assigner must match task role
    const userBaseRole = payload.roleCode.replace(/[a-z]$/i, '')
    const taskBaseRole = task.assignedRole.replace(/[a-z]$/i, '')
    const isGlobalAdmin = ['R00', 'R01', 'R02'].includes(userBaseRole)

    if (!isGlobalAdmin && userBaseRole !== taskBaseRole) {
      return errorResponse(`Bạn không có quyền phân công. Chỉ Quản lý bộ phận ${task.assignedRole} hoặc PM mới được thao tác.`, 403)
    }

    const updated = await assignTask(id, body.assignToUserId)
    return successResponse({ task: updated }, 'Đã phân công task')
  }

  return errorResponse('Action không hợp lệ. Sử dụng: complete, assign')
})
