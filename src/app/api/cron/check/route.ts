import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const materials = await prisma.material.findMany({
      where: { currentStock: { gt: 0 } }
    })
    return NextResponse.json({ materials })
  } catch (err) {
    return NextResponse.json({ error: String(err) })
  }
}
