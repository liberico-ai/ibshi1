import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/hr/timesheets — list timesheets
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (month && year) {
      const start = new Date(Number(year), Number(month) - 1, 1)
      const end = new Date(Number(year), Number(month), 0, 23, 59, 59)
      where.workDate = { gte: start, lte: end }
    }

    const timesheets = await prisma.timesheet.findMany({
      where,
      include: {
        employee: { select: { employeeCode: true, fullName: true } },
        project: { select: { projectCode: true, projectName: true } },
      },
      orderBy: { workDate: 'desc' },
    })

    const totalRegular = timesheets.reduce((s, t) => s + Number(t.hoursRegular), 0)
    const totalOT = timesheets.reduce((s, t) => s + Number(t.hoursOT), 0)

    return successResponse({
      timesheets,
      total: timesheets.length,
      summary: { regular: totalRegular, ot: totalOT, total: totalRegular + totalOT },
    })
  } catch (err) {
    console.error('GET /api/hr/timesheets error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/hr/timesheets — create timesheet entry
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { employeeId, projectId, workDate, hoursRegular, hoursOT, taskDescription } = body

    if (!employeeId || !projectId || !workDate) {
      return errorResponse('Thiếu: employeeId, projectId, workDate')
    }

    const ts = await prisma.timesheet.upsert({
      where: {
        employeeId_projectId_workDate: {
          employeeId, projectId, workDate: new Date(workDate),
        },
      },
      update: {
        hoursRegular: hoursRegular ?? 8,
        hoursOT: hoursOT ?? 0,
        taskDescription: taskDescription || null,
      },
      create: {
        employeeId, projectId,
        workDate: new Date(workDate),
        hoursRegular: hoursRegular ?? 8,
        hoursOT: hoursOT ?? 0,
        taskDescription: taskDescription || null,
      },
    })

    return successResponse({ timesheet: ts }, 'Lưu chấm công thành công')
  } catch (err) {
    console.error('POST /api/hr/timesheets error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
