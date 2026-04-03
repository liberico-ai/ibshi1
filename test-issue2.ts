import 'dotenv/config'
import prisma from './src/lib/db'

async function main() {
  const task = await prisma.workflowTask.findUnique({
    where: { id: 'cmnh2wfzv0033f0w16qzivq3s' },
  })
  
  console.dir(task?.resultData, { depth: null })
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) });
