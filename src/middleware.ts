import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, RATE_PRESETS } from '@/lib/rate-limiter'

// ── Public routes that don't require authentication ──
const PUBLIC_ROUTES = ['/api/auth/login', '/api/health']

// ── Edge-compatible JWT verification using Web Crypto API ──
async function verifyJWTEdge(token: string, secret: string): Promise<boolean> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.')
    if (!headerB64 || !payloadB64 || !signatureB64) return false

    // Import the secret key for HMAC-SHA256
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Verify the signature
    const data = encoder.encode(`${headerB64}.${payloadB64}`)
    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    )

    const isValid = await crypto.subtle.verify('HMAC', key, signature, data)
    if (!isValid) return false

    // Check expiration
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return false
    }

    return true
  } catch {
    return false
  }
}

// ── Decode JWT payload without verification (used after middleware already verified) ──
function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

// ── Get client IP for rate limiting ──
function getClientIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}

// ── Add CORS headers to response ──
function addCorsHeaders(response: NextResponse, req: NextRequest): NextResponse {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || req.headers.get('origin') || ''
  response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return response
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only protect /api/* routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 })
    return addCorsHeaders(response, req)
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next()
    return addCorsHeaders(response, req)
  }

  // Validate CRON routes with secret
  if (pathname.startsWith('/api/cron')) {
    const cronSecret = req.headers.get('x-cron-secret')
    const expected = process.env.CRON_SECRET
    if (!expected || cronSecret !== expected) {
      return NextResponse.json({ ok: false, error: 'Invalid cron secret' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Extract Bearer token
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const token = authHeader.substring(7)
  const secret = process.env.JWT_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500 })
  }

  const isValid = await verifyJWTEdge(token, secret)
  if (!isValid) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 401 })
  }

  // Rate limiting for authenticated API routes
  const payload = decodeJWTPayload(token)
  const rateLimitKey = (payload?.userId as string) || getClientIP(req)
  const isUpload = pathname.includes('/upload')
  const preset = isUpload ? RATE_PRESETS.API_UPLOAD : RATE_PRESETS.API_GENERAL

  if (!checkRateLimit(rateLimitKey, preset.maxRequests, preset.windowMs)) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please try again later.' },
      { status: 429 }
    )
  }

  const response = NextResponse.next()
  return addCorsHeaders(response, req)
}

export const config = {
  matcher: ['/api/:path*'],
}
