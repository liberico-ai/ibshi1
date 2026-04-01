import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.material.createMany({
    data: [
      { materialCode: 'STL-991', name: 'Thép tấm SA-516 Gr.70', unit: 'kg', category: 'steel', specification: 'SA-516 Gr.70, 20mm', currentStock: 5200 },
      { materialCode: 'PIP-992', name: 'Ống thép A106 Gr.B', unit: 'm', category: 'pipe', specification: 'A106 Gr.B', currentStock: 450 },
      { materialCode: 'VLV-993', name: 'Van cầu DN100 PN16', unit: 'cái', category: 'valve', specification: 'Gate Valve, DN100', currentStock: 24 },
      { materialCode: 'WLD-994', name: 'Que hàn E7018', unit: 'kg', category: 'welding', specification: 'AWS A5.1 E7018', currentStock: 800 },
      { materialCode: 'PNT-995', name: 'Sơn Epoxy chống gỉ', unit: 'lít', category: 'paint', specification: 'Jotun Jotacote', currentStock: 180 },
      { materialCode: 'BLT-996', name: 'Bu lông M20x80', unit: 'bộ', category: 'bolt', specification: 'A193 B7', currentStock: 1500 },
      { materialCode: 'CSM-997', name: 'Đá mài cắt 100x16', unit: 'viên', category: 'consumable', specification: 'Makita', currentStock: 50 },
      { materialCode: 'PIP-998', name: 'Mặt bích rỗng DN200', unit: 'cái', category: 'pipe', specification: 'Flange RF', currentStock: 10 }
    ],
    skipDuplicates: true
  });
  console.log('Successfully added materials to DB');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
