import { config } from 'dotenv';
config();

import { prisma } from '../src/lib/db';
import * as XLSX from 'xlsx';
import path from 'path';
import crypto from 'crypto';

async function main() {
  const filePath = path.resolve(__dirname, '../Du_lieu_vat_tu.xlsx');
  console.log(`Reading Excel file from ${filePath}...`);
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const rows = data.slice(1);
  console.log(`Found ${rows.length} rows to process. Running bulk import...`);

  const materialsToCreate = [];
  const stockMovementsToCreate = [];
  
  // To avoid duplicates in excel itself
  const seenCodes = new Set();
  
  let skipCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    const materialCode = row[1]?.toString().trim();
    const category = row[2]?.toString().trim() || 'UNCATEGORIZED';
    const name = row[3]?.toString().trim();
    const unit = row[4]?.toString().trim() || 'cái';
    const currentStock = parseFloat(row[7]) || 0;
    const unitPrice = row[13] !== undefined && row[13] !== null ? parseFloat(row[13]) : null;

    if (!materialCode || !name || seenCodes.has(materialCode)) {
      skipCount++;
      continue;
    }
    seenCodes.add(materialCode);
    
    // Generate ID manually so we can link StockMovement
    const materialId = crypto.randomUUID();

    materialsToCreate.push({
      id: materialId,
      materialCode,
      name,
      category,
      unit,
      currentStock,
      unitPrice: isNaN(unitPrice as number) ? null : unitPrice,
      minStock: 0,
      currency: 'VND',
    });

    if (currentStock > 0) {
      stockMovementsToCreate.push({
        id: crypto.randomUUID(),
        materialId: materialId,
        type: 'ADJUST',
        quantity: currentStock,
        reason: 'Khởi tạo tồn kho đầu kỳ từ file Excel',
        performedBy: 'Hệ thống (Import)',
      });
    }
  }

  try {
    console.log(`Inserting ${materialsToCreate.length} materials...`);
    // Prisma createMany is very fast
    await prisma.material.createMany({
      data: materialsToCreate,
      skipDuplicates: true
    });

    console.log(`Inserting ${stockMovementsToCreate.length} stock movements...`);
    // We can chunk this if it's too big, but ~2500 is fine for PostgreSQL
    await prisma.stockMovement.createMany({
      data: stockMovementsToCreate,
      skipDuplicates: true
    });

    console.log('--- Import Summary ---');
    console.log(`Total Rows in Excel: ${rows.length}`);
    console.log(`Successfully Imported Materials: ${materialsToCreate.length}`);
    console.log(`Successfully Imported Stock Movements: ${stockMovementsToCreate.length}`);
    console.log(`Skipped (Duplicates/Invalid): ${skipCount}`);
  } catch (error) {
    console.error("Error during bulk import:", error);
  }
}

main()
  .catch(e => {
    console.error("Fatal Error during import:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
