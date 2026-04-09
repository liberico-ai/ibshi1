import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

process.env.DATABASE_URL = "postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi"
const prisma = new PrismaClient()

async function main() {
  const taskP12a = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P1.2A' },
    orderBy: { createdAt: 'desc' }
  })

  if (!taskP12a) {
    console.log("No P1.2A tasks found to mock project.")
    return
  }

  const projectId = taskP12a.projectId
  const project = await prisma.project.findUnique({ where: { id: projectId } })

  console.log(`Using Project: ${project?.projectCode}`)

  const now = new Date()
  const year = now.getFullYear()
  
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1)
  const thisMonday = new Date(now)
  thisMonday.setDate(now.getDate() + mondayOffset)
  thisMonday.setHours(0, 0, 0, 0)

  const thisFriday = new Date(thisMonday)
  thisFriday.setDate(thisMonday.getDate() + 4)
  thisFriday.setHours(23, 59, 59, 999)

  let lsxCode1 = '0_cutting'
  let lsxCode2 = '1_welding'
  
  const dailyLogs = [
    { projectId, lsxCode: lsxCode1, reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 0), reportedVolume: 1000, reportedBy: 'sys' },
    { projectId, lsxCode: lsxCode1, reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 1), reportedVolume: 500, reportedBy: 'sys' },
    { projectId, lsxCode: lsxCode2, reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 2), reportedVolume: 200, reportedBy: 'sys' },
    { projectId, lsxCode: lsxCode2, reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 3), reportedVolume: 800, reportedBy: 'sys' },
  ]

  console.log("Inserting dummy daily production logs...")
  await prisma.dailyProductionLog.deleteMany({ where: { reportedBy: 'sys' } })
  for (const log of dailyLogs) {
    await prisma.dailyProductionLog.create({ data: log })
  }

  const weekNumber = 99
  const taskPayload = {
    weekNumber,
    year,
    weekStartDate: thisMonday.toISOString(),
    weekEndDate: thisFriday.toISOString(),
    projectCode: project?.projectCode,
    projectName: project?.projectName,
  }

  console.log("Creating dummy P5.3 and P5.4 tasks...")
  const p53 = await prisma.workflowTask.create({
    data: {
      projectId, stepCode: 'P5.3', stepName: 'NGHIỆM THU KHỐI LƯỢNG TUẦN (MOCK)', stepNameEn: 'Weekly Acceptance',
      assignedRole: 'R09', status: 'IN_PROGRESS', startedAt: new Date(),
      resultData: JSON.parse(JSON.stringify(taskPayload))
    }
  })

  const p54 = await prisma.workflowTask.create({
    data: {
      projectId, stepCode: 'P5.4', stepName: 'NGHIỆM THU KHỐI LƯỢNG TUẦN (MOCK)', stepNameEn: 'Weekly Acceptance',
      assignedRole: 'R02', status: 'IN_PROGRESS', startedAt: new Date(),
      resultData: JSON.parse(JSON.stringify(taskPayload))
    }
  })

  console.log(`✅ Success!`)
  console.log(`Task P5.3 URL: http://localhost:3000/dashboard/tasks/${p53.id}`)
  console.log(`Task P5.4 URL: http://localhost:3000/dashboard/tasks/${p54.id}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
