import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  verifyPassword,
  generateToken,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  logAudit,
} from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { loginSchema } from '@/lib/schemas'

// ── In-memory rate limiter ──
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of loginAttempts) {
    if (now > val.resetAt) loginAttempts.delete(key)
  }
}, 300_000)

function getClientIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = loginAttempts.get(ip)

  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  record.count++
  return record.count <= RATE_LIMIT_MAX
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting check
    const clientIP = getClientIP(req)
    if (!checkRateLimit(clientIP)) {
      return errorResponse('Quá nhiều lần đăng nhập. Vui lòng thử lại sau 1 phút.', 429)
    }

    const result = await validateBody(req, loginSchema)
    if (!result.success) return result.response
    const { username, password } = result.data

    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      include: { department: { select: { code: true, name: true } } },
    })

    if (!user || !user.isActive) {
      return unauthorizedResponse('Tên đăng nhập hoặc mật khẩu không đúng')
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return unauthorizedResponse('Tên đăng nhập hoặc mật khẩu không đúng')
    }

    // Reset rate limit on successful login
    loginAttempts.delete(clientIP)

    const token = generateToken({
      userId: user.id,
      username: user.username,
      roleCode: user.roleCode,
      userLevel: user.userLevel,
      fullName: user.fullName,
    })

    await logAudit(user.id, 'LOGIN', 'user', user.id)

    return successResponse({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        roleCode: user.roleCode,
        userLevel: user.userLevel,
        department: user.department,
      },
    }, 'Đăng nhập thành công')
  } catch (err) {
    console.error('Login error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
