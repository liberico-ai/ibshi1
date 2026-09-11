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

      const duyet = await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}/decide`, {
        method: 'POST', headers: H(bgd), body: JSON.stringify({ decision: 'APPROVE' }),
      })
      const duyetJson = await duyet.json()
      kiem('BGĐ duyệt được', duyet.ok, duyetJson.message)

      const lan2 = await fetch(`${BASE}/api/procurement/commerce-approvals/${dot.id}/decide`, {
        method: 'POST', headers: H(bgd), body: JSON.stringify({ decision: 'REJECT', reason: 'đổi ý' }),
      })
      kiem('duyệt rồi thì không quyết lại được', lan2.status === 409, `HTTP ${lan2.status}`)

      const ban = await prisma.syncOutbox.findFirst({
        where: { event: 'approval.decided', entityId: dot.id },
        select: { payload: true, status: true },
      })
      kiem('quyết định đã xếp hàng đẩy về TM', !!ban && ban.payload?.decision === 'APPROVED',
        ban ? `trạng thái ${ban.status}` : 'không thấy bản tin')

      const lai2 = await fetch(`${BASE}/api/integration/commerce/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Commerce-Signature': ky }, body: than,
      })
      kiem('TM không ghi đè được đợt đã duyệt', lai2.status === 409, `HTTP ${lai2.status}`)
    }

    console.log(`\nKết quả: ${dat} đạt · ${hong} hỏng`)
    if (hong > 0) process.exitCode = 1
  } finally {
    await donDep()
    console.log('Đã dọn dữ liệu thử.')
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error('LỖI:', e); process.exitCode = 1; prisma.$disconnect() })
