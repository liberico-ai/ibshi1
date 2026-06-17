import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { generateMaterialCode } from '@/lib/material-code'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/pr-create-code  { index, prefix?, subgroup? }
// Sinh MÃ TẠM (provisional, PENDING) cho 1 dòng PR chưa có mã, rồi cập nhật vào task.resultData.pr
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { index?: number; prefix?: string; subgroup?: string }
    const index = Number(body.index)
    if (!Number.isInteger(index)) return errorResponse('Thiếu chỉ số dòng', 400)

    const task = await prisma.task.findUnique({ where: { id }, select: { resultData: true } })
    const rd = (task?.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
    const pr = rd.pr as { items?: { code: string; name: string; spec: string; unit: string; qty: string; matched: unknown }[]; summary?: { total: number; matched: number; unmatched: number } } | undefined
    const row = pr?.items?.[index]
    if (!pr || !row) return errorResponse('Không tìm thấy dòng PR', 404)
    if (row.matched) return errorResponse('Dòng này đã có mã', 400)

    const prefix = (body.prefix || 'VT').trim()
    const subgroup = (body.subgroup || 'TAM').trim()
    const material = await prisma.$transaction(async (tx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = await generateMaterialCode(tx, prefix, subgroup)
        const clash = await tx.material.findUnique({ where: { materialCode: code }, select: { id: true } })
        if (clash) continue
        return tx.material.create({
          data: {
            materialCode: code, name: row.name || '(chưa đặt tên)', unit: row.unit || 'cái',
            category: prefix, specification: row.spec || null,
            status: 'PENDING', isProvisional: true, createdByUnit: payload.roleCode,
          },
        })
      }
      throw new Error('Không sinh được mã duy nhất')
    })

    // Cập nhật dòng + tổng kết
    row.code = material.materialCode
    row.matched = { materialCode: material.materialCode, name: material.name, unit: material.unit, status: material.status, via: 'new' }
    if (pr.summary) { pr.summary.matched += 1; pr.summary.unmatched = Math.max(0, pr.summary.unmatched - 1) }
    await prisma.task.update({ where: { id }, data: { resultData: JSON.parse(JSON.stringify({ ...rd, pr })) } })
    await logAudit(payload.userId, 'QUICK_CREATE', 'Material', material.id, { materialCode: material.materialCode, fromTask: id }, getClientIP(req))

    return successResponse({ code: material.materialCode }, `Đã tạo mã tạm ${material.materialCode}`)
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/pr-create-code error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi sinh mã', 400)
  }
}
