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
import { ALL_PROCESS_GATES, PROCESS_GATE_KEYS } from '@/lib/process-gates'

// GET /api/admin/config — Read system config
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!['R01', 'R10'].includes(payload.roleCode)) return forbiddenResponse()

    const configs = await prisma.systemConfig.findMany()
    const configMap: Record<string, string> = {}
    for (const c of configs) configMap[c.key] = c.value

    return successResponse({ config: configMap })
  } catch (err) {
    console.error('GET /api/admin/config error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/admin/config — Update system config (R10 only)
export async function PUT(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (payload.roleCode !== 'R10') return forbiddenResponse('Chỉ Quản trị hệ thống mới có quyền thay đổi cấu hình')

    const body = await req.json()
    const { config } = body as { config: Record<string, string> }

    if (!config || typeof config !== 'object') {
      return errorResponse('Dữ liệu config không hợp lệ')
    }

    const ALLOWED_KEYS = [
      'company_name', 'company_address', 'company_phone', 'company_email', 'company_logo_url',
      'password_min_length', 'session_timeout_hours',
      'email_notifications_enabled', 'system_maintenance_mode',
      // Cổng vật tư của lệnh SX: 'true' = phải cấp đủ vật tư mới được Bắt đầu SX.
      // Vắng hoặc 'false' = cho bắt đầu ngay (đang đặt như vậy từ 09/2026).
      ...PROCESS_GATE_KEYS,
    ]

    const updates: { key: string; value: string }[] = []
    for (const [key, value] of Object.entries(config)) {
      if (!ALLOWED_KEYS.includes(key)) continue
      updates.push({ key, value: String(value) })
    }

    for (const u of updates) {
      await prisma.systemConfig.upsert({
        where: { key: u.key },
        update: { value: u.value },
        create: { key: u.key, value: u.value },
      })
    }

    // Đổi cờ xong phải xoá cache, không thì phải chờ hết 60 giây mới có hiệu lực.
    for (const g of ALL_PROCESS_GATES) if (updates.some(u => u.key === g.key)) g.invalidate()

    await logAudit(payload.userId, 'UPDATE', 'SystemConfig', 'global', {
      updatedKeys: updates.map(u => u.key),
    }, getClientIP(req))

    return successResponse({}, `Đã cập nhật ${updates.length} cấu hình`)
  } catch (err) {
    console.error('PUT /api/admin/config error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
