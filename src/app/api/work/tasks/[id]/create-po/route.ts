import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest, successResponse, errorResponse,
  unauthorizedResponse, requireRoles,
} from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R07', 'R07a']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) {
    return errorResponse('Không có quyền tạo PO', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id: taskId } = pResult.data

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, projectId: true, createdBy: true, resultData: true,
      assignees: { select: { userId: true } },
    },
  })
  if (!task) return errorResponse('Không tìm thấy task', 404)

  const isAssignee = task.assignees.some(a => a.userId === user.userId)
  if (!isAssignee && task.createdBy !== user.userId) {
    return errorResponse('Bạn không liên quan đến task này', 403)
  }

  const rd = (task.resultData && typeof task.resultData === 'object')
    ? (task.resultData as Record<string, unknown>) : {}

  // Idempotent: already created
  if (rd.poId && typeof rd.poId === 'string') {
    const existing = await prisma.purchaseOrder.findUnique({ where: { id: rd.poId } })
    if (existing) {
      return successResponse({ poId: existing.id, poCode: existing.poCode, existing: true })
    }
  }

  // Validate chosen vendor
  const chosenVendorId = typeof rd.chosenVendorId === 'string' ? rd.chosenVendorId : null
  if (!chosenVendorId) return errorResponse('Chưa chọn NCC (chosenVendorId)', 400)

  const vendor = await prisma.vendor.findUnique({ where: { id: chosenVendorId } })
  if (!vendor) return errorResponse('NCC không tồn tại', 404)

  // Parse quotes + bomPr
  const quotes = Array.isArray(rd.supplierQuotes)
    ? (rd.supplierQuotes as Array<{ vendorId?: string; lines?: Array<{ matchedPrIndex?: number | null; unitPrice?: number; code?: string; description?: string; profile?: string; grade?: string; unit?: string; qty?: number }> ; paymentTerms?: string }>)
    : []
  const chosenQuote = quotes.find(q => q.vendorId === chosenVendorId)
  const quoteLines = chosenQuote?.lines ?? []

  const bomPr = typeof rd.bomPr === 'string' ? (() => { try { return JSON.parse(rd.bomPr) } catch { return null } })() : null
  const prItems: Array<{ stt?: string; canonicalCode?: string; description?: string; profile?: string; grade?: string; unit?: string; needToBuyQty?: number }> =
    Array.isArray(bomPr) ? bomPr : []

  // Build PO items: only lines matched to PR items with needToBuyQty > 0
  const poItems: Array<{
    itemCode: string; description: string; profile: string; grade: string;
    unit: string; quantity: number; unitPrice: number;
  }> = []

  for (const line of quoteLines) {
    if (line.matchedPrIndex == null) continue
    const prItem = prItems[line.matchedPrIndex]
    if (!prItem) continue
    const needToBuy = typeof prItem.needToBuyQty === 'number' ? prItem.needToBuyQty : 0
    if (needToBuy <= 0) continue

    poItems.push({
      itemCode: prItem.canonicalCode || prItem.stt || line.code || '',
      description: prItem.description || line.description || '',
      profile: prItem.profile || line.profile || '',
      grade: prItem.grade || line.grade || '',
      unit: prItem.unit || line.unit || '',
      quantity: needToBuy,
      unitPrice: line.unitPrice ?? 0,
    })
  }

  if (poItems.length === 0) {
    return errorResponse('Không có vật tư cần mua (đủ kho)', 400)
  }

  const totalValue = poItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)

  // Generate PO code
  const lastPo = await prisma.purchaseOrder.findFirst({ orderBy: { poCode: 'desc' } })
  const lastNum = lastPo?.poCode ? parseInt(lastPo.poCode.replace('PO-', ''), 10) || 0 : 0
  const poCode = `PO-${String(lastNum + 1).padStart(5, '0')}`

  const po = await prisma.purchaseOrder.create({
    data: {
      poCode,
      vendorId: chosenVendorId,
      projectId: task.projectId,
      status: 'DRAFT',
      currency: 'VND',
      paymentTerms: chosenQuote?.paymentTerms || null,
      orderDate: new Date(),
      createdBy: user.userId,
      sourceTaskId: taskId,
      totalValue: Math.round(totalValue),
      items: {
        create: poItems.map(it => ({
          materialId: null,
          itemCode: it.itemCode,
          description: it.description,
          profile: it.profile,
          grade: it.grade,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
        })),
      },
    },
  })

  // Save poId/poCode to resultData (atomic merge)
  const patch = JSON.stringify({ poId: po.id, poCode: po.poCode })
  await prisma.$executeRaw`
    UPDATE "tasks"
    SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
        "updated_at" = now()
    WHERE "id" = ${taskId}`

  return successResponse({ poId: po.id, poCode: po.poCode })
}
