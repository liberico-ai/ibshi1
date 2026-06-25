import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'

export async function GET() {
  try {
    const materials = await prisma.material.findMany({
      where: { currentStock: { gt: 0 } }
    })
    return successResponse({ materials })
  } catch (err) {
    return errorResponse(String(err), 500)
  }
}
