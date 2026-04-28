import { config } from 'dotenv';
config();
import { prisma } from '../src/lib/db';

async function check() {
  const task = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P1.2', status: 'DONE' },
    orderBy: { createdAt: 'desc' }
  });
  console.log('Result data:', JSON.stringify(task?.resultData, null, 2).substring(0, 1000));
}
check().finally(() => process.exit(0));
