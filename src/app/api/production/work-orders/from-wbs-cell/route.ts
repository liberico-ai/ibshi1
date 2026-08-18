import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { WBS_STAGE_LABEL, normWorkshop, woCodeFor, pieceMarkFor, unitTagForRow } from '@/lib/wbs-wo'
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
 * body: { projectId, rowIndex, stageKey, teamCode?, isSub?, weight?, start?, finish?, mode? }
 * Phát hành 1 WO từ 1 Ô công đoạn WBS. Sửa trọng lượng/xưởng/ngày → ghi ngược vào WBS THEO Ô CÔNG ĐOẠN:
 * KL lưu riêng `{stageKey}Weight` (độc lập từng công đoạn), xưởng lưu `{stageKey}`, ngày lưu `{stageKey}Start/Finish`.
 * KL cột trái (khoiLuong) chỉ là tham chiếu/khởi tạo — KHÔNG bị ghi đè, không ảnh hưởng công đoạn khác.
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

    // KL ĐỘC LẬP THEO CÔNG ĐOẠN: ưu tiên override từ body, else KL riêng của ô (`{stageKey}Weight`),
    // else KL cột trái của hạng mục (khoiLuong) làm mặc định/khởi tạo. KHÔNG ghi đè khoiLuong.
    const stageWeightStr = String(row[`${stageKey}Weight`] ?? '').trim()
    const baseWeight = stageWeightStr || String(row.khoiLuong ?? '')
    const weightNum = body.weight !== undefined && body.weight !== null && body.weight !== '' ? Number(body.weight) : Number(baseWeight)
    const startStr = body.start !== undefined ? String(body.start || '').trim() : String(row[`${stageKey}Start`] || '')
    const finishStr = body.finish !== undefined ? String(body.finish || '').trim() : String(row[`${stageKey}Finish`] || '')

    const hangMuc = String(row.hangMuc ?? '').trim() || `Dòng ${rowIndex + 1}`
    const stageLabel = WBS_STAGE_LABEL[stageKey]
    // UNIT + STT của dòng → mỗi dòng WBS = 1 WO (không đụng nhau kể cả trùng piece-mark trong cùng UNIT).
    const unitTag = unitTagForRow(rows, rowIndex)
    const stt = String(row.stt ?? '').trim()
    const pieceMark = pieceMarkFor(hangMuc, unitTag)
    const woCode = woCodeFor(project.projectCode, hangMuc, stageKey, unitTag, stt)

    // Ô đã phát hành: mode='update' → SỬA WO đó; không thì trả WO cũ (client dùng DELETE để xóa/mở lại).
    const existing = await prisma.workOrder.findUnique({ where: { woCode }, select: { id: true, woCode: true } })
    const isUpdate = body.mode === 'update' && !!existing
    if (existing && !isUpdate) return successResponse({ workOrder: existing, existing: true }, `Ô này đã phát hành WO ${existing.woCode}`)

    const dept = teamCode !== 'THAUPHU' ? await prisma.department.findFirst({ where: { code: teamCode }, select: { id: true } }) : null

    // ── Ghi ngược WBS: KL ghi RIÊNG cho ô công đoạn (`{stageKey}Weight`), KHÔNG đụng khoiLuong (cột trái = tham chiếu gốc) ──
    let newResultData: Record<string, unknown> | undefined
    if (planTask && fullRows[rowIndex] && String(fullRows[rowIndex].hangMuc || '').trim() === hangMuc) {
      const t = { ...fullRows[rowIndex] }
      t[stageKey] = cellStr
      if (Number.isFinite(weightNum)) t[`${stageKey}Weight`] = String(weightNum)
      t[`${stageKey}Start`] = startStr
      t[`${stageKey}Finish`] = finishStr
      const updated = [...fullRows]; updated[rowIndex] = t
      newResultData = { ...(planTask.resultData as Record<string, unknown>), wbsItems: JSON.stringify(updated) }
    }

    const woData = {
      description: `${pieceMark} — ${stageLabel}${isSub ? ' (Thầu phụ)' : ''}`,
      teamCode, woType: isSub ? 'EXTERNAL' : 'INTERNAL',
      plannedWeight: Number.isFinite(weightNum) && weightNum > 0 ? weightNum : null,
      plannedStart: toDate(startStr), plannedEnd: toDate(finishStr), departmentId: dept?.id || null,
    }
    const wo = await prisma.$transaction(async (tx) => {
      const saved = isUpdate
        ? await tx.workOrder.update({ where: { id: existing!.id }, data: woData, select: { id: true, woCode: true, teamCode: true, description: true } })
        : await tx.workOrder.create({ data: { woCode, projectId, pieceMark, createdBy: payload.userId, ...woData }, select: { id: true, woCode: true, teamCode: true, description: true } })
      if (newResultData && planTask) await tx.task.update({ where: { id: planTask.id }, data: { resultData: newResultData as Prisma.InputJsonValue } })
      return saved
    })
    const verb = isUpdate ? 'Đã cập nhật' : 'Đã phát hành'
    return successResponse({ workOrder: wo, updated: isUpdate, wbsUpdated: !!newResultData }, `${verb} WO ${wo.woCode}`, isUpdate ? 200 : 201)
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
    const woCode = woCodeFor(project.projectCode, hangMuc, stageKey, unitTagForRow(rows, rowIndex), String(row.stt ?? '').trim())
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
