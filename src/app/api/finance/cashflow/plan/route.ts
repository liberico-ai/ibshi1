import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    // Check roles (only treasury/finance + PMs)
    const allowedRoles = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a']
    if (!allowedRoles.includes(user.roleCode)) {
      return errorResponse('Forbidden. Role not allowed.', 403)
    }

    const { projectId, customerId, scopeDescription, contractValue, budgetLines, monthlyCashflows } = await req.json()

    if (!projectId) {
      return errorResponse('projectId is required', 400)
    }

    // Run transaction to replace whole plan
    const result = await prisma.$transaction(async (tx) => {
      // 1. Find or create plan
      let plan = await tx.projectFinancePlan.findUnique({ where: { projectId } })
      
      if (!plan) {
        plan = await tx.projectFinancePlan.create({
          data: {
            projectId,
            customerId: customerId || null,
            scopeDescription: scopeDescription || null,
            contractValue: contractValue || null,
            status: 'ACTIVE'
          }
        })
      } else {
        // Update master
        plan = await tx.projectFinancePlan.update({
          where: { id: plan.id },
          data: {
            customerId: customerId || null,
            scopeDescription: scopeDescription || null,
            contractValue: contractValue || null,
            status: 'ACTIVE'
          }
        })
        
        // Delete old budgets and cashflows to override
        await tx.projectBudgetLine.deleteMany({ where: { planId: plan.id } })
        await tx.projectCashflowMonthly.deleteMany({ where: { planId: plan.id } })
      }

      // 2. Insert new budgetLines
      if (budgetLines && budgetLines.length > 0) {
        await tx.projectBudgetLine.createMany({
          data: budgetLines.map((b: any) => ({
            planId: plan!.id,
            sectionType: b.sectionType,
            categoryCode: b.categoryCode,
            itemName: b.itemName,
            unit: b.unit || null,
            quantity: b.quantity ? Number(b.quantity) : null,
            unitPrice: b.unitPrice ? Number(b.unitPrice) : null,
            totalBudget: Number(b.totalBudget) || 0
          }))
        })
      }

      // 3. Insert new monthly cashflows
      if (monthlyCashflows && monthlyCashflows.length > 0) {
        await tx.projectCashflowMonthly.createMany({
          data: monthlyCashflows.map((m: any) => ({
            planId: plan!.id,
            month: m.month,
            year: m.year,
            amountVnd: Number(m.amountVnd) || 0,
            category: m.category,
            notes: m.notes || null
          }))
        })
      }

      return plan
    })

    return successResponse({ plan: result })

  } catch (err: any) {
    console.error('Save Finance Plan error:', err)
    return errorResponse('Lỗi hệ thống khi lưu kế hoạch tài chính', 500)
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      const plans = await prisma.projectFinancePlan.findMany({
        include: { project: true }
      })
      return successResponse({ plans })
    }

    const plan = await prisma.projectFinancePlan.findUnique({
      where: { projectId },
      include: {
        budgetLines: true,
        monthlyCashflows: { orderBy: [{ year: 'asc' }, { month: 'asc' }] },
        project: true
      }
    })

    return successResponse({ plan })

  } catch (err: any) {
    return errorResponse('Lỗi hệ thống khi tải kế hoạch tài chính', 500)
  }
}
