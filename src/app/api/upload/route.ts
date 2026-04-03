import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, unauthorizedResponse } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'


// ── Upload Security ──────────────────────────────────────────────────
// Block only truly dangerous executable extensions.
// All document/archive/image formats are allowed per business requirement.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.com', '.scr',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.cpl', '.hta',
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

    if (!file) {
      return NextResponse.json({ ok: false, error: 'Chưa chọn file' }, { status: 400 })
    }

    // Block dangerous executable extensions
    const ext = path.extname(file.name).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { ok: false, error: `Định dạng file "${ext}" bị chặn vì lý do bảo mật.` },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'File quá lớn. Kích thước tối đa là 50 MB.' },
        { status: 400 }
      )
    }

    // Create upload directory
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', entityType.toLowerCase(), entityId)
    await mkdir(uploadDir, { recursive: true })

    // Write file
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = path.join(uploadDir, safeName)
    await writeFile(filePath, buffer)

    const fileUrl = `/uploads/${entityType.toLowerCase()}/${entityId}/${safeName}`

    // Save to DB
    const attachment = await prisma.fileAttachment.create({
      data: {
        entityType,
        entityId,
        fileName: file.name,
        fileUrl,
        fileSize: buffer.length,
        mimeType: file.type || null,
        uploadedBy: user.userId,
      },
    })

    return NextResponse.json({ ok: true, attachment }, { status: 201 })
  } catch (err) {
    console.error('POST /api/upload error:', err)
    return NextResponse.json({ ok: false, error: 'Lỗi upload' }, { status: 500 })
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
    return NextResponse.json({ ok: false, error: 'Lỗi hệ thống' }, { status: 500 })
  }
}
