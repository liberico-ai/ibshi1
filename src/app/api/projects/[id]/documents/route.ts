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

// T5 — Sổ tài liệu dự án (Project Document Register)
// GET  /api/projects/[id]/documents        → list (lọc docType / dept)
// POST /api/projects/[id]/documents        → tạo bản ghi (gắn fileAttachmentId nếu có)

// Roles được phép TẠO tài liệu (mọi phòng phát hành hồ sơ chính).
// Xem: bất kỳ role nào có quyền truy cập dự án (row-level qua getUserProjectIds).
const DOC_CREATE_ROLES = new Set([
  'R01',        // BGĐ
  'R02', 'R02a', // QLDA
  'R03', 'R03a', // KTKT (kế hoạch/kinh tế)
  'R04', 'R04a', // Thiết kế
  'R07', 'R07a', // Thương mại
  'R08', 'R08a', // Tài chính KT
  'R09', 'R09a', // QC
  'R10',        // Admin
])

const DOC_TYPES = new Set(['BAN_VE', 'BOM', 'HDMB', 'DTTC', 'QC', 'HSE', 'BBH', 'KHAC'])
const MAX_STR = 300

// Kiểm tra người dùng có quyền truy cập dự án không (R01/R10 = tất cả).
async function canAccessProject(
  user: { userId: string; roleCode: string; username: string; userLevel: number; fullName: string },
  projectId: string,
): Promise<boolean> {
  if (user.roleCode === 'R01' || user.roleCode === 'R10') return true
  const allowedIds = await getUserProjectIds(user)
  if (allowedIds === null) return true // no filter = sees all
  return allowedIds.includes(projectId)
}

// GET — danh sách tài liệu của dự án, lọc theo docType / deptCode
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

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
    const docType = searchParams.get('docType')
    const deptCode = searchParams.get('deptCode')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = { projectId }
    if (docType) where.docType = docType
    if (deptCode) where.deptCode = deptCode
    if (status) where.status = status

    const documents = await prisma.projectDocument.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    })

    // Đính kèm metadata file (fileName/fileUrl/mimeType) cho các bản ghi có fileAttachmentId
    const attIds = documents.map(d => d.fileAttachmentId).filter(Boolean) as string[]
    let attMap = new Map<string, { id: string; fileName: string; fileUrl: string; mimeType: string | null }>()
    if (attIds.length) {
      const atts = await prisma.fileAttachment.findMany({
        where: { id: { in: [...new Set(attIds)] } },
        select: { id: true, fileName: true, fileUrl: true, mimeType: true },
      })
      attMap = new Map(atts.map(a => [a.id, a]))
    }

    const items = documents.map(d => ({
      ...d,
      file: d.fileAttachmentId ? attMap.get(d.fileAttachmentId) || null : null,
    }))

    return successResponse({ project, documents: items, canCreate: DOC_CREATE_ROLES.has(user.roleCode) })
  } catch (err) {
    console.error('GET /api/projects/[id]/documents error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST — tạo bản ghi tài liệu (fileAttachmentId là tùy chọn — có thể tạo trước, gắn file sau)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { id: projectId } = await params
    if (!projectId) return errorResponse('Thiếu mã dự án', 400)

    if (!DOC_CREATE_ROLES.has(user.roleCode)) {
      return forbiddenResponse('Bạn không có quyền thêm tài liệu dự án')
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    if (!(await canAccessProject(user, projectId))) {
      return errorResponse('Dự án không tồn tại', 404)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errorResponse('Dữ liệu không hợp lệ', 400)

    const docCode = String(body.docCode || '').trim()
    const docType = String(body.docType || '').trim()
    const title = String(body.title || '').trim()
    const revision = String(body.revision || 'Rev0').trim() || 'Rev0'
    const deptCode = body.deptCode ? String(body.deptCode).trim() : null
    const fileAttachmentId = body.fileAttachmentId ? String(body.fileAttachmentId).trim() : null
    const taskId = body.taskId ? String(body.taskId).trim() : null

    if (!docCode) return errorResponse('Thiếu mã tài liệu (docCode)', 400)
    if (!title) return errorResponse('Thiếu tiêu đề tài liệu (title)', 400)
    if (!docType || !DOC_TYPES.has(docType)) {
      return errorResponse(`Loại tài liệu không hợp lệ. Chấp nhận: ${[...DOC_TYPES].join(', ')}`, 400)
    }
    if (docCode.length > MAX_STR || title.length > MAX_STR || revision.length > 50) {
      return errorResponse('Nội dung quá dài', 400)
    }

    // Nếu có fileAttachmentId, xác thực file tồn tại (FK mềm)
    if (fileAttachmentId) {
      const att = await prisma.fileAttachment.findUnique({
        where: { id: fileAttachmentId },
        select: { id: true },
      })
      if (!att) return errorResponse('File đính kèm không tồn tại', 400)
    }

    // Nếu có taskId, xác thực task thuộc đúng dự án (tránh gắn nhầm)
    if (taskId) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true },
      })
      if (!task || task.projectId !== projectId) {
        return errorResponse('Công việc liên kết không hợp lệ', 400)
      }
    }

    const doc = await prisma.projectDocument.create({
      data: {
        projectId,
        docCode,
        docType,
        revision,
        deptCode,
        title,
        fileAttachmentId,
        taskId,
        uploadedBy: user.userId,
      },
    })

    await logAudit(user.userId, 'CREATE', 'ProjectDocument', doc.id, { projectId, docCode, docType, revision }, getClientIP(req))

    return successResponse({ document: doc }, 'Đã thêm tài liệu vào sổ dự án', 201)
  } catch (err) {
    console.error('POST /api/projects/[id]/documents error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
