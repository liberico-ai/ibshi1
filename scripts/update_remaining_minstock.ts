import { config } from 'dotenv';
config();
import { prisma } from '../src/lib/db';

async function main() {
  const res = await prisma.material.updateMany({
    where: { minStock: 0 },
    data: { minStock: -1 }
  });
  console.log('Updated:', res.count);
}
main().finally(() => prisma.$disconnect());
