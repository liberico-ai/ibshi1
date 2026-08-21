import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { inferStatusFlag } from '@/lib/procurement-status'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R03', 'R03a', 'R07', 'R07a', 'R10']
const N = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }
const S = (v: unknown) => String(v ?? '').trim()
const norm = (s: string) => s.trim().toUpperCase().replace(/[\s\-._/]/g, '')
const d = (v: unknown): Date | null => { const s = S(v); if (!s) return null; if (/^\d{4,6}$/.test(s)) { const n = Number(s); if (n >= 20000 && n <= 90000) return new Date(Math.round((n - 25569) * 86400000)) } const dt = new Date(s); return isNaN(dt.getTime()) ? null : dt }
const sani = (s: string) => S(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)

interface Row { itemCode?: string; matCode?: string; remainQty?: unknown
  domContractNo?: string; domVendor?: string; domQty?: unknown; domWeight?: unknown; domPrice?: unknown; domDelivered?: unknown; domHandoverDate?: unknown; domQcReport?: string; domQcResult?: string
  impContractNo?: string; impVendor?: string; impQty?: unknown; impWeight?: unknown; impPrice?: unknown; impDelivered?: unknown; impQcReport?: string; impQcResult?: string
  impLcDate?: unknown; impExportPort?: string; impCifDate?: unknown; impPaymentDate?: unknown; impCustomsDate?: unknown; impArrivedDate?: unknown; impQcInvitation?: unknown; impCountry?: string }

// POST /api/procurement/master-tracking/update — "Cập nhật mua sắm" từ Excel:
// khớp dòng ↔ PR item → cập nhật tồn/trạng thái + upsert dòng HĐ (DOM/IMP) + QC → Theo dõi hiện số thật.
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền cập nhật mua sắm', 403)
    const b = await req.json().catch(() => ({})) as { projectId?: string; rows?: Row[] }
    if (!b.projectId) return errorResponse('Cần chọn dự án', 400)
    const rows = Array.isArray(b.rows) ? b.rows : []
    if (rows.length === 0) return errorResponse('File không có dòng nào', 400)

    // PR items của dự án + map khớp theo mã kho / mã VT
    const prItems = await prisma.purchaseRequestItem.findMany({
      where: { purchaseRequest: { projectId: b.projectId } },
      select: { id: true, itemCode: true, matCode: true, description: true, reqQty: true },
    })
    const byMat = new Map<string, string>(); const byCode = new Map<string, string>()
    for (const p of prItems) { if (p.matCode) byMat.set(norm(p.matCode), p.id); if (p.itemCode) byCode.set(norm(p.itemCode), p.id) }
    const reqById = new Map(prItems.map(p => [p.id, Number(p.reqQty) || 0]))

    // Cache vendor + contract theo tên/mã để tránh tạo trùng.
    const vendorCache = new Map<string, string>()
    const findOrCreateVendor = async (name: string): Promise<string | null> => {
      const key = name.toLowerCase(); if (!name) return null
      if (vendorCache.has(key)) return vendorCache.get(key)!
      let v = await prisma.vendor.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })
      if (!v) v = await prisma.vendor.create({ data: { vendorCode: `VND-${sani(name)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`, name, category: 'SUPPLIER', isActive: true }, select: { id: true } })
      vendorCache.set(key, v.id); return v.id
    }
    const findOrCreateContract = async (code: string, vendorName: string, tradeType: 'DOMESTIC' | 'IMPORT', imp?: Partial<Row>): Promise<string | null> => {
      if (!code) return null
      const vendorId = await findOrCreateVendor(vendorName)
      if (!vendorId) return null
      const existing = await prisma.purchaseContract.findUnique({ where: { contractCode: code }, select: { id: true } })
      const impFields = tradeType === 'IMPORT' && imp ? { vendorCountry: S(imp.impCountry) || null, exportPort: S(imp.impExportPort) || null, importLcDate: d(imp.impLcDate), cifDate: d(imp.impCifDate), paymentDate: d(imp.impPaymentDate), customsDate: d(imp.impCustomsDate), arrivedDate: d(imp.impArrivedDate), qcInvitationDate: d(imp.impQcInvitation) } : {}
      if (existing) { await prisma.purchaseContract.update({ where: { id: existing.id }, data: { tradeType, ...impFields } }); return existing.id }
      const c = await prisma.purchaseContract.create({ data: { contractCode: code, contractType: tradeType === 'IMPORT' ? 'HDMB' : 'HDMB', tradeType, projectId: b.projectId, vendorId, title: `HĐ ${code}`, status: 'ACTIVE', createdBy: user.userId, ...impFields }, select: { id: true } })
      return c.id
    }
    const upsertItem = async (contractId: string, prItemId: string, itemCode: string, qty: number, weight: number, price: number, delivered: number, handover: Date | null) => {
      const totalNoVat = qty * price
      const ex = await prisma.purchaseContractItem.findFirst({ where: { contractId, prItemId }, select: { id: true } })
      const data = { itemCode: itemCode || null, contractQty: qty, contractWeight: weight, unitPriceNoVat: price, totalNoVat, totalWithVat: totalNoVat * 1.1, deliveredQty: delivered, handoverDate: handover }
      if (ex) { await prisma.purchaseContractItem.update({ where: { id: ex.id }, data }); return ex.id }
      const it = await prisma.purchaseContractItem.create({ data: { contractId, prItemId, ...data }, select: { id: true } })
      return it.id
    }
    const upsertQc = async (contractItemId: string, type: 'DOMESTIC' | 'IMPORT', reportNo: string, result: string, acceptedQty: number) => {
      if (!reportNo && !result) return
      const ex = await prisma.contractInspection.findFirst({ where: { contractItemId, inspectionType: type }, select: { id: true } })
      const data = { reportNo: reportNo || null, result: result || null, acceptedQty }
      if (ex) await prisma.contractInspection.update({ where: { id: ex.id }, data })
      else await prisma.contractInspection.create({ data: { contractItemId, inspectionType: type, ...data } })
    }

    let matched = 0, prUpdated = 0, contractsUpserted = 0, itemsUpserted = 0
    const loi: Array<{ dong: number; ly_do: string }> = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const prId = (r.matCode && byMat.get(norm(S(r.matCode)))) || (r.itemCode && byCode.get(norm(S(r.itemCode)))) || null
      if (!prId) { loi.push({ dong: i + 2, ly_do: `không khớp PR (${S(r.itemCode) || S(r.matCode)})` }); continue }
      matched++
      const contractCodes = new Set<string>()

      // DOM
      let domQty = 0, domDelivered = 0
      if (S(r.domContractNo)) {
        const cid = await findOrCreateContract(S(r.domContractNo), S(r.domVendor), 'DOMESTIC')
        if (cid) {
          contractsUpserted++; contractCodes.add(S(r.domContractNo))
          domQty = N(r.domQty); domDelivered = N(r.domDelivered)
          const iid = await upsertItem(cid, prId, S(r.itemCode), domQty, N(r.domWeight), N(r.domPrice), domDelivered, d(r.domHandoverDate)); itemsUpserted++
          await upsertQc(iid, 'DOMESTIC', S(r.domQcReport), S(r.domQcResult), 0)
        }
      }
      // IMP
      let impQty = 0, impDelivered = 0
      if (S(r.impContractNo)) {
        const cid = await findOrCreateContract(S(r.impContractNo), S(r.impVendor), 'IMPORT', r)
        if (cid) {
          contractsUpserted++; contractCodes.add(S(r.impContractNo))
          impQty = N(r.impQty); impDelivered = N(r.impDelivered)
          const iid = await upsertItem(cid, prId, S(r.itemCode), impQty, N(r.impWeight), N(r.impPrice), impDelivered, null); itemsUpserted++
          await upsertQc(iid, 'IMPORT', S(r.impQcReport), S(r.impQcResult), 0)
        }
      }

      // Cập nhật PR: tồn + cần mua + trạng thái suy ra
      const req = reqById.get(prId) || 0
      const remain = r.remainQty != null && S(r.remainQty) !== '' ? N(r.remainQty) : undefined
      const purchased = (domDelivered || domQty) + (impDelivered || impQty)
      const status = inferStatusFlag({ hasHandover: !!d(r.domHandoverDate), qcResult: S(r.domQcResult) || S(r.impQcResult), arrivedDate: d(r.impArrivedDate), purchasedQty: purchased, reqQty: req, hasContract: contractCodes.size > 0 })
      await prisma.purchaseRequestItem.update({ where: { id: prId }, data: { ...(remain !== undefined ? { remainQty: remain, toBuyQty: Math.max(0, req - remain) } : {}), statusFlag: status } })
      prUpdated++
    }

    return successResponse({ soDongNhan: rows.length, matched, prUpdated, contractsUpserted, itemsUpserted, soKhongKhop: loi.length, loi: loi.slice(0, 30) },
      `Đã cập nhật ${prUpdated} dòng PR · ${itemsUpserted} dòng HĐ${loi.length ? ` · ${loi.length} dòng không khớp` : ''}`)
  } catch (err) {
    console.error('POST master-tracking/update error:', err)
    return errorResponse('Lỗi cập nhật mua sắm', 500)
  }
}
