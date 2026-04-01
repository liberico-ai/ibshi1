import prisma from '@/lib/db'
import { hashPassword, successResponse, errorResponse } from '@/lib/auth'

// Temporary endpoint to reset password — DELETE after use
export async function POST() {
  try {
    const newHash = await hashPassword('123456')
    await prisma.user.updateMany({
      where: { username: { in: ['doannd', 'thuynth'] } },
      data: { passwordHash: newHash },
    })
    return successResponse({ message: 'Password reset for doannd, thuynth' })
  } catch (err) {
    console.error(err)
    return errorResponse('Failed', 500)
  }
}
