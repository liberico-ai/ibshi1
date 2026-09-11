import prisma from '@/lib/db'
import { ghiLien, timLocalId } from './link'
import { syncPOtoBudget } from '@/lib/sync-engine'
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
  if (!code || !name) return { ok: false, message: 'Nhà cung cấp thiếu mã hoặc tên' }

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
  if (!poCode || !vendorCode) return { ok: false, message: 'PO thiếu mã PO hoặc mã NCC' }

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
export async function nhanHangVe(goi: GoiHangVe): Promise<KetQuaNhan> {
  const poCode = chu(goi.poCode)
  const grnCode = chu(goi.grnCode)
  if (!poCode || !grnCode) return { ok: false, message: 'Thiếu mã phiếu giao hàng hoặc mã PO' }

  const po = await prisma.purchaseOrder.findUnique({
    where: { poCode },
    select: { id: true, items: { select: { id: true, itemCode: true, quantity: true, receivedQty: true } } },
  })
  if (!po) return { ok: false, message: `Không tìm thấy PO ${poCode} trong ERP — đồng bộ PO trước` }

  const canhBao: string[] = []
  let capNhat = 0
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
    capNhat++
  }

  await ghiLien({ entity: 'grn', localId: po.id, remoteId: chu(goi.remoteId) || grnCode, refCode: grnCode })

  return {
    ok: true,
    id: po.id,
    message: `Đã ghi hàng về ${grnCode} cho PO ${poCode} (${capNhat} dòng) — chờ QC nghiệm thu rồi Kho nhập`,
    canhBao: canhBao.length ? canhBao : undefined,
  }
}

/** Id ERP của một bản ghi Thương mại đã đồng bộ — dùng cho phần chặn ghi ở giai đoạn cắt. */
export async function idErpCua(entity: string, remoteId: string): Promise<string | null> {
  return timLocalId(entity, remoteId)
}
