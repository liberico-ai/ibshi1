import prisma from '@/lib/db'
import { HE_TM } from './config'

// Nối danh tính hai hệ.
//
// Cùng một dự án có id khác nhau ở hai bên (ERP dùng cuid, Thương mại dùng uuid). Khoá NGHIỆP VỤ
// để nối là MÃ — mã dự án, mã vật tư, mã PO — vì đó là thứ con người đọc và đối chiếu được.
// Bảng integration_links lưu lại cặp id đã nối, để lần sau khỏi tra lại theo mã.
//
// Nguyên tắc cứng: đẩy sang mà bên kia KHÔNG tìm thấy mã thì BÁO LỖI, tuyệt đối không tự tạo
// bản ghi mới bên đó. Tự tạo là cách nhanh nhất để có hai dự án trùng tên khác mã.

export interface Lien {
  entity: string
  localId: string
  remoteId: string
  refCode?: string | null
}

/** Ghi/nhớ một cặp id đã nối. Gọi lại với cùng localId thì cập nhật, không sinh dòng mới. */
export async function ghiLien(l: Lien, system = HE_TM): Promise<void> {
  await prisma.integrationLink.upsert({
    where: { system_entity_localId: { system, entity: l.entity, localId: l.localId } },
    create: {
      system, entity: l.entity, localId: l.localId, remoteId: l.remoteId,
      refCode: l.refCode ?? null,
    },
    update: { remoteId: l.remoteId, refCode: l.refCode ?? null, syncedAt: new Date() },
  })
}

/** Id bên Thương mại của một bản ghi ERP — chưa nối thì null. */
export async function timRemoteId(entity: string, localId: string, system = HE_TM): Promise<string | null> {
  const r = await prisma.integrationLink.findUnique({
    where: { system_entity_localId: { system, entity, localId } },
    select: { remoteId: true },
  })
  return r?.remoteId ?? null
}

/** Id bên ERP của một bản ghi Thương mại — chưa nối thì null. */
export async function timLocalId(entity: string, remoteId: string, system = HE_TM): Promise<string | null> {
  const r = await prisma.integrationLink.findUnique({
    where: { system_entity_remoteId: { system, entity, remoteId } },
    select: { localId: true },
  })
  return r?.localId ?? null
}

/**
 * Đã đẩy bản ghi này với đúng nội dung đó chưa.
 * Dùng để bỏ qua những bản ghi không đổi gì — dự án 31 cái, vật tư 3.975 cái, quét lại mỗi
 * lần đồng bộ mà cái nào cũng đẩy thì vừa tốn vừa làm nhiễu nhật ký.
 */
export async function khongDoi(entity: string, localId: string, checksum: string, system = HE_TM): Promise<boolean> {
  const r = await prisma.integrationLink.findUnique({
    where: { system_entity_localId: { system, entity, localId } },
    select: { checksum: true },
  })
  return r?.checksum === checksum
}

/** Đánh dấu đã đẩy xong với vân tay nội dung tương ứng. */
export async function danhDauDaDay(
  entity: string, localId: string, checksum: string, refCode?: string | null, system = HE_TM,
): Promise<void> {
  await prisma.integrationLink.upsert({
    where: { system_entity_localId: { system, entity, localId } },
    create: {
      system, entity, localId,
      // Chưa biết id bên kia thì tạm dùng chính mã nghiệp vụ; lúc hệ kia trả id thật sẽ ghi đè.
      remoteId: refCode || localId,
      refCode: refCode ?? null, checksum,
    },
    update: { checksum, refCode: refCode ?? null, syncedAt: new Date() },
  })
}
