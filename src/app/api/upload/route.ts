import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse, errorResponse } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'


// ── Upload Security ──────────────────────────────────────────────────
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.dwg', '.dxf',
  '.zip', '.rar', '.7z',
])

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
}

const ALLOWED_ENTITY_TYPES = new Set([
  'TaskDoc', 'TaskQuote', 'Project', 'ProjectDoc', 'ProjectDraft',
  'PO', 'PR', 'GRN', 'Meeting', 'General', 'Task',
])

const ENTITY_ID_REGEX = /^[A-Za-z0-9._-]+$/

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
    if (!ENTITY_ID_REGEX.test(entityId)) {
      return errorResponse('Tham số không hợp lệ', 400)
    }

    if (!file) {
      return errorResponse('Chưa chọn file', 400)
    }

    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return errorResponse(`Định dạng file "${ext}" không được hỗ trợ.`, 400)
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse('File quá lớn. Kích thước tối đa là 50 MB.', 400)
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', entityType.toLowerCase(), entityId)
    await mkdir(uploadDir, { recursive: true })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = path.join(uploadDir, safeName)
    await writeFile(filePath, buffer)

    const fileUrl = `/uploads/${entityType.toLowerCase()}/${entityId}/${safeName}`
    const mimeType = EXT_TO_MIME[ext] || 'application/octet-stream'

    const attachment = await prisma.fileAttachment.create({
      data: {
        entityType,
        entityId,
        fileName: file.name,
        fileUrl,
        fileSize: buffer.length,
        mimeType,
        uploadedBy: user.userId,
      },
    })

    return NextResponse.json({ ok: true, attachment }, {
      status: 201,
      headers: { 'Content-Disposition': 'attachment' },
    })
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

    return NextResponse.json({ ok: true, attachments })
  } catch (err) {
    console.error('GET /api/upload error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}