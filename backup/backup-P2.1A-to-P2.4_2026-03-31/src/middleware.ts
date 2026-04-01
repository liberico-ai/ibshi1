import { NextRequest, NextResponse } from 'next/server'

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only protect /api/* routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Allow CRON routes only with valid secret (future: add CRON_SECRET check)
  if (pathname.startsWith('/api/cron')) {
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

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
