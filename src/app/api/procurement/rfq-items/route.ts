import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { groupLabelOf } from '@/lib/material-group'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)

// Tab → statusFlag của dòng PR.
const TAB_STATUS: Record<string, string> = {
  'need': 'Chờ báo giá',       // Cần hỏi giá
  'asking': 'Đang chào giá',   // Đang hỏi giá (đã vào BID)
}

/**
 * GET /api/procurement/rfq-items?tab=need|asking|received&projectId=&group=
 * Lưới VẬT TƯ "cần hỏi giá" (khớp Commerce màn Yêu cầu & Báo giá) + cột NCC ĐỀ XUẤT.
 * Gợi ý NCC: (1) NCC từng cấp ĐÚNG mã VT (lịch sử PO + HĐ); (2) fallback NCC từng được chọn cho
 * cùng HỌ vật tư (materialSubGroupCode) trong các BID trước. Dòng chưa phân họ + không có lịch sử → không gợi ý.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const sp = req.nextUrl.searchParams
    const tab = sp.get('tab') || 'need'
    const projectId = sp.get('projectId') || undefined
    const group = sp.get('group') || undefined

    // Điều kiện lọc theo tab.
    const baseWhere: Record<string, unknown> = { purchaseRequest: { ...(projectId ? { projectId } : {}), status: { notIn: ['CANCELLED', 'REJECTED'] } } }
    if (tab === 'received') {
      // Đã nhận báo giá: dòng đã vào BID và NCC đó có báo giá (>0) cho dòng.
      baseWhere.bidQuoteItems = { some: { offers: { some: { unitPrice: { gt: 0 } } } } }
    } else if (TAB_STATUS[tab]) {
      baseWhere.statusFlag = TAB_STATUS[tab]
    }
    if (group) baseWhere.materialGroupCode = group

    const items = await prisma.purchaseRequestItem.findMany({
      where: baseWhere,
      orderBy: [{ materialGroupCode: 'asc' }, { itemCode: 'asc' }],
      take: 800,
      select: {
        id: true, itemCode: true, matCode: true, description: true, profile: true, grade: true, unit: true,
        reqQty: true, quantity: true, requiredDate: true, materialGroupCode: true, materialSubGroupCode: true,
        purchaseRequest: { select: { prCode: true, projectId: true, project: { select: { projectCode: true } } } },
      },
    })

    // ── NCC đề xuất ──
    const itemCodes = [...new Set(items.map(i => i.itemCode).filter((x): x is string => !!x))]
    const subGroups = [...new Set(items.map(i => i.materialSubGroupCode).filter((x): x is string => !!x))]

    // (1) mã VT → NCC (từ PO + HĐ đã ký)
    const byItemCode = new Map<string, Set<string>>()
    if (itemCodes.length) {
      const [poItems, ctItems] = await Promise.all([
        prisma.purchaseOrderItem.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, purchaseOrder: { select: { vendor: { select: { name: true } } } } } }),
        prisma.purchaseContractItem.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, contract: { select: { vendor: { select: { name: true } } } } } }),
      ])
      const add = (code: string | null, name?: string) => { if (!code || !name) return; if (!byItemCode.has(code)) byItemCode.set(code, new Set()); byItemCode.get(code)!.add(name) }
      poItems.forEach(p => add(p.itemCode, p.purchaseOrder?.vendor?.name))
      ctItems.forEach(c => add(c.itemCode, c.contract?.vendor?.name))
    }

    // (2) họ vật tư → NCC (từng được chọn trong BID trước)
    const bySubGroup = new Map<string, Set<string>>()
    if (subGroups.length) {
      const chosen = await prisma.bidQuoteItem.findMany({
        where: { selectedVendorName: { not: null }, prItem: { materialSubGroupCode: { in: subGroups } } },
        select: { selectedVendorName: true, prItem: { select: { materialSubGroupCode: true } } },
      })
      for (const c of chosen) {
        const sg = c.prItem?.materialSubGroupCode; const nm = c.selectedVendorName
        if (!sg || !nm) continue
        if (!bySubGroup.has(sg)) bySubGroup.set(sg, new Set())
        bySubGroup.get(sg)!.add(nm)
      }
    }

    const rows = items.map(it => {
      const sug = new Set<string>()
      if (it.itemCode && byItemCode.has(it.itemCode)) byItemCode.get(it.itemCode)!.forEach(v => sug.add(v))
      if (sug.size === 0 && it.materialSubGroupCode && bySubGroup.has(it.materialSubGroupCode)) bySubGroup.get(it.materialSubGroupCode)!.forEach(v => sug.add(v))
      const suggested = [...sug]
      const grp = it.materialGroupCode || 'KHAC'
      return {
        id: it.id,
        projectCode: it.purchaseRequest?.project?.projectCode || '—',
        projectId: it.purchaseRequest?.projectId || null,
        prCode: it.purchaseRequest?.prCode || '',
        itemCode: it.itemCode || '', matCode: it.matCode || '',
        description: it.description || '', profile: it.profile || '', grade: it.grade || '', uom: it.unit || '',
        reqQty: N(it.reqQty) || N(it.quantity), requiredDate: it.requiredDate,
        groupCode: grp, groupLabel: groupLabelOf(grp), subGroup: it.materialSubGroupCode,
        noSubGroup: !it.materialSubGroupCode,
        suggestedVendors: suggested.slice(0, 3), suggestedMore: Math.max(0, suggested.length - 3),
      }
    })

    // Chip nhóm + tổng hợp.
    const groupMap = new Map<string, { label: string; count: number }>()
    for (const r of rows) { const g = groupMap.get(r.groupCode) || { label: r.groupLabel, count: 0 }; g.count++; groupMap.set(r.groupCode, g) }
    const summary = {
      total: rows.length,
      withRequiredDate: rows.filter(r => r.requiredDate).length,
      withSuggestion: rows.filter(r => r.suggestedVendors.length > 0).length,
      noSubGroup: rows.filter(r => r.noSubGroup).length,
      groups: [...groupMap.entries()].map(([code, g]) => ({ code, label: g.label, count: g.count })).sort((a, b) => b.count - a.count),
    }
    return successResponse({ rows, summary })
  } catch (err) {
    console.error('GET rfq-items error:', err)
    return errorResponse('Lỗi tải lưới yêu cầu báo giá', 500)
  }
}
