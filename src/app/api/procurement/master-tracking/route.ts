import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)

// GET /api/procurement/master-tracking?projectId= — bảng theo dõi mua hàng tổng hợp (khớp Commerce MasterTracking):
// PR ↔ tận dụng tồn ↔ đã mua trong nước (DOM) ↔ nhập khẩu (IMP) ↔ QC ↔ so sánh với PR.
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId') || ''
    if (!projectId) return errorResponse('Cần chọn dự án', 400)

    const items = await prisma.purchaseRequestItem.findMany({
      where: { purchaseRequest: { projectId } },
      orderBy: [{ materialSubGroupCode: 'asc' }, { itemCode: 'asc' }],
      select: {
        id: true, itemCode: true, matCode: true, matCodeSource: true, description: true, profile: true, grade: true, unit: true,
        unitWeight: true, netQty: true, netWeight: true, reqQty: true, reqWeight: true, remainQty: true, remainWeight: true,
        toBuyQty: true, toBuyWeight: true, statusFlag: true, materialGroupCode: true, materialSubGroupCode: true,
        purchaseRequest: { select: { prCode: true } },
        contractItems: {
          select: {
            contractQty: true, contractWeight: true, unitPriceNoVat: true, currency: true, totalNoVat: true,
            deliveredQty: true, deliveredWeight: true, handoverDate: true, actualProfile: true, actualGrade: true,
            contract: { select: { contractCode: true, tradeType: true, signedDate: true, vendor: { select: { name: true } }, exportPort: true, importLcDate: true, cifDate: true, paymentDate: true, customsDate: true, arrivedDate: true, qcInvitationDate: true } },
            inspections: { select: { inspectionType: true, reportNo: true, inspectionDate: true, acceptedQty: true, acceptedWeight: true, result: true } },
          },
        },
      },
    })

    type CI = (typeof items)[number]['contractItems'][number]
    const grp = (cis: CI[]) => {
      const qty = cis.reduce((s, c) => s + N(c.contractQty), 0)
      const weight = cis.reduce((s, c) => s + N(c.contractWeight), 0)
      const total = cis.reduce((s, c) => s + N(c.totalNoVat), 0)
      const deliveredQty = cis.reduce((s, c) => s + N(c.deliveredQty), 0)
      const deliveredWeight = cis.reduce((s, c) => s + N(c.deliveredWeight), 0)
      const qc = cis.flatMap(c => c.inspections)
      const first = cis[0]?.contract
      return {
        contractNo: [...new Set(cis.map(c => c.contract.contractCode))].join(', '),
        vendor: [...new Set(cis.map(c => c.contract.vendor?.name).filter(Boolean))].join(', '),
        signedDate: first?.signedDate || null,
        spec: [...new Set(cis.map(c => c.actualProfile).filter(Boolean))].join(', '),
        qty, weight, unitPrice: qty > 0 ? total / qty : N(cis[0]?.unitPriceNoVat), total,
        currency: cis[0]?.currency || 'VND',
        deliveredQty, deliveredWeight,
        handoverDate: cis.map(c => c.handoverDate).filter(Boolean).sort().slice(-1)[0] || null,
        // mốc nhập khẩu (lấy từ HĐ đầu)
        exportPort: first?.exportPort || null, lcDate: first?.importLcDate || null, cifDate: first?.cifDate || null,
        paymentDate: first?.paymentDate || null, customsDate: first?.customsDate || null, arrivedDate: first?.arrivedDate || null, qcInvitationDate: first?.qcInvitationDate || null,
        // QC
        qcReportNo: [...new Set(qc.map(q => q.reportNo).filter(Boolean))].join(', '),
        qcDate: qc.map(q => q.inspectionDate).filter(Boolean).sort().slice(-1)[0] || null,
        qcAcceptedQty: qc.reduce((s, q) => s + N(q.acceptedQty), 0),
        qcAcceptedWeight: qc.reduce((s, q) => s + N(q.acceptedWeight), 0),
        qcResult: [...new Set(qc.map(q => q.result).filter(Boolean))].join(', '),
      }
    }

    const rows = items.map(it => {
      const dom = grp(it.contractItems.filter(c => c.contract.tradeType !== 'IMPORT'))
      const imp = grp(it.contractItems.filter(c => c.contract.tradeType === 'IMPORT'))
      const boughtQty = dom.qty + imp.qty
      const boughtWeight = dom.weight + imp.weight
      const reqQty = N(it.reqQty)
      const diffQty = reqQty - boughtQty
      const diffWeight = N(it.reqWeight) - boughtWeight
      const ket = diffQty > 0.001 ? 'THIEU' : diffQty < -0.001 ? 'THUA' : 'DU'
      return {
        id: it.id, prCode: it.purchaseRequest?.prCode || null, groupCode: it.materialSubGroupCode || it.materialGroupCode || 'KHAC',
        itemCode: it.itemCode, matCode: it.matCode, matCodeSource: it.matCodeSource, description: it.description,
        profile: it.profile, grade: it.grade, unit: it.unit, unitWeight: N(it.unitWeight),
        netQty: N(it.netQty), netWeight: N(it.netWeight), reqQty, reqWeight: N(it.reqWeight),
        remainQty: N(it.remainQty), remainWeight: N(it.remainWeight), toBuyQty: N(it.toBuyQty), toBuyWeight: N(it.toBuyWeight),
        statusFlag: it.statusFlag, dom, imp, boughtQty, boughtWeight, diffQty, diffWeight, ket,
      }
    })

    return successResponse({ rows, summary: { total: rows.length, thieu: rows.filter(r => r.ket === 'THIEU').length, du: rows.filter(r => r.ket === 'DU').length, thua: rows.filter(r => r.ket === 'THUA').length } })
  } catch (err) {
    console.error('GET master-tracking error:', err)
    return errorResponse('Lỗi tải bảng theo dõi mua hàng', 500)
  }
}
