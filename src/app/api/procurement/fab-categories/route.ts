import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { FAB_WRITE_ROLES, chuanHoaHangMuc } from '@/lib/fab-allocation'

export const dynamic = 'force-dynamic'

/**
 * GET /api/procurement/fab-categories?projectId=...
 * [PORT Thương Mại] Danh sách hạng mục chế tạo của 1 dự án (bám getProjectFabCategories).
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = req.nextUrl.searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId', 400)
    const categories = await prisma.fabricationCategory.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, name: true, sortOrder: true, ghiChu: true },
    })
    return successResponse({ projectId, count: categories.length, categories })
  } catch (err) {
    console.error('GET fab-categories error:', err)
    return errorResponse('Lỗi tải hạng mục', 500)
  }
}

/**
 * POST /api/procurement/fab-categories?projectId=...  body: { code, name, sortOrder?, ghiChu? }
 * [PORT Thương Mại] Thêm 1 hạng mục (bám createFabCategory). 409 nếu trùng mã trong dự án.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!FAB_WRITE_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const projectId = req.nextUrl.searchParams.get('projectId')
    if (!projectId) return errorResponse('Thiếu projectId', 400)

    const duAn = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!duAn) return errorResponse('Không tìm thấy dự án', 404)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const hm = chuanHoaHangMuc(body, 0)
    if (!hm.code) return errorResponse('Thiếu mã hạng mục', 400)
    if (!hm.name) return errorResponse('Thiếu tên hạng mục', 400)

    const trung = await prisma.fabricationCategory.findFirst({ where: { projectId, code: hm.code }, select: { id: true } })
    if (trung) return errorResponse(`Mã "${hm.code}" đã có trong dự án này`, 409)

    const created = await prisma.fabricationCategory.create({ data: { projectId, ...hm } })
    await logAudit(payload.userId, 'CREATE_FAB_CATEGORY', 'FabricationCategory', created.id, { projectId, code: hm.code })
    return successResponse({ category: created }, `Đã thêm hạng mục ${hm.code}`, 201)
  } catch (err) {
    console.error('POST fab-categories error:', err)
    return errorResponse('Lỗi thêm hạng mục', 500)
  }
}
