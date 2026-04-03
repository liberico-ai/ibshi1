const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const result = await prisma.workflowTask.updateMany({
    where: { stepCode: 'P1.3' },
    data: { stepName: 'Phê duyệt Dự toán, kế hoạch kickoff, WBS, milestones' },
  })
  console.log(`Updated ${result.count} tasks.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
