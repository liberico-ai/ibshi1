import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { KEY_TO_FORM, canEditForm } from '@/lib/constants'
import { materializePrSafe } from '@/lib/pr-materialize'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = [
  'bomPr', 'momAttendants', 'momSections', 'momHeader', 'templateType',
  'weldData', 'paintData',
  'totalMaterial', 'totalLabor', 'totalService', 'totalOverhead', 'totalEstimate', 'dt02Detail', 'estimateFileName',
  'wbsItems', 'milestones', 'bomItemsList',
  'supplierQuotes', 'chosenVendorId',
]

// POST /api/work/tasks/[id]/result-data  { key, value }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { key?: string; value?: unknown }
    if (!body.key || !ALLOWED_KEYS.includes(body.key)) return errorResponse('Key không hợp lệ', 400)

    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, resultData: true, createdBy: true, assignees: { select: { userId: true, role: true } } },
    })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    const isParticipant = task.createdBy === payload.userId
      || task.assignees.some(a => a.userId === payload.userId || a.role === payload.roleCode)
    if (!isParticipant) return errorResponse('Bạn không có quyền sửa công việc này', 403)

    const form = KEY_TO_FORM[body.key]
    if (form && !canEditForm(form, payload.roleCode)) {
      return errorResponse('Bạn không có quyền sửa biểu mẫu này', 403)
    }

    if (body.key === 'chosenVendorId' && body.value) {
      const rd = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
      const quotes = Array.isArray(rd.supplierQuotes) ? rd.supplierQuotes as { vendorId?: string; totalAmount?: number; selectReason?: string }[] : []
      const vendorId = String(body.value)
      const chosen = quotes.find(q => q.vendorId === vendorId)
      if (!chosen) return errorResponse('NCC không nằm trong danh sách báo giá', 400)
      const priced = quotes.filter(q => (q.totalAmount ?? 0) > 0)
      if (priced.length >= 2) {
        const minAmount = Math.min(...priced.map(q => q.totalAmount!))
        if ((chosen.totalAmount ?? 0) > minAmount && !chosen.selectReason?.trim()) {
          return errorResponse('Phải nhập lý do khi chọn NCC không phải giá thấp nhất', 400)
        }
      }
    }

    const patch = JSON.stringify({ [body.key]: body.value ?? '' })
    await prisma.$executeRaw`
      UPDATE "tasks"
      SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
          "updated_at" = now()
      WHERE "id" = ${id}`
    // Sinh/cập nhật PR (sau FF_PR_MATERIALIZE, mặc định TẮT). Không bao giờ throw.
    await materializePrSafe(id, payload.userId)
    return successResponse({})
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/result-data error:', err)
    return errorResponse('Lỗi lưu dữ liệu', 500)
  }
}

// GET /api/work/tasks/[id]/result-data — lấy toàn bộ resultData
// P3.5: nếu chưa có bomPr, tự aggregate từ P2.1/P2.2/P2.3 cùng project hoặc parent
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const task = await prisma.task.findUnique({
      where: { id },
      select: { resultData: true, taskType: true, projectId: true, parentId: true },
    })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    const rd = (task.resultData && typeof task.resultData === 'object')
      ? (task.resultData as Record<string, unknown>)
      : {}

    if (task.taskType === 'P3.5' && !rd.bomPr) {
      const bomPr = await resolveBomPrForP35(task.projectId, task.parentId)
      if (bomPr) rd.bomPr = bomPr
    }

    return successResponse({ resultData: rd })
  } catch (err) {
    console.error('GET /api/work/tasks/[id]/result-data error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

async function resolveBomPrForP35(projectId: string | null, parentId: string | null): Promise<string | null> {
  const parseArr = (raw: unknown): unknown[] => {
    if (!raw) return []
    if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return [] } }
    return Array.isArray(raw) ? raw : []
  }

  // 1) Aggregate từ P2.1/P2.2/P2.3 cùng project
  if (projectId) {
    const steps = await prisma.task.findMany({
      where: { projectId, taskType: { in: ['P2.1', 'P2.2', 'P2.3'] }, status: 'DONE' },
      select: { taskType: true, resultData: true },
      orderBy: { completedAt: 'desc' },
    })
    const all: unknown[] = []
    for (const s of steps) {
      const d = s.resultData as Record<string, unknown> | null
      if (!d) continue
      if (s.taskType === 'P2.1') all.push(...parseArr(d.bomPrItems))
      else if (s.taskType === 'P2.2') { all.push(...parseArr(d.weldPrItems)); all.push(...parseArr(d.paintPrItems)) }
      else all.push(...parseArr(d.bomItems))
    }
    if (all.length > 0) return JSON.stringify(all)
  }

  // 2) Fallback: parent task resultData.bomPr
  if (parentId) {
    const parent = await prisma.task.findUnique({ where: { id: parentId }, select: { resultData: true } })
    const prd = parent?.resultData as Record<string, unknown> | null
    if (prd?.bomPr) return typeof prd.bomPr === 'string' ? prd.bomPr : JSON.stringify(prd.bomPr)
  }

  return null
}
