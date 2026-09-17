import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { ghiLien, timLocalId } from './link'
import { syncPOtoBudget } from '@/lib/sync-engine'
import { detectPrefixSubgroup } from '@/lib/bompr-enrich'
import { generateMaterialCode } from '@/lib/material-code'
import type { KetQuaNhan } from './nhan-tu-tm'

// Nhận kết quả mua sắm từ ibs-commerce.
//
// Cố ý ghi vào CHÍNH bảng cũ của ERP (purchase_orders, vendors, purchase_contracts…) chứ không
// dựng bảng gương riêng. Lý do: ngân sách, dòng tiền, báo cáo của ERP đang đọc mấy bảng đó.
// Đổ vào bảng mới thì phải sửa lại toàn bộ phần tính tiền — vừa nhiều việc vừa dễ sai.
//
// Đổi lại phải giữ một kỷ luật: bản ghi nào do Thương mại đẩy sang thì ERP KHÔNG được sửa.
// Bảng integration_links ghi lại từng bản ghi thuộc diện đó (entity 'po' | 'vendor' | 'contract'),
// và giai đoạn cắt giao diện sẽ chặn ghi dựa vào đúng danh sách này.

const so = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const chu = (v: unknown): string => String(v ?? '').trim()
const ngay = (v: unknown): Date | null => {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

// ── Nhà cung cấp ─────────────────────────────────────────────────────────────

export interface GoiNCC {
  remoteId: string
  code: string
  name: string
  shortName?: string | null
  taxCode?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  category?: string | null
  active?: boolean
}

/**
 * Nhận một nhà cung cấp. Khoá nối là MÃ NCC — Thương mại đổi tên NCC thì ERP đổi theo,
 * nhưng đổi mã là thành một NCC khác, không phải sửa cái cũ.
 */
export async function nhanNCC(goi: GoiNCC): Promise<KetQuaNhan> {
  const code = chu(goi.code)
  const name = chu(goi.name)
  if (!code || !name) return { ok: false, ma: 400, message: 'Nhà cung cấp thiếu mã hoặc tên' }

  const chung = {
    name,
    shortName: goi.shortName ?? null,
    taxCode: goi.taxCode ?? null,
    phone: goi.phone ?? null,
    email: goi.email ?? null,
    address: goi.address ?? null,
    category: chu(goi.category) || 'MATERIAL',
    isActive: goi.active !== false,
  }
  const v = await prisma.vendor.upsert({
    where: { vendorCode: code },
    create: { vendorCode: code, ...chung },
    update: chung,
    select: { id: true },
  })
  await ghiLien({ entity: 'vendor', localId: v.id, remoteId: chu(goi.remoteId) || code, refCode: code })
  return { ok: true, id: v.id, message: `Đã nhận NCC ${code}` }
}

// ── Đơn đặt hàng ─────────────────────────────────────────────────────────────

interface DongPO {
  itemCode?: string
  itemName?: string
  profile?: string | null
  grade?: string | null
  uom?: string
  quantity?: number
  unitPrice?: number
  notes?: string | null
}

export interface GoiPO {
  remoteId: string
  poCode: string
  projectCode: string
  vendorCode: string
  vendorName?: string
  status?: string
  currency?: string
  totalValue?: number
  orderDate?: string
  deliveryDate?: string
  paymentTerms?: string | null
  notes?: string | null
  lines?: DongPO[]
}

/** Trạng thái PO bên Thương mại → trạng thái ERP. Không map được thì giữ nguyên chữ TM gửi. */
const TRANG_THAI_PO: Record<string, string> = {
  DRAFT: 'DRAFT',
  ISSUED: 'APPROVED',
  CONFIRMED: 'APPROVED',
  PARTIALLY_RECEIVED: 'PARTIAL',
  RECEIVED: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
}

/**
 * Nhận một đơn đặt hàng.
 *
 * Nhận xong thì tính lại NGÂN SÁCH ĐÃ CAM KẾT của dự án — đây chính là lý do ERP cần dữ liệu
 * PO: không có nó thì phần "đã cam kết" trong ngân sách đứng yên trong khi tiền đã hứa đi rồi.
 */
export async function nhanPO(goi: GoiPO): Promise<KetQuaNhan> {
  const poCode = chu(goi.poCode)
  const projectCode = chu(goi.projectCode)
  const vendorCode = chu(goi.vendorCode)
  if (!poCode || !vendorCode) return { ok: false, ma: 400, message: 'PO thiếu mã PO hoặc mã NCC' }

  const canhBao: string[] = []

  const duAn = projectCode
    ? await prisma.project.findFirst({ where: { projectCode }, select: { id: true } })
    : null
  if (projectCode && !duAn) canhBao.push(`Không tìm thấy dự án "${projectCode}" — PO chưa gắn dự án`)

  // NCC phải có trước PO. Thương mại đẩy PO của một NCC chưa đồng bộ thì tạo chỗ giữ chỗ,
  // để PO không rơi mất; lần đồng bộ NCC sau sẽ điền đủ thông tin vào đúng bản ghi đó.
  let ncc = await prisma.vendor.findUnique({ where: { vendorCode }, select: { id: true } })
  if (!ncc) {
    ncc = await prisma.vendor.create({
      data: {
        vendorCode,
        name: chu(goi.vendorName) || vendorCode,
        category: 'MATERIAL',
        notes: 'Tạo tự động khi nhận PO từ hệ Thương mại — chờ đồng bộ hồ sơ NCC',
      },
      select: { id: true },
    })
    canhBao.push(`NCC "${vendorCode}" chưa có trong ERP — đã tạo chỗ giữ chỗ`)
  }

  const dong = (goi.lines ?? []).map(l => ({
    itemCode: chu(l.itemCode) || null,
    description: chu(l.itemName) || null,
    profile: l.profile ?? null,
    grade: l.grade ?? null,
    unit: chu(l.uom) || null,
    quantity: so(l.quantity),
    unitPrice: so(l.unitPrice),
    notes: l.notes ?? null,
  }))

  // Tổng tiền: tin số TM gửi nếu có, không thì tự cộng từ các dòng. Không để trống —
  // PO không có giá trị thì ngân sách cam kết hụt đúng bằng cái PO đó.
  const tong = so(goi.totalValue) || dong.reduce((s, d) => s + d.quantity * d.unitPrice, 0)

  const chung = {
    projectId: duAn?.id ?? null,
    vendorId: ncc.id,
    status: TRANG_THAI_PO[chu(goi.status).toUpperCase()] || chu(goi.status).toUpperCase() || 'APPROVED',
    totalValue: tong,
    currency: chu(goi.currency) || 'VND',
    orderDate: ngay(goi.orderDate),
    deliveryDate: ngay(goi.deliveryDate),
    paymentTerms: goi.paymentTerms ?? null,
    notes: goi.notes ?? null,
  }

  const cu = await prisma.purchaseOrder.findUnique({ where: { poCode }, select: { id: true } })
  const po = await prisma.$transaction(async tx => {
    if (cu) {
      // Thay trọn danh sách dòng thay vì so từng dòng: Thương mại là nơi duy nhất được sửa PO,
      // nên bản TM gửi sang luôn là bản đúng — giữ lại dòng cũ chỉ tạo ra rác.
      await tx.purchaseOrderItem.deleteMany({ where: { poId: cu.id } })
      return tx.purchaseOrder.update({
        where: { id: cu.id },
        data: { ...chung, items: { create: dong } },
        select: { id: true, projectId: true },
      })
    }
    return tx.purchaseOrder.create({
      data: { poCode, ...chung, createdBy: 'commerce', items: { create: dong } },
      select: { id: true, projectId: true },
    })
  })

  await ghiLien({ entity: 'po', localId: po.id, remoteId: chu(goi.remoteId) || poCode, refCode: poCode })

  // Tính lại phần đã cam kết của dự án. Hỏng bước này thì PO vẫn đúng, chỉ số ngân sách trễ —
  // nên không để nó làm đổ cả lời gọi.
  if (po.projectId) {
    await syncPOtoBudget(po.projectId, po.id, 'commerce')
      .catch(e => canhBao.push(`Chưa cập nhật được ngân sách: ${(e as Error).message}`))
  }

  return {
    ok: true,
    id: po.id,
    message: `${cu ? 'Đã cập nhật' : 'Đã nhận'} PO ${poCode} (${dong.length} dòng)`,
    canhBao: canhBao.length ? canhBao : undefined,
  }
}

// ── Hàng về ──────────────────────────────────────────────────────────────────

export interface GoiHangVe {
  remoteId: string
  grnCode: string
  poCode: string
  receivedDate?: string
  note?: string | null
  lines?: { itemCode?: string; quantity?: number }[]
}

/**
 * Nhận thông báo hàng NCC đã giao.
 *
 * Ranh giới chốt 10/09/2026: Thương mại ghi nhận hàng NCC giao; ERP làm nghiệm thu QC rồi mới
 * nhập kho. Nên ở đây CHỈ cập nhật số đã nhận trên dòng PO — KHÔNG cộng vào tồn kho.
 * Cộng tồn ở đây là hàng chưa nghiệm thu đã nằm trong kho, sản xuất lĩnh ra dùng luôn.
 */
/**
 * Tài khoản đứng tên cho phiếu kho sinh từ Thương mại.
 *
 * ERP bắt mọi biến động kho phải có người thực hiện — đúng, vì kho là nơi mất mát khó lần
 * nhất. Việc này do máy ghi, nên mượn tên một tài khoản Kho; ghi chú trên phiếu nói rõ
 * nguồn là Thương mại để sau này còn truy được.
 */
async function nguoiDungTen(): Promise<string | null> {
  for (const vai of ['R05', 'R05a', 'R10', 'R01']) {
    const u = await prisma.user.findFirst({
      where: { roleCode: vai, isActive: true }, select: { id: true },
    })
    if (u) return u.id
  }
  return null
}

/**
 * Mã vật tư ERP cho một dòng PO. Đơn hàng từ Thương mại không mang mã kho của ERP, nên lần
 * đầu hàng về phải sinh một mã TẠM (isProvisional) — y như đường nhập hàng sẵn có của ERP.
 * Không có mã thì không ghi được phiếu kho, mà không có phiếu thì Kho không thấy lô hàng.
 */
async function maVatTuCuaDong(dong: {
  id: string; materialId: string | null; description: string | null;
  profile: string | null; grade: string | null; unit: string | null;
}): Promise<string> {
  if (dong.materialId) return dong.materialId
  const anh = { description: dong.description || '', profile: dong.profile || '' }
  const { prefix, subgroup } = detectPrefixSubgroup(anh)
  return prisma.$transaction(async tx => {
    const ma = await generateMaterialCode(tx, prefix, subgroup)
    const vt = await tx.material.create({
      data: {
        materialCode: ma,
        name: (anh.description || anh.profile || 'Vật tư tạm').trim(),
        unit: dong.unit || 'cái',
        category: prefix,
        specification: anh.profile || undefined,
        grade: dong.grade || undefined,
        status: 'PENDING',
        isProvisional: true,
        createdByUnit: 'TM',
      },
      select: { id: true },
    })
    await tx.purchaseOrderItem.update({ where: { id: dong.id }, data: { materialId: vt.id } })
    return vt.id
  })
}

export async function nhanHangVe(goi: GoiHangVe): Promise<KetQuaNhan> {
  const poCode = chu(goi.poCode)
  const grnCode = chu(goi.grnCode)
  if (!poCode || !grnCode) return { ok: false, ma: 400, message: 'Thiếu mã phiếu giao hàng hoặc mã PO' }

  const po = await prisma.purchaseOrder.findUnique({
    where: { poCode },
    select: {
      id: true, projectId: true, status: true,
      items: {
        select: {
          id: true, itemCode: true, quantity: true, receivedQty: true,
          materialId: true, description: true, profile: true, grade: true, unit: true,
        },
      },
    },
  })
  if (!po) return { ok: false, ma: 404, message: `Không tìm thấy PO ${poCode} trong ERP — đồng bộ PO trước` }

  const canhBao: string[] = []
  let capNhat = 0
  const nguoi = await nguoiDungTen()
  if (!nguoi) canhBao.push('ERP chưa có tài khoản Kho đang hoạt động — chỉ cộng số đã nhận, chưa ghi phiếu hàng về')
  for (const l of goi.lines ?? []) {
    const ma = chu(l.itemCode)
    const sl = so(l.quantity)
    if (!ma || sl <= 0) continue
    const dong = po.items.find(i => (i.itemCode || '') === ma)
    if (!dong) { canhBao.push(`PO ${poCode} không có dòng vật tư "${ma}"`); continue }
    // Cộng dồn: NCC giao làm nhiều đợt thì mỗi đợt một phiếu.
    const moi = Number(dong.receivedQty) + sl
    if (moi > Number(dong.quantity)) {
      canhBao.push(`Dòng "${ma}" nhận ${moi} vượt số đặt ${Number(dong.quantity)} — vẫn ghi, kiểm tra lại với NCC`)
    }
    await prisma.purchaseOrderItem.update({ where: { id: dong.id }, data: { receivedQty: moi } })

    // Bản ghi "hàng về" — CHỈ GHI NHẬN, KHÔNG cộng tồn kho. Tồn chỉ tăng ở bước Kho nhập
    // sau khi QAQC nghiệm thu đạt. Nhưng phải có bản ghi này thì màn Kho mới thấy lô hàng.
    if (nguoi) {
      const materialId = await maVatTuCuaDong(dong)
      await prisma.stockMovement.create({
        data: {
          materialId,
          projectId: po.projectId,
          type: 'RECEIPT',
          quantity: sl,
          reason: 'po_receipt',
          referenceNo: poCode,
          poItemId: dong.id,
          performedBy: nguoi,
          notes: `Hàng về từ ${poCode} — phiếu ${grnCode} (Thương mại)`,
        },
      })
    }
    capNhat++
  }

  // Trạng thái PO đi theo số đã nhận, để danh sách đơn hàng của ERP nói đúng sự thật.
  if (capNhat > 0) {
    const sau = await prisma.purchaseOrder.findUnique({
      where: { id: po.id }, select: { items: { select: { quantity: true, receivedQty: true } } },
    })
    const ds = sau?.items ?? []
    const duCa = ds.length > 0 && ds.every(i => Number(i.receivedQty) >= Number(i.quantity))
    const coIt = ds.some(i => Number(i.receivedQty) > 0)
    const moi = duCa ? 'RECEIVED' : coIt ? 'PARTIAL_RECEIVED' : null
    if (moi && moi !== po.status) {
      await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: moi } })
    }
  }

  await ghiLien({ entity: 'grn', localId: po.id, remoteId: chu(goi.remoteId) || grnCode, refCode: grnCode })

  return {
    ok: true,
    id: po.id,
    message: `Đã ghi hàng về ${grnCode} cho PO ${poCode} (${capNhat} dòng) — chờ QC nghiệm thu rồi Kho nhập`,
    canhBao: canhBao.length ? canhBao : undefined,
  }
}

// ── Mời QC nghiệm thu ────────────────────────────────────────────────────────

/**
 * Hàng về kho thì THƯƠNG MẠI là người mời QC — họ mới biết hàng đã tới, tới bao nhiêu.
 * Nhưng NGHIỆM THU là việc của QAQC bên ERP. Hai vai tách hẳn: mời một nơi, nghiệm thu
 * một nơi. Để cả hai cùng ghi kết quả thì chắc chắn lệch số, mà lúc đó không biết tin ai.
 */
export interface GoiMoiQC {
  /** Id lô hàng bên Thương mại — dùng chống trùng và để bắn kết quả ngược về đúng lô. */
  remoteId: string
  poCode: string
  requestedBy?: string | null
  requestedAt?: string
  note?: string | null
  lines?: { itemCode?: string; itemName?: string; quantity?: number; uom?: string }[]
}

/** Việc QAQC phải xem khi nghiệm thu vật tư mua về. Thiếu hạng mục nào thì bổ sung ở đây. */
const VIEC_KIEM_VAT_TU = [
  { checkItem: 'Đúng chủng loại, quy cách so với đơn hàng', standard: 'Theo dòng PO' },
  { checkItem: 'Số lượng thực giao khớp phiếu giao hàng', standard: 'Theo phiếu giao' },
  { checkItem: 'Chứng chỉ vật liệu (CO / CQ / Mill Cert)', standard: 'Có và khớp mác thép' },
  { checkItem: 'Tình trạng bề mặt: không móp, cong vênh, gỉ nặng', standard: 'Quan sát' },
  { checkItem: 'Mã Heat / Lot truy xuất được', standard: 'Ghi lại khi nhập kho' },
]

/** Mã biên bản chưa ai dùng. Một PO giao nhiều đợt thì mỗi đợt một biên bản riêng. */
async function maBienBanTrong(poCode: string): Promise<string> {
  const goc = `NT-${poCode}`
  for (let i = 0; i < 50; i++) {
    const ma = i === 0 ? goc : `${goc}-${i + 1}`
    const co = await prisma.inspection.findUnique({ where: { inspectionCode: ma }, select: { id: true } })
    if (!co) return ma
  }
  return `${goc}-${Date.now()}`
}

/**
 * Thương mại mời QC → ERP sinh biên bản nghiệm thu vật tư chờ QAQC.
 *
 * Trước đây QAQC phải tự lập biên bản bằng tay, nghĩa là phải có ai đó nhắn cho họ biết
 * hàng đã về. Việc truyền miệng đó chính là chỗ rơi.
 */
export async function nhanMoiQC(goi: GoiMoiQC): Promise<KetQuaNhan> {
  const remoteId = chu(goi.remoteId)
  const poCode = chu(goi.poCode)
  if (!remoteId || !poCode) return { ok: false, ma: 400, message: 'Thiếu remoteId hoặc mã PO' }

  // Mời lại cùng một lô thì trả về đúng biên bản cũ, không đẻ thêm.
  const daCo = await timLocalId('qc-request', remoteId)
  if (daCo) {
    const bb = await prisma.inspection.findUnique({
      where: { id: daCo }, select: { id: true, inspectionCode: true, status: true },
    })
    if (bb) {
      return {
        ok: true, id: bb.id,
        message: `Lô này đã mời QC rồi — biên bản ${bb.inspectionCode} (${bb.status})`,
      }
    }
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { poCode },
    select: { id: true, projectId: true, vendor: { select: { name: true } } },
  })
  if (!po) return { ok: false, ma: 404, message: `Không tìm thấy PO ${poCode} trong ERP — đồng bộ PO trước` }
  // Biên bản QC buộc phải thuộc một dự án: QAQC lọc việc theo dự án, và kết quả nghiệm thu
  // đi thẳng vào hồ sơ chất lượng của dự án đó.
  if (!po.projectId) {
    return { ok: false, ma: 409, message: `PO ${poCode} chưa gắn dự án trong ERP — gắn dự án rồi mời lại` }
  }

  const inspectionCode = await maBienBanTrong(poCode)
  const bb = await prisma.inspection.create({
    data: {
      inspectionCode,
      projectId: po.projectId,
      type: 'material_incoming',
      // P3.5 là bước nghiệm thu vật tư trong quy trình — xem QC_STEP_TYPE_MAP ở workflow-engine.
      stepCode: 'P3.5',
      status: 'PENDING',
      // poIds là thứ màn Kho đọc để biết PO nào đã nghiệm thu đạt, được phép nhập.
      resultData: {
        poIds: [po.id],
        moiTuTM: {
          remoteId, poCode,
          requestedBy: goi.requestedBy ?? null,
          requestedAt: goi.requestedAt ?? new Date().toISOString(),
          note: goi.note ?? null,
          lines: goi.lines ?? [],
        },
      } as Prisma.InputJsonValue,
      remarks: goi.note ?? null,
      checklistItems: { create: VIEC_KIEM_VAT_TU },
    },
    select: { id: true },
  })

  await ghiLien({ entity: 'qc-request', localId: bb.id, remoteId, refCode: inspectionCode })

  // Báo cho QAQC. Không báo thì biên bản nằm im trong danh sách, không ai biết mà mở.
  const qaqc = await prisma.user.findMany({
    where: { roleCode: { in: ['R09', 'R09a'] }, isActive: true }, select: { id: true },
  })
  if (qaqc.length > 0) {
    await prisma.notification.createMany({
      data: qaqc.map(u => ({
        userId: u.id,
        title: 'Thương mại mời nghiệm thu vật tư',
        message: `PO ${poCode}${po.vendor?.name ? ` — ${po.vendor.name}` : ''} đã về kho. Biên bản ${inspectionCode} đang chờ nghiệm thu.`,
        type: 'qc_requested',
        linkUrl: '/dashboard/qc/inspections',
      })),
    })
  }

  return {
    ok: true, id: bb.id,
    message: `Đã lập biên bản ${inspectionCode} cho PO ${poCode} — chờ QAQC nghiệm thu`,
  }
}

/** Id ERP của một bản ghi Thương mại đã đồng bộ — dùng cho phần chặn ghi ở giai đoạn cắt. */
export async function idErpCua(entity: string, remoteId: string): Promise<string | null> {
  return timLocalId(entity, remoteId)
}
