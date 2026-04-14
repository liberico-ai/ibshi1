import prisma from '../src/lib/db'

async function main() {
  const tasks = await prisma.workflowTask.findMany({
    where: { stepCode: { in: ['P5.1', 'P5.1A'] } },
    select: { id: true, stepCode: true, stepName: true, status: true, assignedRole: true, projectId: true, project: { select: { projectCode: true } } }
  })
  console.log(JSON.stringify(tasks, null, 2))
}

main().finally(() => prisma.$disconnect())
