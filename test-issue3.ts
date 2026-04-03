import 'dotenv/config'
import prisma from './src/lib/db'

async function main() {
  const tasks = await prisma.workflowTask.findMany({
    where: { stepCode: 'P4.5' },
    orderBy: { createdAt: 'desc' }
  })
  
  tasks.forEach(t => {
    console.log(`Task ID: ${t.id}`)
    console.dir(t.resultData, { depth: null })
  })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) });
