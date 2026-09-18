// Thử đường đồng bộ ERP ↔ ibs-commerce mà KHÔNG cần máy chủ Thương mại chạy thật.
//
// Kiểm ba việc:
//   1. ERP xếp hàng đúng dữ liệu vào hộp thư đi (dự án, dự toán, nhu cầu)
//   2. Webhook nhận đợt trình duyệt: chữ ký sai thì chặn, chữ ký đúng thì vào bảng gương
//   3. BGĐ duyệt → quyết định xếp hàng đẩy ngược về Thương mại
//
// Chỉ chạy trên DB dev. Dọn sạch những gì nó tạo ra.
//
//   node scripts/thu-dong-bo-commerce.mjs

import 'dotenv/config'
import { createHmac } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }),
})
const BASE = process.env.THU_BASE_URL || 'http://localhost:3000'
const BIMAT = process.env.COMMERCE_WEBHOOK_SECRET || ''

const SEL = { id: true, username: true, roleCode: true, userLevel: true, fullName: true }
const the = u => jwt.sign(
  { userId: u.id, username: u.username, roleCode: u.roleCode, userLevel: u.userLevel, fullName: u.fullName },
  process.env.JWT_SECRET, { expiresIn: 3600 })
const H = u => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${the(u)}` })

let dat = 0, hong = 0
const kiem = (nhan, ok, themVao = '') => {
  console.log(`  ${ok ? '✔' : '✘'} ${nhan}${themVao ? ' — ' + themVao : ''}`)
  ok ? dat++ : hong++
}

async function main() {
  console.log('DB:', new URL(process.env.DATABASE_URL).hostname, '\n')
  if (!BIMAT) {
    console.log('THIẾU COMMERCE_WEBHOOK_SECRET trong .env — không kiểm được webhook.')
    process.exitCode = 1
    return
  }

  const duAn = await prisma.project.findFirst({
    where: { projectCode: { not: '' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, projectCode: true, projectName: true },
  })
  const bgd = await prisma.user.findFirst({ where: { roleCode: 'R01' }, select: SEL })
  if (!duAn || !bgd) throw new Error('Cần ít nhất một dự án và một tài khoản BGĐ trên dev')
  console.log(`Dự án thử: ${duAn.projectCode} — ${duAn.projectName}\n`)

  const REMOTE_ID = `thu-dong-bo-${Date.now()}`
  const donDep = async () => {
    await prisma.commerceApproval.deleteMany({ where: { remoteId: REMOTE_ID } })
    await prisma.syncOutbox.deleteMany({ where: { idemKey: { contains: REMOTE_ID } } })
    const lien = await prisma.integrationLink.findMany({ where: { entity: 'qc-request', remoteId: { contains: REMOTE_ID } } })
    for (const l of lien) {
      await prisma.inspectionItem.deleteMany({ where: { inspectionId: l.localId } })
      await prisma.inspection.deleteMany({ where: { id: l.localId } })
    }
    await prisma.integrationLink.deleteMany({ where: { entity: 'qc-request', remoteId: { contains: REMOTE_ID } } })
  }

  try {
    // ── 1. Xếp hàng chiều ERP → TM ──
    console.log('1. Xếp hàng ERP → Thương mại')
    const day = async (what) => {
      const r = await fetch(`${BASE}/api/integration/commerce/push`, {
        method: 'POST', headers: H(bgd), body: JSON.stringify({ what, projectId: duAn.id }),
      })
      const j = await r.json()
      return j.results?.[0] ?? { xepHang: 0, lyDo: j.error || `HTTP ${r.status}` }
    }
    const r1 = await day('project')
    kiem('đẩy dự án vào hộp thư đi', r1.xepHang === 1 || r1.lyDo === 'không đổi', r1.lyDo || 'đã xếp hàng')
    const r2 = await day('project')
    kiem('đẩy lần hai không sinh bản tin trùng', r2.xepHang === 0, r2.lyDo)
    const rd = await day('estimate')
    kiem('dự toán: có DT03 thì xếp hàng, không có thì nói rõ vì sao', !!(rd.xepHang || rd.lyDo), rd.lyDo || 'đã xếp hàng')
    const rn = await day('demand')
    kiem('nhu cầu: có BOM thì xếp hàng, không có thì nói rõ vì sao', !!(rn.xepHang || rn.lyDo), rn.lyDo || 'đã xếp hàng')

    const ban = await prisma.syncOutbox.findFirst({
      where: { event: 'project.upserted', entityId: duAn.id }, select: { payload: true },
    })
    kiem('bản tin dự án mang đúng mã dự án', ban?.payload?.code === duAn.projectCode, ban?.payload?.code)

    // ── 2. Webhook nhận đợt trình duyệt ──
    console.log('\n2. Webhook Thương mại → ERP')
    const goi = {
      event: 'bid.submitted',
      data: {
        remoteId: REMOTE_ID,
        bidCode: 'BID-THU-001',
        projectCode: duAn.projectCode,
        subject: 'Thép tấm SS400 — đợt thử đồng bộ',
        selectionMode: 'PER_ITEM',
        currency: 'VND',
        totalValue: 125_000_000,
        submittedBy: 'Lê Thị Khánh',
        submittedAt: new Date().toISOString(),
        lines: [
          { lineNo: 1, itemCode: 'VT-001', itemName: 'Thép tấm SS400 10mm', uom: 'kg',
            quantity: 5000, vendorName: 'NCC A', unitPrice: 18000, totalPrice: 90_000_000,
            estUnitPrice: 17000, offers: { 'NCC A': 18000, 'NCC B': 18500 } },
          { lineNo: 2, itemCode: 'VT-002', itemName: 'Thép hình H200', uom: 'kg',
            quantity: 2000, vendorName: 'NCC B', unitPrice: 17500, totalPrice: 35_000_000,
            estUnitPrice: 17800, offers: { 'NCC A': 17900, 'NCC B': 17500 } },
        ],
      },
    }
    const than = JSON.stringify(goi)
    const ky = createHmac('sha256', BIMAT).update(than).digest('hex')

    const sai = await fetch(`${BASE}/api/integration/commerce/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Commerce-Signature': 'sai-be-bet' }, body: than,
    })
    kiem('chữ ký sai bị chặn', sai.status === 401, `HTTP ${sai.status}`)

    const khongKy = await fetch(`${BASE}/api/integration/commerce/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: than,
    })
    kiem('không ký cũng bị chặn', khongKy.status === 401, `HTTP ${khongKy.status}`)

    const dung = await fetch(`${BASE}/api/integration/commerce/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Commerce-Signature': ky }, body: than,
    })
    const dungJson = await dung.json()
    kiem('chữ ký đúng thì nhận', dung.ok && dungJson.ok, dungJson.message || `HTTP ${dung.status}`)

    // Gói tin thiếu trường phải ra 400 (sửa rồi gửi lại được), KHÔNG phải 409 (đụng
    // trạng thái, gửi lại vô ích). Thương mại dựa vào mã này để quyết thử lại hay bỏ cuộc.
    const thieu = JSON.stringify({ event: 'bid.submitted', data: {} })
    const rThieu = await fetch(`${BASE}/api/integration/commerce/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Commerce-Signature': createHmac('sha256', BIMAT).update(thieu).digest('hex'),
      },
      body: thieu,
    })
    kiem('gói tin thiếu trường trả 400, không phải 409', rThieu.status === 400, `HTTP ${rThieu.status}`)

    const lai = await fetch(`${BASE}/api/integration/commerce/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Commerce-Signature': ky }, body: than,
    })
    const laiJson = await lai.json()
    const dem = await prisma.commerceApproval.count({ where: { remoteId: REMOTE_ID } })
    kiem('gửi lại không đẻ thêm đợt', dem === 1, `${dem} đợt trong DB · ${laiJson.message}`)

    // ── 3. BGĐ duyệt ──
    console.log('\n3. BGĐ duyệt trong ERP')
    const ds = await (await fetch(`${BASE}/api/procurement/commerce-approvals?status=PENDING`, { headers: H(bgd) })).json()
    const dot = (ds.approvals || []).find(x => x.bidCode === 'BID-THU-001')
    kiem('BGĐ thấy đợt chờ duyệt', !!dot, dot ? `${dot.lineCount} dòng · ${dot.totalValue.toLocaleString('vi-VN')} đ` : 'không thấy')

    if (dot) {
      const ct = await (await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}`, { headers: H(bgd) })).json()
      const vuot = ct.lines?.find(l => l.lineNo === 1)
      kiem('tính được phần vượt dự toán', vuot?.vuotDuToanPct === 5.9, `dòng 1 vượt ${vuot?.vuotDuToanPct}%`)
      kiem('đếm đúng số dòng vượt dự toán', ct.soDongVuotDuToan === 1, `${ct.soDongVuotDuToan} dòng`)

      const thieuLyDo = await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}/decide`, {
        method: 'POST', headers: H(bgd), body: JSON.stringify({ decision: 'REJECT' }),
      })
      kiem('trả lại mà không ghi lý do thì bị chặn', thieuLyDo.status === 400, `HTTP ${thieuLyDo.status}`)

      // ── Vòng trả lại: BGĐ trả lại → TM chọn NCC khác → trình lại → BGĐ duyệt ──
      // Vòng này phải khép được. Trước đây ERP chặn cả đợt đã trả lại, nên Thương mại
      // sửa xong không trình lại được — việc đứng im giữa đường.
      const traLai = await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}/decide`, {
        method: 'POST', headers: H(bgd),
        body: JSON.stringify({ decision: 'REJECT', reason: 'Giá NCC A cao hơn dự toán, tìm nhà khác' }),
      })
      kiem('BGĐ trả lại được', traLai.ok, (await traLai.json()).message)

      // Thương mại đổi NCC dòng 1 rồi trình lại CHÍNH đợt đó, không đẻ đợt mới.
      const goiLai = JSON.parse(than)
      goiLai.data.lines[0].vendorName = 'NCC B'
      goiLai.data.lines[0].unitPrice = 16800
      goiLai.data.lines[0].totalPrice = 84_000_000
      goiLai.data.totalValue = 119_000_000
      const thanLai = JSON.stringify(goiLai)
      const rLai = await fetch(`${BASE}/api/integration/commerce/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Commerce-Signature': createHmac('sha256', BIMAT).update(thanLai).digest('hex'),
        },
        body: thanLai,
      })
      const jLai = await rLai.json()
      kiem('đợt đã trả lại thì TM trình lại được', rLai.ok, jLai.message || `HTTP ${rLai.status}`)

      const ct2 = await (await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}`, { headers: H(bgd) })).json()
      kiem('đợt quay về hàng chờ, xoá dấu quyết định cũ',
        ct2.approval?.status === 'PENDING' && !ct2.approval?.decidedBy && !ct2.approval?.reason,
        `${ct2.approval?.status} · người quyết ${ct2.approval?.decidedBy || '—'}`)
      kiem('đếm đúng lần trình thứ hai', ct2.approval?.soLanTrinh === 2, `lần ${ct2.approval?.soLanTrinh}`)
      kiem('giữ lý do trả lại lần trước cho BGĐ đọc',
        (ct2.approval?.lyDoTraLaiTruoc || '').includes('tìm nhà khác'), ct2.approval?.lyDoTraLaiTruoc || '—')
      kiem('nhận đúng NCC mới ở dòng 1',
        ct2.lines?.find(l => l.lineNo === 1)?.vendorName === 'NCC B',
        ct2.lines?.find(l => l.lineNo === 1)?.vendorName || '—')
      const soDong = await prisma.commerceApprovalLine.count({ where: { approvalId: dot.id } })
      kiem('thay dòng cũ chứ không chồng thêm', soDong === 2, `${soDong} dòng`)

      const duyet = await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}/decide`, {
        method: 'POST', headers: H(bgd), body: JSON.stringify({ decision: 'APPROVE' }),
      })
      const duyetJson = await duyet.json()
      kiem('BGĐ duyệt được', duyet.ok, duyetJson.message)

      const lan2 = await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}/decide`, {
        method: 'POST', headers: H(bgd), body: JSON.stringify({ decision: 'REJECT', reason: 'đổi ý' }),
      })
      kiem('duyệt rồi thì không quyết lại được', lan2.status === 409, `HTTP ${lan2.status}`)

      // Đợt này có hai quyết định (trả lại rồi duyệt) nên phải lấy bản tin MỚI NHẤT,
      // không thì bắt nhầm bản tin trả lại và tưởng là hỏng.
      const ban = await prisma.syncOutbox.findFirst({
        where: { event: 'approval.decided', entityId: dot.id },
        orderBy: { createdAt: 'desc' },
        select: { payload: true, status: true },
      })
      kiem('quyết định đã xếp hàng đẩy về TM', !!ban && ban.payload?.decision === 'APPROVED',
        ban ? `trạng thái ${ban.status}` : 'không thấy bản tin')

      const lai2 = await fetch(`${BASE}/api/integration/commerce/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Commerce-Signature': ky }, body: than,
      })
      kiem('TM không ghi đè được đợt đã duyệt', lai2.status === 409, `HTTP ${lai2.status}`)
    }

    // ── 4. Kết quả mua sắm từ Thương mại về ERP ──
    console.log('\n4. Kết quả mua sắm Thương mại → ERP')
    const goiVe = (event, data) => {
      const t = JSON.stringify({ event, data })
      return fetch(`${BASE}/api/integration/commerce/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Commerce-Signature': createHmac('sha256', BIMAT).update(t).digest('hex'),
        },
        body: t,
      })
    }

    const MA_NCC = `TM-THU-${Date.now().toString().slice(-6)}`
    const MA_PO = `PO-THU-${Date.now().toString().slice(-6)}`

    const rNcc = await goiVe('vendor.upserted', {
      remoteId: `v-${MA_NCC}`, code: MA_NCC, name: 'NCC Thử Đồng Bộ',
      taxCode: '0101234567', phone: '0912345678', category: 'MATERIAL',
    })
    const jNcc = await rNcc.json()
    kiem('nhận nhà cung cấp', rNcc.ok, jNcc.message)

    const rPo = await goiVe('po.upserted', {
      remoteId: `p-${MA_PO}`, poCode: MA_PO, projectCode: duAn.projectCode, vendorCode: MA_NCC,
      status: 'ISSUED', currency: 'VND', orderDate: new Date().toISOString(),
      lines: [
        { itemCode: 'VT-001', itemName: 'Thép tấm SS400 10mm', uom: 'kg', quantity: 5000, unitPrice: 18000 },
        { itemCode: 'VT-002', itemName: 'Thép hình H200', uom: 'kg', quantity: 2000, unitPrice: 17500 },
      ],
    })
    const jPo = await rPo.json()
    kiem('nhận đơn đặt hàng', rPo.ok, jPo.message)

    const po = await prisma.purchaseOrder.findUnique({
      where: { poCode: MA_PO },
      select: { id: true, totalValue: true, projectId: true, status: true },
    })
    kiem('tự cộng tổng tiền từ các dòng', Math.round(Number(po?.totalValue)) === 125000000,
      `${Math.round(Number(po?.totalValue)).toLocaleString('vi-VN')} đ`)
    kiem('quy đổi trạng thái ISSUED → APPROVED', po?.status === 'APPROVED', po?.status)
    kiem('PO gắn đúng dự án', !!po?.projectId, po?.projectId ? 'đã gắn' : 'chưa gắn')

    const soPhieuKhoTruoc = await prisma.stockMovement.count()

    const rGrn = await goiVe('grn.received', {
      remoteId: `g-${MA_PO}`, grnCode: `GRN-${MA_PO}`, poCode: MA_PO,
      receivedDate: new Date().toISOString(),
      lines: [{ itemCode: 'VT-001', quantity: 3000 }],
    })
    const jGrn = await rGrn.json()
    kiem('nhận hàng về', rGrn.ok, jGrn.message)

    const sau = await prisma.purchaseOrder.findUnique({
      where: { poCode: MA_PO }, select: { items: { select: { itemCode: true, receivedQty: true } } },
    })
    const d1 = sau?.items.find(i => i.itemCode === 'VT-001')
    kiem('ghi số đã nhận lên dòng PO', Math.round(Number(d1?.receivedQty)) === 3000, `${Number(d1?.receivedQty)} kg`)

    const soPhieuKhoSau = await prisma.stockMovement.count()
    kiem('có ghi phiếu hàng về để Kho nhìn thấy lô hàng', soPhieuKhoSau > soPhieuKhoTruoc,
      `${soPhieuKhoTruoc} → ${soPhieuKhoSau} phiếu xuất nhập`)

    const phieu = await prisma.stockMovement.findFirst({
      where: { referenceNo: MA_PO, reason: 'po_receipt' },
      select: { type: true, quantity: true, materialId: true },
    })
    kiem('phiếu ghi đúng loại HÀNG VỀ, đúng số lượng',
      phieu?.type === 'RECEIPT' && Math.round(Number(phieu?.quantity)) === 3000,
      `${phieu?.type} · ${Number(phieu?.quantity)}`)

    // Đây mới là điều phải giữ: hàng về KHÔNG được cộng tồn. Tồn chỉ tăng khi Kho nhập,
    // mà Kho chỉ nhập được sau khi QAQC nghiệm thu đạt.
    const ton = phieu?.materialId
      ? Number((await prisma.material.findUnique({ where: { id: phieu.materialId }, select: { currentStock: true } }))?.currentStock)
      : -1
    kiem('hàng về KHÔNG cộng tồn kho (chờ QC nghiệm thu)', ton === 0, `tồn ${ton}`)

    const poLa = await goiVe('grn.received', {
      remoteId: 'g-khong-co', grnCode: 'GRN-LA', poCode: 'PO-KHONG-TON-TAI', lines: [],
    })
    kiem('hàng về của PO lạ thì báo lỗi rõ', poLa.status === 404, `HTTP ${poLa.status}`)

    // ── 5. Mời QC: Thương mại mời, QAQC bên ERP nghiệm thu ──
    console.log('\n5. Mời QC — Thương mại mời, QAQC ERP nghiệm thu')
    const qcUser = await prisma.user.findFirst({ where: { roleCode: { in: ['R09', 'R09a'] }, isActive: true }, select: SEL })
    if (!qcUser) {
      kiem('có tài khoản QAQC để nghiệm thu', false, 'dev chưa có user R09/R09a')
    } else {
      const laQC = `${REMOTE_ID}-lo1`
      const rMoi = await goiVe('qc.requested', {
        remoteId: laQC, poCode: MA_PO,
        requestedBy: 'Lê Thị Khánh', note: 'Hàng về kho ngày hôm nay, mời QAQC nghiệm thu',
        lines: [{ itemCode: 'VT-001', quantity: 3000, uom: 'kg' }],
      })
      const jMoi = await rMoi.json()
      kiem('nhận lời mời QC, lập biên bản', rMoi.ok, jMoi.message || `HTTP ${rMoi.status}`)

      const bb = await prisma.inspection.findUnique({
        where: { id: jMoi.inspectionId },
        select: { inspectionCode: true, type: true, stepCode: true, status: true, projectId: true, resultData: true, checklistItems: true },
      })
      kiem('biên bản đúng loại nghiệm thu vật tư, đang chờ',
        bb?.type === 'material_incoming' && bb?.status === 'PENDING' && bb?.stepCode === 'P3.5',
        `${bb?.inspectionCode} · ${bb?.type} · ${bb?.status}`)
      kiem('biên bản trỏ đúng PO để Kho biết lô nào được nhập',
        (bb?.resultData?.poIds || []).length === 1, `${(bb?.resultData?.poIds || []).length} PO`)
      kiem('có sẵn hạng mục cần kiểm cho QAQC', (bb?.checklistItems || []).length >= 4,
        `${(bb?.checklistItems || []).length} hạng mục`)

      const rMoiLai = await goiVe(`qc.requested`, { remoteId: laQC, poCode: MA_PO })
      const jLai = await rMoiLai.json()
      kiem('mời lại cùng lô không đẻ thêm biên bản', jLai.inspectionId === jMoi.inspectionId, jLai.message)

      const rLa = await goiVe('qc.requested', { remoteId: `${REMOTE_ID}-la`, poCode: 'PO-KHONG-TON-TAI' })
      kiem('mời QC cho PO lạ thì báo lỗi rõ', rLa.status === 404, `HTTP ${rLa.status}`)

      // QAQC nghiệm thu ĐẠT.
      const rQuyet = await fetch(`${BASE}/api/qc/${jMoi.inspectionId}`, {
        method: 'PUT', headers: H(qcUser),
        body: JSON.stringify({ status: 'PASSED', remarks: 'Đủ số lượng, có Mill Cert' }),
      })
      kiem('QAQC nghiệm thu được', rQuyet.ok, (await rQuyet.json()).message || `HTTP ${rQuyet.status}`)

      const banQC = await prisma.syncOutbox.findFirst({
        where: { event: 'qc.decided', entityId: jMoi.inspectionId },
        select: { payload: true, status: true },
      })
      kiem('kết quả nghiệm thu xếp hàng báo về Thương mại',
        banQC?.payload?.result === 'PASSED' && banQC?.payload?.remoteId === laQC,
        banQC ? `${banQC.payload?.inspectionCode} · ${banQC.payload?.result}` : 'không thấy bản tin')

      // Kho chỉ được nhập khi đã nghiệm thu đạt.
      const rKho = await fetch(`${BASE}/api/warehouse/grn-stockin`, { headers: H(bgd) })
      const jKho = await rKho.json()
      const thay = JSON.stringify(jKho).includes(MA_PO)
      kiem('nghiệm thu đạt rồi thì PO hiện ở màn Kho chờ nhập', thay, thay ? 'đã hiện' : 'chưa hiện')
    }

    // ── 6. Kho nhập hàng → tồn kho hai bên khớp nhau ──
    console.log('\n6. Kho ERP nhập hàng — tồn kho ERP là bản chuẩn')
    const thuKho = await prisma.user.findFirst({ where: { roleCode: { in: ['R05', 'R05a'] }, isActive: true }, select: SEL })
    if (!thuKho) {
      kiem('có tài khoản Kho để nhập hàng', false, 'dev chưa có user R05/R05a')
    } else {
      const dsKho = await (await fetch(`${BASE}/api/warehouse/grn-stockin`, { headers: H(thuKho) })).json()
      const poKho = (dsKho.purchaseOrders || []).find(x => x.poCode === MA_PO)
      kiem('Kho thấy lô hàng đã nghiệm thu đạt', !!poKho, poKho ? `${poKho.items.length} dòng chờ nhập` : 'không thấy')

      if (poKho) {
        const dong = poKho.items[0]
        const rNhap = await fetch(`${BASE}/api/warehouse/grn-stockin`, {
          method: 'POST', headers: H(thuKho),
          body: JSON.stringify({ poId: poKho.poId, items: [{ receiptId: dong.receiptId, actualQty: dong.claimedQty }] }),
        })
        kiem('Kho nhập được', rNhap.ok, (await rNhap.json()).message || `HTTP ${rNhap.status}`)

        const mv = await prisma.stockMovement.findFirst({
          where: { referenceNo: MA_PO, type: 'IN' }, orderBy: { createdAt: 'desc' }, select: { materialId: true },
        })
        const vt = mv && await prisma.material.findUnique({
          where: { id: mv.materialId }, select: { materialCode: true, currentStock: true, isProvisional: true },
        })
        kiem('nhập xong TỒN KHO mới tăng', Math.round(Number(vt?.currentStock)) === 3000,
          `${vt?.materialCode} = ${Number(vt?.currentStock)}`)

        // Chờ tiến trình nền dựng gói tin tồn kho.
        await new Promise(r => setTimeout(r, 3500))
        // Tồn kho đẩy theo LÔ 500 mã. Thêm một mã mới là mọi lô phía sau xê dịch theo, nên
        // phải soi cả mẻ bản tin vừa dựng chứ không riêng cái mới nhất.
        const dsKhoBan = await prisma.syncOutbox.findMany({
          where: { event: 'stock.snapshot', createdAt: { gt: new Date(Date.now() - 60_000) } },
          select: { status: true, payload: true },
        })
        const tongMa = dsKhoBan.reduce((n, b) => n + (b.payload?.items || []).length, 0)
        kiem('tồn kho tự đẩy sang Thương mại ngay sau khi nhập', dsKhoBan.length > 0,
          dsKhoBan.length ? `${dsKhoBan.length} lô · ${tongMa} mã vật tư` : 'không thấy bản tin')

        const coMaTam = dsKhoBan.some(b => (b.payload?.items || []).some(i => i.code === vt?.materialCode))
        kiem('gói tin có cả mã vật tư tạm vừa mua về', coMaTam,
          coMaTam ? `có ${vt?.materialCode}` : `thiếu ${vt?.materialCode}`)
      }
    }

    const phieuXoa = await prisma.stockMovement.findMany({
      where: { referenceNo: MA_PO }, select: { id: true, materialId: true },
    })
    await prisma.stockMovement.deleteMany({ where: { referenceNo: MA_PO } })

    const poXoa = await prisma.purchaseOrder.findUnique({ where: { poCode: MA_PO }, select: { id: true } })
    if (poXoa) {
      await prisma.purchaseOrderItem.deleteMany({ where: { poId: poXoa.id } })
      await prisma.purchaseOrder.delete({ where: { id: poXoa.id } })
    }

    await prisma.integrationLink.deleteMany({ where: { entity: 'stock-batch' } })
    await prisma.syncOutbox.deleteMany({ where: { event: 'stock.snapshot', status: 'PENDING' } })

    // Vật tư tạm xoá SAU CÙNG: dòng PO còn trỏ vào nó thì khoá ngoại chặn.
    for (const f of phieuXoa) {
      await prisma.material.deleteMany({ where: { id: f.materialId, isProvisional: true } })
    }
    await prisma.integrationLink.deleteMany({ where: { refCode: { in: [MA_NCC, MA_PO, `GRN-${MA_PO}`] } } })
    await prisma.vendor.deleteMany({ where: { vendorCode: MA_NCC } })

    console.log(`\nKết quả: ${dat} đạt · ${hong} hỏng`)
    if (hong > 0) process.exitCode = 1
  } finally {
    await donDep()
    console.log('Đã dọn dữ liệu thử.')
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error('LỖI:', e); process.exitCode = 1; prisma.$disconnect() })
