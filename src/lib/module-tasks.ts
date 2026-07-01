import prisma from './db'
import { createTask } from './work-engine'

interface ModuleTaskInput {
  projectId?: string
  taskType: string
  title: string
  description?: string
  priority?: 'NORMAL' | 'HIGH' | 'URGENT'
  deadline?: string
  assigneeRoles: string[]
}

export async function createModuleTask(
  source: string,
  entityKey: string,
  input: ModuleTaskInput,
  actorUserId: string,
): Promise<string | null> {
  const externalRef = `MOD:${source}:${entityKey}`

  try {
    const existing = await prisma.task.findUnique({ where: { externalRef } })
    if (existing) return existing.id

    const assignees = input.assigneeRoles.map(role => ({ role }))

    const task = await createTask(
      {
        projectId: input.projectId,
        taskType: input.taskType,
        title: input.title,
        description: input.description,
        priority: input.priority || 'NORMAL',
        deadline: input.deadline,
        assignees,
      },
      actorUserId,
      { externalRef, externalSource: `MODULE_${source}` },
    )

    return task.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('Không tìm được người nhận') || msg.includes('ít nhất 1')) {
      // Fallback: try R06 then R01
      try {
        const fallback = await prisma.user.findFirst({
          where: { roleCode: { in: ['R06', 'R01'] }, isActive: true },
          orderBy: [{ roleCode: 'asc' }, { userLevel: 'asc' }],
          select: { id: true },
        })
        if (!fallback) {
          console.warn(`[module-tasks] ${externalRef}: no assignees found, skipping`)
          return null
        }
        const task = await createTask(
          {
            ...input,
            priority: input.priority || 'NORMAL',
            assignees: [{ userId: fallback.id }],
          },
          actorUserId,
          { externalRef, externalSource: `MODULE_${source}` },
        )
        return task.id
      } catch (fallbackErr) {
        console.warn(`[module-tasks] ${externalRef}: fallback failed`, fallbackErr)
        return null
      }
    }

    console.warn(`[module-tasks] ${externalRef}: failed`, msg)
    return null
  }
}
