import { createHash } from 'crypto'
import prisma from '@/lib/db'
import { HE_TM, SO_LAN_THU, GIAN_CACH_PHUT, commerceBaseUrl, commerceApiKey, sanSangGoiTM } from './config'

// Hộp thư đi.
//
// Nghiệp vụ KHÔNG gọi thẳng sang Thương mại. Nó ghi một bản tin vào bảng sync_outbox rồi trả
// lời người dùng ngay; một tiến trình nền mới gửi đi. Ba lý do:
//   • Thương mại sập hoặc mạng chậm thì người dùng ERP không phải chờ, và thay đổi không mất
//   • Gửi hỏng thì thử lại được — bản tin vẫn nằm đó, không bốc hơi trong một lời gọi fetch
//   • Luôn biết còn tồn đọng bao nhiêu, cái nào lỗi vì sao (bảng là thứ nhìn được, log thì không)

/** Vân tay nội dung — payload không đổi thì khỏi đẩy lại. */
export function vanTay(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32)
}

/**
 * Đưa một thay đổi vào hộp thư đi.
 *
 * Khoá chống trùng `idemKey` = sự kiện + bản ghi + vân tay nội dung. Cùng một thay đổi đẩy
 * hai lần (người dùng bấm lưu hai lần, hoặc job chạy chồng) chỉ sinh MỘT bản tin. Nội dung
 * đổi thật thì vân tay đổi theo và bản tin mới được xếp hàng.
 */
export async function xepHang(params: {
  event: string
  entity: string
  entityId: string
  payload: Record<string, unknown>
  system?: string
}): Promise<{ moi: boolean; id: string }> {
  const { event, entity, entityId, payload } = params
  const system = params.system || HE_TM
  const idemKey = `${system}:${event}:${entityId}:${vanTay(payload)}`

  const daCo = await prisma.syncOutbox.findUnique({ where: { idemKey }, select: { id: true } })
  if (daCo) return { moi: false, id: daCo.id }

  const ban = await prisma.syncOutbox.create({
    data: { system, event, entity, entityId, payload: payload as object, idemKey },
    select: { id: true },
  })
  return { moi: true, id: ban.id }
}

/** Thời điểm được thử lại sau lần hỏng thứ `lan`. */
function lanSau(lan: number): Date {
  const phut = GIAN_CACH_PHUT[Math.min(lan, GIAN_CACH_PHUT.length - 1)]
  return new Date(Date.now() + phut * 60_000)
}

export interface KetQuaGui {
  daGui: number
  loi: number
  conLai: number
  chuaCauHinh: boolean
}

/**
 * Gửi các bản tin đang chờ sang Thương mại.
 *
 * Gửi TUẦN TỰ theo thứ tự tạo, không gửi song song: dự án phải sang trước dự toán của nó,
 * dự toán phải sang trước nhu cầu mua. Đẩy song song thì hệ kia nhận dự toán của một dự án
 * chưa tồn tại và trả về lỗi 404 hàng loạt.
 */
export async function guiHangCho(gioiHan = 50): Promise<KetQuaGui> {
  if (!sanSangGoiTM()) return { daGui: 0, loi: 0, conLai: 0, chuaCauHinh: true }

  const cho = await prisma.syncOutbox.findMany({
    where: { status: 'PENDING', availableAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: gioiHan,
  })

  let daGui = 0
  let loi = 0
  for (const ban of cho) {
    try {
      await guiMot(ban.event, ban.payload as Record<string, unknown>, ban.idemKey)
      await prisma.syncOutbox.update({
        where: { id: ban.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: ban.attempts + 1, lastError: null },
      })
      daGui++
    } catch (e) {
      const lan = ban.attempts + 1
      // Lỗi 4xx là hệ kia TỪ CHỐI có lý do — dữ liệu sai, bản ghi không tồn tại, đợt đã
      // duyệt rồi. Gửi lại y nguyên gói tin đó thì lần nào cũng hỏng y hệt, chỉ tổ lấp đầy
      // nhật ký và che mất lỗi thật. Bỏ ngay, để người ta nhìn thấy mà xử lý.
      // Riêng 408/429 là "bận, thử lại sau" nên vẫn thử tiếp.
      const maLoi = Number(/HTTP (\d{3})/.exec((e as Error).message)?.[1] || 0)
      const tuChoiHan = maLoi >= 400 && maLoi < 500 && maLoi !== 408 && maLoi !== 429
      const het = tuChoiHan || lan >= SO_LAN_THU
      await prisma.syncOutbox.update({
        where: { id: ban.id },
        data: {
          status: het ? 'FAILED' : 'PENDING',
          attempts: lan,
          lastError: (tuChoiHan ? '[bị từ chối, không thử lại] ' : '')
            + (e as Error).message.slice(0, 460),
          availableAt: het ? ban.availableAt : lanSau(lan),
        },
      })
      loi++
    }
  }

  const conLai = await prisma.syncOutbox.count({ where: { status: 'PENDING' } })
  return { daGui, loi, conLai, chuaCauHinh: false }
}

/** Gọi một bản tin sang Thương mại. Ném lỗi để hàm gọi biết mà thử lại. */
async function guiMot(event: string, payload: Record<string, unknown>, idemKey: string): Promise<void> {
  const goc = commerceBaseUrl()!
  // Tên sự kiện 'project.upserted' → đường dẫn '/sync/project-upserted'. Một quy ước duy nhất,
  // hệ kia khỏi phải tra bảng ánh xạ.
  const duong = `${goc}/sync/${event.replace(/\./g, '-')}`
  const res = await fetch(duong, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${commerceApiKey()}`,
      'Idempotency-Key': idemKey,
      'X-IBS-Source': 'erp',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const chiTiet = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${duong} ${chiTiet.slice(0, 200)}`)
  }
}
