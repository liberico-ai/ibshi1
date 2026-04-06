import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getBot } from '@/lib/telegram'

// POST /api/telegram/setup — Register webhook with Telegram (admin only)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (payload.roleCode !== 'R01' && payload.roleCode !== 'R10' && payload.roleCode !== 'R00') {
      return errorResponse('Chỉ BGĐ/Admin mới được cấu hình Telegram', 403)
    }

    const bot = getBot()
    if (!bot) return errorResponse('TELEGRAM_BOT_TOKEN chưa được cấu hình', 500)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) return errorResponse('NEXT_PUBLIC_APP_URL chưa được cấu hình', 500)

    // Register webhook with Telegram
    await bot.api.setWebhook(`${appUrl}/api/telegram/webhook`, {
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    })

    const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID

    return successResponse({
      webhookSet: true,
      webhookUrl: `${appUrl}/api/telegram/webhook`,
      groupChatId: groupChatId || 'Chưa cấu hình — thêm TELEGRAM_GROUP_CHAT_ID vào .env',
    }, 'Telegram webhook đã được đăng ký')
  } catch (err) {
    console.error('POST /api/telegram/setup error:', err)
    return errorResponse((err as Error).message || 'Lỗi hệ thống', 500)
  }
}
