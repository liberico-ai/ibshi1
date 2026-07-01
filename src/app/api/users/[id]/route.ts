import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  hashPassword,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  logAudit,
  getClientIP,
} from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { updateUserSchema, idParamSchema } from '@/lib/schemas'

const ADMIN_ROLES = ['R01', 'R10']

// GET /api/users/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, fullName: true, email: true,
        roleCode: true, userLevel: true, isActive: true, createdAt: true, updatedAt: true,
        department: { select: { id: true, code: true, name: true } },
      },
    })

    if (!user) return errorResponse('User không tồn tại', 404)
    return successResponse({ user })
  } catch (err) {
    console.error('GET /api/users/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/users/[id] — Edit user (R01, R10 only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ Admin mới có quyền sửa user')

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const result = await validateBody(req, updateUserSchema)
    if (!result.success) return result.response
    const { username, fullName, email, roleCode, userLevel, departmentCode, isActive } = result.data

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return errorResponse('User không tồn tại', 404)

    // Username change: check uniqueness
    if (username !== undefined && username !== existing.username) {
      const dup = await prisma.user.findUnique({ where: { username } })
      if (dup) return errorResponse(`Username "${username}" đã tồn tại`, 409)
    }

    let departmentId: string | undefined | null = undefined
    if (departmentCode !== undefined) {
      if (departmentCode) {
        const dept = await prisma.department.findUnique({ where: { code: departmentCode } })
        departmentId = dept?.id ?? undefined
      } else {
        departmentId = null
      }
    }

    const data: Record<string, unknown> = {}
    if (username !== undefined) data.username = username
    if (fullName !== undefined) data.fullName = fullName
    if (email !== undefined) data.email = email || null
    if (roleCode !== undefined) data.roleCode = roleCode
    if (userLevel !== undefined) data.userLevel = userLevel
    if (departmentId !== undefined) data.departmentId = departmentId
    if (isActive !== undefined) data.isActive = isActive

    const updated = await prisma.user.update({ where: { id }, data })

    await logAudit(payload.userId, 'UPDATE', 'User', id, {
      changes: result.data,
      targetUser: existing.username,
    }, getClientIP(req))

    return successResponse({
      user: {
        id: updated.id, username: updated.username, fullName: updated.fullName,
        roleCode: updated.roleCode, userLevel: updated.userLevel, isActive: updated.isActive,
      },
    }, 'Cập nhật user thành công')
  } catch (err) {
    console.error('PUT /api/users/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// DELETE /api/users/[id] — Hard delete (only inactive users without audit logs)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ Admin mới có quyền')

    const pResult2 = validateParams(await params, idParamSchema)
    if (!pResult2.success) return pResult2.response
    const { id } = pResult2.data

    if (id === payload.userId) return errorResponse('Không thể xoá chính mình')

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return errorResponse('User không tồn tại', 404)

    if (existing.isActive) {
      return errorResponse('Chỉ có thể xoá user đã ở trạng thái Inactive. Hãy vô hiệu hoá trước.', 400)
    }

    // Block hard-delete if user has any audit log (preserve audit trail)
    const auditCount = await prisma.auditLog.count({ where: { userId: id } })
    if (auditCount > 0) {
      return errorResponse(`Không thể xoá: user đã có ${auditCount} bản ghi nhật ký hoạt động. Chỉ xoá được tài khoản chưa từng hoạt động.`, 400)
    }

    // Log BEFORE delete (audit log references admin's userId, not target's)
    await logAudit(payload.userId, 'DELETE', 'User', id, {
      targetUser: existing.username,
      targetFullName: existing.fullName,
    }, getClientIP(req))

    // Clean up dependents that don't cascade automatically
    await prisma.$executeRaw`UPDATE workflow_tasks SET assigned_to = NULL WHERE assigned_to = ${id}`
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.employee.updateMany({ where: { userId: id }, data: { userId: null } }),
      prisma.user.delete({ where: { id } }),
    ])

    return successResponse({}, `Đã xoá user ${existing.username}`)
  } catch (err) {
    console.error('DELETE /api/users/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
