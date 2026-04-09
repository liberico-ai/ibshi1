import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const taskP12a = await prisma.workflowTask.findFirst({
      where: { stepCode: 'P1.2A' },
      orderBy: { createdAt: 'desc' }
    })

    if (!taskP12a) {
      return NextResponse.json({ error: "No P1.2A tasks found to mock project." }, { status: 400 })
    }

    const projectId = taskP12a.projectId
    const project = await prisma.project.findUnique({ where: { id: projectId } })

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
    let lsxCode3 = '2_painting'
    
    // Tạo data full cả tuần cho 3 mã công việc khác nhau
    const dailyLogs = [
      // Hạng mục 1: Cắt (hoàn thành rải rác T2 T3 T4)
      { projectId, lsxCode: lsxCode1, wbsStage: 'cutting', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 0), reportedVolume: 1200, teamUserId: 'team_A' },
      { projectId, lsxCode: lsxCode1, wbsStage: 'cutting', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 1), reportedVolume: 800, teamUserId: 'team_A' },
      { projectId, lsxCode: lsxCode1, wbsStage: 'cutting', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 2), reportedVolume: 500, teamUserId: 'team_B' },
      
      // Hạng mục 2: Hàn (hoàn thành rải rác T4 T5 T6)
      { projectId, lsxCode: lsxCode2, wbsStage: 'welding', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 2), reportedVolume: 1000, teamUserId: 'team_C' },
      { projectId, lsxCode: lsxCode2, wbsStage: 'welding', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 3), reportedVolume: 1500, teamUserId: 'team_C' },
      { projectId, lsxCode: lsxCode2, wbsStage: 'welding', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 4), reportedVolume: 600, teamUserId: 'team_C' },

      // Hạng mục 3: Sơn (hoàn thành vào T5, T6)
      { projectId, lsxCode: lsxCode3, wbsStage: 'painting', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 3), reportedVolume: 300, teamUserId: 'team_D' },
      { projectId, lsxCode: lsxCode3, wbsStage: 'painting', reportDate: new Date(thisMonday.getTime() + 1000 * 3600 * 24 * 4), reportedVolume: 700, teamUserId: 'team_E' },
    ]

    await prisma.dailyProductionLog.deleteMany({ where: { teamUserId: { in: ['team_A', 'team_B', 'team_C', 'team_D', 'team_E'] } } })
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

    const mockTaskName = 'MOCK PO FOR LSX (P5 TESTING)'
    await prisma.workflowTask.deleteMany({
      where: {
        stepCode: 'P3.3',
        stepName: mockTaskName,
        projectId
      }
    })

    // Mock P3.3 task for totalLSX
    const mockCells = {
      "0": { "cutting": [{ volume: 4000 }] },
      "1": { "welding": [{ volume: 3100 }] },
      "2": { "painting": [{ volume: 1000 }] }
    }
    const mockIssued = {
      "0": { "cutting": { "0": true } },
      "1": { "welding": { "0": true } },
      "2": { "painting": { "0": true } }
    }

    await prisma.workflowTask.create({
      data: {
        projectId, stepCode: 'P3.3', stepName: 'MOCK PO FOR LSX (P5 TESTING)', stepNameEn: 'MOCK PO',
        assignedRole: 'R07', status: 'DONE', startedAt: new Date(), completedAt: new Date(), 
        resultData: {
          cellAssignments: JSON.stringify(mockCells),
          lsxIssuedDetails: JSON.stringify(mockIssued)
        }
      }
    })

    const p53 = await prisma.workflowTask.create({
      data: {
        projectId, stepCode: 'P5.3', stepName: 'NGHIỆM THU KHỐI LƯỢNG TUẦN (MOCK)', stepNameEn: 'Weekly Acceptance',
        assignedRole: 'R09', status: 'IN_PROGRESS', startedAt: new Date(),
        resultData: JSON.parse(JSON.stringify(taskPayload))
      }
    })

    return NextResponse.json({
      success: true,
      p53_url: `http://localhost:3000/dashboard/tasks/${p53.id}`
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
