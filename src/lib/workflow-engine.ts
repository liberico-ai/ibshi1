import prisma from './db'
import { TASK_STATUS } from './constants'
import { WORKFLOW_RULES } from './workflow-constants'
import { logChangeEvent, runReverseHooks } from './sync-engine'
import { runValidationRules } from './validation-rules'
import { notifyTaskActivated, notifyTaskRejected } from './telegram-notifications'
import { resolveRoleToUser } from './work-engine'

// Re-export client-safe items for backward compatibility
export { WORKFLOW_RULES, PHASE_LABELS, getWorkflowProgress } from './workflow-constants'
export type { WorkflowStep } from './workflow-constants'

// ── Workflow Engine Core Functions (Server-only) ──

const DYNAMIC_STEPS = [
  'P4.3', 'P4.4',
  'P5.1', 'P5.1A', 'P5.2', 'P5.3', 'P5.4', 'P5.1.1', 'P5.3A',
]

export async function completeTask(
  taskId: string,
  userId: string,
  resultData?: Record<string, unknown>,
  notes?: string
): Promise<{ nextSteps: string[] }> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } })
  if (!task) throw new Error('Task not found')
  if (!task.projectId) throw new Error('Task has no projectId')
  if (task.status === TASK_STATUS.DONE) throw new Error('Task already completed')
  const projectId = task.projectId

  // Run TC validation rules before marking as done
  const validation = await runValidationRules(task.taskType, resultData, projectId)
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join('; ')}`)
  }
  // Append warnings to resultData (non-blocking)
  let finalNotes = notes || ''
  if (validation.warnings.length > 0) {
    finalNotes = finalNotes + (finalNotes ? '\n' : '') + validation.warnings.map(w => `⚠️ ${w}`).join('\n')
  }

  // Merge notes into resultData since Task model has no notes field
  const mergedResultData = resultData ? JSON.parse(JSON.stringify(resultData)) : undefined
  if (finalNotes && mergedResultData) mergedResultData._notes = finalNotes

  // Multi-assignee: mark current user's row as done first
  const myRow =
    task.assignees.find((a) => a.userId === userId) ||
    task.assignees.find((a) => !a.done)
  if (myRow) {
    await prisma.taskAssignee.update({
      where: { id: myRow.id },
      data: { done: true, doneAt: new Date(), doneBy: userId },
    })
  }

  // Check if ALL assignees are now done (including the one we just updated)
  const totalAssignees = task.assignees.length
  const alreadyDone = task.assignees.filter((a) => a.done && a.id !== myRow?.id).length
  const allDone = totalAssignees <= 1 || (alreadyDone + 1 >= totalAssignees)

  if (!allDone) {
    // Not all assignees done yet — save resultData but keep task active
    if (mergedResultData) {
      await prisma.task.update({
        where: { id: taskId },
        data: { resultData: mergedResultData },
      })
    }
    return { nextSteps: [] }
  }

  // All assignees done — mark task as DONE
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: TASK_STATUS.DONE,
      completedAt: new Date(),
      completedBy: userId,
      resultData: mergedResultData,
    },
  })

  // Run module integration hooks
  await runWorkflowHooks(projectId, task.taskType, userId, resultData)

  // Get workflow rule for this step
  const rule = WORKFLOW_RULES[task.taskType]

  // Auto-create P5.1 when a dynamic P4.5 completes
  if (task.taskType === 'P4.5') {
    await checkAndCreateP51(taskId)
  }

  // Dynamic P4.4 creation — when a per-PO P4.3 (QC nghiệm thu CL) completes,
  // spawn the matching per-PO P4.4 (Kho nghiệm thu SL + nhập kho) for the same PO.
  if (task.taskType === 'P4.3') {
    const rd = (resultData || task.resultData) as { poId?: string; poCode?: string } | null
    if (rd?.poId && rd?.poCode) {
      const existingP44 = await prisma.task.findFirst({
        where: {
          projectId: projectId,
          taskType: 'P4.4',
          resultData: { path: ['poId'], equals: rd.poId },
        },
        select: { id: true },
      })
      if (!existingP44) {
        const p44Rule = WORKFLOW_RULES['P4.4']
        const newP44 = await prisma.task.create({
          data: {
            projectId: projectId,
            taskType: 'P4.4',
            title: `Nhập kho theo PO ${rd.poCode}`,
            description: `Stock-in for PO ${rd.poCode}`,
            createdBy: userId,
            status: TASK_STATUS.IN_PROGRESS,
            startedAt: new Date(),
            deadline: p44Rule?.deadlineDays
              ? new Date(Date.now() + p44Rule.deadlineDays * 24 * 60 * 60 * 1000)
              : null,
            resultData: { poId: rd.poId, poCode: rd.poCode },
          },
        })
        const p44Role = p44Rule?.role || 'R05'
        const p44User = await resolveRoleToUser(p44Role, projectId)
        await prisma.taskAssignee.create({ data: { taskId: newP44.id, role: p44Role, userId: p44User.id, isPrimary: true } })
      }
    }
  }

  // Auto-create P5.3A when P5.1.1 (Yêu cầu nghiệm thu CL) completes
  if (task.taskType === 'P5.1.1') {
    const rd = resultData || (task.resultData as Record<string, any>) || {}
    const newP53a = await prisma.task.create({
      data: {
        projectId: projectId,
        taskType: 'P5.3A',
        title: `QAQC nghiệm thu CL: ${rd.hangMucName || 'Hạng mục'}`,
        createdBy: userId,
        status: TASK_STATUS.IN_PROGRESS,
        resultData: rd,
      }
    })
    const p53aRole = WORKFLOW_RULES['P5.3A']?.role || 'R09'
    const p53aUser = await resolveRoleToUser(p53aRole, projectId)
    await prisma.taskAssignee.create({ data: { taskId: newP53a.id, role: p53aRole, userId: p53aUser.id, isPrimary: true } })

    // Notify for P5.3A
    try {
      const users = await prisma.user.findMany({ where: { roleCode: p53aRole, isActive: true }, select: { id: true, username: true, telegramChatId: true } })
      if (users.length > 0) {
        const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, projectName: true } })
        if (project) {
          await prisma.notification.createMany({
            data: users.map(u => ({
              userId: u.id,
              title: `Công việc mới: QAQC nghiệm thu CL`,
              message: `Bước P5.3A của dự án ${project.projectCode} đã sẵn sàng.`,
              type: 'task_assigned',
              linkUrl: `/dashboard/work/${newP53a.id}`,
            }))
          })
          await notifyTaskActivated({
            stepCode: 'P5.3A', stepName: newP53a.title,
            projectCode: project.projectCode, projectName: project.projectName,
            assignedRole: p53aRole, deadline: null, taskId: newP53a.id,
            mentionUsers: users.map(u => ({ fullName: u.username, telegramChatId: u.telegramChatId }))
          }).catch(console.error)
        }
      }
    } catch (e) { console.error(e) }
  }

  if (!rule) return { nextSteps: [] }

  // Parallel multi-user approval check for P1.3
  if (task.taskType === 'P1.3') {
    const pendingCount = await prisma.task.count({
      where: {
        projectId: projectId,
        taskType: task.taskType,
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
      const gatePass = await checkGate(projectId, nextRule.gate)
      if (!gatePass) continue
    }

    await activateTask(projectId, nextCode)
    activatedSteps.push(nextCode)

    // Auto-propagate: if the next step's own next step is RETURNED (was the step that rejected),
    // auto-complete the intermediate step and re-activate the RETURNED step.
    // This handles: P5.3 reject → P5.1 → P5.2 auto-skip → P5.3 re-activate
    if (nextRule.next && nextRule.next.length > 0) {
      for (const downstreamCode of nextRule.next) {
        const downstreamTask = await prisma.task.findFirst({
          where: { projectId: projectId, taskType: downstreamCode, status: TASK_STATUS.RETURNED },
        })
        if (downstreamTask) {
          const intermediateTask = await prisma.task.findFirst({
            where: { projectId: projectId, taskType: nextCode, status: TASK_STATUS.IN_PROGRESS },
          })
          if (intermediateTask) {
            await prisma.task.update({
              where: { id: intermediateTask.id },
              data: {
                status: TASK_STATUS.DONE,
                completedAt: new Date(),
                completedBy: userId,
              },
            })
            await activateTask(projectId, downstreamCode)
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
      if (!r.gate.includes(task.taskType)) continue
      // This gated step depends on the step we just completed
      const gatePass = await checkGate(projectId, r.gate)
      if (gatePass) {
        await activateTask(projectId, code)
        activatedSteps.push(code)
      }
    }
  }

  return { nextSteps: activatedSteps }
}

// ── Ensure the persistent daily-report tasks (P5.1 + P5.1A) exist for a project ──
// Idempotent: safe to call multiple times — only creates each task once.
// Triggered by: (1) first P4.5 completion (Kho cấp VT xong); (2) PM/QLSX phát hành LSX
// (api/tasks/ensure-daily-report) — so material-less stages still get a daily report.
export async function ensureDailyReportTasks(projectId: string, createdByUserId?: string): Promise<void> {
  const rule = WORKFLOW_RULES['P5.1']
  if (!rule) return
  const systemUser = createdByUserId || 'system'

  // P5.1 — single persistent "Daily Report" task
  const existingDailyTask = await prisma.task.findFirst({
    where: { projectId, taskType: 'P5.1', title: 'BÁO CÁO KHỐI LƯỢNG HOÀN THÀNH (THEO NGÀY)' },
  })
  if (!existingDailyTask) {
    const newP51 = await prisma.task.create({
      data: {
        projectId,
        taskType: 'P5.1',
        title: 'BÁO CÁO KHỐI LƯỢNG HOÀN THÀNH (THEO NGÀY)',
        description: 'Daily Production Volume Report',
        createdBy: systemUser,
        status: TASK_STATUS.IN_PROGRESS,
        startedAt: new Date(),
      },
    })
    const p51User = await resolveRoleToUser(rule.role, projectId)
    await prisma.taskAssignee.create({ data: { taskId: newP51.id, role: rule.role, userId: p51User.id, isPrimary: true } })
    try {
      const users = await prisma.user.findMany({ where: { roleCode: rule.role, isActive: true }, select: { id: true, username: true, telegramChatId: true } })
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, projectName: true } })
      if (users.length > 0 && project) {
        await prisma.notification.createMany({
          data: users.map(u => ({
            userId: u.id, title: `Công việc mới: Báo cáo SX Hàng ngày`,
            message: `Bước P5.1 của dự án ${project.projectCode} đã sẵn sàng.`,
            type: 'task_assigned', linkUrl: `/dashboard/work/${newP51.id}`,
          })),
        })
        await notifyTaskActivated({
          stepCode: 'P5.1', stepName: newP51.title,
          projectCode: project.projectCode, projectName: project.projectName,
          assignedRole: rule.role, deadline: null, taskId: newP51.id,
          mentionUsers: users.map(u => ({ fullName: u.username, telegramChatId: u.telegramChatId })),
        }).catch(console.error)
      }
    } catch (e) { console.error(e) }
  }

  // P5.1A — subcontractor daily report
  const ruleP51A = WORKFLOW_RULES['P5.1A']
  if (ruleP51A) {
    const existingP51A = await prisma.task.findFirst({ where: { projectId, taskType: 'P5.1A' } })
    if (!existingP51A) {
      const newP51A = await prisma.task.create({
        data: {
          projectId,
          taskType: 'P5.1A',
          title: 'BÁO CÁO KHỐI LƯỢNG CỦA THẦU PHỤ (THEO NGÀY)',
          description: 'Daily Subcontractor Production Report',
          createdBy: systemUser,
          status: TASK_STATUS.IN_PROGRESS,
          startedAt: new Date(),
        },
      })
      const p51aUser = await resolveRoleToUser(ruleP51A.role, projectId)
      await prisma.taskAssignee.create({ data: { taskId: newP51A.id, role: ruleP51A.role, userId: p51aUser.id, isPrimary: true } })
      try {
        const users = await prisma.user.findMany({ where: { roleCode: ruleP51A.role, isActive: true }, select: { id: true, username: true, telegramChatId: true } })
        const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, projectName: true } })
        if (users.length > 0 && project) {
          await prisma.notification.createMany({
            data: users.map(u => ({
              userId: u.id, title: `Công việc mới: Báo cáo SX Thầu phụ`,
              message: `Bước P5.1A của dự án ${project.projectCode} đã sẵn sàng.`,
              type: 'task_assigned', linkUrl: `/dashboard/work/${newP51A.id}`,
            })),
          })
          await notifyTaskActivated({
            stepCode: 'P5.1A', stepName: newP51A.title,
            projectCode: project.projectCode, projectName: project.projectName,
            assignedRole: ruleP51A.role, deadline: null, taskId: newP51A.id,
            mentionUsers: users.map(u => ({ fullName: u.username, telegramChatId: u.telegramChatId })),
          }).catch(console.error)
        }
      } catch (e) { console.error(e) }
    }
  }
}

// ── Auto-create persistent P5.1 "Daily Report" task when first P4.5 completes ──
// P5.1.1 (Yêu cầu nghiệm thu) is NOT handled here anymore.
// It is triggered by /api/tasks/check-p511 when PM/QLSX Phát hành đủ 100% công đoạn.
async function checkAndCreateP51(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return
  if (task.taskType !== 'P4.5') return

  const data = (task.resultData as Record<string, any>) || {}
  if (data._p51Created || !data.sourceStep) return
  if (task.status !== TASK_STATUS.DONE) return

  await ensureDailyReportTasks(task.projectId!, task.completedBy || undefined)

  // Mark P4.5 as processed
  await prisma.task.update({
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
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } })
  if (!task) throw new Error('Task not found')
  if (!task.projectId) throw new Error('Task has no projectId')
  const projectId = task.projectId

  const rule = WORKFLOW_RULES[task.taskType]
  if (!rule) throw new Error('No workflow rule for this step')

  const rejectTo = overrideRejectTo || rule.rejectTo
  if (!rejectTo) throw new Error(`Step ${task.taskType} cannot be rejected (no rejectTo defined)`)

  // 1. Mark current task as RETURNED
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: TASK_STATUS.RETURNED,
      resultData: { ...(task.resultData as Record<string, any> || {}), _rejectReason: reason },
      completedBy: userId,
      completedAt: new Date(),
      returnCount: { increment: 1 },
    },
  })

  // Parallel multi-user rejection logic for P1.3
  if (task.taskType === 'P1.3') {
    await prisma.task.updateMany({
      where: {
        projectId: projectId,
        taskType: task.taskType,
        id: { not: taskId },
        status: { not: TASK_STATUS.RETURNED }
      },
      data: {
        status: TASK_STATUS.RETURNED,
      }
    })
  }

  // 2. Reset intermediate steps between rejectTo and current step
  if (!overrideRejectTo) {
    const allSteps = Object.keys(WORKFLOW_RULES)
    const rejectToPhase = WORKFLOW_RULES[rejectTo]?.phase || 1
    const currentPhase = rule.phase

    const stepsToReset = allSteps.filter((code) => {
      const r = WORKFLOW_RULES[code]
      if (['P5.2', 'P5.3', 'P5.4'].includes(code)) return false;
      return r && r.phase >= rejectToPhase && r.phase <= currentPhase
        && code !== task.taskType && code !== rejectTo
    })

    if (stepsToReset.length > 0) {
      await prisma.task.updateMany({
        where: {
          projectId: projectId,
          taskType: { in: stepsToReset },
          status: TASK_STATUS.DONE,
        },
        data: { status: TASK_STATUS.OPEN, completedAt: null, completedBy: null },
      })
    }
  }

  // 3. Reactivate the target step
  await activateTask(projectId, rejectTo)

  // Append failedContext if provided
  if (failedContext) {
    const targetTask = await prisma.task.findFirst({
      where: { projectId: projectId, taskType: rejectTo },
      orderBy: { createdAt: 'desc' }
    });
    if (targetTask) {
      const rd = (targetTask.resultData || {}) as Record<string, any>;
      rd.qcFailedAssignments = rd.qcFailedAssignments || [];
      rd.qcFailedAssignments.push(failedContext);
      await prisma.task.update({
        where: { id: targetTask.id },
        data: { resultData: rd }
      });
    }
  }

  // 4. Run reverse sync hooks
  await runReverseHooks(projectId, task.taskType, userId, reason)

  // 5. Log ChangeEvent
  await logChangeEvent({
    projectId: projectId, sourceStep: task.taskType,
    sourceModel: 'Task', sourceId: taskId,
    eventType: 'REJECT', targetModel: 'Task',
    targetId: rejectTo, reason, triggeredBy: userId,
  })

  // 6. Create notification for the target step's assignee
  try {
    const targetRule = WORKFLOW_RULES[rejectTo]
    if (targetRule) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
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
            message: `Bước ${task.taskType} bị từ chối. Lý do: ${reason}. Quay về ${rejectTo} — ${targetRule.name}.`,
            type: 'REJECTED',
            linkUrl: `/dashboard/projects/${projectId}`,
          })),
        })
        notifyTaskRejected({
          stepCode: task.taskType, stepName: rule.name,
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

    // ── Existing Module Hooks ──
    // Budget sync (syncBOMtoBudget, syncPOtoBudget) handled via work-hooks hookKeys — single path.
    
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
        const p36Task = await prisma.task.findUnique({ where: { id: p36Id } })
        if (p36Task) {
          const rd = (p36Task.resultData as any) || {}
          if (rd.groups) {
             const gIndex = rd.groups.findIndex((x: any) => x.id === groupId)
             if (gIndex >= 0) {
               rd.groups[gIndex].paymentStatus = 'PAID'
               rd.groups[gIndex].paymentDate = resultData?.paymentDate ? new Date(resultData.paymentDate as string).toISOString() : new Date().toISOString()
               rd.groups[gIndex].paymentMethod = resultData?.paymentMethod
               await prisma.task.update({
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
      const p54Task = await prisma.task.findFirst({
        where: { projectId, taskType: 'P5.4', status: 'IN_PROGRESS' },
        orderBy: { createdAt: 'desc' },
      })
      if (p54Task) {
        const weekStartDate = new Date(resultData.weekStartDate as string)
        const deadline = new Date(weekStartDate)
        deadline.setDate(weekStartDate.getDate() + 5)
        deadline.setHours(23, 59, 59, 999)

        await prisma.task.update({
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
  const doneTasks = await prisma.task.findMany({
    where: {
      projectId,
      taskType: { in: requiredCodes },
      status: TASK_STATUS.DONE,
    },
    select: { taskType: true, status: true },
  })
  const doneStepCodes = doneTasks.map(t => t.taskType)
  const missing = requiredCodes.filter(c => !doneStepCodes.includes(c))
  console.log(`[GATE CHECK] Required: [${requiredCodes.join(', ')}] | Done: [${doneStepCodes.join(', ')}] | Missing: [${missing.join(', ')}] | Pass: ${missing.length === 0}`)
  return missing.length === 0
}

export async function activateTask(projectId: string, stepCode: string): Promise<void> {
  const rule = WORKFLOW_RULES[stepCode]
  if (!rule) return

  // For rejection re-activation: also update tasks that are OPEN, RETURNED or DONE
  await prisma.task.updateMany({
    where: {
      projectId,
      taskType: stepCode,
      status: { in: [TASK_STATUS.OPEN, TASK_STATUS.RETURNED, TASK_STATUS.DONE] },
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
      const existingTasks = await prisma.task.findMany({
        where: { projectId, taskType: stepCode },
        include: { assignees: true },
        orderBy: { createdAt: 'asc' }
      })

      if (existingTasks.length > 0) {
        const assignedUserIds = existingTasks
          .flatMap(t => t.assignees?.map(a => a.userId) || [])
          .filter(Boolean) as string[]
        const unassignedUsers = roleUsers.filter(u => !assignedUserIds.includes(u.id))

        let firstUnassignedTask = existingTasks.find(t => !t.assignees?.some(a => a.userId))

        for (const user of unassignedUsers) {
          if (firstUnassignedTask) {
            const assignee = firstUnassignedTask.assignees?.[0]
            if (assignee) {
              await prisma.taskAssignee.update({
                where: { id: assignee.id },
                data: { userId: user.id }
              })
            }
            firstUnassignedTask = undefined
          } else {
            const newTask = await prisma.task.create({
              data: {
                projectId,
                taskType: stepCode,
                title: rule.name,
                description: rule.nameEn,
                createdBy: 'system',
                status: TASK_STATUS.IN_PROGRESS,
                startedAt: new Date(),
                deadline: rule.deadlineDays
                  ? new Date(Date.now() + rule.deadlineDays * 24 * 60 * 60 * 1000)
                  : null,
              }
            })
            await prisma.taskAssignee.create({ data: { taskId: newTask.id, role: rule.role, userId: user.id, isPrimary: true } })
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
    const task = await prisma.task.findFirst({
      where: { projectId, taskType: stepCode },
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
          linkUrl: `/dashboard/work/${task.id}`,
        })),
      })
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
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Task not found')
  if (task.status === TASK_STATUS.DONE) throw new Error('Task already completed')

  const existingData = (task.resultData as Record<string, any>) || {}
  const issuedAccumulated: Record<string, number> = { ...(existingData.issuedAccumulated || {}) }
  const reqs = (existingData.materialIssueRequests as Record<string, any>[]) || []

  const project = await prisma.project.findUnique({ where: { id: task.projectId! }, select: { projectCode: true } })
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
            projectId: task.projectId!,
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
  await prisma.task.update({
    where: { id: taskId },
    data: { resultData: JSON.parse(JSON.stringify(updatedData)) },
  })

  return { isPartial: true, issuedAccumulated }
}
