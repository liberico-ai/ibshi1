import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { WBS_STAGE_LABEL, normWorkshop, woCodeFor } from '@/lib/wbs-wo'
import { stripWbsNotes } from '@/lib/wbs-parser'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
const ALLOWED_ROLES = ['R01', 'R02'] // như "Sinh WO từ BOM": chỉ PM + BGĐ

const toDate = (v: unknown): Date | null => {
  const s = String(v ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

interface Body {
  projectId?: string; rowIndex?: number; stageKey?: string
  teamCode?: string; isSub?: boolean; weight?: number | string; start?: string; finish?: string
  // Quyết định khi KL thay đổi mà hạng mục đã có WO phát hành trước: 'update' (đồng bộ KL) | 'delete' (xóa WO + mở lại ô).
  klResolution?: 'update' | 'delete'
  // 'update' = SỬA WO đã phát hành của ô này (thay vì tạo mới). Mặc định: ô đã có WO → trả WO cũ.
  mode?: 'update'
}

// Đọc WBS (đã bỏ ghi chú) + mảng gốc từ task P1.2A.
async function readWbs(projectId: string) {
  const planTask = await prisma.task.findFirst({ where: { projectId, taskType: 'P1.2A' }, select: { id: true, resultData: true }, orderBy: { createdAt: 'desc' } })
  let fullRows: Record<string, string>[] = []
  if (planTask?.resultData) {
    const pData = planTask.resultData as Record<string, unknown>
    try { fullRows = typeof pData.wbsItems === 'string' ? JSON.parse(pData.wbsItems) : ((pData.wbsItems as Record<string, string>[]) || []) } catch { fullRows = [] }
  }
  if (!Array.isArray(fullRows)) fullRows = []
  return { planTask, fullRows, rows: stripWbsNotes(fullRows) }
}

/**
 * POST /api/production/work-orders/from-wbs-cell
 * body: { projectId, rowIndex, stageKey, teamCode?, isSub?, weight?, start?, finish?, klResolution? }
 * Phát hành 1 WO từ 1 Ô công đoạn WBS. Sửa trọng lượng/xưởng/ngày → ghi ngược vào WBS (KL ghi CẢ dòng hạng mục).
 * KL đổi + hạng mục đã có WO phát hành (KL cũ) → trả needsKlDecision để client hỏi Sửa/Xóa; rồi gọi lại kèm klResolution.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền phát hành WO', 403)

    const body = await req.json().catch(() => ({})) as Body
    const { projectId, stageKey } = body
    const rowIndex = Number(body.rowIndex)
    if (!projectId || !stageKey || !Number.isInteger(rowIndex) || rowIndex < 0) return errorResponse('Thiếu projectId / rowIndex / stageKey', 400)
    if (!WBS_STAGE_LABEL[stageKey]) return errorResponse(`Công đoạn không hợp lệ: ${stageKey}`, 400)

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectCode: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    const { planTask, fullRows, rows } = await readWbs(projectId)
    const row = rows[rowIndex] || null
    if (!row) return errorResponse('Không tìm thấy hạng mục WBS tương ứng', 404)

    // ── Giá trị cuối: ưu tiên override, else từ WBS ──
    let cellStr: string
    if (body.teamCode !== undefined || body.isSub !== undefined) {
      const tc = String(body.teamCode || '').trim(); const sub = !!body.isSub
      cellStr = sub ? (tc && tc.toUpperCase() !== 'THAUPHU' ? `${tc} Thầu phụ` : 'Thầu phụ') : tc
    } else cellStr = String(row[stageKey] ?? '').trim()
    if (!cellStr) return errorResponse('Chưa chọn xưởng cho ô này — không phát hành được WO', 400)
    const { teamCode, isSub } = normWorkshop(cellStr)
    if (!teamCode) return errorResponse(`Ô không xác định được xưởng: "${cellStr}"`, 400)

    const weightNum = body.weight !== undefined && body.weight !== null && body.weight !== '' ? Number(body.weight) : Number(row.khoiLuong)
    const startStr = body.start !== undefined ? String(body.start || '').trim() : String(row[`${stageKey}Start`] || '')
    const finishStr = body.finish !== undefined ? String(body.finish || '').trim() : String(row[`${stageKey}Finish`] || '')

    const hangMuc = String(row.hangMuc ?? '').trim() || `Dòng ${rowIndex + 1}`
    const stageLabel = WBS_STAGE_LABEL[stageKey]
    const woCode = woCodeFor(project.projectCode, hangMuc, stageKey)

    // Ô đã phát hành: mode='update' → SỬA WO đó; không thì trả WO cũ (client dùng DELETE để xóa/mở lại).
    const existing = await prisma.workOrder.findUnique({ where: { woCode }, select: { id: true, woCode: true } })
    const isUpdate = body.mode === 'update' && !!existing
    if (existing && !isUpdate) return successResponse({ workOrder: existing, existing: true }, `Ô này đã phát hành WO ${existing.woCode}`)

    const dept = teamCode !== 'THAUPHU' ? await prisma.department.findFirst({ where: { code: teamCode }, select: { id: true } }) : null

    // ── XUNG ĐỘT KL: KL là của CẢ hạng mục. Sửa KL khác cũ + hạng mục đã có WO phát hành (KL cũ) → cần quyết định ──
    const oldKl = Number(row.khoiLuong) || 0
    const klChanged = Number.isFinite(weightNum) && weightNum > 0 && Math.abs(weightNum - oldKl) > 0.0001
    let siblings: Array<{ id: string; woCode: string; teamCode: string; plannedWeight: number; hasProduction: boolean }> = []
    if (klChanged) {
      const sibs = await prisma.workOrder.findMany({
        where: { projectId, pieceMark: hangMuc, woCode: { not: woCode } },
        select: { id: true, woCode: true, teamCode: true, plannedWeight: true, _count: { select: { jobCards: true, materialIssues: true, deliveries: true } } },
      })
      siblings = sibs.filter(s => Math.abs(Number(s.plannedWeight ?? 0) - weightNum) > 0.0001)
        .map(s => ({ id: s.id, woCode: s.woCode, teamCode: s.teamCode, plannedWeight: Number(s.plannedWeight ?? 0), hasProduction: (s._count.jobCards + s._count.materialIssues + s._count.deliveries) > 0 }))
    }
    const klRes = body.klResolution
    if (siblings.length > 0 && !klRes) {
      return successResponse({ needsKlDecision: true, oldKl, newKl: weightNum, siblings }, 'Cần xác nhận xử lý WO đã phát hành của hạng mục')
    }
    if (siblings.length > 0 && klRes === 'delete') {
      const blocked = siblings.filter(s => s.hasProduction)
      if (blocked.length) return errorResponse(`Không xóa được WO đã có báo cáo SX / cấp vật tư: ${blocked.map(s => s.woCode).join(', ')}. Hãy chọn "Cập nhật KL" thay vì xóa.`, 409)
    }

    // ── Ghi ngược WBS (KL ghi CẢ dòng hạng mục) ──
    let newResultData: Record<string, unknown> | undefined
    if (planTask && fullRows[rowIndex] && String(fullRows[rowIndex].hangMuc || '').trim() === hangMuc) {
      const t = { ...fullRows[rowIndex] }
      t[stageKey] = cellStr
      if (Number.isFinite(weightNum)) t.khoiLuong = String(weightNum)
      t[`${stageKey}Start`] = startStr
      t[`${stageKey}Finish`] = finishStr
      const updated = [...fullRows]; updated[rowIndex] = t
      newResultData = { ...(planTask.resultData as Record<string, unknown>), wbsItems: JSON.stringify(updated) }
    }

    const woData = {
      description: `${hangMuc} — ${stageLabel}${isSub ? ' (Thầu phụ)' : ''}`,
      teamCode, woType: isSub ? 'EXTERNAL' : 'INTERNAL',
      plannedWeight: Number.isFinite(weightNum) && weightNum > 0 ? weightNum : null,
      plannedStart: toDate(startStr), plannedEnd: toDate(finishStr), departmentId: dept?.id || null,
    }
    const wo = await prisma.$transaction(async (tx) => {
      const saved = isUpdate
        ? await tx.workOrder.update({ where: { id: existing!.id }, data: woData, select: { id: true, woCode: true, teamCode: true, description: true } })
        : await tx.workOrder.create({ data: { woCode, projectId, pieceMark: hangMuc, createdBy: payload.userId, ...woData }, select: { id: true, woCode: true, teamCode: true, description: true } })
      if (newResultData && planTask) await tx.task.update({ where: { id: planTask.id }, data: { resultData: newResultData as Prisma.InputJsonValue } })
      // Đồng bộ KL cho các WO đã phát hành của hạng mục
      if (siblings.length > 0 && klRes === 'update') await tx.workOrder.updateMany({ where: { id: { in: siblings.map(s => s.id) } }, data: { plannedWeight: weightNum } })
      else if (siblings.length > 0 && klRes === 'delete') await tx.workOrder.deleteMany({ where: { id: { in: siblings.map(s => s.id) } } })
      return saved
    })
    const extra = klRes === 'update' ? ` · cập nhật KL ${siblings.length} WO` : klRes === 'delete' ? ` · xóa ${siblings.length} WO cũ` : ''
    const verb = isUpdate ? 'Đã cập nhật' : 'Đã phát hành'
    return successResponse({ workOrder: wo, updated: isUpdate, wbsUpdated: !!newResultData, klSynced: klRes === 'update' ? siblings.length : 0, klDeleted: klRes === 'delete' ? siblings.length : 0 }, `${verb} WO ${wo.woCode}${extra}`, isUpdate ? 200 : 201)
  } catch (err) {
    console.error('POST from-wbs-cell error:', err)
    return errorResponse('Lỗi phát hành WO từ WBS', 500)
  }
}

/**
 * DELETE /api/production/work-orders/from-wbs-cell  body: { projectId, rowIndex, stageKey }
 * Xóa WO của 1 ô → ô trở về "chưa phát hành" (mở lại). Chặn nếu WO đã có báo cáo SX / cấp vật tư.
 */
export async function DELETE(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền xóa WO', 403)

    const body = await req.json().catch(() => ({})) as { projectId?: string; rowIndex?: number; stageKey?: string }
    const { projectId, stageKey } = body
    const rowIndex = Number(body.rowIndex)
    if (!projectId || !stageKey || !Number.isInteger(rowIndex) || rowIndex < 0) return errorResponse('Thiếu projectId / rowIndex / stageKey', 400)
    if (!WBS_STAGE_LABEL[stageKey]) return errorResponse(`Công đoạn không hợp lệ: ${stageKey}`, 400)

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)
    const { rows } = await readWbs(projectId)
    const row = rows[rowIndex]
    if (!row) return errorResponse('Không tìm thấy hạng mục WBS', 404)

    const hangMuc = String(row.hangMuc ?? '').trim() || `Dòng ${rowIndex + 1}`
    const woCode = woCodeFor(project.projectCode, hangMuc, stageKey)
    const wo = await prisma.workOrder.findUnique({ where: { woCode }, select: { id: true, _count: { select: { jobCards: true, materialIssues: true, deliveries: true } } } })
    if (!wo) return errorResponse('Ô này chưa phát hành WO', 404)
    if (wo._count.jobCards + wo._count.materialIssues + wo._count.deliveries > 0) return errorResponse('WO đã có báo cáo SX / cấp vật tư — không xóa được', 409)

    await prisma.workOrder.delete({ where: { id: wo.id } })
    return successResponse({ deleted: woCode }, `Đã xóa WO ${woCode} — ô đã mở lại`)
  } catch (err) {
    console.error('DELETE from-wbs-cell error:', err)
    return errorResponse('Lỗi xóa WO', 500)
  }
}
