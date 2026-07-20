import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { createLinkToken } from '@/lib/telegram-link'
import { getBotUsername } from '@/lib/telegram'

// POST /api/me/telegram/link-token — sinh mã liên kết + deep-link mở bot (một chạm).
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const botUsername = await getBotUsername()
  if (!botUsername) return errorResponse('Bot Telegram chưa được cấu hình', 503)

  const token = await createLinkToken(user.userId)
  return successResponse({
    botUsername,
    deepLink: `https://t.me/${botUsername}?start=${token}`,
  })
}
