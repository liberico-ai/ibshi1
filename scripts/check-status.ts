import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const task = await prisma.task.findFirst({
    where: { stepCode: 'P1.1B' },
    orderBy: { createdAt: 'desc' }
  })
  console.log('P1.1B status:', task?.status)
}
main()
