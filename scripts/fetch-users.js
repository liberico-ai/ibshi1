const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, fullName: true, roleCode: true }});
  const nullRoles = users.filter(u => !u.roleCode);
  console.log('Total users:', users.length, 'Null roles:', nullRoles);
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
