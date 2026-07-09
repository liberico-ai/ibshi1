import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { prismaMock } from '@/lib/__mocks__/db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { authState } = vi.hoisted(() => ({ authState: { user: null as any } }))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual, // giữ verifyPassword/hashPassword/response helpers thật
    authenticateRequest: vi.fn(async () => authState.user),
    logAudit: vi.fn().mockResolvedValue(undefined),
    getClientIP: vi.fn(() => '127.0.0.1'),
  }
})

import { POST } from '@/app/api/auth/change-password/route'

const OLD_HASH = bcrypt.hashSync('oldpass123', 4) // cost thấp cho test nhanh

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(body: any): any {
  return new Request('http://localhost/api/auth/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { userId: 'u1', roleCode: 'R06a', username: 'x' }
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', username: 'x', passwordHash: OLD_HASH } as never)
    prismaMock.user.update.mockResolvedValue({} as never)
  })

  it('401 khi chưa đăng nhập', async () => {
    authState.user = null
    const res = await POST(req({ currentPassword: 'oldpass123', newPassword: 'newpass123' }))
    expect(res.status).toBe(401)
  })

  it('400 khi thiếu mật khẩu', async () => {
    const res = await POST(req({ currentPassword: 'oldpass123' }))
    expect(res.status).toBe(400)
  })

  it('400 khi mật khẩu hiện tại SAI', async () => {
    const res = await POST(req({ currentPassword: 'wrong', newPassword: 'newpass123' }))
    expect(res.status).toBe(400)
    const b = await res.json()
    expect(b.error).toContain('hiện tại')
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('400 khi mật khẩu mới < 6 ký tự', async () => {
    const res = await POST(req({ currentPassword: 'oldpass123', newPassword: 'abc' }))
    expect(res.status).toBe(400)
  })

  it('400 khi mật khẩu mới trùng hiện tại', async () => {
    const res = await POST(req({ currentPassword: 'oldpass123', newPassword: 'oldpass123' }))
    expect(res.status).toBe(400)
  })

  it('đổi thành công → update hash mới (khác hash cũ)', async () => {
    const res = await POST(req({ currentPassword: 'oldpass123', newPassword: 'newpass123' }))
    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = prismaMock.user.update.mock.calls[0][0] as any
    expect(arg.where).toEqual({ id: 'u1' })
    expect(typeof arg.data.passwordHash).toBe('string')
    expect(arg.data.passwordHash).not.toBe(OLD_HASH)
  })
})
