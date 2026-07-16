import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, successResponse, errorResponse } from '@/lib/auth'
import { canEditForm } from '@/lib/constants'
import { saveAttachmentFromBuffer, validateFileName, ENTITY_ID_REGEX } from '@/lib/save-attachment'

const ALLOWED_ENTITY_TYPES = new Set([
  'TaskDoc', 'TaskQuote', 'Project', 'ProjectDoc', 'ProjectDraft',
  'PO', 'PR', 'GRN', 'Meeting', 'General', 'Task', 'TaskEvidence',
  'PurchaseContract',
])

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

// POST /api/upload — File upload
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const entityType = formData.get('entityType') as string || 'General'
    const entityId = formData.get('entityId') as string || 'unknown'

    if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
      return errorResponse('Tham số không hợp lệ', 400)
    }
    if (entityType === 'TaskQuote' && !canEditForm('SUPPLIER_QUOTE', user.roleCode)) {
      return errorResponse('Chỉ Thương mại / BGĐ được upload báo giá NCC', 403)
    }
    if (entityType === 'PR' && !canEditForm('PR', user.roleCode)) {
      return errorResponse('Bạn không có quyền upload file PR', 403)
    }
    if (entityType === 'TaskEvidence') {
      const taskId = entityId.replace(/_evidence$/, '')
      const isAssignee = await prisma.taskAssignee.findFirst({
        where: { taskId, userId: user.userId },
      })
      if (!isAssignee) {
        return errorResponse('Chỉ người nhận việc được upload bằng chứng', 403)
      }
    }
    if (!ENTITY_ID_REGEX.test(entityId)) {
      return errorResponse('Tham số không hợp lệ', 400)
    }

    if (!file) {
      return errorResponse('Chưa chọn file', 400)
    }

    const extErr = validateFileName(file.name)
    if (extErr) return errorResponse(extErr, 400)

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse('File quá lớn. Kích thước tối đa là 50 MB.', 400)
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const attachment = await saveAttachmentFromBuffer({
      buffer,
      fileName: file.name,
      entityType,
      entityId,
      uploadedBy: user.userId,
    })

    return successResponse({ attachment }, undefined, 201)
  } catch (err) {
    console.error('POST /api/upload error:', err)
    return errorResponse('Lỗi upload', 500)
  }
}

// GET /api/upload?entityType=&entityId= — List files for entity
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const entityType = searchParams.get('entityType')
    const entityId = searchParams.get('entityId')

    if (entityType && !ALLOWED_ENTITY_TYPES.has(entityType)) {
      return errorResponse('Tham số không hợp lệ', 400)
    }
    if (entityId && !ENTITY_ID_REGEX.test(entityId)) {
      return errorResponse('Tham số không hợp lệ', 400)
    }

    const where: Record<string, unknown> = {}
    if (entityType) where.entityType = entityType
    if (entityId) where.entityId = entityId

    const attachments = await prisma.fileAttachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({ attachments })
  } catch (err) {
    console.error('GET /api/upload error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
