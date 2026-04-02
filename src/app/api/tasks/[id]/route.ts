import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getTaskById, assignTask } from '@/lib/task-engine'
import { completeTask, WORKFLOW_RULES } from '@/lib/workflow-engine'
import prisma from '@/lib/db'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// GET /api/tasks/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
      const [p21Task, p22Task, p23Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
      ])

      // Collect all BOM items from P2.1/P2.2/P2.3
      type BomEntry = { name: string; code: string; spec: string; quantity: string; unit: string }
      const allPrItems: (BomEntry & { source: string })[] = []
      const sources = [
        { data: p21Task?.resultData as Record<string, unknown> | null, label: 'P2.1' },
        { data: p22Task?.resultData as Record<string, unknown> | null, label: 'P2.2' },
        { data: p23Task?.resultData as Record<string, unknown> | null, label: 'P2.3' },
      ]
      for (const src of sources) {
        const items = (src.data?.bomItems as BomEntry[]) || []
        for (const item of items) {
          if (item.name?.trim()) {
            allPrItems.push({ ...item, source: src.label })
          }
        }
      }

      // Fetch all materials for stock comparison
      const materials = await prisma.material.findMany({
        select: { materialCode: true, name: true, specification: true, currentStock: true, unit: true },
      })

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
      const [p12aTask, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2A' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        plan: p12aTask?.resultData || null,
        estimate: p12Task?.resultData || null,
      }
    }

    // For P2.3: fetch P2.2 (BOM) data + P1.2 (estimate) for comparison
    if (task.stepCode === 'P2.3') {
      const [p22Task, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        bom: p22Task?.resultData || null,
        estimate: p12Task?.resultData || null,
      }
    }

    // For P2.4: fetch BOM data from P2.1 (VT chính), P2.2 (VT hàn/sơn), P2.3 (VT phụ) + P1.2 estimate
    if (task.stepCode === 'P2.4') {
      const [p21Task, p22Task, p23Task, p12Task, p21aTask] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1A' },
          select: { resultData: true },
        }),
      ])

      const est12 = (p12Task?.resultData as Record<string, any>) || {}
      const est21a = (p21aTask?.resultData as Record<string, any>) || {}

      previousStepData = {
        bomMain: p21Task?.resultData || null,       // VT chính from Thiết kế
        bomWeldPaint: p22Task?.resultData || null,   // VT hàn/sơn from PM
        bomSupply: p23Task?.resultData || null,      // VT phụ from Kho
        estimate: { ...est12, ...est21a },           // Dự toán from P1.2 (DT02..06) & P2.1A (DT07)
      }
    }

    // For P2.5: fetch P2.4 (KH SX + dự toán điều chỉnh) + P1.2 estimate + BOM data
    if (task.stepCode === 'P2.5') {
      const [p24Task, p21Task, p22Task, p23Task, p12Task, p21aTask] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.4' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1A' },
          select: { resultData: true },
        }),
      ])

      const est12 = (p12Task?.resultData as Record<string, any>) || {}
      const est21a = (p21aTask?.resultData as Record<string, any>) || {}

      previousStepData = {
        plan: p24Task?.resultData || null,
        estimate: { ...est12, ...est21a },
        bomMain: p21Task?.resultData || null,
        bomWeldPaint: p22Task?.resultData || null,
        bomSupply: p23Task?.resultData || null,
      }
    }

    // For P3.1: fetch P1.2A (WBS plan) for PM reference
    if (task.stepCode === 'P3.1') {
      const p12aTask = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P1.2A' },
        select: { resultData: true, status: true },
      })
      previousStepData = {
        plan: p12aTask?.resultData || null,
      }
    }
    // For P3.5: fetch BOM items from P2.1/P2.2/P2.3 (same PR list as P3.2)
    if (task.stepCode === 'P3.5') {
      const [p21Task, p22Task, p23Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
      ])
      type BomEntry = { name: string; code: string; spec: string; quantity: string; unit: string }
      const allPrItems: (BomEntry & { source: string })[] = []
      const sources = [
        { data: p21Task?.resultData as Record<string, unknown> | null, label: 'P2.1' },
        { data: p22Task?.resultData as Record<string, unknown> | null, label: 'P2.2' },
        { data: p23Task?.resultData as Record<string, unknown> | null, label: 'P2.3' },
      ]
      for (const src of sources) {
        const items = (src.data?.bomItems as BomEntry[]) || []
        for (const item of items) {
          if (item.name?.trim()) {
            allPrItems.push({ ...item, source: src.label })
          }
        }
      }
      previousStepData = { prItems: allPrItems }
    }

    // For P3.3 and P3.4: fetch P1.2A (WBS plan) + BOM from P2.1/P2.2/P2.3
    if (task.stepCode === 'P3.3' || task.stepCode === 'P3.4') {
      const [p12aTask, p21Task, p22Task, p23Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2A' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
      ])
      type BomEntry = { name: string; code: string; spec: string; quantity: string; unit: string }
      const allBomItems: (BomEntry & { source: string })[] = []
      const bomSources = [
        { data: p21Task?.resultData as Record<string, unknown> | null, label: 'P2.1 - VT chính' },
        { data: p22Task?.resultData as Record<string, unknown> | null, label: 'P2.2 - Hàn & Sơn' },
        { data: p23Task?.resultData as Record<string, unknown> | null, label: 'P2.3 - VT phụ' },
      ]
      for (const src of bomSources) {
        const items = (src.data?.bomItems as BomEntry[]) || []
        for (const item of items) {
          if (item.name?.trim()) {
            allBomItems.push({ ...item, source: src.label })
          }
        }
      }
      previousStepData = {
        plan: p12aTask?.resultData || null,
        bomItems: allBomItems,
      }
    }

    // For P3.6: fetch P3.5 (supplier quotes) + P1.2 (estimate for budget comparison)
    if (task.stepCode === 'P3.6') {
      const [p35Task, p12Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.5' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P1.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        supplierData: p35Task?.resultData || null,
        estimate: p12Task?.resultData || null,
      }
    }

    // For P3.7: fetch P3.5 supplier quotes for best-price summary
    if (task.stepCode === 'P3.7') {
      const p35Task = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P3.5' },
        select: { resultData: true, status: true },
      })
      previousStepData = {
        supplierData: p35Task?.resultData || null,
      }
    }

    // For P4.1: fetch P3.7 (PO + payment terms + delivery plan) for Kế toán
    if (task.stepCode === 'P4.1') {
      const p37Task = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P3.7' },
        select: { resultData: true, status: true },
      })
      previousStepData = {
        poData: p37Task?.resultData || null,
      }
    }

    // For P4.2: fetch P3.7 (delivery plan) + P3.5 (supplier quotes) for tracking
    if (task.stepCode === 'P4.2') {
      const [p37Task, p35Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.7' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.5' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        poData: p37Task?.resultData || null,
        supplierData: p35Task?.resultData || null,
      }
    }

    // For P4.3: fetch P3.7 (PO + delivery data) + P3.5 (supplier quotes) for QC to see incoming goods
    if (task.stepCode === 'P4.3') {
      const [p37Task, p35Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.7' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.5' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        poData: p37Task?.resultData || null,
        supplierData: p35Task?.resultData || null,
      }
    }

    // For P4.4: fetch P4.3 (QC result) + P3.5 (supplier materials) + BOM (PR quantities) for Kho
    if (task.stepCode === 'P4.4') {
      const [p43Task, p35Task, p21Task, p22Task, p23Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P4.3' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.5' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.2' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P2.3' },
          select: { resultData: true, status: true },
        }),
      ])
      // Aggregate BOM items for PR quantities
      type BomEntry = { name: string; quantity: string; unit: string }
      const bomSources = [
        (p21Task?.resultData as Record<string, unknown> | null)?.bomItems as BomEntry[] || [],
        (p22Task?.resultData as Record<string, unknown> | null)?.bomItems as BomEntry[] || [],
        (p23Task?.resultData as Record<string, unknown> | null)?.bomItems as BomEntry[] || [],
      ]
      const prItems = bomSources.flat().filter(b => b?.name?.trim())
      previousStepData = {
        qcData: p43Task?.resultData || null,
        supplierData: p35Task?.resultData || null,
        prItems,
      }
    }

    // For P4.5: fetch P3.3 (subcontractor LSX) + P3.4 WO items + Materials inventory for material issue
    if (task.stepCode === 'P4.5') {
      const [p33Task, p34Task, materials] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.3' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P3.4' },
          select: { resultData: true, status: true },
        }),
        prisma.material.findMany({
          where: { currentStock: { gt: 0 } },
          select: { materialCode: true, name: true, specification: true, currentStock: true, unit: true, category: true },
          orderBy: { category: 'asc' },
          take: 200,
        }),
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

    // For P5.2: fetch P5.1 job card data to auto-display completed stages
    if (task.stepCode === 'P5.2') {
      const p51Task = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P5.1' },
        select: { resultData: true, status: true },
      })
      previousStepData = {
        jobCardData: p51Task?.resultData || null,
      }
    }

    // For P5.4: fetch P5.1 (job card data) + P5.2 (volume report with job cards) for PM review
    if (task.stepCode === 'P5.4') {
      const [p51Task, p52Task] = await Promise.all([
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P5.1' },
          select: { resultData: true, status: true },
        }),
        prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: 'P5.2' },
          select: { resultData: true, status: true },
        }),
      ])
      previousStepData = {
        jobCardData: p51Task?.resultData || null,
        volumeData: p52Task?.resultData || null,
      }
    }

    // P6.2: Fetch P1.2 estimate data for budget reference
    if (task.stepCode === 'P6.2') {
      const p12Task = await prisma.workflowTask.findFirst({
        where: { projectId: task.projectId, stepCode: 'P1.2' },
        select: { resultData: true },
      })
      const rd = p12Task?.resultData as Record<string, unknown> | null
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

    return successResponse({ task, siblingFiles, rejectionInfo, previousStepData })
  } catch (err) {
    console.error('GET /api/tasks/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/tasks/[id] — Complete or assign task
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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

    if (action === 'complete') {
      // Role-based authorization: only the assigned role (or admin) can complete
      const task = await prisma.workflowTask.findUnique({ where: { id } })
      if (!task) return errorResponse('Task không tồn tại', 404)
      const isGlobalAdmin = ['R00', 'R01', 'R02', 'R02a'].includes(payload.roleCode)
      const baseTaskRole = task.assignedRole.replace(/[a-zA-Z]$/, '')
      const baseUserRole = payload.roleCode.replace(/[a-zA-Z]$/, '')
      const isAssignedToMe = task.assignedTo === payload.userId
      
      const isAuthorized = isGlobalAdmin || isAssignedToMe || (payload.userLevel === 1 && baseUserRole === baseTaskRole && !task.assignedTo)
      
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
  } catch (err) {
    console.error('PUT /api/tasks/[id] error:', err)
    return errorResponse((err as Error).message || 'Lỗi hệ thống', 500)
  }
}
