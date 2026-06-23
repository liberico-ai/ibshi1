import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import prisma from '@/lib/db'

// ── Allowlists (shared with /api/upload) ──

export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.dwg', '.dxf',
  '.zip', '.rar', '.7z',
])

export const EXT_TO_MIME: Record<string, string> = {
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

export const ENTITY_ID_REGEX = /^[A-Za-z0-9._-]+$/

export interface SaveAttachmentInput {
  buffer: Buffer
  fileName: string
  entityType: string
  entityId: string
  uploadedBy: string
}

export interface SaveAttachmentResult {
  id: string
  fileName: string
  fileUrl: string
}

export function validateFileName(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase()
  if (!ext) return 'File thiếu phần mở rộng'
  if (!ALLOWED_EXTENSIONS.has(ext)) return `Định dạng file "${ext}" không được hỗ trợ.`
  return null
}

export async function saveAttachmentFromBuffer(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
  const { buffer, fileName, entityType, entityId, uploadedBy } = input

  if (!ENTITY_ID_REGEX.test(entityId)) {
    throw new Error('entityId không hợp lệ')
  }

  const extErr = validateFileName(fileName)
  if (extErr) throw new Error(extErr)

  const ext = path.extname(fileName).toLowerCase()
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

  const uploadDir = path.join(process.cwd(), 'public', 'uploads', entityType.toLowerCase(), entityId)
  await mkdir(uploadDir, { recursive: true })

  const filePath = path.join(uploadDir, safeName)
  await writeFile(filePath, buffer)

  const fileUrl = `/uploads/${entityType.toLowerCase()}/${entityId}/${safeName}`
  const mimeType = EXT_TO_MIME[ext] || 'application/octet-stream'

  const attachment = await prisma.fileAttachment.create({
    data: {
      entityType,
      entityId,
      fileName,
      fileUrl,
      fileSize: buffer.length,
      mimeType,
      uploadedBy,
    },
  })

  return { id: attachment.id, fileName: attachment.fileName, fileUrl: attachment.fileUrl }
}
