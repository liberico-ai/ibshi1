import { config } from 'dotenv';
config();
import { prisma } from '../src/lib/db';

async function main() {
  const pos = await prisma.purchaseOrder.findMany();
  const materials = await prisma.material.findMany({ take: 50 }); // Grab some materials
  
  if (materials.length === 0) {
    console.log('No materials found to attach to POs.');
    return;
  }

  for (const po of pos) {
    const numItems = Math.floor(Math.random() * 3) + 2; // 2 to 4 items
    let poTotal = 0;
    
    for (let i = 0; i < numItems; i++) {
      const mat = materials[Math.floor(Math.random() * materials.length)];
      const quantity = Math.floor(Math.random() * 50) + 10;
      const unitPrice = mat.unitPrice ? Number(mat.unitPrice) : Math.floor(Math.random() * 100000) + 50000;
      
      await prisma.purchaseOrderItem.create({
        data: {
          poId: po.id,
          materialId: mat.id,
          quantity: quantity,
          unitPrice: unitPrice,
          receivedQty: 0,
        }
      });
      
      poTotal += quantity * unitPrice;
    }
    
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { totalValue: poTotal }
    });
    
    console.log(`Updated PO ${po.poCode} with ${numItems} items, Total: ${poTotal}`);
  }
}

main().finally(() => process.exit(0));
