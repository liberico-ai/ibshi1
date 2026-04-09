import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  const p53Tasks = await prisma.workflowTask.findMany({
    where: { stepCode: 'P5.3' },
    orderBy: { createdAt: 'asc' }
  });
  
  const p54Tasks = await prisma.workflowTask.findMany({
    where: { stepCode: 'P5.4' },
    orderBy: { createdAt: 'asc' }
  });

  const p53Task = await prisma.workflowTask.findUnique({ where: { id: 'cmnr7ahml002bpow16qpmr0tr' } });
  
  // MOCK SUBMIT P5.3
  if (p53Task && p53Task.status !== 'DONE') {
    const rdP53 = p53Task.resultData as Record<string, any>;
    
    // Add logs
    await (prisma as any).weeklyAcceptanceLog.createMany({
      data: [
        { projectId: p53Task.projectId, lsxCode: "0_cutting", weekNumber: rdP53.weekNumber || 99, year: rdP53.year || 2026, weekStartDate: new Date(), weekEndDate: new Date(), taskId: p53Task.id, role: 'QC', reportedTotal: 2500, acceptedVolume: 2500, inspectorId: 'mock' },
        { projectId: p53Task.projectId, lsxCode: "1_welding", weekNumber: rdP53.weekNumber || 99, year: rdP53.year || 2026, weekStartDate: new Date(), weekEndDate: new Date(), taskId: p53Task.id, role: 'QC', reportedTotal: 3100, acceptedVolume: 3100, inspectorId: 'mock' },
        { projectId: p53Task.projectId, lsxCode: "2_painting", weekNumber: rdP53.weekNumber || 99, year: rdP53.year || 2026, weekStartDate: new Date(), weekEndDate: new Date(), taskId: p53Task.id, role: 'QC', reportedTotal: 1000, acceptedVolume: 1000, inspectorId: 'mock' },
      ]
    });
    await prisma.workflowTask.update({
      where: { id: p53Task.id },
      data: { status: 'DONE', completedAt: new Date() }
    });
    await prisma.workflowTask.create({
      data: {
        projectId: p53Task.projectId,
        stepCode: 'P5.4',
        stepName: 'Nghiệm thu khối lượng tuần (PM)',
        stepNameEn: 'Weekly Acceptance',
        assignedRole: 'R02',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        resultData: JSON.parse(JSON.stringify({
          ...rdP53,
          sourceP53TaskId: p53Task.id
        })),
        deadline: p53Task.deadline,
        priority: p53Task.priority
      }
    });
  }

  const newP54s = await prisma.workflowTask.findMany({
    where: { stepCode: 'P5.4', createdAt: { gte: new Date(Date.now() - 3600000) } } // created in last hour
  });

  return NextResponse.json({
    success: true,
    p53_status: p53Task?.status,
    p53_data: p53Task,
    newP54_urls: newP54s.map(t => `http://localhost:3000/dashboard/tasks/${t.id}`)
  });
}
