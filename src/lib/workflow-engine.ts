import prisma from './db'
import { TASK_STATUS } from './constants'
import { WORKFLOW_RULES } from './workflow-constants'
import { syncBOMtoBudget, syncPOtoBudget, syncGRNtoBudget, logChangeEvent, runReverseHooks } from './sync-engine'
import { runValidationRules } from './validation-rules'

// Re-export client-safe items for backward compatibility
export { WORKFLOW_RULES, PHASE_LABELS, getWorkflowProgress } from './workflow-constants'
export type { WorkflowStep } from './workflow-constants'

// ── Workflow Engine Core Functions (Server-only) ──

export async function initializeProjectWorkflow(projectId: string): Promise<void> {
  const steps = Object.values(WORKFLOW_RULES)
  const tasks = steps.map((step) => ({
    projectId,
    stepCode: step.code,
    stepName: step.name,
    stepNameEn: step.nameEn,
    assignedRole: step.role,
    status: TASK_STATUS.PENDING,
    deadline: step.deadlineDays
      ? new Date(Date.now() + step.deadlineDays * 24 * 60 * 60 * 1000)
      : null,
  }))

  await prisma.workflowTask.createMany({ data: tasks })

  // Activate first step
  await activateTask(projectId, 'P1.1')
}

export async function completeTask(
  taskId: string,
  userId: string,
  resultData?: Record<string, unknown>,
  notes?: string
): Promise<{ nextSteps: string[] }> {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Task not found')
  if (task.status === TASK_STATUS.DONE) throw new Error('Task already completed')

  // Run TC validation rules before marking as done
  const validation = await runValidationRules(task.stepCode, resultData, task.projectId)
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join('; ')}`)
  }
  // Append warnings to notes (non-blocking)
  let finalNotes = notes || ''
  if (validation.warnings.length > 0) {
    finalNotes = finalNotes + (finalNotes ? '\n' : '') + validation.warnings.map(w => `⚠️ ${w}`).join('\n')
  }

  // Mark as done
  await prisma.workflowTask.update({
    where: { id: taskId },
    data: {
      status: TASK_STATUS.DONE,
      completedAt: new Date(),
      completedBy: userId,
      resultData: resultData ? JSON.parse(JSON.stringify(resultData)) : undefined,
      notes: finalNotes || undefined,
    },
  })

  // Run module integration hooks
  await runWorkflowHooks(task.projectId, task.stepCode, userId, resultData)

  // Get workflow rule for this step
  const rule = WORKFLOW_RULES[task.stepCode]
  if (!rule) return { nextSteps: [] }

  const activatedSteps: string[] = []

  // Try to activate next steps
  for (const nextCode of rule.next) {
    const nextRule = WORKFLOW_RULES[nextCode]
    if (!nextRule) continue

    // Check gate conditions
    if (nextRule.gate && nextRule.gate.length > 0) {
      const gatePass = await checkGate(task.projectId, nextRule.gate)
      if (!gatePass) continue
    }

    await activateTask(task.projectId, nextCode)
    activatedSteps.push(nextCode)

    // Auto-propagate: if the next step's own next step is REJECTED (was the step that rejected),
    // auto-complete the intermediate step and re-activate the REJECTED step.
    // This handles: P5.3 reject → P5.1 → P5.2 auto-skip → P5.3 re-activate
    if (nextRule.next && nextRule.next.length > 0) {
      for (const downstreamCode of nextRule.next) {
        const downstreamTask = await prisma.workflowTask.findFirst({
          where: { projectId: task.projectId, stepCode: downstreamCode, status: TASK_STATUS.REJECTED },
        })
        if (downstreamTask) {
          // The downstream step was the one that rejected — auto-complete the intermediate step
          const intermediateTask = await prisma.workflowTask.findFirst({
            where: { projectId: task.projectId, stepCode: nextCode, status: TASK_STATUS.IN_PROGRESS },
          })
          if (intermediateTask) {
            await prisma.workflowTask.update({
              where: { id: intermediateTask.id },
              data: {
                status: TASK_STATUS.DONE,
                completedAt: new Date(),
                completedBy: userId,
                notes: 'Auto-completed (re-submission after rejection)',
              },
            })
            await activateTask(task.projectId, downstreamCode)
            activatedSteps.push(downstreamCode)
          }
        }
      }
    }
  }

  return { nextSteps: activatedSteps }
}

// ── Reject Task (Reverse Flow) ──

export async function rejectTask(
  taskId: string,
  userId: string,
  reason: string,
  overrideRejectTo?: string
): Promise<{ returnedTo: string }> {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Task not found')

  const rule = WORKFLOW_RULES[task.stepCode]
  if (!rule) throw new Error('No workflow rule for this step')

  const rejectTo = overrideRejectTo || rule.rejectTo
  if (!rejectTo) throw new Error(`Step ${task.stepCode} cannot be rejected (no rejectTo defined)`)

  // 1. Mark current task as REJECTED
  await prisma.workflowTask.update({
    where: { id: taskId },
    data: {
      status: TASK_STATUS.REJECTED,
      notes: `REJECTED: ${reason}`,
      completedBy: userId,
      completedAt: new Date(),
    },
  })

  // 2. Reset intermediate steps between rejectTo and current step
  //    Skip this when using overrideRejectTo (selective reject — don't reset siblings)
  if (!overrideRejectTo) {
    const allSteps = Object.keys(WORKFLOW_RULES)
    const rejectToPhase = WORKFLOW_RULES[rejectTo]?.phase || 1
    const currentPhase = rule.phase

    const stepsToReset = allSteps.filter((code) => {
      const r = WORKFLOW_RULES[code]
      return r && r.phase >= rejectToPhase && r.phase <= currentPhase
        && code !== task.stepCode && code !== rejectTo
    })

    // Reset intermediate steps that were DONE back to PENDING
    if (stepsToReset.length > 0) {
      await prisma.workflowTask.updateMany({
        where: {
          projectId: task.projectId,
          stepCode: { in: stepsToReset },
          status: TASK_STATUS.DONE,
        },
        data: { status: TASK_STATUS.PENDING, completedAt: null, completedBy: null },
      })
    }
  }

  // 3. Reactivate the target step
  await activateTask(task.projectId, rejectTo)

  // 4. Run reverse sync hooks
  await runReverseHooks(task.projectId, task.stepCode, userId, reason)

  // 5. Log ChangeEvent
  await logChangeEvent({
    projectId: task.projectId, sourceStep: task.stepCode,
    sourceModel: 'WorkflowTask', sourceId: taskId,
    eventType: 'REJECT', targetModel: 'WorkflowTask',
    targetId: rejectTo, reason, triggeredBy: userId,
  })

  // 6. Create notification for the target step's assignee
  try {
    const targetRule = WORKFLOW_RULES[rejectTo]
    if (targetRule) {
      const project = await prisma.project.findUnique({
        where: { id: task.projectId },
        select: { projectCode: true, projectName: true },
      })
      const users = await prisma.user.findMany({
        where: { roleCode: targetRule.role, isActive: true },
        select: { id: true },
      })
      if (users.length > 0 && project) {
        await prisma.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            title: `⚠️ Từ chối: ${rule.name}`,
            message: `Bước ${task.stepCode} bị từ chối. Lý do: ${reason}. Quay về ${rejectTo} — ${targetRule.name}.`,
            type: 'REJECTED',
            linkUrl: `/dashboard/projects/${task.projectId}`,
          })),
        })
      }
    }
  } catch (err) {
    console.error('Reject notification error:', err)
  }

  return { returnedTo: rejectTo }
}

// ── Workflow → Module Integration Hooks ──

const QC_STEP_TYPE_MAP: Record<string, string> = {
  'P3.5': 'material_incoming',
  'P4.6': 'ndt',
  'P4.7': 'pressure_test',
  'P4.8': 'fat',
  'P5.3': 'sat',
}

async function runWorkflowHooks(
  projectId: string,
  stepCode: string,
  userId: string,
  resultData?: Record<string, unknown>,
) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectCode: true },
    })
    const projCode = project?.projectCode || 'UNKNOWN'

    // ── Forward Sync Hooks ──

    // P2.2/P2.3: BOM complete → sync budget.planned
    if (['P2.2', 'P2.3'].includes(stepCode)) {
      await syncBOMtoBudget(projectId, userId)
    }

    // P3.3: PO approved → sync budget.committed
    if (stepCode === 'P3.3' && resultData?.poId) {
      await syncPOtoBudget(projectId, resultData.poId as string, userId)
    }

    // P3.4A: GRN → sync budget.actual
    if (stepCode === 'P3.4A' && resultData?.grnAmount) {
      await syncGRNtoBudget(projectId, resultData.grnAmount as number, userId)
    }

    // ── Existing Module Hooks ──

    // P3.4A/B: Material receipt → auto StockMovement (IN)
    if (['P3.4A', 'P3.4B'].includes(stepCode) && resultData) {
      const materialId = resultData.materialId as string | undefined
      const quantity = resultData.quantity as number | undefined
      if (materialId && quantity && quantity > 0) {
        await prisma.$transaction([
          prisma.stockMovement.create({
            data: {
              materialId,
              projectId,
              type: 'IN',
              quantity,
              reason: 'po_receipt',
              referenceNo: `${projCode}-${stepCode}`,
              performedBy: userId,
              notes: `Auto: workflow ${stepCode} completed`,
            },
          }),
          prisma.material.update({
            where: { id: materialId },
            data: { currentStock: { increment: quantity } },
          }),
        ])
      }
    }

    // P4.1: Issue WO → auto WorkOrder
    if (stepCode === 'P4.1') {
      const woCode = (resultData?.woCode as string) || `WO-${projCode}-${Date.now()}`
      const teamCode = (resultData?.teamCode as string) || 'TO-01'
      const description = (resultData?.description as string) || `Lệnh SX cho ${projCode}`
      await prisma.workOrder.create({
        data: {
          woCode,
          projectId,
          description,
          teamCode,
          status: 'OPEN',
          createdBy: userId,
        },
      })
    }

    // P4.2: Material issue → auto StockMovement (OUT) + MaterialIssue
    if (stepCode === 'P4.2' && resultData) {
      const materialId = resultData.materialId as string | undefined
      const quantity = resultData.quantity as number | undefined
      const workOrderId = resultData.workOrderId as string | undefined
      if (materialId && quantity && quantity > 0 && workOrderId) {
        await prisma.$transaction([
          prisma.materialIssue.create({
            data: { workOrderId, materialId, quantity, issuedBy: userId },
          }),
          prisma.stockMovement.create({
            data: {
              materialId,
              projectId,
              type: 'OUT',
              quantity,
              reason: 'production_issue',
              referenceNo: `${projCode}-P4.2`,
              performedBy: userId,
              notes: 'Auto: workflow P4.2 completed',
            },
          }),
          prisma.material.update({
            where: { id: materialId },
            data: { currentStock: { decrement: quantity } },
          }),
        ])
      }
    }

    // QC steps → auto Inspection
    const qcType = QC_STEP_TYPE_MAP[stepCode]
    if (qcType) {
      const inspCode = `QC-${projCode}-${stepCode}-${Date.now()}`
      await prisma.inspection.create({
        data: {
          inspectionCode: inspCode,
          projectId,
          type: qcType,
          stepCode,
          status: 'PENDING',
          inspectorId: userId,
        },
      })
    }

    // P5.1: Packing → auto DeliveryRecord
    if (stepCode === 'P5.1') {
      const count = await prisma.deliveryRecord.count()
      const deliveryCode = `DL-${projCode}-${String(count + 1).padStart(3, '0')}`
      await prisma.deliveryRecord.create({
        data: {
          deliveryCode,
          projectId,
          status: 'PACKING',
          createdBy: userId,
          notes: `Auto: workflow P5.1 completed`,
        },
      })
    }

    // P5.2: Shipping → update delivery to SHIPPED
    if (stepCode === 'P5.2') {
      const delivery = await prisma.deliveryRecord.findFirst({
        where: { projectId, status: 'PACKING' },
        orderBy: { createdAt: 'desc' },
      })
      if (delivery) {
        await prisma.deliveryRecord.update({
          where: { id: delivery.id },
          data: { status: 'SHIPPED', shippedAt: new Date() },
        })
      }
    }
  } catch (err) {
    // Hooks should not block task completion
    console.error(`Workflow hook error for ${stepCode}:`, err)
  }
}

async function checkGate(projectId: string, requiredCodes: string[]): Promise<boolean> {
  const doneTasks = await prisma.workflowTask.findMany({
    where: {
      projectId,
      stepCode: { in: requiredCodes },
      status: TASK_STATUS.DONE,
    },
    select: { stepCode: true, status: true },
  })
  const doneStepCodes = doneTasks.map(t => t.stepCode)
  const missing = requiredCodes.filter(c => !doneStepCodes.includes(c))
  console.log(`[GATE CHECK] Required: [${requiredCodes.join(', ')}] | Done: [${doneStepCodes.join(', ')}] | Missing: [${missing.join(', ')}] | Pass: ${missing.length === 0}`)
  return missing.length === 0
}

export async function activateTask(projectId: string, stepCode: string): Promise<void> {
  const rule = WORKFLOW_RULES[stepCode]
  if (!rule) return

  // For rejection re-activation: also update tasks that are DONE, REJECTED or PENDING
  await prisma.workflowTask.updateMany({
    where: {
      projectId,
      stepCode,
      status: { in: [TASK_STATUS.PENDING, TASK_STATUS.REJECTED, TASK_STATUS.DONE] },
    },
    data: {
      status: TASK_STATUS.IN_PROGRESS,
      startedAt: new Date(),
      deadline: rule.deadlineDays
        ? new Date(Date.now() + rule.deadlineDays * 24 * 60 * 60 * 1000)
        : null,
    },
  })

  // Create notifications for users with matching role
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectName: true },
    })
    const users = await prisma.user.findMany({
      where: { roleCode: rule.role, isActive: true },
      select: { id: true },
    })
    // Find the task ID for this step+project to link notifications correctly
    const task = await prisma.workflowTask.findFirst({
      where: { projectId, stepCode },
      select: { id: true },
    })
    if (users.length > 0 && project && task) {
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          title: `Công việc mới: ${rule.name}`,
          message: `Bước ${stepCode} của dự án ${project.projectCode} — ${project.projectName} đã sẵn sàng.`,
          type: 'task_assigned',
          linkUrl: `/dashboard/tasks/${task.id}`,
        })),
      })
    }
  } catch (err) {
    console.error('Notification creation error:', err)
  }
}
