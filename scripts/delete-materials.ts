import { config } from 'dotenv';
config();

import { prisma } from '../src/lib/db';

async function main() {
  console.log('Starting deletion of material data...');
  try {
    // Delete in order to avoid foreign key constraint errors
    const deletedStockMovements = await prisma.stockMovement.deleteMany({});
    console.log(`Deleted ${deletedStockMovements.count} stock movements.`);

    const deletedPrItems = await prisma.purchaseRequestItem.deleteMany({});
    console.log(`Deleted ${deletedPrItems.count} purchase request items.`);

    const deletedPoItems = await prisma.purchaseOrderItem.deleteMany({});
    console.log(`Deleted ${deletedPoItems.count} purchase order items.`);

    const deletedMillCerts = await prisma.millCertificate.deleteMany({});
    console.log(`Deleted ${deletedMillCerts.count} mill certificates.`);

    const deletedMaterialIssues = await prisma.materialIssue.deleteMany({});
    console.log(`Deleted ${deletedMaterialIssues.count} material issues.`);

    const deletedBomItems = await prisma.bomItem.deleteMany({});
    console.log(`Deleted ${deletedBomItems.count} bom items.`);

    const deletedMaterials = await prisma.material.deleteMany({});
    console.log(`Deleted ${deletedMaterials.count} materials.`);

    console.log('Material data deletion completed successfully.');
  } catch (error) {
    console.error('Error deleting material data:', error);
  } finally {
    process.exit(0);
  }
}

main();
