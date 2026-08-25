import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { groupLabelOf } from '@/lib/material-group'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)

/**
 * GET /api/procurement/pr-items?projectId=&status=
 * Lưới VẬT TƯ phẳng (item-centric) — mọi dòng PR của nhiều PR/dự án trên 1 bảng, gộp theo nhóm VT.
 * (Khớp trang /mua-hang của Commerce: Mã kho · Description · Profile · Grade · ĐVT · SL · Tấn · REV.)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const sp = req.nextUrl.searchParams
    const projectId = sp.get('projectId') || undefined
    const status = sp.get('status') || undefined

    const items = await prisma.purchaseRequestItem.findMany({
      where: { purchaseRequest: { ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) } },
      orderBy: [{ materialGroupCode: 'asc' }, { itemCode: 'asc' }],
      take: 6000,
      select: {
        id: true, itemCode: true, matCode: true, description: true, profile: true, grade: true, unit: true,
        quantity: true, reqQty: true, reqWeight: true, netWeight: true, toBuyQty: true, materialGroupCode: true,
        purchaseRequest: { select: { prCode: true, revNo: true, status: true, projectId: true, project: { select: { projectCode: true } } } },
      },
    })

    const rows = items.map(it => {
      const grp = it.materialGroupCode || 'KHAC'
      return {
        id: it.id,
        projectCode: it.purchaseRequest?.project?.projectCode || '—',
        projectId: it.purchaseRequest?.projectId || null,
        prCode: it.purchaseRequest?.prCode || '',
        revNo: it.purchaseRequest?.revNo ?? 0,
        prStatus: it.purchaseRequest?.status || 'DRAFT',
        itemCode: it.itemCode || '',
        matCode: it.matCode || '',
        description: it.description || '',
        profile: it.profile || '',
        grade: it.grade || '',
        uom: it.unit || '',
        qty: N(it.reqQty) || N(it.quantity),
        weightTon: (N(it.reqWeight) || N(it.netWeight)) / 1000,
        toBuyQty: N(it.toBuyQty),
        groupCode: grp,
        groupLabel: groupLabelOf(grp),
      }
    })

    // Tổng hợp cho thanh tiêu đề.
    const projMap = new Map<string, number>()
    const groupSet = new Set<string>()
    const revSet = new Set<string>()
    let totalWeight = 0
    for (const r of rows) {
      projMap.set(r.projectCode, (projMap.get(r.projectCode) || 0) + 1)
      groupSet.add(r.groupCode)
      revSet.add(`${r.prCode}#${r.revNo}`)
      totalWeight += r.weightTon
    }
    const summary = {
      totalItems: rows.length,
      totalWeightTon: totalWeight,
      groupCount: groupSet.size,
      projectCount: projMap.size,
      revCount: revSet.size,
      projects: [...projMap.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    }
    return successResponse({ rows, summary })
  } catch (err) {
    console.error('GET pr-items error:', err)
    return errorResponse('Lỗi tải lưới vật tư PR', 500)
  }
}
