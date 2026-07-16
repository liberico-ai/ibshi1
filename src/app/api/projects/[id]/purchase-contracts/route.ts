import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  getUserProjectIds,
  logAudit,
  getClientIP,
} from '@/lib/auth'
import {
  CONTRACT_VIEW_ROLES,
  CONTRACT_WRITE_ROLES,
  CONTRACT_TYPES,
  MAX_STR,
} from '@/lib/purchase-contract-constants'

// T1 — Hợp đồng mua (Purchase Contract)
// GET  /api/projects/[id]/purchase-contracts  → list HĐ theo dự án (lọc vendor/status) + tổng PO đã gắn
// POST /api/projects/[id]/purchase-contracts  → tạo HĐ (đính signedFileId nếu có)

type AuthUser = { userId: string; roleCode: string; username: string; userLevel: number; fullName: string }

// Kiểm tra người dùng có quyền truy cập dự án không (R01/R10 = tất cả).
async function canAccessProject(user: AuthUser, projectId: string): Promise<boolean> {
  if (user.roleCode === 'R01' || user.roleCode === 'R10') return true
  const allowedIds = await getUserProjectIds(user)
  if (allowedIds === null) return true
  return allowedIds.includes(projectId)
}

// GET — danh sách HĐ mua của dự án + tổng giá trị PO đã gắn (theo dõi giải ngân)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!CONTRACT_VIEW_ROLES.has(user.roleCode)) {
      return forbiddenResponse('Bạn không có quyền xem hợp đồng mua')
    }

    const { id: projectId } = await params
    if (!projectId) return errorResponse('Thiếu mã dự án', 400)

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, projectCode: true, projectName: true },
    })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    if (!(await canAccessProject(user, projectId))) {
      return errorResponse('Dự án không tồn tại', 404)
    }

    const { searchParams } = new URL(req.url)
    const vendorId = searchParams.get('vendorId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = { projectId }
    if (vendorId) where.vendorId = vendorId
    if (status) where.status = status

    const contracts = await prisma.purchaseContract.findMany({
      where,
      include: {
        vendor: { select: { id: true, vendorCode: true, name: true } },
        orders: { select: { id: true, poCode: true, totalValue: true, status: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    // Đính metadata file ký (fileName/fileUrl/mimeType) cho các HĐ có signedFileId
    const fileIds = contracts.map(c => c.signedFileId).filter(Boolean) as string[]
    let fileMap = new Map<string, { id: string; fileName: string; fileUrl: string; mimeType: string | null }>()
    if (fileIds.length) {
      const atts = await prisma.fileAttachment.findMany({
        where: { id: { in: [...new Set(fileIds)] } },
        select: { id: true, fileName: true, fileUrl: true, mimeType: true },
      })
      fileMap = new Map(atts.map(a => [a.id, a]))
    }

    const items = contracts.map(c => {
      const linkedPoTotal = c.orders.reduce((s, o) => s + Number(o.totalValue || 0), 0)
      const value = c.value != null ? Number(c.value) : null
      return {
        ...c,
        value,
        linkedPoTotal,
        linkedPoCount: c.orders.length,
        // Cảnh báo mềm: tổng PO đã gắn vượt giá trị HĐ (không chặn cứng)
        overBudget: value != null && linkedPoTotal > value,
        signedFile: c.signedFileId ? fileMap.get(c.signedFileId) || null : null,
      }
    })

    return successResponse({
      project,
      contracts: items,
      canWrite: CONTRACT_WRITE_ROLES.has(user.roleCode),
    })
  } catch (err) {
    console.error('GET /api/projects/[id]/purchase-contracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST — tạo HĐ mua (signedFileId tùy chọn — có thể tạo trước, gắn file sau)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { id: projectId } = await params
    if (!projectId) return errorResponse('Thiếu mã dự án', 400)

    if (!CONTRACT_WRITE_ROLES.has(user.roleCode)) {
      return forbiddenResponse('Chỉ Thương mại (R07) / BGĐ (R01) được lập hợp đồng mua')
    }

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    if (!(await canAccessProject(user, projectId))) {
      return errorResponse('Dự án không tồn tại', 404)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errorResponse('Dữ liệu không hợp lệ', 400)

    const contractCode = String(body.contractCode || '').trim()
    const contractType = String(body.contractType || 'HDMB').trim() || 'HDMB'
    const vendorId = String(body.vendorId || '').trim()
    const title = String(body.title || '').trim()
    const currency = String(body.currency || 'VND').trim() || 'VND'
    const paymentTerms = body.paymentTerms ? String(body.paymentTerms).trim() : null
    const deliveryTerms = body.deliveryTerms ? String(body.deliveryTerms).trim() : null
    const notes = body.notes ? String(body.notes).trim() : null
    const signedFileId = body.signedFileId ? String(body.signedFileId).trim() : null

    if (!contractCode) return errorResponse('Thiếu số hợp đồng (contractCode)', 400)
    if (!title) return errorResponse('Thiếu tiêu đề hợp đồng (title)', 400)
    if (!vendorId) return errorResponse('Thiếu nhà cung cấp (vendorId)', 400)
    if (!CONTRACT_TYPES.has(contractType)) {
      return errorResponse(`Loại hợp đồng không hợp lệ. Chấp nhận: ${[...CONTRACT_TYPES].join(', ')}`, 400)
    }
    if (contractCode.length > MAX_STR || title.length > MAX_STR) {
      return errorResponse('Nội dung quá dài', 400)
    }

    // value (số tiền) — tùy chọn, nhưng nếu có phải là số ≥ 0
    let value: number | null = null
    if (body.value != null && body.value !== '') {
      value = Number(body.value)
      if (!Number.isFinite(value) || value < 0) return errorResponse('Giá trị hợp đồng không hợp lệ', 400)
    }

    // Ngày ký / hiệu lực — tùy chọn
    const signedDate = body.signedDate ? new Date(String(body.signedDate)) : null
    const effectiveDate = body.effectiveDate ? new Date(String(body.effectiveDate)) : null
    if (signedDate && isNaN(signedDate.getTime())) return errorResponse('Ngày ký không hợp lệ', 400)
    if (effectiveDate && isNaN(effectiveDate.getTime())) return errorResponse('Ngày hiệu lực không hợp lệ', 400)

    // Vendor phải tồn tại
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })
    if (!vendor) return errorResponse('Nhà cung cấp không tồn tại', 400)

    // Số HĐ phải duy nhất
    const dup = await prisma.purchaseContract.findUnique({ where: { contractCode }, select: { id: true } })
    if (dup) return errorResponse(`Số hợp đồng ${contractCode} đã tồn tại`, 409)

    // Nếu có signedFileId, xác thực file tồn tại (FK mềm)
    if (signedFileId) {
      const att = await prisma.fileAttachment.findUnique({ where: { id: signedFileId }, select: { id: true } })
      if (!att) return errorResponse('File ký đính kèm không tồn tại', 400)
    }

    const contract = await prisma.purchaseContract.create({
      data: {
        contractCode,
        contractType,
        projectId,
        vendorId,
        title,
        value,
        currency,
        signedDate,
        effectiveDate,
        paymentTerms,
        deliveryTerms,
        signedFileId,
        notes,
        createdBy: user.userId,
      },
    })

    await logAudit(user.userId, 'CREATE', 'PurchaseContract', contract.id, { projectId, contractCode, contractType, vendorId }, getClientIP(req))

    return successResponse({ contract }, 'Đã tạo hợp đồng mua', 201)
  } catch (err) {
    console.error('POST /api/projects/[id]/purchase-contracts error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
