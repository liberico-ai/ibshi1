import { config } from 'dotenv';
config();
import { prisma } from '../src/lib/db';

async function check() {
  const pos = await prisma.purchaseOrder.findMany({ include: { items: true } });
  console.log('POs:', pos.length);
  console.log('Total Items in all POs:', pos.reduce((s, p) => s + p.items.length, 0));
  
  // Also check if any PR has items
  const prs = await prisma.purchaseRequest.findMany({ include: { items: true } });
  console.log('PRs:', prs.length);
  console.log('Total Items in all PRs:', prs.reduce((s, p) => s + p.items.length, 0));
}
check().finally(() => process.exit(0));
