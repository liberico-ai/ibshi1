import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { buildTemplateSyncReport, expectedForStep, type TemplateStepRow } from '@/lib/template-sync'

// Đồng bộ bảng TemplateStep theo WORKFLOW_RULES (code) — thay cho việc sửa tay trong DB.
//   GET  → báo cáo lệch (chỉ đọc, xem trước)
//   POST → ghi (BGĐ/Admin), có audit log
// Chỉ UPDATE tại chỗ: giữ nguyên id nên Task.templateStepId (không có khóa ngoại) không bị mồ côi.
// KHÔNG tạo/xoá bước — bước đã về hưu (P4.3/P4.4) giữ nguyên trong DB.
const SYNC_ROLES = ['R01', 'R10']

async function loadRows(): Promise<TemplateStepRow[]> {
  const steps = await prisma.templateStep.findMany({
    select: {
      id: true, code: true, title: true, roleCode: true, deptCode: true,
      deadlineDays: true, nextCodes: true, gateCodes: true,
    },
    orderBy: [{ templateId: 'asc' }, { orderIndex: 'asc' }],
  })
  return steps as TemplateStepRow[]
}

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, SYNC_ROLES)) return errorResponse('Chỉ BGĐ/Admin được xem đối chiếu template', 403)

    const [rows, linkedTasks, openTasks] = await Promise.all([
      loadRows(),
      prisma.task.count({ where: { templateStepId: { not: null } } }),
      prisma.task.count({ where: { templateStepId: { not: null }, status: { notIn: ['DONE', 'CANCELLED'] } } }),
    ])

    return successResponse({ report: buildTemplateSyncReport(rows), linkedTasks, openTasks })
  } catch (err) {
    console.error('GET /api/admin/template-steps/sync error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, SYNC_ROLES)) return errorResponse('Chỉ BGĐ/Admin được đồng bộ template', 403)

    const body = await req.json().catch(() => ({}))
    const withGraph = body?.withGraph === true

    const rows = await loadRows()
    const report = buildTemplateSyncReport(rows)
    const targets = withGraph
      ? [...new Map([...report.pending, ...report.graphPending].map((s) => [s.id, s])).values()]
      : report.pending

    if (targets.length === 0) return successResponse({ updated: 0, report }, 'Template đã khớp code — không có gì để đồng bộ')

    // Ảnh chụp giá trị CŨ để audit log — hoàn nguyên được nếu cần.
    const before = rows
      .filter((r) => targets.some((t) => t.id === r.id))
      .map((r) => ({ id: r.id, code: r.code, title: r.title, roleCode: r.roleCode, deptCode: r.deptCode, deadlineDays: r.deadlineDays, nextCodes: r.nextCodes, gateCodes: r.gateCodes }))

    await prisma.$transaction(
      targets.map((t) => {
        const want = expectedForStep(t.code)!
        return prisma.templateStep.update({
          where: { id: t.id },
          data: {
            title: want.title,
            roleCode: want.roleCode,
            deptCode: want.deptCode,
            deadlineDays: want.deadlineDays,
            ...(withGraph ? { nextCodes: want.nextCodes, gateCodes: want.gateCodes } : {}),
          },
        })
      }),
    )

    await logAudit(user.userId, 'SYNC_TEMPLATE_STEPS', 'TemplateStep', undefined,
      { withGraph, count: targets.length, codes: targets.map((t) => t.code), before }, getClientIP(req))

    const after = buildTemplateSyncReport(await loadRows())
    return successResponse(
      { updated: targets.length, report: after },
      `Đã đồng bộ ${targets.length} bước theo code. Task đang mở giữ nguyên người nhận — role mới chỉ áp cho task sinh sau này.`,
    )
  } catch (err) {
    console.error('POST /api/admin/template-steps/sync error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
