const { execSync } = require('child_process');
require('dotenv').config();
process.env.DATABASE_URL = "postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi";

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function fix() {
  const tasks = await p.workflowTask.findMany({
    where: { stepCode: { in: ['P3.3', 'P3.4'] }, project: { projectCode: { contains: 'SON' } } },
    include: { project: true }
  });
  
  for (const t of tasks) {
    if (t.stepCode === 'P3.3' && t.project.pmUserId) {
      await p.workflowTask.update({
        where: { id: t.id },
        data: { assignedTo: t.project.pmUserId }
      });
      console.log('Assigned P3.3 to PM:', t.project.pmUserId);
    }
  }
  console.log('Done!');
}

fix().catch(console.error).finally(() => p.$disconnect());
