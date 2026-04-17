import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const tasks = await prisma.workflowTask.findMany({ where: { stepCode: 'P3.6' } })
  const result = tasks.map(t => {
    let groups = []
    if (t.resultData) {
      if (typeof t.resultData === 'string') {
        groups = JSON.parse(t.resultData).groups || []
      } else {
        groups = (t.resultData as any).groups || []
      }
    }
    return {
      id: t.id,
      groupsCount: groups.length,
      approvedGroups: groups.filter((g: any) => g.status === 'APPROVED').length,
      allStatuses: groups.map((g: any) => g.status)
    }
  })
  return NextResponse.json({ tasks: result })
}
