import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { computePricingTotals } from '@/lib/apl-pricing'

const PRICE_EDIT_ROLES = ['R01', 'R03', 'R03a']

// POST /api/hr/apl-pricing/complete — chốt bảng đơn giá khoán.
// Chỉ chốt được khi ĐỦ CẢ HAI: mọi dòng đã có đơn giá VÀ mọi khối đã nghiệm thu xong.
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!PRICE_EDIT_ROLES.includes(user.roleCode)) {
    return errorResponse('Chỉ Kinh tế Kỹ thuật (KTKH) hoặc BGĐ được chốt bảng đơn giá', 403)
  }

  const { projectId } = await req.json()
  if (!projectId) return errorResponse('Thiếu projectId', 400)

  const imp = await prisma.aplImport.findFirst({
    where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true },
  })
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)

  const totals = await computePricingTotals(imp.id)
  if (!totals.canComplete) {
    // Nói rõ còn thiếu gì thay vì chỉ báo "chưa đủ điều kiện"
    const missing: string[] = []
    if (totals.itemsPriced < totals.itemsTotal) {
      missing.push(`${totals.itemsTotal - totals.itemsPriced}/${totals.itemsTotal} ITEM chưa có đơn giá`)
    } else if (totals.linesWithoutPrice > 0) {
      missing.push(`${totals.linesWithoutPrice} dòng chi tiết chưa có đơn giá`)
    }
    if (totals.itemsAccepted < totals.itemsTotal) {
      missing.push(`${totals.itemsTotal - totals.itemsAccepted}/${totals.itemsTotal} ITEM chưa nghiệm thu xong`)
    }
    return errorResponse(`Chưa chốt được: ${missing.join('; ')}`, 400)
  }

  const pricing = await prisma.aplPricing.upsert({
    where: { importId: imp.id },
    create: {
      importId: imp.id, status: 'COMPLETED', totalAmount: totals.totalAmount,
      completedBy: user.userId, completedAt: new Date(),
    },
    update: {
      status: 'COMPLETED', totalAmount: totals.totalAmount,
      completedBy: user.userId, completedAt: new Date(),
    },
  })

  await logAudit(user.userId, 'UPDATE', 'AplPricing', imp.id,
    { action: 'complete', totalAmount: totals.totalAmount, acceptedKg: totals.acceptedKg })

  return successResponse({ pricing, totals }, 'Đã chốt bảng đơn giá khoán')
}

// DELETE — mở lại bảng đã chốt (BGĐ / KTKH), phòng khi chốt nhầm.
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!PRICE_EDIT_ROLES.includes(user.roleCode)) {
    return errorResponse('Không có quyền mở lại bảng đơn giá', 403)
  }

  const { projectId } = await req.json()
  if (!projectId) return errorResponse('Thiếu projectId', 400)

  const imp = await prisma.aplImport.findFirst({
    where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true },
  })
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)

  await prisma.aplPricing.updateMany({
    where: { importId: imp.id },
    data: { status: 'DRAFT', completedBy: null, completedAt: null },
  })
  await logAudit(user.userId, 'UPDATE', 'AplPricing', imp.id, { action: 'reopen' })

  return successResponse({}, 'Đã mở lại bảng đơn giá')
}
