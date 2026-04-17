import prisma from './db'
import { TASK_STATUS } from './constants'
import { WORKFLOW_RULES } from './workflow-constants'
import { syncBOMtoBudget, syncPOtoBudget, syncGRNtoBudget, logChangeEvent, runReverseHooks } from './sync-engine'
import { runValidationRules } from './validation-rules'
import { notifyTaskActivated, notifyTaskRejected } from './telegram-notifications'

// Re-export client-safe items for backward compatibility
export { WORKFLOW_RULES, PHASE_LABELS, getWorkflowProgress } from './workflow-constants'
export type { WorkflowStep } from './workflow-constants'

// ── Workflow Engine Core Functions (Server-only) ──

// Steps that are created dynamically (multi-instance), not during project init
const DYNAMIC_STEPS = ['P5.1', 'P5.1A', 'P5.2', 'P5.3', 'P5.4', 'P5.1.1', 'P5.3A']

export async function initializeProjectWorkflow(projectId: string): Promise<void> {
  const steps = Object.values(WORKFLOW_RULES).filter(s => !DYNAMIC_STEPS.includes(s.code))
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

  // Auto-create P5.1 when a dynamic P4.5 completes
  if (task.stepCode === 'P4.5') {
    await checkAndCreateP51(taskId)
  }

  // Auto-create P5.3A when P5.1.1 (Yêu cầu nghiệm thu CL) completes
  if (task.stepCode === 'P5.1.1') {
    const rd = resultData || (task.resultData as Record<string, any>) || {}
    await prisma.workflowTask.create({
      data: {
        projectId: task.projectId,
        stepCode: 'P5.3A',
        stepName: `QAQC nghiệm thu CL: ${rd.hangMucName || 'Hạng mục'}`,
        assignedRole: WORKFLOW_RULES['P5.3A']?.role || 'R09',
        status: TASK_STATUS.IN_PROGRESS,
        resultData: rd,
      }
    })
  }

  if (!rule) return { nextSteps: [] }

  // Parallel multi-user approval check for P1.3
  if (task.stepCode === 'P1.3') {
    const pendingCount = await prisma.workflowTask.count({
      where: {
        projectId: task.projectId,
        stepCode: task.stepCode,
        status: { not: TASK_STATUS.DONE }
      }
    })
    
    if (pendingCount > 0) {
      // Not all P1.3 tasks are completed yet, stop propagation here
      return { nextSteps: [] }
    }
  }

  const activatedSteps: string[] = []

  // Try to activate next steps
  for (const nextCode of rule.next) {
    const nextRule = WORKFLOW_RULES[nextCode]
    if (!nextRule) continue

    // Skip dynamic steps — they are created by dedicated handlers (e.g., createP53AndP54ForP51)
    if (DYNAMIC_STEPS.includes(nextCode)) continue

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

  // Auto-check gate-based steps: if no next steps were activated,
  // check if any gated step now has all prerequisites met
  if (activatedSteps.length === 0) {
    for (const [code, r] of Object.entries(WORKFLOW_RULES)) {
      if (!r.gate || r.gate.length === 0) continue
      if (!r.gate.includes(task.stepCode)) continue
      // This gated step depends on the step we just completed
      const gatePass = await checkGate(task.projectId, r.gate)
      if (gatePass) {
        await activateTask(task.projectId, code)
        activatedSteps.push(code)
      }
    }
  }

  return { nextSteps: activatedSteps }
}

// ── Auto-create persistent P5.1 "Daily Report" task when first P4.5 completes ──
// P5.1.1 (Yêu cầu nghiệm thu) is NOT handled here anymore.
// It is triggered by /api/tasks/check-p511 when PM/QLSX Phát hành đủ 100% công đoạn.
async function checkAndCreateP51(taskId: string) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } })
  if (!task) return
  if (task.stepCode !== 'P4.5') return

  const data = (task.resultData as Record<string, any>) || {}
  if (data._p51Created || !data.sourceStep) return
  if (task.status !== TASK_STATUS.DONE) return

  const rule = WORKFLOW_RULES['P5.1']
  if (!rule) return

  // Ensure the single persistent "Daily Report" task exists
  const existingDailyTask = await prisma.workflowTask.findFirst({
    where: {
      projectId: task.projectId,
      stepCode: 'P5.1',
      stepName: 'BÁO CÁO KHỐI LƯỢNG HOÀN THÀNH (THEO NGÀY)'
    }
  })

  if (!existingDailyTask) {
    await prisma.workflowTask.create({
      data: {
        projectId: task.projectId,
        stepCode: 'P5.1',
        stepName: 'BÁO CÁO KHỐI LƯỢNG HOÀN THÀNH (THEO NGÀY)',
        stepNameEn: 'Daily Production Volume Report',
        assignedRole: rule.role,
        status: TASK_STATUS.IN_PROGRESS,
        startedAt: new Date(),
      }
    })
  }

  // Also create P5.1A for PM (subcontractor daily report)
  const ruleP51A = WORKFLOW_RULES['P5.1A']
  if (ruleP51A) {
    const existingP51A = await prisma.workflowTask.findFirst({
      where: {
        projectId: task.projectId,
        stepCode: 'P5.1A',
      }
    })
    if (!existingP51A) {
      await prisma.workflowTask.create({
        data: {
          projectId: task.projectId,
          stepCode: 'P5.1A',
          stepName: 'BÁO CÁO KHỐI LƯỢNG CỦA THẦU PHỤ (THEO NGÀY)',
          stepNameEn: 'Daily Subcontractor Production Report',
          assignedRole: ruleP51A.role,
          status: TASK_STATUS.IN_PROGRESS,
          startedAt: new Date(),
        }
      })
    }
  }

  // Mark P4.5 as processed
  await prisma.workflowTask.update({
    where: { id: task.id },
    data: { resultData: JSON.parse(JSON.stringify({ ...data, _p51Created: true })) },
  })
}



export async function rejectTask(
  taskId: string,
  userId: string,
  reason: string,
  overrideRejectTo?: string,
  failedContext?: Record<string, any>
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

  // Parallel multi-user rejection logic for P1.3
  if (task.stepCode === 'P1.3') {
    await prisma.workflowTask.updateMany({
      where: {
        projectId: task.projectId,
        stepCode: task.stepCode,
        id: { not: taskId },
        status: { not: TASK_STATUS.REJECTED }
      },
      data: {
        status: TASK_STATUS.REJECTED,
        notes: `Auto-rejected due to rejection by another user: ${reason}`
      }
    })
  }

  // 2. Reset intermediate steps between rejectTo and current step
  //    Skip this when using overrideRejectTo (selective reject — don't reset siblings)
  if (!overrideRejectTo) {
    const allSteps = Object.keys(WORKFLOW_RULES)
    const rejectToPhase = WORKFLOW_RULES[rejectTo]?.phase || 1
    const currentPhase = rule.phase

    const stepsToReset = allSteps.filter((code) => {
      const r = WORKFLOW_RULES[code]
      // DO NOT globally reset parallel production steps, as it destroys independent job cards
      if (['P5.2', 'P5.3', 'P5.4'].includes(code)) return false;
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

  // Append failedContext if provided
  if (failedContext) {
    const targetTask = await prisma.workflowTask.findFirst({
      where: { projectId: task.projectId, stepCode: rejectTo },
      orderBy: { createdAt: 'desc' }
    });
    if (targetTask) {
      const rd = (targetTask.resultData || {}) as Record<string, any>;
      rd.qcFailedAssignments = rd.qcFailedAssignments || [];
      rd.qcFailedAssignments.push(failedContext);
      await prisma.workflowTask.update({
        where: { id: targetTask.id },
        data: { resultData: rd }
      });
    }
  }

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
        // Push rejection to Telegram group (fire-and-forget)
        notifyTaskRejected({
          stepCode: task.stepCode, stepName: rule.name,
          projectCode: project.projectCode, projectName: project.projectName,
          assignedRole: rule.role, deadline: null, taskId,
          reason, returnedTo: rejectTo, returnedStepName: targetRule.name,
        }).catch(err => console.error('Telegram rejectTask error:', err))
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
    
    // P1.1: Lập KHDA → update Master Project record if edited
    if (stepCode === 'P1.1' && resultData) {
      const dataToUpdate: any = {}
      if (resultData.projectName) dataToUpdate.projectName = resultData.projectName
      if (resultData.projectCode) dataToUpdate.projectCode = resultData.projectCode
      if (resultData.clientName) dataToUpdate.clientName = resultData.clientName
      if (resultData.productType) dataToUpdate.productType = resultData.productType
      if (resultData.currency) dataToUpdate.currency = resultData.currency
      if (resultData.contractValue) dataToUpdate.contractValue = Number(resultData.contractValue)
      if (resultData.description) dataToUpdate.description = resultData.description
      
      if (Object.keys(dataToUpdate).length > 0) {
        await prisma.project.update({
          where: { id: projectId },
          data: dataToUpdate,
        })
      }
    }

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

    // P4.4: Kho nghiệm thu nhập kho → auto StockMovement (IN) for each warehouse item
    if (stepCode === 'P4.4' && resultData) {
      const warehouseItems = resultData.warehouseItems as { material: string; receivedQty: string; storageLocation: string }[] | undefined
      if (warehouseItems && Array.isArray(warehouseItems)) {
        const validItems = warehouseItems.filter(w => w.material?.trim() && Number(w.receivedQty) > 0)
        for (const item of validItems) {
          const qty = Number(item.receivedQty)
          const matName = item.material.trim().toLowerCase()
          // Find material by name (fuzzy: exact, then includes)
          let material = await prisma.material.findFirst({
            where: { name: { equals: item.material.trim(), mode: 'insensitive' } },
            select: { id: true },
          })
          if (!material) {
            material = await prisma.material.findFirst({
              where: { name: { contains: item.material.trim(), mode: 'insensitive' } },
              select: { id: true },
            })
          }
          if (material) {
            await prisma.$transaction([
              prisma.stockMovement.create({
                data: {
                  materialId: material.id,
                  projectId,
                  type: 'IN',
                  quantity: qty,
                  reason: 'warehouse_receipt',
                  referenceNo: `${projCode}-P4.4`,
                  performedBy: userId,
                  notes: `Nhập kho: ${item.material} x ${qty}, vị trí: ${item.storageLocation || '—'}`,
                },
              }),
              prisma.material.update({
                where: { id: material!.id },
                data: { currentStock: { increment: qty } },
              }),
            ])
          }
        }
      }
    }

    // P4.1: Receive Payment Request -> update PR tracking status
    if (stepCode === 'P4.1') {
      const p36Id = resultData?.sourceP36Id as string
      const groupId = resultData?.sourceGroupId as string
      if (p36Id && groupId) {
        const p36Task = await prisma.workflowTask.findUnique({ where: { id: p36Id } })
        if (p36Task) {
          const rd = (p36Task.resultData as any) || {}
          if (rd.groups) {
             const gIndex = rd.groups.findIndex((x: any) => x.id === groupId)
             if (gIndex >= 0) {
               rd.groups[gIndex].paymentStatus = 'PAID'
               rd.groups[gIndex].paymentDate = resultData?.paymentDate ? new Date(resultData.paymentDate).toISOString() : new Date().toISOString()
               rd.groups[gIndex].paymentMethod = resultData?.paymentMethod
               await prisma.workflowTask.update({
                 where: { id: p36Id },
                 data: { resultData: rd }
               })
             }
          }
        }
      }

      // Legacy fallback logic for P4.1 Issue WO (if it still exists in other parts of the app)
      const woCode = (resultData?.woCode as string)
      if (woCode) {
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

    // P4.5: Kho xuất vật tư → auto deduct stock for each issued item
    if (stepCode === 'P4.5' && resultData && !resultData._stockAlreadyDeducted) {
      const issueItemsRaw = resultData.issueItems as string | undefined
      let issueItems: { name: string; code: string; spec: string; qty: string; unit: string }[] = []
      try { issueItems = issueItemsRaw ? JSON.parse(issueItemsRaw) : [] } catch { issueItems = [] }
      const validItems = issueItems.filter(item => item.code?.trim() && Number(item.qty) > 0)

      // Feature: Support new interface materialIssueRequests
      const reqs = (resultData.materialIssueRequests as Record<string, any>[]) || []
      for (let i = 0; i < reqs.length; i++) {
        const req = reqs[i]
        const txKey = `actualQty_${req.code?.trim()}_${i}`
        const actualQty = Number(resultData[txKey]) || 0
        if (actualQty > 0 && req.code?.trim()) {
           validItems.push({
             name: req.name || '',
             code: req.code,
             spec: req.spec || '',
             qty: String(actualQty),
             unit: req.unit || ''
           })
        }
      }

      // Pre-validate stock sufficiency
      const insufficientItems: string[] = []
      const materialOps: { materialId: string; qty: number; item: typeof validItems[0] }[] = []
      for (const item of validItems) {
        const material = await prisma.material.findFirst({
          where: { materialCode: item.code.trim() },
          select: { id: true, currentStock: true },
        })
        if (material) {
          const qty = Number(item.qty)
          if (Number(material.currentStock) < qty) {
            insufficientItems.push(`${item.name} (${item.code}): cần ${qty}, tồn ${Number(material.currentStock)}`)
          }
          materialOps.push({ materialId: material.id, qty, item })
        }
      }

      if (insufficientItems.length > 0) {
        console.warn(`[P4.5] Insufficient stock warnings: ${insufficientItems.join('; ')}`)
      }

      // Execute deductions in individual transactions (each item atomic)
      for (const op of materialOps) {
        await prisma.$transaction([
          prisma.stockMovement.create({
            data: {
              materialId: op.materialId,
              projectId,
              type: 'OUT',
              quantity: op.qty,
              reason: 'production_issue',
              referenceNo: `${projCode}-P4.5`,
              performedBy: userId,
              notes: `Xuất VT: ${op.item.name} (${op.item.code}) x ${op.qty} ${op.item.unit}`,
            },
          }),
          prisma.material.update({
            where: { id: op.materialId },
            data: { currentStock: { decrement: op.qty } },
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

    // P5.3: PM Acceptance → forward week data to P5.4 + set deadline
    if (stepCode === 'P5.3' && resultData) {
      const p54Task = await prisma.workflowTask.findFirst({
        where: { projectId, stepCode: 'P5.4', status: 'IN_PROGRESS' },
        orderBy: { createdAt: 'desc' },
      })
      if (p54Task) {
        // Deadline is 23:59:59 of that Saturday (same array of dates from P5.3)
        const weekStartDate = new Date(resultData.weekStartDate as string)
        const deadline = new Date(weekStartDate)
        deadline.setDate(weekStartDate.getDate() + 5) // Saturday
        deadline.setHours(23, 59, 59, 999)

        await prisma.workflowTask.update({
          where: { id: p54Task.id },
          data: {
            deadline,
            resultData: JSON.parse(JSON.stringify({
              weekNumber: resultData.weekNumber,
              year: resultData.year,
              weekStartDate: resultData.weekStartDate,
              weekEndDate: resultData.weekEndDate,
            })),
          },
        })
      }
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

  // Handling multiple parallel approval required logic for P1.3
  if (stepCode === 'P1.3') {
    const roleUsers = await prisma.user.findMany({
      where: { roleCode: rule.role, isActive: true },
    })

    if (roleUsers.length > 0) {
      const existingTasks = await prisma.workflowTask.findMany({
        where: { projectId, stepCode },
        orderBy: { createdAt: 'asc' }
      })

      if (existingTasks.length > 0) {
        // Find users that don't have a specific task assigned to them yet
        const assignedUserIds = existingTasks.map(t => t.assignedTo).filter(Boolean) as string[]
        const unassignedUsers = roleUsers.filter(u => !assignedUserIds.includes(u.id))
        
        let firstUnassignedTask = existingTasks.find(t => !t.assignedTo)

        for (const user of unassignedUsers) {
          if (firstUnassignedTask) {
            await prisma.workflowTask.update({
              where: { id: firstUnassignedTask.id },
              data: { assignedTo: user.id }
            })
            firstUnassignedTask = undefined // used up
          } else {
            await prisma.workflowTask.create({
              data: {
                projectId,
                stepCode,
                stepName: rule.name,
                stepNameEn: rule.nameEn,
                assignedRole: rule.role,
                assignedTo: user.id,
                status: TASK_STATUS.IN_PROGRESS,
                startedAt: new Date(),
                deadline: rule.deadlineDays
                  ? new Date(Date.now() + rule.deadlineDays * 24 * 60 * 60 * 1000)
                  : null,
              }
            })
          }
        }
      }
    }
  }

  // Create notifications for users with matching role
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectName: true },
    })
    const users = await prisma.user.findMany({
      where: { roleCode: rule.role, isActive: true },
      select: { id: true, fullName: true },
    })
    // Find the task ID for this step+project to link notifications correctly
    const task = await prisma.workflowTask.findFirst({
      where: { projectId, stepCode },
      select: { id: true },
    })
    if (users.length > 0 && project && task) {
      const deadline = rule.deadlineDays ? new Date(Date.now() + rule.deadlineDays * 86400000) : null
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          title: `Công việc mới: ${rule.name}`,
          message: `Bước ${stepCode} của dự án ${project.projectCode} — ${project.projectName} đã sẵn sàng.`,
          type: 'task_assigned',
          linkUrl: `/dashboard/tasks/${task.id}`,
        })),
      })
      // Push to Telegram group + tag users (fire-and-forget)
      notifyTaskActivated({
        stepCode, stepName: rule.name,
        projectCode: project.projectCode, projectName: project.projectName,
        assignedRole: rule.role,
        deadline,
        taskId: task.id,
        mentionUsers: users.map(u => ({ fullName: u.fullName, telegramChatId: null })),
      }).catch(err => console.error('Telegram activateTask error:', err))
    }
  } catch (err) {
    console.error('Notification creation error:', err)
  }
}

// P4.5 Partial Issue: deduct stock per batch, track accumulated, complete only when all fulfilled
export async function processP45PartialIssue(
  taskId: string,
  userId: string,
  resultData: Record<string, unknown>
): Promise<{ isPartial: boolean; issuedAccumulated: Record<string, number> }> {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Task not found')
  if (task.status === TASK_STATUS.DONE) throw new Error('Task already completed')

  const existingData = (task.resultData as Record<string, any>) || {}
  const issuedAccumulated: Record<string, number> = { ...(existingData.issuedAccumulated || {}) }
  const reqs = (existingData.materialIssueRequests as Record<string, any>[]) || []

  const project = await prisma.project.findUnique({ where: { id: task.projectId }, select: { projectCode: true } })
  const projCode = project?.projectCode || 'UNKNOWN'

  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i]
    const code = req.code?.trim()
    if (!code) continue

    const txKey = `actualQty_${code}_${i}`
    const actualQty = Number(resultData[txKey]) || 0
    if (actualQty <= 0) continue

    const material = await prisma.material.findFirst({
      where: { materialCode: code },
      select: { id: true, currentStock: true },
    })
    if (material) {
      await prisma.$transaction([
        prisma.stockMovement.create({
          data: {
            materialId: material.id,
            projectId: task.projectId,
            type: 'OUT',
            quantity: actualQty,
            reason: 'production_issue',
            referenceNo: `${projCode}-P4.5`,
            performedBy: userId,
            notes: `Xuất VT (partial): ${req.name} (${code}) x ${actualQty} ${req.unit}`,
          },
        }),
        prisma.material.update({
          where: { id: material.id },
          data: { currentStock: { decrement: actualQty } },
        }),
      ])
    }

    const accKey = `${code}_${i}`
    issuedAccumulated[accKey] = (issuedAccumulated[accKey] || 0) + actualQty
  }

  // Check: all items fully issued (=== exactly)
  let allFulfilled = reqs.length > 0
  for (let i = 0; i < reqs.length; i++) {
    const code = reqs[i].code?.trim()
    if (!code) continue
    const accKey = `${code}_${i}`
    const reqQty = Number(reqs[i].quantity) || 0
    const issued = issuedAccumulated[accKey] || 0
    if (issued !== reqQty) { allFulfilled = false; break }
  }

  if (allFulfilled) {
    // All fulfilled → complete the task. Set flag to skip double stock deduction.
    const cleanedData: Record<string, unknown> = { ...existingData, issuedAccumulated, _stockAlreadyDeducted: true }
    for (const key of Object.keys(cleanedData)) {
      if (key.startsWith('actualQty_')) delete cleanedData[key]
    }
    await completeTask(taskId, userId, cleanedData)
    // checkAndCreateP51 is now called inside completeTask
    return { isPartial: false, issuedAccumulated }
  }

  // Partial: save accumulated progress, clear actualQty for next round
  const updatedData: Record<string, unknown> = { ...existingData, issuedAccumulated }
  for (const key of Object.keys(updatedData)) {
    if (key.startsWith('actualQty_')) delete updatedData[key]
  }
  await prisma.workflowTask.update({
    where: { id: taskId },
    data: { resultData: JSON.parse(JSON.stringify(updatedData)) },
  })

  return { isPartial: true, issuedAccumulated }
}
