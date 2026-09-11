import { createHmac, timingSafeEqual } from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { commerceWebhookSecret } from './config'

// Chiều Thương mại → ERP.
//
// Thương mại gọi vào ERP qua một cổng duy nhất, ký HMAC-SHA256 trên đúng phần thân request.
// Không ký thì ai cũng đẩy được dữ liệu mua sắm vào ERP — nên thiếu bí mật là TỪ CHỐI hết,
// chứ không "tạm cho qua".

/** Kiểm chữ ký của Thương mại trên thân request. */
export function chuKyDung(body: string, chuKy: string | null): boolean {
  const bimat = commerceWebhookSecret()
  if (!bimat || !chuKy) return false
  const mong = createHmac('sha256', bimat).update(body).digest('hex')
  const a = Buffer.from(mong, 'utf8')
  const b = Buffer.from(chuKy.trim(), 'utf8')
  // So sánh theo thời gian hằng số: so bằng === thì kẻ tấn công dò được từng ký tự qua thời gian.
  return a.length === b.length && timingSafeEqual(a, b)
}

const so = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const chu = (v: unknown): string => String(v ?? '').trim()

export interface KetQuaNhan {
  ok: boolean
  message: string
  id?: string
  canhBao?: string[]
  /**
   * Mã HTTP nên trả khi hỏng. Phải phân biệt được hai loại hỏng, vì Thương mại xử lý khác nhau:
   *   400 — gói tin thiếu/sai dữ liệu → sửa gói tin rồi gửi lại
   *   404 — không tìm thấy bản ghi để gắn vào → đồng bộ thứ còn thiếu trước
   *   409 — đụng trạng thái không cho ghi (đợt đã duyệt) → ĐỪNG gửi lại, phải trình đợt mới
   * Trả 409 cho cả ba thì bên kia không biết nên thử lại hay bỏ cuộc.
   */
  ma?: number
}

// ── Đợt báo giá trình BGĐ duyệt ──────────────────────────────────────────────

interface DongBaoGia {
  lineNo?: number
  itemCode?: string
  itemName?: string
  profile?: string | null
  grade?: string | null
  uom?: string
  quantity?: number
  vendorName?: string | null
  unitPrice?: number
  totalPrice?: number
  estUnitPrice?: number | null
  offers?: unknown
  notes?: string | null
}

export interface GoiTrinhDuyet {
  remoteId: string
  bidCode: string
  projectCode: string
  subject?: string
  selectionMode?: string | null
  currency?: string
  totalValue?: number
  fileUrl?: string | null
  submittedBy?: string | null
  submittedAt?: string
  lines?: DongBaoGia[]
  snapshot?: unknown
}

/**
 * Nhận một đợt báo giá Thương mại trình BGĐ duyệt.
 *
 * Gọi lại lần hai với cùng `remoteId` thì CẬP NHẬT đợt cũ (TM sửa rồi trình lại), không đẻ
 * thêm bản ghi. Nhưng đợt đã có quyết định của BGĐ thì KHÔNG cho ghi đè — quyết định đã ký
 * là dữ liệu gốc của ERP, TM muốn đổi thì phải trình đợt mới.
 */
export async function nhanTrinhDuyet(goi: GoiTrinhDuyet): Promise<KetQuaNhan> {
  const remoteId = chu(goi.remoteId)
  const bidCode = chu(goi.bidCode)
  const projectCode = chu(goi.projectCode)
  if (!remoteId || !bidCode || !projectCode) {
    return { ok: false, ma: 400, message: 'Thiếu remoteId / bidCode / projectCode' }
  }

  const canhBao: string[] = []
  const duAn = await prisma.project.findFirst({
    where: { projectCode }, select: { id: true },
  })
  // Không tra ra dự án thì VẪN nhận, nhưng ghi rõ cảnh báo: chặn ở đây là chặn luôn việc duyệt
  // của BGĐ, mà mã lệch nhau là chuyện sửa được ở bảng ánh xạ chứ không phải lỗi của TM.
  if (!duAn) canhBao.push(`Không tìm thấy dự án mã "${projectCode}" trong ERP — đợt duyệt chưa gắn dự án`)

  const cu = await prisma.commerceApproval.findUnique({
    where: { remoteId }, select: { id: true, status: true },
  })
  if (cu && cu.status !== 'PENDING') {
    return { ok: false, ma: 409, message: `Đợt ${bidCode} đã ${cu.status === 'APPROVED' ? 'được duyệt' : 'bị từ chối'} — trình lại thì tạo đợt mới`, id: cu.id }
  }

  const dong = (goi.lines ?? []).map((l, i) => ({
    lineNo: l.lineNo ?? i + 1,
    itemCode: chu(l.itemCode),
    itemName: chu(l.itemName),
    profile: l.profile ?? null,
    grade: l.grade ?? null,
    uom: chu(l.uom),
    quantity: so(l.quantity),
    vendorName: l.vendorName ?? null,
    unitPrice: so(l.unitPrice),
    totalPrice: so(l.totalPrice),
    estUnitPrice: l.estUnitPrice === null || l.estUnitPrice === undefined ? null : so(l.estUnitPrice),
    // Cột Json: để trống thì truyền undefined, không truyền null — Prisma coi null là
    // "ghi giá trị JSON null" chứ không phải "bỏ trống ô".
    offers: (l.offers ?? undefined) as Prisma.InputJsonValue | undefined,
    notes: l.notes ?? null,
  }))

  const chung = {
    bidCode,
    projectCode,
    projectId: duAn?.id ?? null,
    subject: chu(goi.subject) || bidCode,
    selectionMode: goi.selectionMode ?? null,
    currency: chu(goi.currency) || 'VND',
    totalValue: so(goi.totalValue),
    fileUrl: goi.fileUrl ?? null,
    snapshot: (goi.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
    submittedBy: goi.submittedBy ?? null,
    submittedAt: goi.submittedAt ? new Date(goi.submittedAt) : new Date(),
  }

  const ban = await prisma.$transaction(async tx => {
    if (cu) {
      await tx.commerceApprovalLine.deleteMany({ where: { approvalId: cu.id } })
      return tx.commerceApproval.update({
        where: { id: cu.id },
        data: { ...chung, status: 'PENDING', lines: { create: dong } },
        select: { id: true },
      })
    }
    return tx.commerceApproval.create({
      data: { remoteId, ...chung, lines: { create: dong } },
      select: { id: true },
    })
  })

  return {
    ok: true,
    id: ban.id,
    message: cu ? `Đã cập nhật đợt ${bidCode} (${dong.length} dòng)` : `Đã nhận đợt ${bidCode} (${dong.length} dòng)`,
    canhBao: canhBao.length ? canhBao : undefined,
  }
}
