import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { STAGE_WEIGHTS, STAGES_ORDERED } from '@/lib/production-weights'
import { stripWbsNotes } from '@/lib/wbs-parser'

// GET /api/production/progress — Fabrication progress by tons + piece-marks + 5-stage bar
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const departmentId = url.searchParams.get('departmentId') || undefined

  const woWhere: Record<string, unknown> = {}
  if (projectId) woWhere.projectId = projectId
  if (departmentId) woWhere.departmentId = departmentId

  const workOrders = await prisma.workOrder.findMany({
    where: woWhere,
    select: {
      id: true, woCode: true, pieceMark: true, status: true,
      plannedWeight: true, completedQty: true, earnedQty: true, teamCode: true,
      departmentId: true, projectId: true,
      project: { select: { projectCode: true } },
    },
  })

  // ── Gom nhóm theo HẠNG MỤC = (dự án + piece-mark) ────────────────────────────────────────────
  // Nhiều WO cùng (dự án + piece-mark) là các CÔNG ĐOẠN (cắt/chế tạo/hoàn thiện…) làm cho CÙNG MỘT
  // khối lượng vật chất → KHÔNG cộng dồn tấn. Mỗi nhóm tính MỘT LẦN, lấy giá trị đại diện = max
  // (khối lượng các công đoạn vốn bằng nhau; completed/earned lấy công đoạn xa nhất → % không vượt 100).
  // WO không có piece-mark: mỗi WO là 1 nhóm riêng (không gộp vì không biết có cùng hạng mục hay không).
  type Grp = { planned: number; completed: number; earned: number; allCompleted: boolean; hasPieceMark: boolean }
  const groups = new Map<string, Grp>()
  for (const w of workOrders) {
    const key = w.pieceMark ? `${w.projectId ?? ''}|${w.pieceMark}` : `wo:${w.id}`
    const g = groups.get(key) ?? { planned: 0, completed: 0, earned: 0, allCompleted: true, hasPieceMark: !!w.pieceMark }
    g.planned = Math.max(g.planned, Number(w.plannedWeight) || 0)
    g.completed = Math.max(g.completed, Number(w.completedQty) || 0)
    g.earned = Math.max(g.earned, Number(w.earnedQty) || 0)
    g.allCompleted = g.allCompleted && w.status === 'COMPLETED'
    groups.set(key, g)
  }
  const groupList = [...groups.values()]
  const pmGroups = groupList.filter(g => g.hasPieceMark)

  // Khi LỌC THEO DỰ ÁN: TỔNG TẤN + tổng hạng mục lấy theo WBS (tổng khối lượng các hạng mục import ở P1.2A),
  // KHÔNG cộng dồn plannedWeight của WO. Không lọc dự án → giữ cách gộp theo WO như cũ.
  let wbsTotalKg: number | null = null
  let wbsPieceMarks: number | null = null
  if (projectId) {
    const planTask = await prisma.task.findFirst({ where: { projectId, taskType: 'P1.2A' }, select: { resultData: true }, orderBy: { createdAt: 'desc' } })
    let wbsRows: Record<string, string>[] = []
    if (planTask?.resultData) {
      const pData = planTask.resultData as Record<string, unknown>
      try { wbsRows = typeof pData.wbsItems === 'string' ? JSON.parse(pData.wbsItems) : ((pData.wbsItems as Record<string, string>[]) || []) } catch { wbsRows = [] }
    }
    const clean = stripWbsNotes(Array.isArray(wbsRows) ? wbsRows : [])
    const klOf = (r: Record<string, string>) => Number(r.khoiLuong) || 0
    const isUnitRow = (r: Record<string, string>) => /^\s*unit\b/i.test(String(r.hangMuc || ''))    // dòng TỔNG cấp UNIT
    const isKhungKien = (r: Record<string, string>) => /khung ki[eệ]n/i.test(String(r.hangMuc || '')) // đóng kiện — không phải sản phẩm
    const unitRows = clean.filter(r => isUnitRow(r) && klOf(r) > 0)
    // TỔNG TẤN = tổng KL trên các dòng UNIT (số tổng có sẵn của file — đã loại Chế tạo khung kiện, không cộng dòng con).
    // WBS không có dòng UNIT (danh sách phẳng) → fallback: cộng dòng có KL, bỏ Chế tạo khung kiện.
    wbsTotalKg = unitRows.length > 0
      ? unitRows.reduce((s, r) => s + klOf(r), 0)
      : clean.filter(r => klOf(r) > 0 && !isKhungKien(r)).reduce((s, r) => s + klOf(r), 0)
    // Số hạng mục SẢN PHẨM = dòng có KL, KHÔNG phải dòng UNIT, KHÔNG phải Chế tạo khung kiện.
    wbsPieceMarks = clean.filter(r => klOf(r) > 0 && !isUnitRow(r) && !isKhungKien(r)).length
  }

  const totalPieceMarks = wbsPieceMarks ?? pmGroups.length
  const completedPieceMarks = pmGroups.filter(g => g.allCompleted).length  // hạng mục xong khi MỌI công đoạn đã COMPLETED
  const earnedPieceMarks = pmGroups.filter(g => g.earned > 0).length

  const totalKg = wbsTotalKg ?? groupList.reduce((s, g) => s + g.planned, 0)
  const completedKg = groupList.reduce((s, g) => s + g.completed, 0)
  const earnedKg = groupList.reduce((s, g) => s + g.earned, 0)

  const totalTons = totalKg / 1000
  const completedTons = completedKg / 1000
  const earnedTons = earnedKg / 1000

  const woIds = workOrders.map(w => w.id)

  const jobCards = await prisma.jobCard.findMany({
    where: { workOrderId: { in: woIds }, status: { not: 'CANCELLED' } },
    select: { workType: true, actualQty: true, status: true, workDate: true },
  })

  const stageProgress = STAGES_ORDERED.map(stage => {
    const cards = jobCards.filter(jc => jc.workType === stage)
    const completed = cards.filter(jc => jc.status === 'COMPLETED')
    const totalQty = cards.reduce((s, jc) => s + (Number(jc.actualQty) || 0), 0)
    return {
      stage,
      weight: STAGE_WEIGHTS[stage] || 0,
      totalCards: cards.length,
      completedCards: completed.length,
      totalQty: Math.round(totalQty * 100) / 100,
      pct: cards.length > 0 ? Math.round((completed.length / cards.length) * 100) : 0,
    }
  })

  const dailyOutput = jobCards
    .filter(jc => jc.status === 'COMPLETED' && jc.actualQty)
    .reduce((s, jc) => s + Number(jc.actualQty), 0)

  return successResponse({
    summary: {
      totalTons: Math.round(totalTons * 100) / 100,
      completedTons: Math.round(completedTons * 100) / 100,
      earnedTons: Math.round(earnedTons * 100) / 100,
      tonsPct: totalTons > 0 ? Math.round((completedTons / totalTons) * 100) : 0,
      earnedPct: totalTons > 0 ? Math.round((earnedTons / totalTons) * 100) : 0,
      totalPieceMarks,
      completedPieceMarks,
      earnedPieceMarks,
      pieceMarkPct: totalPieceMarks > 0 ? Math.round((completedPieceMarks / totalPieceMarks) * 100) : 0,
    },
    stages: stageProgress,
    dailyOutputKg: Math.round(dailyOutput * 100) / 100,
    workOrderCount: workOrders.length,
  })
}
