import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createBudgetSchema } from '@/lib/schemas'

// Map cashflow category to budget category
const catMap: Record<string, string> = {
  'MATERIAL_COST': 'MATERIAL',
  'LABOR_COST': 'LABOR',
  'EQUIPMENT_COST': 'EQUIPMENT',
  'SUBCONTRACT_COST': 'SUBCONTRACT',
  'OVERHEAD_COST': 'OVERHEAD',
}
const ALL_CATS = ['MATERIAL', 'LABOR', 'EQUIPMENT', 'SUBCONTRACT', 'OVERHEAD']

// GET /api/finance/budgets — project budgets with variance analysis
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    const pWhere = projectId ? { id: projectId } : { status: 'ACTIVE' }
    
    // Fetch base active projects
    const dbProjects = await prisma.project.findMany({
      where: pWhere,
      select: { id: true, projectCode: true, projectName: true, contractValue: true }
    })

    // Fetch manual budget inputs (planned)
    const bWhere = projectId ? { projectId } : {}
    const manualBudgets = await prisma.budget.findMany({ where: bWhere })

    // Fetch ACTUAL costs from CashflowEntry OUTFLOW
    // Since prisma.groupBy cannot group by relations, we group by projectId directly
    const cfRaw = await prisma.cashflowEntry.findMany({
      where: { type: 'OUTFLOW', projectId: { in: dbProjects.map(p => p.id) } },
      select: { projectId: true, category: true, amount: true }
    })
    const actualsMap: Record<string, Record<string, number>> = {}
    for (const row of cfRaw) {
       if (!row.projectId) continue;
       const bCat = catMap[row.category] || row.category // fallback map
       if (!actualsMap[row.projectId]) actualsMap[row.projectId] = {}
       if (!actualsMap[row.projectId][bCat]) actualsMap[row.projectId][bCat] = 0
       actualsMap[row.projectId][bCat] += Number(row.amount || 0)
    }

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

    // Fetch APPROVED budgets from P1.2 WorkflowTask (Dự toán được duyệt)
    const p12Tasks = await prisma.workflowTask.findMany({
      where: {
        projectId: { in: dbProjects.map(p => p.id) },
        stepCode: 'P1.2',
        status: { in: ['DONE', 'COMPLETED', 'APPROVED'] }
      },
      orderBy: { createdAt: 'desc' }
    });

    const p12BudgetsMap: Record<string, Record<string, number>> = {};
    const maCpToCat: Record<string, string> = {
      'I': 'MATERIAL',
      'II': 'LABOR',
      'III': 'EQUIPMENT',
      'IV': 'SUBCONTRACT',
      'V': 'OVERHEAD'
    };

    for (const p12 of p12Tasks) {
      if (!p12BudgetsMap[p12.projectId]) { // Only take the latest one (because of orderBy desc)
        p12BudgetsMap[p12.projectId] = {};
        try {
           const rd = p12.resultData as any;
           if (rd && rd.dt02Detail) {
              const dt02 = typeof rd.dt02Detail === 'string' ? JSON.parse(rd.dt02Detail) : rd.dt02Detail;
              for (const row of dt02) {
                 const mappedCat = maCpToCat[row.maCP];
                 if (mappedCat) {
                    p12BudgetsMap[p12.projectId][mappedCat] = Number(row.giaTri || 0);
                 }
              }
           }
        } catch (e) {
           console.error('Error parsing P1.2 dt02Detail', e);
        }
      }
    }

    const projectsRes = dbProjects.map(p => {
      const pid = p.id
      
      const pLaborCom = Number(laborCom.find(x => x.projectId === pid)?._sum?.contractValue || 0)
      const pSubCom = Number(subCom.find(x => x.projectId === pid)?._sum?.contractValue || 0)
      
      const categoriesList = ALL_CATS.map(cat => {
        // Find manual budget input if exists
        const mb = manualBudgets.find(b => b.projectId === pid && b.category === cat)
        
        let actual = actualsMap[pid]?.[cat] || 0
        let committed = 0
        
        // Auto-assign committed
        if (cat === 'LABOR') committed = pLaborCom
        else if (cat === 'SUBCONTRACT') committed = pSubCom

        // If manual budget provided actuals/committed, we might merge or prefer dynamic. We prefer dynamic.
        // Planned is from manual budget (if > 0) OR fallback to P1.2 approved budget
        let planned = (mb && Number(mb.planned) > 0) ? Number(mb.planned) : (p12BudgetsMap[pid]?.[cat] || 0)

        // For demo/UI sake if manual was typed but dynamic is 0 we can fallback, but dynamic should override
        if (actual === 0 && mb?.actual) actual = Number(mb.actual)
        if (committed === 0 && mb?.committed) committed = Number(mb.committed)

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

    const result = await validateBody(req, createBudgetSchema)
    if (!result.success) return result.response
    const { projectId, category, planned, actual, committed, forecast, month, year, notes } = result.data

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
