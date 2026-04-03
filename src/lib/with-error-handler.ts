import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from './auth'
import { logger, generateRequestId, sanitizeBody } from './logger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: NextRequest, ctx: any) => Promise<NextResponse<any>>

function classifyError(err: unknown): 'VALIDATION' | 'DATABASE' | 'AUTH' | 'UNKNOWN' {
  if (!err || typeof err !== 'object') return 'UNKNOWN'
  const name = (err as Error).name || ''
  const msg = (err as Error).message || ''
  if (name.includes('PrismaClient') || msg.includes('prisma')) return 'DATABASE'
  if (name === 'ZodError' || msg.includes('validation')) return 'VALIDATION'
  if (name === 'JsonWebTokenError' || name === 'TokenExpiredError' || msg.includes('jwt')) return 'AUTH'
  return 'UNKNOWN'
}

function extractIp(req: NextRequest): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || undefined
}

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (req: NextRequest, ctx: any) => {
    const requestId = generateRequestId()
    const start = Date.now()
    const method = req.method
    const path = req.nextUrl.pathname

    try {
      const response = await handler(req, ctx)

      // Add request ID header to all responses
      response.headers.set('X-Request-ID', requestId)
      return response
    } catch (err) {
      const duration = Date.now() - start
      const code = classifyError(err)
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined

      // Try to read request body for context
      let body: unknown = undefined
      try {
        const cloned = req.clone()
        body = await cloned.json()
      } catch {
        // No JSON body or already consumed
      }

      logger.error(message, {
        requestId,
        method,
        path,
        statusCode: 500,
        duration,
        ipAddress: extractIp(req),
        userAgent: req.headers.get('user-agent') || undefined,
        code,
        stack,
        requestBody: body ? sanitizeBody(body) : undefined,
      })

      const response = errorResponse('Lỗi hệ thống', 500)
      response.headers.set('X-Request-ID', requestId)
      return response
    }
  }
}
