import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/reports/executive — Executive KPI summary across all modules
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const month = Number(searchParams.get('month')) || 0 // 0 = full year

    // Projects
    const projects = await prisma.project.findMany({
      select: { id: true, status: true, contractValue: true },
    })
    const projectStats = {
      total: projects.length,
      active: projects.filter(p => p.status === 'ACTIVE').length,
      completed: projects.filter(p => p.status === 'COMPLETED').length,
      totalValue: projects.reduce((s, p) => s + Number(p.contractValue || 0), 0),
    }

    // Tasks
    const tasks = await prisma.workflowTask.findMany({
      select: { status: true },
    })
    const taskStats = {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'COMPLETED').length,
      inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
      pending: tasks.filter(t => t.status === 'PENDING').length,
      completionRate: tasks.length > 0
        ? Math.round(tasks.filter(t => t.status === 'COMPLETED').length / tasks.length * 100)
        : 0,
    }

    // Warehouse
    const materials = await prisma.material.findMany({
      select: { currentStock: true, unitPrice: true, minStock: true },
    })
    const warehouseStats = {
      totalMaterials: materials.length,
      totalValue: materials.reduce((s, m) => s + Number(m.currentStock) * Number(m.unitPrice || 0), 0),
      lowStock: materials.filter(m => Number(m.currentStock) <= Number(m.minStock || 0)).length,
    }

    // QC
    const inspections = await prisma.inspection.findMany({
      select: { status: true },
    })
    const qcStats = {
      total: inspections.length,
      passed: inspections.filter(i => i.status === 'PASSED').length,
      failed: inspections.filter(i => i.status === 'FAILED').length,
      passRate: inspections.length > 0
        ? Math.round(inspections.filter(i => i.status === 'PASSED').length / inspections.length * 100)
        : 0,
    }

    // HR
    const employees = await prisma.employee.findMany({
      select: { status: true },
    })
    const hrStats = {
      total: employees.length,
      active: employees.filter(e => e.status === 'ACTIVE').length,
    }

    // Finance — Invoices
    const invoices = await prisma.invoice.findMany({
      select: { type: true, totalAmount: true, paidAmount: true, status: true },
    })
    const financeStats = {
      totalInvoices: invoices.length,
      receivable: invoices.filter(i => i.type === 'RECEIVABLE').reduce((s, i) => s + Number(i.totalAmount), 0),
      payable: invoices.filter(i => i.type === 'PAYABLE').reduce((s, i) => s + Number(i.totalAmount), 0),
      collected: invoices.filter(i => i.type === 'RECEIVABLE').reduce((s, i) => s + Number(i.paidAmount), 0),
      overdue: invoices.filter(i => i.status === 'OVERDUE').length,
    }

    // Production
    const workOrders = await prisma.workOrder.findMany({
      select: { status: true },
    })
    const productionStats = {
      totalWO: workOrders.length,
      completed: workOrders.filter(w => w.status === 'COMPLETED').length,
      inProgress: workOrders.filter(w => w.status === 'IN_PROGRESS').length,
    }

    // Procurement
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      select: { status: true, totalValue: true },
    })
    const procurementStats = {
      totalPO: purchaseOrders.length,
      totalValue: purchaseOrders.reduce((s, po) => s + Number(po.totalValue || 0), 0),
      delivered: purchaseOrders.filter(po => po.status === 'RECEIVED').length,
    }

    return successResponse({
      year,
      projects: projectStats,
      tasks: taskStats,
      warehouse: warehouseStats,
      qc: qcStats,
      hr: hrStats,
      finance: financeStats,
      production: productionStats,
      procurement: procurementStats,
    })
  } catch (err) {
    console.error('GET /api/reports/executive error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
