import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  try {
    const tasks = await prisma.workflowTask.findMany({
      where: { stepCode: { in: ['P3.3', 'P3.4'] }, project: { projectCode: { contains: 'SON' } } },
      include: { project: true }
    });

    for (const t of tasks) {
      if (t.stepCode === 'P3.3' && t.project.pmUserId) {
        await prisma.workflowTask.update({
          where: { id: t.id },
          data: { assignedTo: t.project.pmUserId }
        });
        console.log('Assigned P3.3 to PM:', t.project.pmUserId);
      }
    }
    return NextResponse.json({ success: true, count: tasks.length });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
