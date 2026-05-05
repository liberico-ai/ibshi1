import prisma from '../src/lib/db'

async function main() {
  const result = await prisma.workflowTask.deleteMany({
    where: { stepCode: 'P3.2' }
  })
  console.log(`Deleted ${result.count} deprecated P3.2 tasks.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
