import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getWoAcceptance, blockReason } from '@/lib/wo-acceptance'

// GET /api/production/acceptance?projectId=… — tình hình nghiệm thu từng lệnh của một dự án.
// Màn tạo ITP cần biết mỗi lệnh còn bao nhiêu kg mời nghiệm thu được, để không mời trùng
// phần đã ký hoặc đang chờ ký.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return errorResponse('Thiếu projectId')

  const wos = await prisma.workOrder.findMany({
    where: { projectId },
    select: { id: true },
  })
  const map = await getWoAcceptance(wos.map(w => w.id))

  const acceptance: Record<string, unknown> = {}
  for (const [woId, a] of map) {
    acceptance[woId] = { ...a, blockReason: blockReason(a) }
  }
  return successResponse({ acceptance })
}
