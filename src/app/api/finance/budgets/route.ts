import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, getUserProjectIds } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createBudgetSchema } from '@/lib/schemas'
import { FINANCE_WRITE_ROLES } from '@/lib/constants'

// 4 nhóm DTTC → Budget.category: VAT_TU→MATERIAL, NHAN_CONG→LABOR, DICH_VU→SERVICE, CHI_PHI_CHUNG→OVERHEAD.
// SERVICE bắt buộc có mặt, nếu thiếu thì dòng ngân sách DỊCH_VỤ (DICH_VU) bị rơi khỏi bảng + tổng hợp.
const ALL_CATS = ['MATERIAL', 'LABOR', 'SERVICE', 'EQUIPMENT', 'SUBCONTRACT', 'OVERHEAD']

// GET /api/finance/budgets — project budgets with variance analysis
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    const userProjectIds = await getUserProjectIds(user)
    const idFilter = userProjectIds !== null ? { id: { in: userProjectIds } } : {}
    const pWhere = projectId
      ? { id: projectId, ...idFilter }
      : { status: 'ACTIVE' as const, ...idFilter }
    
    // Fetch base active projects
    const dbProjects = await prisma.project.findMany({
      where: pWhere,
      select: { id: true, projectCode: true, projectName: true, contractValue: true }
    })

    // Fetch budget records (planned, actual, committed written by sync hooks)
    const bWhere = projectId ? { projectId } : {}
    const manualBudgets = await prisma.budget.findMany({ where: bWhere })

    // Fetch COMMITTED LABOR (PieceRate)
    const laborCom = await prisma.pieceRateContract.groupBy({
      by: ['projectId'], _sum: { contractValue: true },
      where: { projectId: { in: dbProjects.map(p => p.id) } }
    })

    // Fetch COMMITTED SUBCONTRACT (Subcontractor)
    const subCom = await prisma.subcontractorContract.groupBy({
      by: ['projectId'], _sum: { contractValue: true },
      where: { projectId: { in: dbProjects.map(p => p.id) } }
    })

    // DEPRECATED: legacy WorkflowTask, đã ngừng dùng
    // P1.2 approved-budget fetch was here but workflowTask table is dead.
    // Budget planned values now come from the Budget table only.
    const p12BudgetsMap: Record<string, Record<string, number>> = {};

    const projectsRes = dbProjects.map(p => {
      const pid = p.id
      
      const pLaborCom = Number(laborCom.find(x => x.projectId === pid)?._sum?.contractValue || 0)
      const pSubCom = Number(subCom.find(x => x.projectId === pid)?._sum?.contractValue || 0)
      
      const categoriesList = ALL_CATS.map(cat => {
        const mb = manualBudgets.find(b => b.projectId === pid && b.category === cat)

        const planned = (mb && Number(mb.planned) > 0) ? Number(mb.planned) : (p12BudgetsMap[pid]?.[cat] || 0)
        const actual = mb ? Number(mb.actual) : 0

        let committed = mb ? Number(mb.committed) : 0
        if (cat === 'LABOR') committed = pLaborCom || committed
        else if (cat === 'SUBCONTRACT') committed = pSubCom || committed

        return {
          id: mb?.id || `${pid}-${cat}`,
          category: cat,
          planned,
          actual,
          committed,
          forecast: Number(mb?.forecast || 0),
          notes: mb?.notes || null
        }
      })

      const totalPlanned = categoriesList.reduce((s, c) => s + c.planned, 0)
      const totalActual = categoriesList.reduce((s, c) => s + c.actual, 0)
      const totalCommitted = categoriesList.reduce((s, c) => s + c.committed, 0)

      return {
        projectId: pid,
        projectCode: p.projectCode,
        projectName: p.projectName,
        contractValue: Number(p.contractValue || 0),
        categories: categoriesList,
        totalPlanned,
        totalActual,
        totalCommitted,
        variance: totalPlanned - totalActual,
        variancePct: totalPlanned > 0 ? Math.round((totalPlanned - totalActual) / totalPlanned * 100) : 0,
      }
    })

    const totals = {
      planned: projectsRes.reduce((s, p) => s + p.totalPlanned, 0),
      actual: projectsRes.reduce((s, p) => s + p.totalActual, 0),
      committed: projectsRes.reduce((s, p) => s + p.totalCommitted, 0),
    }

    return successResponse({ projects: projectsRes, totals })
  } catch (err) {
    console.error('GET /api/finance/budgets error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/budgets — create/update budget entry
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(FINANCE_WRITE_ROLES as readonly string[]).includes(user.roleCode)) return forbiddenResponse('Không có quyền ghi tài chính')

    const result = await validateBody(req, createBudgetSchema)
    if (!result.success) return result.response
    const { projectId, category, planned, actual, committed, forecast, month, year, notes } = result.data

    const userProjectIds = await getUserProjectIds(user)
    if (userProjectIds && !userProjectIds.includes(projectId)) {
      return errorResponse('Không có quyền ghi ngân sách cho dự án này', 403)
    }

    const budget = await prisma.budget.upsert({
      where: {
        projectId_category_month_year: {
          projectId,
          category,
          month: month ?? 0,
          year: year ?? 0,
        },
      },
      create: {
        projectId,
        category,
        planned,
        actual,
        committed,
        forecast,
        month: month ?? null,
        year: year ?? null,
        notes,
      },
      update: {
        planned,
        actual,
        committed,
        forecast,
        notes,
      },
    })

    return successResponse({ budget }, 'Cập nhật ngân sách thành công')
  } catch (err) {
    console.error('POST /api/finance/budgets error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
