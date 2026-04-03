import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

// Must import mocks before importing the route
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    // verifyPassword and generateToken are used directly — keep actual implementations
    // logAudit is a side-effect we don't care about in tests
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

import { POST } from '@/app/api/auth/login/route'

const VALID_USER = {
  id: 'user-1',
  username: 'admin',
  passwordHash: '$2a$12$placeholder', // will be mocked via verifyPassword
  isActive: true,
  roleCode: 'R01',
  userLevel: 1,
  fullName: 'Admin User',
  department: { code: 'BGD', name: 'Ban Giám Đốc' },
}

// Each test gets a unique IP so the module-level rate limiter Map never trips
let ipCounter = 0
function uniqueIP(): string {
  return `10.${Math.floor(++ipCounter / 255)}.${ipCounter % 255}.1`
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset JWT_SECRET for tests
    process.env.JWT_SECRET = 'test-secret-key-for-vitest'
  })

  it('returns 400 when username is missing', async () => {
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': uniqueIP() },
      body: JSON.stringify({ password: 'secret' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('username')
  })

  it('returns 400 when password is missing', async () => {
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': uniqueIP() },
      body: JSON.stringify({ username: 'admin' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('password')
  })

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': uniqueIP() },
      body: 'not-json',
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 401 when user does not exist', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': uniqueIP() },
      body: JSON.stringify({ username: 'nonexistent', password: 'secret' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 401 when user is inactive', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...VALID_USER, isActive: false } as any)

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': uniqueIP() },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 200 with token on valid credentials', async () => {
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash('correctpassword', 1) // rounds=1 for test speed

    prismaMock.user.findFirst.mockResolvedValue({ ...VALID_USER, passwordHash: hash } as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': uniqueIP() },
      body: JSON.stringify({ username: 'admin', password: 'correctpassword' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.token).toBeTruthy()
    expect(json.user).toMatchObject({
      id: 'user-1',
      username: 'admin',
      roleCode: 'R01',
    })
  })

  it('returns 429 when rate limit is exceeded', async () => {
    // Use a fixed IP and hammer it 6 times — the 6th should be blocked
    const rateLimitIP = `192.168.99.${Math.floor(Math.random() * 200) + 10}` // unique per run
    prismaMock.user.findFirst.mockResolvedValue(null)

    const makeReq = () => new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': rateLimitIP },
      body: JSON.stringify({ username: 'bad', password: 'bad' }),
    })

    // 5 allowed attempts
    for (let i = 0; i < 5; i++) {
      await POST(makeReq() as any)
    }

    // 6th attempt should be rate-limited
    const res = await POST(makeReq() as any)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})
