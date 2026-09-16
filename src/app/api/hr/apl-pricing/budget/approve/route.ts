import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// BGĐ (BOM) duyệt Tổng giá trị giao khoán. Duyệt xong Xưởng mới được tải/nhập file đơn giá.
const APPROVE_ROLES = ['R01', 'R10']

async function impOf(projectId: string) {
  return prisma.aplImport.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
}

// POST — duyệt
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!APPROVE_ROLES.includes(user.roleCode)) return errorResponse('Chỉ BGĐ (BOM) được duyệt Tổng giá trị giao khoán', 403)
  const { projectId } = await req.json().catch(() => ({}))
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  const imp = await impOf(String(projectId))
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)
  const pr = await prisma.aplPricing.findUnique({ where: { importId: imp.id }, select: { budgetTotal: true, budgetStatus: true } })
  if (!pr || pr.budgetStatus === 'NONE' || pr.budgetTotal == null) return errorResponse('Chưa có Tổng giá trị giao khoán để duyệt (KTKT tải file trước)', 400)
  if (pr.budgetStatus === 'APPROVED') return errorResponse('Tổng giá trị đã được duyệt', 409)
  await prisma.aplPricing.update({ where: { importId: imp.id }, data: { budgetStatus: 'APPROVED', budgetApprovedBy: user.userId, budgetApprovedAt: new Date() } })
  await logAudit(user.userId, 'UPDATE', 'AplPricing', imp.id, { action: 'budget_approve', budgetTotal: Number(pr.budgetTotal) })
  return successResponse({ budgetStatus: 'APPROVED' }, 'Đã duyệt Tổng giá trị giao khoán — các Xưởng có thể nhập đơn giá')
}

// DELETE — mở lại (huỷ duyệt) để KTKT tải lại, phòng khi duyệt nhầm.
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!APPROVE_ROLES.includes(user.roleCode)) return errorResponse('Chỉ BGĐ (BOM) được mở lại', 403)
  const { projectId } = await req.json().catch(() => ({}))
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  const imp = await impOf(String(projectId))
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)
  await prisma.aplPricing.updateMany({ where: { importId: imp.id }, data: { budgetStatus: 'PENDING', budgetApprovedBy: null, budgetApprovedAt: null } })
  await logAudit(user.userId, 'UPDATE', 'AplPricing', imp.id, { action: 'budget_reopen' })
  return successResponse({ budgetStatus: 'PENDING' }, 'Đã mở lại — chờ duyệt lại')
}
