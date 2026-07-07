import { prisma } from '@/lib/db'

export const USE_QUOTE_TABLES = process.env.USE_QUOTE_TABLES === '1'

/**
 * Sync groups JSON → normalized tables (idempotent upsert).
 * Called after every JSON write to keep tables in sync (dual-write).
 */
export async function syncQuoteGroups(
  taskId: string,
  projectId: string | null,
  groups: any[],
) {
  for (const g of groups) {
    const groupKey = String(g.id || `GRP-${Date.now()}`)

    const qg = await prisma.quoteGroup.upsert({
      where: { taskId_groupKey: { taskId, groupKey } },
      create: {
        taskId,
        projectId,
        groupKey,
        name: g.name || g.groupName || 'Nhóm vật tư',
        status: g.status || 'PENDING',
        totalValue: g.totalValue || 0,
        prCode: g.prCode || null,
        paymentStatus: g.paymentStatus || null,
        deliveryDate: g.deliveryDate ? new Date(g.deliveryDate) : null,
        paymentDate: g.paymentDate ? new Date(g.paymentDate) : null,
        assignedSupplier: g.assignedSupplier || null,
        rejectedReason: g.rejectedReason || null,
      },
      update: {
        name: g.name || g.groupName || 'Nhóm vật tư',
        status: g.status || 'PENDING',
        totalValue: g.totalValue || 0,
        prCode: g.prCode || null,
        paymentStatus: g.paymentStatus || null,
        deliveryDate: g.deliveryDate ? new Date(g.deliveryDate) : null,
        paymentDate: g.paymentDate ? new Date(g.paymentDate) : null,
        assignedSupplier: g.assignedSupplier || null,
        rejectedReason: g.rejectedReason || null,
      },
    })

    // Replace items: delete existing, re-create
    await prisma.quoteGroupItem.deleteMany({ where: { quoteGroupId: qg.id } })

    for (const item of g.items || []) {
      const qi = await prisma.quoteGroupItem.create({
        data: {
          quoteGroupId: qg.id,
          name: item.name || '',
          code: item.code || '',
          spec: item.spec || null,
          unit: item.unit || '',
          source: item.source || '',
          quantity: String(item.quantity ?? '0'),
          requestedQty: item.requestedQty || 0,
          inStock: item.inStock || 0,
          shortfall: item.shortfall || 0,
          specMatch: item.specMatch || false,
          matchedMaterialJson: item.matchedMaterial || undefined,
          selectedQuoteIndex: item.selectedQuoteIndex || 0,
        },
      })

      if (Array.isArray(item.quotes)) {
        await prisma.supplierQuoteLine.createMany({
          data: item.quotes.map((q: any, idx: number) => ({
            itemId: qi.id,
            lineIndex: idx,
            supplierName: q.ncc || '',
            unitPrice: q.price || 0,
          })),
        })
      }
    }
  }
}

/**
 * Read approved groups from normalized tables (replacement for JSON scan).
 */
export async function readApprovedGroups() {
  const groups = await prisma.quoteGroup.findMany({
    where: { status: 'APPROVED' },
    include: {
      task: { select: { id: true } },
      project: { select: { id: true, projectName: true, projectCode: true } },
      items: {
        include: { quoteLines: { orderBy: { lineIndex: 'asc' } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return groups.map((g) => {
    const selectedSupplier =
      g.assignedSupplier ||
      g.items[0]?.quoteLines[g.items[0]?.selectedQuoteIndex || 0]
        ?.supplierName ||
      'Chưa chốt NCC'

    return {
      taskId: g.taskId,
      projectId: g.projectId,
      projectName: g.project?.projectName || '',
      projectCode: g.project?.projectCode || '',
      groupId: g.groupKey,
      groupName: g.name,
      prCode: g.prCode || '',
      supplier: selectedSupplier,
      totalValue: Number(g.totalValue),
      items: g.items.map((i) => ({
        name: i.name,
        code: i.code,
        spec: i.spec,
        unit: i.unit,
        source: i.source,
        quantity: i.quantity,
        requestedQty: Number(i.requestedQty),
        inStock: Number(i.inStock),
        shortfall: Number(i.shortfall),
        specMatch: i.specMatch,
        matchedMaterial: i.matchedMaterialJson,
        selectedQuoteIndex: i.selectedQuoteIndex,
        quotes: i.quoteLines.map((q) => ({
          ncc: q.supplierName,
          price: Number(q.unitPrice),
        })),
      })),
      paymentStatus: g.paymentStatus || 'PENDING',
      deliveryDate: g.deliveryDate?.toISOString() || null,
      paymentDate: g.paymentDate?.toISOString() || null,
    }
  })
}
