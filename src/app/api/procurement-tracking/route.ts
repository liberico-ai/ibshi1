import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const payload = await authenticateRequest(request)
    if (!payload?.userId) return unauthorizedResponse()

    // Find all P3.6 Tasks
    const tasks = await prisma.workflowTask.findMany({
      where: { stepCode: 'P3.6' },
      include: { project: true },
      orderBy: { createdAt: 'desc' }
    })

    const allApprovedGroups: any[] = []

    for (const task of tasks) {
      const rd = (task.resultData as any) || {}
      const groups = rd.groups || []
      
      for (const g of groups) {
        if (g.status === 'APPROVED') {
          // Flatten into trackable units
          allApprovedGroups.push({
            taskId: task.id,
            projectId: task.projectId,
            projectName: task.project?.projectName || '',
            projectCode: task.project?.projectCode || '',
            groupId: g.id || `GRP-${Math.random()}`,
            groupName: g.name || g.groupName || 'Nhóm vật tư',
            prCode: g.prCode || `PR-LEGACY-${String(g.id || Math.floor(Math.random()*10000)).slice(-4)}`,
            supplier: g.assignedSupplier || (g.items?.length > 0 ? (g.items[0].quotes?.[g.items[0].selectedQuoteIndex || 0]?.ncc || 'Chưa chốt NCC') : 'Chưa chốt NCC'),
            totalValue: g.totalValue || (g.items || []).reduce((sum: number, item: any) => sum + ((item.quotes?.[item.selectedQuoteIndex || 0]?.price || 0) * (item.shortfall || 0)), 0),
            items: g.items || [],
            paymentStatus: g.paymentStatus || 'PENDING',
            deliveryDate: g.deliveryDate || null,
            paymentDate: g.paymentDate || null,
          })
        }
      }
    }

    return NextResponse.json(
      { success: true, trackingList: allApprovedGroups },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' } }
    )
  } catch (error: any) {
    console.error('procurement-tracking GET ERROR:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await authenticateRequest(request)
    if (!payload?.userId) return unauthorizedResponse()

    const body = await request.json()
    const { taskId, groupId, action, deliveryDate } = body

    const task = await prisma.workflowTask.findUnique({ where: { id: taskId } })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const rd = (task.resultData as any) || {}
    let groups = rd.groups || []
    
    const blockIndex = groups.findIndex((g: any) => g.id === groupId)
    if (blockIndex === -1) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    
    const g = groups[blockIndex]

    if (action === 'update_delivery') {
      g.deliveryDate = deliveryDate
    } else if (action === 'request_payment') {
      // 1. Change internal group status
      g.paymentStatus = 'PAYMENT_REQUESTED'
      g.prCode = g.prCode || `PR-LEGACY-${g.id.slice(-4)}`
      if (deliveryDate) {
        g.deliveryDate = deliveryDate
      }
      
      const actualSupplier = g.assignedSupplier || (g.items?.length > 0 ? (g.items[0].quotes?.[g.items[0].selectedQuoteIndex || 0]?.ncc || 'NCC') : 'NCC')
      const actualTotalValue = g.totalValue || (g.items || []).reduce((sum: number, item: any) => sum + ((item.quotes?.[item.selectedQuoteIndex || 0]?.price || 0) * (item.shortfall || 0)), 0)

      // 2. Spawn P4.1 (Yêu cầu thanh toán) task for Accountant
      await prisma.workflowTask.create({
        data: {
          projectId: task.projectId,
          stepCode: 'P4.1',
          stepName: `Kế toán thanh toán PO lô hàng: ${g.prCode} (${actualSupplier})`,
          assignedRole: 'R08', // Kế toán trưởng
          status: 'IN_PROGRESS',
          resultData: { 
            sourceP36Id: taskId, 
            sourceGroupId: groupId,
            prCode: g.prCode,
            supplier: actualSupplier,
            items: g.items,
            totalValue: actualTotalValue
          },
          startedAt: new Date(),
        }
      })

      // 3. Auto-generate physical PO so Finance can select it for Drawdown
      let vendor = await prisma.vendor.findFirst({ where: { name: actualSupplier } })
      if (!vendor) {
        vendor = await prisma.vendor.create({ data: { name: actualSupplier, vendorCode: `VND-${Date.now()}`, category: 'SUPPLIER', isActive: true } })
      }
      
      const existingPo = await prisma.purchaseOrder.findUnique({ where: { poCode: g.prCode } })
      if (!existingPo) {
        await prisma.purchaseOrder.create({
          data: {
             poCode: g.prCode,
             vendorId: vendor.id,
             totalValue: actualTotalValue,
             status: 'APPROVED',
             createdBy: payload.userId,
             deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          }
        })
      }
    }

    // Save back to P3.6 task
    groups[blockIndex] = g
    await prisma.workflowTask.update({
      where: { id: taskId },
      data: { resultData: { ...rd, groups } }
    })

    return NextResponse.json({ success: true, message: 'Đã cập nhật thành công' })
  } catch (error: any) {
    console.error('procurement-tracking PUT ERROR:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
