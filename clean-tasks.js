const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  const p53Tasks = await prisma.workflowTask.findMany({
    where: { stepCode: 'P5.3' },
    orderBy: { createdAt: 'asc' }
  });
  
  const p54Tasks = await prisma.workflowTask.findMany({
    where: { stepCode: 'P5.4' },
    orderBy: { createdAt: 'asc' }
  });

  const p53Groups = {};
  p53Tasks.forEach(t => {
    if (!p53Groups[t.projectId]) p53Groups[t.projectId] = [];
    p53Groups[t.projectId].push(t);
  });

  const p54Groups = {};
  p54Tasks.forEach(t => {
    if (!p54Groups[t.projectId]) p54Groups[t.projectId] = [];
    p54Groups[t.projectId].push(t);
  });

  let deleted = 0;

  for (const pid of Object.keys(p53Groups)) {
    const tasks = p53Groups[pid];
    if (tasks.length > 1) {
      const doneTask = tasks.find(t => t.status === 'DONE');
      const keepTask = doneTask || tasks[tasks.length - 1];
      const toDelete = tasks.filter(t => t.id !== keepTask.id);
      
      for (const t of toDelete) {
        await prisma.workflowTask.delete({ where: { id: t.id } });
        deleted++;
      }
    }
  }

  for (const pid of Object.keys(p54Groups)) {
    const tasks = p54Groups[pid];
    if (tasks.length > 1) {
      const doneTask = tasks.find(t => t.status === 'DONE');
      const keepTask = doneTask || tasks[tasks.length - 1];
      const toDelete = tasks.filter(t => t.id !== keepTask.id);
      
      for (const t of toDelete) {
        await prisma.workflowTask.delete({ where: { id: t.id } });
        deleted++;
      }
    }
  }

  console.log('Deleted ' + deleted + ' duplicate P5.3/P5.4 tasks.');
}

clean().catch(console.error).finally(() => prisma.$disconnect());
