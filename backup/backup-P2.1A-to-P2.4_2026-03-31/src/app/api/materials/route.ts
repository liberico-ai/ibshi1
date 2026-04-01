import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const materials = await prisma.material.findMany({
      where: { currentStock: { gt: 0 } },
      select: {
        id: true,
        materialCode: true,
        name: true,
        unit: true,
        category: true,
        specification: true,
        currentStock: true,
      },
      orderBy: { category: 'asc' },
    })

    return NextResponse.json({
      ok: true,
      materials: materials.map(m => ({
        ...m,
        currentStock: Number(m.currentStock),
      })),
    })
  } catch (err) {
    console.error('Materials API error:', err)
    return NextResponse.json({ ok: false, error: 'Lỗi khi tải danh sách vật tư' }, { status: 500 })
  }
}
