import prisma from '../src/lib/db'

async function main() {
  const activeP51 = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P5.1', status: 'IN_PROGRESS' },
    orderBy: { createdAt: 'desc' }
  });

  if (!activeP51) {
    console.log('No active P5.1 task found.');
    return;
  }

  const existingP51A = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P5.1A', projectId: activeP51.projectId }
  });

  if (existingP51A) {
    console.log('P5.1A already exists for this project:', existingP51A.id);
    return;
  }

  const p51a = await prisma.workflowTask.create({
    data: {
      projectId: activeP51.projectId,
      stepCode: 'P5.1A',
      stepName: 'Báo cáo khối lượng của thầu phụ theo ngày',
      stepNameEn: 'Daily Subcontractor Production Report',
      assignedRole: 'R04', // PM
      status: 'IN_PROGRESS',
      resultData: activeP51.resultData || {}
    }
  });

  console.log('Successfully created P5.1A task:', p51a.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
