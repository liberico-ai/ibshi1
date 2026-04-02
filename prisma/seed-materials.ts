import 'dotenv/config';
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const materials = [
    // VT chính (Thép, Ống, Van, v.v.)
    { materialCode: 'STEEL-PL-001', name: 'Thép tấm 10mm', nameEn: 'Steel Plate 10mm', unit: 'kg', category: 'steel', specification: 'SA-516 Gr.70', minStock: 1000, currentStock: 5000, unitPrice: 25000, currency: 'VND' },
    { materialCode: 'STEEL-PL-002', name: 'Thép tấm 12mm', nameEn: 'Steel Plate 12mm', unit: 'kg', category: 'steel', specification: 'SA-516 Gr.70', minStock: 1000, currentStock: 4500, unitPrice: 25500, currency: 'VND' },
    { materialCode: 'PIPE-SML-001', name: 'Ống đúc DN100 SCH40', nameEn: 'Seamless Pipe DN100 SCH40', unit: 'm', category: 'pipe', specification: 'A106 Gr.B', minStock: 100, currentStock: 300, unitPrice: 150000, currency: 'VND' },
    { materialCode: 'PIPE-SML-002', name: 'Ống đúc DN150 SCH40', nameEn: 'Seamless Pipe DN150 SCH40', unit: 'm', category: 'pipe', specification: 'A106 Gr.B', minStock: 50, currentStock: 150, unitPrice: 220000, currency: 'VND' },
    { materialCode: 'BEAM-H-001', name: 'Thép hình H200x200', nameEn: 'H-Beam 200x200', unit: 'kg', category: 'steel', specification: 'SS400', minStock: 500, currentStock: 2000, unitPrice: 21000, currency: 'VND' },
    
    // VT sơn hàn (Sơn, Que hàn, Dây hàn)
    { materialCode: 'WELD-WIRE-001', name: 'Dây hàn lõi thuốc E71T-1 1.2mm', nameEn: 'FCAW Wire E71T-1 1.2mm', unit: 'kg', category: 'welding', specification: 'AWS A5.20', minStock: 200, currentStock: 800, unitPrice: 45000, currency: 'VND' },
    { materialCode: 'WELD-ELEC-001', name: 'Que hàn chịu lực E7018 3.2mm', nameEn: 'Welding Electrode E7018 3.2mm', unit: 'kg', category: 'welding', specification: 'AWS A5.1', minStock: 100, currentStock: 500, unitPrice: 38000, currency: 'VND' },
    { materialCode: 'PAINT-PRM-001', name: 'Sơn lót Epoxy giàu kẽm', nameEn: 'Zinc Rich Epoxy Primer', unit: 'lít', category: 'paint', specification: 'Jotun', minStock: 100, currentStock: 300, unitPrice: 180000, currency: 'VND' },
    { materialCode: 'PAINT-TOP-001', name: 'Sơn phủ Polyurethane xám', nameEn: 'PU Topcoat Grey', unit: 'lít', category: 'paint', specification: 'Jotun', minStock: 100, currentStock: 250, unitPrice: 210000, currency: 'VND' },
    { materialCode: 'THINNER-001', name: 'Dung môi pha sơn số 17', nameEn: 'Thinner No.17', unit: 'lít', category: 'paint', specification: 'Jotun', minStock: 50, currentStock: 150, unitPrice: 95000, currency: 'VND' },
    
    // VT tiêu hao (Bulong, Đá mài, Đá cắt, Kẽm, Khí)
    { materialCode: 'BOLT-M16-001', name: 'Bulong cường độ cao M16x50', nameEn: 'High Strength Bolt M16x50', unit: 'bộ', category: 'bolt', specification: '8.8 Hot Dip Galv', minStock: 500, currentStock: 2000, unitPrice: 15000, currency: 'VND' },
    { materialCode: 'GAS-AR-001', name: 'Khí Argon tinh khiết 99.99%', nameEn: 'Argon Gas 99.99%', unit: 'chai', category: 'consumable', specification: '40L, 150Bar', minStock: 20, currentStock: 50, unitPrice: 350000, currency: 'VND' },
    { materialCode: 'GAS-CO2-001', name: 'Khí CO2 công nghiệp', nameEn: 'CO2 Gas', unit: 'chai', category: 'consumable', specification: '40L', minStock: 20, currentStock: 60, unitPrice: 250000, currency: 'VND' },
    { materialCode: 'GRIND-WHEEL-001', name: 'Đá mài Hải Dương 100mm', nameEn: 'Grinding Wheel 100mm', unit: 'cái', category: 'consumable', specification: '100x6x16mm', minStock: 100, currentStock: 300, unitPrice: 22000, currency: 'VND' },
    { materialCode: 'CUT-WHEEL-001', name: 'Đá cắt Hải Dương 350mm', nameEn: 'Cutting Wheel 350mm', unit: 'cái', category: 'consumable', specification: '350x3x25.4mm', minStock: 50, currentStock: 150, unitPrice: 65000, currency: 'VND' },
    { materialCode: 'TAPE-001', name: 'Băng keo chịu nhiệt', nameEn: 'Heat Resistant Tape', unit: 'cuộn', category: 'consumable', specification: '50mm', minStock: 50, currentStock: 100, unitPrice: 40000, currency: 'VND' }
  ]

  console.log('Bắt đầu thêm Vật tư...')
  
  for (const m of materials) {
    const existing = await prisma.material.findUnique({ where: { materialCode: m.materialCode } })
    if (!existing) {
      await prisma.material.create({ data: m })
      console.log(`+ Đã thêm: ${m.materialCode} - ${m.name}`)
    } else {
      console.log(`- Đã tồn tại: ${m.materialCode}`)
    }
  }

  console.log('Thêm Vật tư hoàn tất!')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
