const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, projectCode: true, projectName: true }
  });
  console.log("All projects:");
  console.table(projects);
}

main().catch(console.error).finally(() => prisma.$disconnect());
