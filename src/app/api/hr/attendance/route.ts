import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/hr/attendance — list attendance for month/employee
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId') || ''
    const month = Number(searchParams.get('month')) || new Date().getMonth() + 1
    const year = Number(searchParams.get('year')) || new Date().getFullYear()

    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0)

    const where: Record<string, unknown> = {
      date: { gte: startDate, lte: endDate },
    }
    if (employeeId) where.employeeId = employeeId

    const records = await prisma.attendance.findMany({
      where: where as never,
      include: { employee: { select: { employeeCode: true, fullName: true } } },
      orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
    })

    // Summary by employee
    const summary: Record<string, { total: number; present: number; absent: number; late: number; ot: number }> = {}
    for (const r of records) {
      if (!summary[r.employeeId]) summary[r.employeeId] = { total: 0, present: 0, absent: 0, late: 0, ot: 0 }
      const s = summary[r.employeeId]
      s.total++
      if (r.status === 'PRESENT') s.present++
      else if (r.status === 'ABSENT') s.absent++
      else if (r.status === 'LATE') s.late++
      if (r.overtime) s.ot += Number(r.overtime)
    }

    return successResponse({ records, summary, month, year })
  } catch (err) {
    console.error('GET /api/hr/attendance error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/hr/attendance — create/update attendance
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { employeeId, date, checkIn, checkOut, status, overtime, notes } = body

    if (!employeeId || !date) return errorResponse('Thiếu nhân viên hoặc ngày', 400)

    const hoursWorked = checkIn && checkOut
      ? Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 3600000 * 10) / 10
      : null

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
      update: {
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        hoursWorked,
        overtime: overtime || 0,
        status: status || 'PRESENT',
        notes: notes || null,
      },
      create: {
        employeeId,
        date: new Date(date),
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        hoursWorked,
        overtime: overtime || 0,
        status: status || 'PRESENT',
        notes: notes || null,
      },
    })

    return NextResponse.json({ ok: true, record }, { status: 201 })
  } catch (err) {
    console.error('POST /api/hr/attendance error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
