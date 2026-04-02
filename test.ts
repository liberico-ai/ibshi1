import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config()
const prisma = new PrismaClient()

async function test() {
  try {
    const tasks = await prisma.workflowTask.findMany({ where: { stepCode: 'P4.5' } })
    fs.writeFileSync('p45_tasks.json', JSON.stringify(tasks, null, 2))
    console.log(`Found ${tasks.length} tasks for P4.5`)

    // Print out the created timestamps and statuses
    tasks.forEach(t => console.log(`${t.id} - ${t.status} - ${t.createdAt}`))
  } catch (err) {
    console.error(err)
  } finally {
    await prisma.$disconnect()
  }
}
test()
