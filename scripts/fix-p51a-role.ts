import prisma from '../src/lib/db'

async function main() {
  // Fix P5.1A assignedRole from R04 to R02 (PM)
  const result = await prisma.workflowTask.updateMany({
    where: { stepCode: 'P5.1A' },
    data: { assignedRole: 'R02' }
  })
  console.log(`Updated ${result.count} P5.1A tasks to role R02 (PM)`)
}

main().finally(() => prisma.$disconnect())
