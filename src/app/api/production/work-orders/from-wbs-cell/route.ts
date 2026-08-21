import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { WBS_STAGE_LABEL, woCodeFor, pieceMarkFor, unitTagForRow, allocTags, allocCellStr } from '@/lib/wbs-wo'
import { canManageProjectWo, notProjectPmError } from '@/lib/project-access'
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

interface AllocIn { teamCode?: string; isSub?: boolean; weight?: number | string; start?: string; finish?: string }
interface Body {
  projectId?: string; rowIndex?: number; stageKey?: string
  // Danh sách phân giao xưởng cho ô công đoạn (mỗi xưởng 1 WO). Tương thích ngược: nếu thiếu, dùng 1 xưởng đơn từ các trường dưới.
  allocations?: AllocIn[]
  teamCode?: string; isSub?: boolean; weight?: number | string; start?: string; finish?: string
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
 * body: { projectId, rowIndex, stageKey, allocations: [{teamCode,isSub,weight,start,finish}] }
 * ÁP phân giao 1 Ô công đoạn WBS cho NHIỀU xưởng → mỗi xưởng 1 WO riêng (mã kèm xưởng).
 * Tạo/cập nhật WO cho từng xưởng trong danh sách; XÓA WO của xưởng đã bỏ khỏi danh sách
 * (trừ WO đã có báo cáo SX). Ghi ngược danh sách vào WBS: `{stageKey}Alloc` (JSON) + {stageKey} (xưởng đầu).
 * KL cột trái (khoiLuong) chỉ là tham chiếu — KHÔNG bị ghi đè.
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

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectCode: true, pmUserId: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)
    if (!canManageProjectWo(payload.roleCode, payload.userId, project.pmUserId)) return errorResponse(notProjectPmError(project.pmUserId), 403)

    const { planTask, fullRows, rows } = await readWbs(projectId)
    const row = rows[rowIndex] || null
    if (!row) return errorResponse('Không tìm thấy hạng mục WBS tương ứng', 404)

    const hangMuc = String(row.hangMuc ?? '').trim() || `Dòng ${rowIndex + 1}`
    const stageLabel = WBS_STAGE_LABEL[stageKey]
    const unitTag = unitTagForRow(rows, rowIndex)
    const stt = String(row.stt ?? '').trim()
    const pieceMark = pieceMarkFor(hangMuc, unitTag)
    const baseWeight = String(row.khoiLuong ?? '') // KL mặc định khi 1 xưởng để trống

    // ── Danh sách phân giao xưởng (mảng allocations, else 1 xưởng đơn từ trường cũ) ──
    const rawAllocs: AllocIn[] = Array.isArray(body.allocations) && body.allocations.length
      ? body.allocations
      : [{ teamCode: body.teamCode, isSub: body.isSub, weight: body.weight, start: body.start, finish: body.finish }]

    const norm = (a: AllocIn) => {
      const teamCode = String(a.teamCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      const isSub = !!a.isSub
      const wNum = a.weight !== undefined && a.weight !== null && a.weight !== '' ? Number(a.weight) : Number(baseWeight)
      const weight = Number.isFinite(wNum) && wNum > 0 ? String(wNum) : ''
      return { teamCode, isSub, weight, start: String(a.start || '').trim(), finish: String(a.finish || '').trim() }
    }
    const allocs = rawAllocs.map(norm).filter(a => a.teamCode || a.isSub) // bỏ dòng trống
    if (allocs.length === 0) return errorResponse('Chưa chọn xưởng nào — không phát hành được WO', 400)
    // CHO PHÉP trùng xưởng: tag lần 2+ tự thêm số ('XPC', 'XPC2'…) → mỗi dòng vẫn 1 WO riêng.
    const tags = allocTags(allocs)

    // WO của từng xưởng + dept
    const codes = allocs.map((a, i) => woCodeFor(project.projectCode, hangMuc, stageKey, unitTag, stt, tags[i]))
    const deptCodes = [...new Set(allocs.filter(a => a.teamCode).map(a => a.teamCode))]
    const depts = deptCodes.length ? await prisma.department.findMany({ where: { code: { in: deptCodes } }, select: { id: true, code: true } }) : []
    const deptByCode = new Map(depts.map(d => [d.code, d.id]))

    const cellPrefix = woCodeFor(project.projectCode, hangMuc, stageKey, unitTag, stt) + '-' // tiền tố chung mọi WO của ô
    const existingCellWos = await prisma.workOrder.findMany({
      where: { projectId, woCode: { startsWith: cellPrefix } },
      select: { id: true, woCode: true, _count: { select: { jobCards: true, materialIssues: true, deliveries: true } } },
    })
    const keepTags = new Set(tags)
    const toDelete = existingCellWos.filter(w => !keepTags.has(w.woCode.slice(cellPrefix.length)))
    const blocked = toDelete.filter(w => w._count.jobCards + w._count.materialIssues + w._count.deliveries > 0)
    const delIds = toDelete.filter(w => !blocked.includes(w)).map(w => w.id)

    // ── Ghi ngược WBS: {stageKey}Alloc (JSON) + {stageKey} (xưởng đầu, tương thích) ──
    let newResultData: Record<string, unknown> | undefined
    if (planTask && fullRows[rowIndex] && String(fullRows[rowIndex].hangMuc || '').trim() === hangMuc) {
      const t = { ...fullRows[rowIndex] }
      t[`${stageKey}Alloc`] = JSON.stringify(allocs)
      t[stageKey] = allocCellStr(allocs[0])
      t[`${stageKey}Weight`] = allocs[0].weight
      t[`${stageKey}Start`] = allocs[0].start
      t[`${stageKey}Finish`] = allocs[0].finish
      const updated = [...fullRows]; updated[rowIndex] = t
      newResultData = { ...(planTask.resultData as Record<string, unknown>), wbsItems: JSON.stringify(updated) }
    }

    let created = 0, updatedN = 0
    // id + mã WO của từng dòng phân giao (theo đúng thứ tự allocations) → FE gắn đề nghị
    // cấp vật tư vào đúng WO ngay sau khi phát hành.
    const woRefs: { index: number; id: string; woCode: string; teamCode: string }[] = []
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < allocs.length; i++) {
        const a = allocs[i]
        const wNum = Number(a.weight)
        const woData = {
          description: `${pieceMark} — ${stageLabel}${a.isSub ? ' (Thầu phụ)' : ''}${allocs.length > 1 ? ` · ${a.teamCode || 'Thầu phụ'}` : ''}`,
          teamCode: a.teamCode || (a.isSub ? 'THAUPHU' : ''), woType: a.isSub ? 'EXTERNAL' : 'INTERNAL',
          plannedWeight: Number.isFinite(wNum) && wNum > 0 ? wNum : null,
          plannedStart: toDate(a.start), plannedEnd: toDate(a.finish), departmentId: a.teamCode ? deptByCode.get(a.teamCode) || null : null,
        }
        const ex = await tx.workOrder.findUnique({ where: { woCode: codes[i] }, select: { id: true } })
        if (ex) {
          await tx.workOrder.update({ where: { id: ex.id }, data: woData }); updatedN++
          woRefs.push({ index: i, id: ex.id, woCode: codes[i], teamCode: woData.teamCode })
        } else {
          const nw = await tx.workOrder.create({ data: { woCode: codes[i], projectId, pieceMark, createdBy: payload.userId, ...woData }, select: { id: true } })
          created++
          woRefs.push({ index: i, id: nw.id, woCode: codes[i], teamCode: woData.teamCode })
        }
      }
      if (delIds.length) await tx.workOrder.deleteMany({ where: { id: { in: delIds } } })
      if (newResultData && planTask) await tx.task.update({ where: { id: planTask.id }, data: { resultData: newResultData as Prisma.InputJsonValue } })
    })

    const extra = delIds.length ? ` · xóa ${delIds.length} WO xưởng đã bỏ` : ''
    const blockedMsg = blocked.length ? ` (${blocked.length} WO đã có SX không xóa được)` : ''
    return successResponse(
      { total: allocs.length, created, updated: updatedN, deleted: delIds.length, blocked: blocked.map(w => w.woCode), wbsUpdated: !!newResultData, workOrders: woRefs },
      `Đã áp ${allocs.length} phân giao (tạo ${created}, cập nhật ${updatedN})${extra}${blockedMsg}`,
      created > 0 && updatedN === 0 ? 201 : 200,
    )
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

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, pmUserId: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)
    if (!canManageProjectWo(payload.roleCode, payload.userId, project.pmUserId)) return errorResponse(notProjectPmError(project.pmUserId), 403)
    const { rows } = await readWbs(projectId)
    const row = rows[rowIndex]
    if (!row) return errorResponse('Không tìm thấy hạng mục WBS', 404)

    const hangMuc = String(row.hangMuc ?? '').trim() || `Dòng ${rowIndex + 1}`
    // Xóa TẤT CẢ WO của ô (mọi xưởng) → tiền tố chung; chặn nếu có WO đã báo cáo SX.
    const cellPrefix = woCodeFor(project.projectCode, hangMuc, stageKey, unitTagForRow(rows, rowIndex), String(row.stt ?? '').trim()) + '-'
    const wos = await prisma.workOrder.findMany({ where: { projectId, woCode: { startsWith: cellPrefix } }, select: { id: true, woCode: true, _count: { select: { jobCards: true, materialIssues: true, deliveries: true } } } })
    if (wos.length === 0) return errorResponse('Ô này chưa phát hành WO', 404)
    const blocked = wos.filter(w => w._count.jobCards + w._count.materialIssues + w._count.deliveries > 0)
    if (blocked.length) return errorResponse(`WO đã có báo cáo SX / cấp vật tư — không xóa được: ${blocked.map(w => w.woCode).join(', ')}`, 409)

    await prisma.workOrder.deleteMany({ where: { id: { in: wos.map(w => w.id) } } })
    return successResponse({ deleted: wos.length }, `Đã xóa ${wos.length} WO — ô đã mở lại`)
  } catch (err) {
    console.error('DELETE from-wbs-cell error:', err)
    return errorResponse('Lỗi xóa WO', 500)
  }
}
