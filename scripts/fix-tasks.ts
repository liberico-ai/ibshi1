import prisma from '../src/lib/db'
import { WORKFLOW_STEPS } from '../src/lib/workflow-constants'

async function run() {
  // Find project DA-26-SON
  const project = await prisma.project.findFirst({
    where: { projectCode: { contains: 'SON' } }
  })
  if (!project) {
    console.log('Project not found!')
    return
  }

  const projectId = project.id
  console.log(`Found project: ${project.projectCode}`)

  // Check what tasks exist
  const existingTasks = await prisma.workflowTask.findMany({
    where: { projectId }
  })
  
  const existingCodes = existingTasks.map(t => t.stepCode)
  console.log('Existing tasks:', existingCodes.join(', '))

  // Create P3.3 if missing
  if (!existingCodes.includes('P3.3')) {
    await prisma.workflowTask.create({
      data: {
        projectId,
        stepCode: 'P3.3',
        stepName: WORKFLOW_STEPS['P3.3'].name,
        stepNameEn: WORKFLOW_STEPS['P3.3'].nameEn,
        assignedRole: WORKFLOW_STEPS['P3.3'].role,
        status: 'PENDING'
      }
    })
    console.log('✅ Created P3.3')
  }

  // Create P3.4 if missing
  if (!existingCodes.includes('P3.4')) {
    await prisma.workflowTask.create({
      data: {
        projectId,
        stepCode: 'P3.4',
        stepName: WORKFLOW_STEPS['P3.4'].name,
        stepNameEn: WORKFLOW_STEPS['P3.4'].nameEn,
        assignedRole: WORKFLOW_STEPS['P3.4'].role,
        status: 'PENDING'
      }
    })
    console.log('✅ Created P3.4')
  }

  console.log('Fix complete.')
}

run().finally(() => prisma.$disconnect())
