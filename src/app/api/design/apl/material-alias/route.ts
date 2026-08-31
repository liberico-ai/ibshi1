import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP, requireRoles } from '@/lib/auth'
import { describeDbError } from '@/lib/db-missing-table'
import { aplAliasKey } from '@/lib/apl-material-match'

export const dynamic = 'force-dynamic'

// TẦNG 2 — người dùng chỉ tay: cặp (mác thép × quy cách) của APL ứng với mã kho nào.
// Lưu vào material_code_aliases, khoá có tiền tố "APL:" nên không đụng mã cũ thật.
// Khai một lần dùng cho MỌI dự án sau, vì quy cách thép lặp lại giữa các dự án.
const ALIAS_ROLES = ['R01', 'R03', 'R03a', 'R04', 'R04a', 'R05', 'R05a', 'R10']

// POST { grade, profile, materialId }  — gắn hoặc đổi
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALIAS_ROLES)) return errorResponse('Không có quyền sửa ánh xạ vật tư', 403)

    const b = await req.json().catch(() => null) as { grade?: string; profile?: string; materialId?: string } | null
    if (!b?.materialId) return errorResponse('Chưa chọn mã vật tư')
    if (!b.grade && !b.profile) return errorResponse('Thiếu mác thép / quy cách')

    const mat = await prisma.material.findUnique({ where: { id: b.materialId }, select: { id: true, materialCode: true, name: true } })
    if (!mat) return errorResponse('Không tìm thấy mã vật tư', 404)

    const aliasCode = aplAliasKey(b.grade, b.profile)
    await prisma.materialCodeAlias.upsert({
      where: { aliasCode },
      create: { aliasCode, materialId: mat.id, source: 'TK', note: `APL ${b.grade || ''} / ${b.profile || ''}`, createdBy: user.userId },
      update: { materialId: mat.id, note: `APL ${b.grade || ''} / ${b.profile || ''}` },
    })
    await logAudit(user.userId, 'SET_APL_MATERIAL_ALIAS', 'Material', mat.id,
      { aliasCode, materialCode: mat.materialCode }, getClientIP(req))

    return successResponse({ aliasCode, material: mat }, `Đã gắn ${b.grade || ''} / ${b.profile || ''} → ${mat.materialCode}`)
  } catch (err) {
    console.error('POST material-alias error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi lưu ánh xạ'), 500)
  }
}

// DELETE ?grade=&profile=  — bỏ ánh xạ tay, trả về cho luật máy tự quyết
export async function DELETE(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALIAS_ROLES)) return errorResponse('Không có quyền sửa ánh xạ vật tư', 403)

    const sp = req.nextUrl.searchParams
    const aliasCode = aplAliasKey(sp.get('grade'), sp.get('profile'))
    // Chỉ xoá bí danh do màn APL tạo (tiền tố "APL:") — không đụng mã cũ thật của kho.
    if (!aliasCode.startsWith('APL:')) return errorResponse('Khoá không hợp lệ')
    const del = await prisma.materialCodeAlias.deleteMany({ where: { aliasCode } })
    if (del.count === 0) return errorResponse('Cặp này chưa có ánh xạ tay', 404)
    await logAudit(user.userId, 'DEL_APL_MATERIAL_ALIAS', 'Material', undefined, { aliasCode }, getClientIP(req))
    return successResponse({}, 'Đã bỏ ánh xạ tay')
  } catch (err) {
    console.error('DELETE material-alias error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi bỏ ánh xạ'), 500)
  }
}
