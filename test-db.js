const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
async function main() {
  try {
    const t = await p.workflowTask.findFirst({
      where: { stepCode: 'P1.2', project: { projectCode: 'DA-26-99' } },
      select: { id: true, status: true, stepName: true }
    })
    console.log('Found:', JSON.stringify(t, null, 2))
    if (t) {
      await p.workflowTask.update({
        where: { id: t.id },
        data: { status: 'IN_PROGRESS', completedAt: null, completedBy: null }
      })
      console.log('Reopened P1.2 to IN_PROGRESS')
    } else {
      console.log('Task not found!')
    }
  } catch (e) {
    console.error('Error:', e.message)
  } finally {
    await p.$disconnect()
  }
}
main()
