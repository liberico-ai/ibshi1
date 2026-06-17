import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/work/project-files?projectId=... — tài liệu của 1 dự án để chọn làm "tài liệu phải đọc".
// Gộp 2 nguồn: (1) thư viện tài liệu dự án (entityType=ProjectDoc) + (2) tệp đã đính kèm ở các task của dự án.
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId')?.trim()
    if (!projectId) return successResponse({ files: [] })

    // (1) Tài liệu dự án: thư viện (ProjectDoc) + tệp đính kèm khi khởi tạo dự án (Project, entityId = projectId[_suffix])
    const projectDocs = await prisma.fileAttachment.findMany({
      where: {
        OR: [
          { entityType: 'ProjectDoc', entityId: projectId },
          { entityType: 'Project', entityId: { startsWith: projectId } },
        ],
      },
      select: { id: true, fileName: true, fileUrl: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    // (2) Tệp đính kèm trong các task thuộc dự án (entityId bắt đầu bằng taskId)
    const tasks = await prisma.task.findMany({ where: { projectId }, select: { id: true } })
    const taskIds = tasks.map((t) => t.id)
    const taskFiles = taskIds.length
      ? await prisma.fileAttachment.findMany({
          where: {
            entityType: 'TaskDoc',
            OR: taskIds.map((id) => ({ entityId: { startsWith: id } })),
          },
          select: { id: true, fileName: true, fileUrl: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : []

    // (3) Tài liệu cuộc họp của dự án (vd Biên bản họp) — tệp độc lập, tải về được
    const meetings = await prisma.meeting.findMany({ where: { projectId }, select: { id: true } })
    const meetingIds = meetings.map((m) => m.id)
    const meetingFiles = meetingIds.length
      ? await prisma.fileAttachment.findMany({
          where: { entityType: 'Meeting', entityId: { in: meetingIds } },
          select: { id: true, fileName: true, fileUrl: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : []

    // Gộp + khử trùng theo id
    const seen = new Set<string>()
    const files: { id: string; fileName: string; fileUrl: string; source: string }[] = []
    for (const f of projectDocs) { if (!seen.has(f.id)) { seen.add(f.id); files.push({ id: f.id, fileName: f.fileName, fileUrl: f.fileUrl, source: 'project' }) } }
    for (const f of meetingFiles) { if (!seen.has(f.id)) { seen.add(f.id); files.push({ id: f.id, fileName: f.fileName, fileUrl: f.fileUrl, source: 'meeting' }) } }
    for (const f of taskFiles) { if (!seen.has(f.id)) { seen.add(f.id); files.push({ id: f.id, fileName: f.fileName, fileUrl: f.fileUrl, source: 'task' }) } }

    return successResponse({ files })
  } catch (err) {
    console.error('GET /api/work/project-files error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
