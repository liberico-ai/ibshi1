const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const result = await p.workflowTask.updateMany({
    where: { stepCode: 'P2.3' },
    data: { stepName: 'Kho đề xuất vật tư tiêu hao' }
  })
  console.log('Updated', result.count, 'P2.3 tasks')
  await p.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
