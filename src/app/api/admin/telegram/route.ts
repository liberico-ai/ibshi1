import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  logAudit,
  getClientIP,
} from '@/lib/auth'
import { encrypt, decrypt, maskSecret } from '@/lib/encryption'
import { resetBot, startPolling, getBot, invalidateConfigCache } from '@/lib/telegram'

const TELEGRAM_KEYS = [
  'telegram_bot_token',
  'telegram_webhook_secret',
  'telegram_group_chat_id',
] as const

const SENSITIVE_KEYS = new Set(['telegram_bot_token', 'telegram_webhook_secret'])

// GET /api/admin/telegram — Read Telegram config (masked secrets)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!['R01', 'R10'].includes(payload.roleCode)) return forbiddenResponse()

    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: [...TELEGRAM_KEYS] } },
    })

    const result: Record<string, { value: string; masked: string; configured: boolean }> = {}

    for (const key of TELEGRAM_KEYS) {
      const cfg = configs.find(c => c.key === key)
      if (!cfg) {
        result[key] = { value: '', masked: '', configured: false }
        continue
      }

      if (SENSITIVE_KEYS.has(key)) {
        try {
          const decrypted = decrypt(cfg.value)
          result[key] = { value: '', masked: maskSecret(decrypted), configured: true }
        } catch {
          result[key] = { value: '', masked: '(lỗi giải mã)', configured: true }
        }
      } else {
        result[key] = { value: cfg.value, masked: cfg.value, configured: true }
      }
    }

    return successResponse({ config: result })
  } catch (err) {
    console.error('GET /api/admin/telegram error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/admin/telegram — Update Telegram config
export async function PUT(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!['R01', 'R10'].includes(payload.roleCode))
      return forbiddenResponse('Chỉ BGĐ hoặc Quản trị viên mới có quyền')

    const body = await req.json()
    const { config } = body as { config: Record<string, string> }

    if (!config || typeof config !== 'object') {
      return errorResponse('Dữ liệu không hợp lệ')
    }

    const updatedKeys: string[] = []

    for (const key of TELEGRAM_KEYS) {
      const value = config[key]
      if (value === undefined || value === '') continue

      const storeValue = SENSITIVE_KEYS.has(key) ? encrypt(value) : value

      await prisma.systemConfig.upsert({
        where: { key },
        update: { value: storeValue },
        create: { key, value: storeValue },
      })
      updatedKeys.push(key)
    }

    if (updatedKeys.length === 0) {
      return errorResponse('Không có giá trị nào để cập nhật')
    }

    // Invalidate config cache so bot picks up new values
    invalidateConfigCache()

    await logAudit(
      payload.userId,
      'UPDATE',
      'TelegramConfig',
      'global',
      { updatedKeys },
      getClientIP(req),
    )

    return successResponse({}, `Đã cập nhật ${updatedKeys.length} cấu hình Telegram`)
  } catch (err) {
    console.error('PUT /api/admin/telegram error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/admin/telegram — Restart bot (apply new config)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!['R01', 'R10'].includes(payload.roleCode))
      return forbiddenResponse('Chỉ BGĐ hoặc Quản trị viên mới có quyền')

    await resetBot()
    const bot = await getBot()
    if (!bot) {
      return errorResponse('Bot token chưa được cấu hình')
    }

    // Test connection by calling getMe
    const me = await bot.api.getMe()

    // Restart polling
    await startPolling()

    await logAudit(
      payload.userId,
      'UPDATE',
      'TelegramBot',
      'global',
      { action: 'restart', botUsername: me.username },
      getClientIP(req),
    )

    return successResponse(
      { botUsername: me.username, botId: me.id },
      `Bot @${me.username} đã khởi động lại thành công`,
    )
  } catch (err) {
    console.error('POST /api/admin/telegram error:', err)
    return errorResponse('Không thể kết nối bot: ' + (err as Error).message, 500)
  }
}
