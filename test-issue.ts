import 'dotenv/config'
import prisma from './src/lib/db'

async function main() {
  const task = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P4.5' },
    orderBy: { createdAt: 'desc' }
  })
  
  console.dir(task?.resultData, { depth: null })
  
  const materials = await prisma.material.findMany({
    where: { materialCode: { contains: 'BOLT' } }
  })
  console.dir(materials, { depth: null })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) });
