import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest, unauthorizedResponse } from '@/lib/auth'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const payload = await authenticateRequest(request)
    if (!payload?.userId) return unauthorizedResponse()

    // Find all P3.6 Tasks
    const tasks = await prisma.task.findMany({
      where: { taskType: 'P3.6' },
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
    return NextResponse.json({ error: 'Lỗi hệ thống khi tải theo dõi mua sắm' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await authenticateRequest(request)
    if (!payload?.userId) return unauthorizedResponse()

    const body = await request.json()
    const { taskId, groupId, action, deliveryDate } = body

    const task = await prisma.task.findUnique({ where: { id: taskId } })
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

      // 2. Find-or-create Vendor
      let vendor = await prisma.vendor.findFirst({ where: { name: actualSupplier } })
      if (!vendor) {
        vendor = await prisma.vendor.create({
          data: {
            vendorCode: `VND-AUTO-${Date.now()}`,
            name: actualSupplier,
            category: 'SUPPLIER',
            isActive: true,
          }
        })
      }

      // 3. Build PO items — find-or-create a Material record for each group item
      // (PurchaseOrderItem requires materialId; BOM items may not exist in Material master yet)
      const CATEGORY_BY_SOURCE: Record<string, string> = {
        'P2.1': 'main', 'P2.2': 'welding_paint', 'P2.3': 'consumable',
      }
      const poItemsData: { materialId: string; quantity: number; unitPrice: number }[] = []
      for (const item of (g.items || [])) {
        const itemName = String(item.name || item.description || 'Vật tư').trim()
        const itemCode = String(item.code || item.materialCode || '').trim()
        const itemUnit = String(item.unit || 'cái').trim()
        const itemSpec = String(item.spec || item.specification || '').trim()
        const itemQty = Number(item.shortfall ?? item.quantity ?? item.requestedQty ?? 0) || 0
        const itemPrice = Number(item.quotes?.[item.selectedQuoteIndex || 0]?.price ?? 0) || 0

        let material = itemCode
          ? await prisma.material.findUnique({ where: { materialCode: itemCode } })
          : null
        if (!material && itemName) {
          material = await prisma.material.findFirst({ where: { name: itemName } })
        }
        if (!material) {
          material = await prisma.material.create({
            data: {
              materialCode: itemCode || `MAT-AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
              name: itemName,
              unit: itemUnit,
              category: CATEGORY_BY_SOURCE[item.source as string] || 'main',
              specification: itemSpec || null,
            }
          })
        }
        poItemsData.push({ materialId: material.id, quantity: itemQty, unitPrice: itemPrice })
      }

      // 4. Auto-generate physical PO (with items) so Finance can select it for Drawdown
      const existingPo = await prisma.purchaseOrder.findUnique({
        where: { poCode: g.prCode },
        include: { items: true },
      })
      if (!existingPo) {
        await prisma.purchaseOrder.create({
          data: {
            poCode: g.prCode,
            projectId: task.projectId, // traceability: PO → workflow project
            vendorId: vendor.id,
            totalValue: actualTotalValue,
            status: 'APPROVED',
            createdBy: payload.userId,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            items: poItemsData.length > 0 ? { create: poItemsData } : undefined,
          }
        })
      } else {
        // PO exists — backfill projectId if missing (legacy data)
        if (!existingPo.projectId) {
          await prisma.purchaseOrder.update({
            where: { id: existingPo.id },
            data: { projectId: task.projectId },
          })
        }
        if (existingPo.items.length === 0 && poItemsData.length > 0) {
          // PO exists but has no items (legacy data) — backfill items
          await prisma.purchaseOrderItem.createMany({
            data: poItemsData.map(d => ({ ...d, poId: existingPo.id })),
          })
        }
      }

      // 5. Notify accountants (R08) — they process payment from the "Thanh toán" tab,
      // so no workflow task is created; a notification + sidebar badge guides them in.
      const accountants = await prisma.user.findMany({
        where: { roleCode: { in: ['R08', 'R08a'] }, isActive: true },
        select: { id: true },
      })
      if (accountants.length > 0) {
        await prisma.notification.createMany({
          data: accountants.map(u => ({
            userId: u.id,
            title: `💰 Yêu cầu thanh toán: ${g.prCode}`,
            message: `Thương mại vừa gửi yêu cầu thanh toán PO ${g.prCode} (${actualSupplier}) — ${formatCurrency(Number(actualTotalValue))}. Vào tab Thanh toán để xử lý.`,
            type: 'payment_request',
            linkUrl: '/dashboard/finance/payments',
          })),
        })
      }
    }

    // Save back to P3.6 task
    groups[blockIndex] = g
    await prisma.task.update({
      where: { id: taskId },
      data: { resultData: { ...rd, groups } }
    })

    return NextResponse.json({ success: true, message: 'Đã cập nhật thành công' })
  } catch (error) {
    console.error('procurement-tracking PUT ERROR:', error)
    return NextResponse.json({ error: 'Lỗi máy chủ nội bộ' }, { status: 500 })
  }
}
