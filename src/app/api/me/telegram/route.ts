import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/me/telegram — trạng thái liên kết Telegram của user hiện tại
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { telegramChatId: true } })
  return successResponse({ linked: !!u?.telegramChatId })
}

// DELETE /api/me/telegram — tự hủy liên kết Telegram
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  await prisma.user.update({ where: { id: user.userId }, data: { telegramChatId: null } })
  return successResponse({ linked: false }, 'Đã hủy liên kết Telegram')
}
