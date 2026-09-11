import prisma from '@/lib/db'
import { fetchEstimateData, aggregateBomItems } from '@/lib/data-fetchers'
import type { Dt03Row } from '@/lib/types/cross-step-data'
import { xepHang, vanTay } from './outbox'
import { khongDoi, danhDauDaDay } from './link'

// Chiều ERP → Thương mại.
//
// Bốn thứ ERP là nơi duy nhất được sửa, nên phải đẩy sang cho Thương mại dùng:
//   project  — dự án: khoá nối của mọi thứ còn lại, luôn đi trước
//   material — danh mục vật tư (ERP giữ gốc, chốt 10/09/2026)
//   estimate — dự toán vật tư: Thương mại dùng chặn mua vượt (Gate 1)
//   demand   — nhu cầu mua gom từ BOM/APL: Thương mại biến thành phiếu dự trù
//
// Mọi hàm dưới đây chỉ XẾP HÀNG vào hộp thư đi rồi trả về ngay — không gọi mạng. Việc gọi
// sang Thương mại do tiến trình nền làm, xem outbox.ts.

const so = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const chu = (v: unknown): string => String(v ?? '').trim()

export interface KetQuaDay {
  entity: string
  xepHang: number
  boQua: number
  lyDo?: string
}

// ── Dự án ────────────────────────────────────────────────────────────────────

/**
 * Đẩy một dự án sang Thương mại.
 * Mã dự án là khoá nối — bên kia tìm theo mã, không thấy thì TẠO MỚI (dự án là thứ duy nhất
 * ERP được phép sinh bên đó, vì ERP là nơi khai sinh dự án).
 */
export async function dayDuAn(projectId: string): Promise<KetQuaDay> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true, projectName: true, clientName: true, status: true, updatedAt: true },
  })
  if (!p) return { entity: 'project', xepHang: 0, boQua: 1, lyDo: 'không thấy dự án' }

  const payload = {
    erpId: p.id,
    code: p.projectCode,
    name: p.projectName,
    client: p.clientName || null,
    status: p.status,
    updatedAt: p.updatedAt.toISOString(),
  }
  const vt = vanTay(payload)
  if (await khongDoi('project', p.id, vt)) return { entity: 'project', xepHang: 0, boQua: 1, lyDo: 'không đổi' }

  await xepHang({ event: 'project.upserted', entity: 'project', entityId: p.id, payload })
  await danhDauDaDay('project', p.id, vt, p.projectCode)
  return { entity: 'project', xepHang: 1, boQua: 0 }
}

// ── Danh mục vật tư ──────────────────────────────────────────────────────────

/**
 * Đẩy danh mục vật tư. Gửi theo LÔ chứ không mỗi vật tư một bản tin: 3.975 vật tư mà mỗi cái
 * một lời gọi HTTP thì tiến trình nền chạy cả buổi và nhật ký không đọc nổi.
 */
export async function dayDanhMucVatTu(coLo = 500): Promise<KetQuaDay> {
  const ds = await prisma.material.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true, materialCode: true, name: true, nameEn: true, unit: true, category: true,
      groupCode: true, specification: true, grade: true, unitPrice: true, updatedAt: true,
    },
    orderBy: { materialCode: 'asc' },
  })

  let dem = 0
  for (let i = 0; i < ds.length; i += coLo) {
    const lo = ds.slice(i, i + coLo)
    const payload = {
      items: lo.map(m => ({
        erpId: m.id,
        code: m.materialCode,
        name: m.name,
        nameEn: m.nameEn || null,
        uom: m.unit,
        category: m.category,
        groupCode: m.groupCode,
        profile: m.specification,
        grade: m.grade,
        unitPriceEst: m.unitPrice === null ? null : Number(m.unitPrice),
      })),
    }
    const vt = vanTay(payload)
    const khoaLo = `material-batch-${i / coLo}`
    if (await khongDoi('material-batch', khoaLo, vt)) continue
    await xepHang({ event: 'material.upserted', entity: 'material', entityId: khoaLo, payload })
    await danhDauDaDay('material-batch', khoaLo, vt, khoaLo)
    dem++
  }
  return { entity: 'material', xepHang: dem, boQua: Math.ceil(ds.length / coLo) - dem }
}

// ── Dự toán vật tư ───────────────────────────────────────────────────────────

/**
 * Đẩy dự toán vật tư của một dự án — bảng DT03 trong biểu mẫu dự toán (bước P1.2).
 *
 * Thương mại dùng đúng bộ số này làm TRẦN: mua quá số lượng hoặc quá đơn giá thì Gate 1 chặn.
 * Vì vậy dự án chưa có dự toán thì KHÔNG đẩy bản rỗng sang — bản rỗng bên kia đọc thành
 * "trần bằng 0", chặn sạch mọi lệnh mua.
 */
export async function dayDuToan(projectId: string): Promise<KetQuaDay> {
  const p = await prisma.project.findUnique({
    where: { id: projectId }, select: { projectCode: true },
  })
  if (!p) return { entity: 'estimate', xepHang: 0, boQua: 1, lyDo: 'không thấy dự án' }

  const est = await fetchEstimateData(projectId, { mergeP21A: true })
  const dt03 = (est?.dt03Items as Dt03Row[] | undefined) ?? []
  if (dt03.length === 0) {
    return { entity: 'estimate', xepHang: 0, boQua: 1, lyDo: 'dự án chưa có bảng DT03' }
  }

  const payload = {
    projectCode: p.projectCode,
    source: 'DT03',
    lines: dt03
      .filter(r => chu(r.danhMuc))
      .map(r => ({
        materialGroupCode: chu(r.nhomVT) || null,
        itemName: chu(r.danhMuc),
        uom: chu(r.dvt),
        limitQty: so(r.kl),
        unitPriceEst: so(r.donGia),
        totalEst: so(r.thanhTien),
      })),
  }
  if (payload.lines.length === 0) {
    return { entity: 'estimate', xepHang: 0, boQua: 1, lyDo: 'DT03 không có dòng nào có tên danh mục' }
  }

  const vt = vanTay(payload)
  if (await khongDoi('estimate', projectId, vt)) return { entity: 'estimate', xepHang: 0, boQua: 1, lyDo: 'không đổi' }

  await xepHang({ event: 'estimate.upserted', entity: 'estimate', entityId: projectId, payload })
  await danhDauDaDay('estimate', projectId, vt, p.projectCode)
  return { entity: 'estimate', xepHang: 1, boQua: 0 }
}

// ── Nhu cầu mua ──────────────────────────────────────────────────────────────

/**
 * Đẩy nhu cầu mua gom từ BOM/APL của dự án.
 *
 * Đây là NHU CẦU, không phải phiếu dự trù. Thương mại nhận rồi tự lập phiếu, tự đánh mã, tự
 * quyết gom vào RFQ nào — ERP không can thiệp. ERP chỉ nói "dự án này cần chừng này vật tư".
 */
export async function dayNhuCau(projectId: string): Promise<KetQuaDay> {
  const p = await prisma.project.findUnique({
    where: { id: projectId }, select: { projectCode: true },
  })
  if (!p) return { entity: 'demand', xepHang: 0, boQua: 1, lyDo: 'không thấy dự án' }

  const bom = await aggregateBomItems(projectId)
  if (bom.length === 0) return { entity: 'demand', xepHang: 0, boQua: 1, lyDo: 'dự án chưa có BOM' }

  const payload = {
    projectCode: p.projectCode,
    source: 'ERP-BOM',
    lines: bom.map(b => ({
      itemCode: chu(b.code),
      itemName: chu(b.name),
      profile: chu(b.spec) || null,
      uom: chu(b.unit),
      quantity: so(b.quantity),
      sourceStep: b.source,
    })).filter(l => l.itemCode || l.itemName),
  }
  if (payload.lines.length === 0) return { entity: 'demand', xepHang: 0, boQua: 1, lyDo: 'BOM không có dòng dùng được' }

  const vt = vanTay(payload)
  if (await khongDoi('demand', projectId, vt)) return { entity: 'demand', xepHang: 0, boQua: 1, lyDo: 'không đổi' }

  await xepHang({ event: 'demand.upserted', entity: 'demand', entityId: projectId, payload })
  await danhDauDaDay('demand', projectId, vt, p.projectCode)
  return { entity: 'demand', xepHang: 1, boQua: 0 }
}

// ── Tồn kho ──────────────────────────────────────────────────────────────────

/** Đẩy tồn kho hiện tại theo lô — Thương mại trừ tồn trước khi ra RFQ. */
export async function dayTonKho(coLo = 500): Promise<KetQuaDay> {
  const ds = await prisma.material.findMany({
    where: { status: 'ACTIVE' },
    select: { materialCode: true, currentStock: true, reservedStock: true, unit: true },
    orderBy: { materialCode: 'asc' },
  })
  let dem = 0
  for (let i = 0; i < ds.length; i += coLo) {
    const lo = ds.slice(i, i + coLo)
    const payload = {
      items: lo.map(m => ({
        code: m.materialCode,
        uom: m.unit,
        onHand: Number(m.currentStock) || 0,
        reserved: Number(m.reservedStock) || 0,
      })),
    }
    const vt = vanTay(payload)
    const khoaLo = `stock-batch-${i / coLo}`
    if (await khongDoi('stock-batch', khoaLo, vt)) continue
    await xepHang({ event: 'stock.snapshot', entity: 'stock', entityId: khoaLo, payload })
    await danhDauDaDay('stock-batch', khoaLo, vt, khoaLo)
    dem++
  }
  return { entity: 'stock', xepHang: dem, boQua: Math.ceil(ds.length / coLo) - dem }
}

// ── Chạy trọn một dự án ──────────────────────────────────────────────────────

/** Đẩy trọn bộ dữ liệu ERP của một dự án. Thứ tự cố định: dự án → dự toán → nhu cầu. */
export async function dayTronDuAn(projectId: string): Promise<KetQuaDay[]> {
  return [
    await dayDuAn(projectId),
    await dayDuToan(projectId),
    await dayNhuCau(projectId),
  ]
}
