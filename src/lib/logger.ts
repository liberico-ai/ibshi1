import prisma from './db'
import { randomUUID } from 'crypto'

// ── Types ──

export interface LogContext {
  requestId?: string
  method?: string
  path?: string
  statusCode?: number
  duration?: number
  userId?: string
  userRole?: string
  ipAddress?: string
  userAgent?: string
  requestBody?: unknown
  metadata?: Record<string, unknown>
  source?: 'server' | 'client'
  code?: 'VALIDATION' | 'DATABASE' | 'AUTH' | 'BUSINESS' | 'UNKNOWN'
  stack?: string
}

// ── Helpers ──

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'cookie', 'accesstoken', 'refreshtoken']
const MAX_BODY_SIZE = 10_000
const MAX_STACK_SIZE = 5_000

export function generateRequestId(): string {
  return randomUUID()
}

export function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeBody(value)
    } else {
      sanitized[key] = value
    }
  }
  const json = JSON.stringify(sanitized)
  if (json.length > MAX_BODY_SIZE) {
    return { _truncated: true, _size: json.length }
  }
  return sanitized
}

function truncateStack(stack?: string): string | undefined {
  if (!stack) return undefined
  return stack.length > MAX_STACK_SIZE ? stack.slice(0, MAX_STACK_SIZE) + '\n... [truncated]' : stack
}

// ── Logger ──

async function writeLog(level: string, message: string, ctx: LogContext = {}) {
  // Always log to console
  const logFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log
  logFn(`[${level}] ${message}`, ctx.path ? `(${ctx.method || ''} ${ctx.path})` : '', ctx.requestId || '')

  // Only persist ERROR and WARN to DB
  if (level === 'INFO') return

  try {
    // Fire-and-forget: don't await to avoid blocking the response
    prisma.errorLog.create({
      data: {
        level,
        message: message.slice(0, 1000),
        stack: truncateStack(ctx.stack),
        code: ctx.code || 'UNKNOWN',
        requestId: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        statusCode: ctx.statusCode,
        duration: ctx.duration,
        userId: ctx.userId,
        userRole: ctx.userRole,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent?.slice(0, 500),
        requestBody: ctx.requestBody ? sanitizeBody(ctx.requestBody) as object : undefined,
        metadata: ctx.metadata as object | undefined,
        source: ctx.source || 'server',
      },
    }).catch((dbErr) => {
      console.error('[Logger] Failed to write to DB:', dbErr)
    })
  } catch (err) {
    console.error('[Logger] Unexpected error:', err)
  }
}

export const logger = {
  error: (message: string, ctx?: LogContext) => writeLog('ERROR', message, ctx),
  warn: (message: string, ctx?: LogContext) => writeLog('WARN', message, ctx),
  info: (message: string, ctx?: LogContext) => writeLog('INFO', message, ctx),
}
