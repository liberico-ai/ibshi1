import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

// POST /api/materials/seed — seed sample materials into the DB
export async function POST() {
  try {
    const existing = await prisma.material.count()
    if (existing > 0) {
      return NextResponse.json({ ok: true, message: `Đã có ${existing} vật tư trong DB, không cần seed thêm.` })
    }

    const materials = [
      { materialCode: 'VT-001', name: 'Thép tấm SA-516 Gr.70', unit: 'kg', category: 'steel', specification: 'SA-516 Gr.70, 20mm', currentStock: 5200 },
      { materialCode: 'VT-002', name: 'Thép tấm A36', unit: 'kg', category: 'steel', specification: 'ASTM A36, 12mm', currentStock: 3800 },
      { materialCode: 'VT-003', name: 'Ống thép A106 Gr.B', unit: 'm', category: 'pipe', specification: 'A106 Gr.B, DN100, Sch40', currentStock: 450 },
      { materialCode: 'VT-004', name: 'Ống thép A312 TP304', unit: 'm', category: 'pipe', specification: 'A312 TP304, DN50, Sch10S', currentStock: 320 },
      { materialCode: 'VT-005', name: 'Van cầu DN100 PN16', unit: 'cái', category: 'valve', specification: 'Gate Valve, DN100, PN16, CS', currentStock: 24 },
      { materialCode: 'VT-006', name: 'Van bi DN50 PN40', unit: 'cái', category: 'valve', specification: 'Ball Valve, DN50, PN40, SS304', currentStock: 18 },
      { materialCode: 'VT-007', name: 'Bu lông M20x80', unit: 'bộ', category: 'bolt', specification: 'A193 B7 / A194 2H, M20x80', currentStock: 1500 },
      { materialCode: 'VT-008', name: 'Gioăng PTFE DN100', unit: 'cái', category: 'bolt', specification: 'Gasket PTFE, DN100, PN16', currentStock: 200 },
      { materialCode: 'VT-009', name: 'Sơn Epoxy chống gỉ', unit: 'lít', category: 'paint', specification: 'Jotun Jotacote Universal', currentStock: 180 },
      { materialCode: 'VT-010', name: 'Sơn phủ Polyurethane', unit: 'lít', category: 'paint', specification: 'Jotun Hardtop AX', currentStock: 120 },
      { materialCode: 'VT-011', name: 'Que hàn E7018', unit: 'kg', category: 'welding', specification: 'AWS A5.1 E7018, 3.2mm', currentStock: 800 },
      { materialCode: 'VT-012', name: 'Dây hàn ER70S-6', unit: 'kg', category: 'welding', specification: 'AWS A5.18 ER70S-6, 1.2mm', currentStock: 450 },
      { materialCode: 'VT-013', name: 'Khí CO2 công nghiệp', unit: 'bình', category: 'welding', specification: 'CO2 99.5%, 40L', currentStock: 35 },
      { materialCode: 'VT-014', name: 'Mặt bích DN100 PN16', unit: 'cái', category: 'pipe', specification: 'Flange WN, DN100, PN16, CS', currentStock: 60 },
      { materialCode: 'VT-015', name: 'Co 90° DN100', unit: 'cái', category: 'pipe', specification: 'Elbow 90° LR, DN100, Sch40, CS', currentStock: 45 },
    ]

    await prisma.material.createMany({ data: materials })

    return NextResponse.json({ ok: true, message: `Đã thêm ${materials.length} vật tư mẫu vào DB.`, count: materials.length })
  } catch (err) {
    console.error('Seed materials error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
