import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R03', 'R03a', 'R07', 'R07a', 'R10']
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// POST /api/purchase-requests/import — tạo 1 PR + nhiều dòng vật tư từ Excel.
// body: { projectId, prCode?, notes?, rows[] }
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền nhập PR', 403)

    const b = await req.json().catch(() => ({})) as { projectId?: string; prCode?: string; notes?: string; rows?: Array<Record<string, unknown>> }
    if (!b.projectId) return errorResponse('Cần chọn dự án', 400)
    const rows = Array.isArray(b.rows) ? b.rows : []
    if (rows.length === 0) return errorResponse('File không có dòng nào', 400)
    const project = await prisma.project.findUnique({ where: { id: b.projectId }, select: { projectCode: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    // Mã PR: dùng mã người dùng nhập, else tự sinh; chống trùng.
    let prCode = String(b.prCode || '').trim() || `PR-${project.projectCode}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    if (await prisma.purchaseRequest.findUnique({ where: { prCode }, select: { id: true } })) prCode = `${prCode}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`

    const loi: Array<{ dong: number; ly_do: string }> = []
    const items = rows.map((r, i) => {
      const itemCode = String(r.itemCode || '').trim()
      const description = String(r.description || '').trim()
      if (!itemCode && !description) { loi.push({ dong: i + 2, ly_do: 'thiếu mã & mô tả' }); return null }
      const reqQty = num(r.reqQty) || num(r.quantity) || num(r.netQty)
      const unitWeight = num(r.unitWeight)
      const netQty = num(r.netQty) || reqQty
      return {
        itemCode: itemCode || null, description: description || null,
        profile: r.profile ? String(r.profile).trim() : null, grade: r.grade ? String(r.grade).trim() : null,
        unit: r.unit ? String(r.unit).trim() : null, matCode: r.matCode ? String(r.matCode).trim() : null,
        materialGroupCode: r.materialGroupCode ? String(r.materialGroupCode).trim() : null,
        materialSubGroupCode: r.materialSubGroupCode ? String(r.materialSubGroupCode).trim() : null,
        unitWeight, quantity: reqQty, netQty, netWeight: num(r.netWeight) || netQty * unitWeight,
        reqQty, reqWeight: num(r.reqWeight) || reqQty * unitWeight,
        remainQty: num(r.remainQty), toBuyQty: num(r.toBuyQty) || reqQty - num(r.remainQty),
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)

    if (items.length === 0) return errorResponse(`Không dòng nào hợp lệ (${loi.length} lỗi)`, 400)
    const pr = await prisma.purchaseRequest.create({
      data: { prCode, projectId: b.projectId, requestedBy: user.userId, status: 'DRAFT', notes: b.notes || null, items: { create: items } },
      select: { id: true, prCode: true },
    })
    return successResponse({ prId: pr.id, prCode: pr.prCode, soDongNhan: rows.length, soDongNhap: items.length, soDongBoQua: loi.length, loi }, `Đã tạo PR ${pr.prCode} với ${items.length} dòng${loi.length ? `, bỏ qua ${loi.length}` : ''}`, 201)
  } catch (err) {
    console.error('POST purchase-requests/import error:', err)
    return errorResponse('Lỗi nhập PR', 500)
  }
}
