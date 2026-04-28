import { config } from 'dotenv';
config();

import { prisma } from '../src/lib/db';
import * as XLSX from 'xlsx';
import path from 'path';

async function main() {
  const filePath = path.resolve(__dirname, '../20250913_Dinh muc ton kho vat tu tieu hao theo tuan Rev2.xlsx');
  console.log(`Reading Excel file from ${filePath}...`);
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  let successCount = 0;
  let notFoundCount = 0;

  // Header is roughly at row 7 (index 6), data starts at index 8
  for (let i = 8; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 5) continue;
    
    // Ignore section headers (like "A", "VẬT TƯ HÀN")
    if (typeof row[0] === 'string' && isNaN(parseInt(row[0]))) continue;
    
    const materialName = row[2]?.toString().trim();
    const minStock = parseFloat(row[4]);
    
    if (!materialName || isNaN(minStock)) continue;
    
    // Find material by name (case insensitive ideally, but we try exact first)
    // The Excel name might differ slightly, but user said "tìm đến tên vật tư"
    const materials = await prisma.material.findMany({
      where: {
        name: {
          equals: materialName,
          mode: 'insensitive'
        }
      }
    });

    if (materials.length > 0) {
      // Update all matching materials (usually should be 1)
      for (const mat of materials) {
        await prisma.material.update({
          where: { id: mat.id },
          data: { minStock }
        });
        successCount++;
      }
    } else {
      console.log(`[Warning] Material not found for name: "${materialName}"`);
      notFoundCount++;
    }
  }

  console.log('--- Update minStock Summary ---');
  console.log(`Successfully Updated: ${successCount}`);
  console.log(`Not Found: ${notFoundCount}`);
}

main()
  .catch(e => {
    console.error("Fatal Error during update:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
