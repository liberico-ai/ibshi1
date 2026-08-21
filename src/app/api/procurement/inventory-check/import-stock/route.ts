import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R05', 'R05a', 'R07', 'R07a', 'R10']

// POST /api/procurement/inventory-check/import-stock
// body: { rows: [{ materialCode, stock, materialName?, unit? }], createMissing?: boolean }
//   - Cập nhật tồn kho hiện tại (Material.currentStock) theo mã kho.
//   - createMissing=true: mã chưa có trong danh mục → tạo Material TẠM (isProvisional) rồi set tồn (khớp Commerce).
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền nhập tồn kho', 403)

    const body = await req.json().catch(() => ({})) as { rows?: Array<{ materialCode?: unknown; stock?: unknown; materialName?: unknown; unit?: unknown }>; createMissing?: boolean }
    const rows = Array.isArray(body.rows) ? body.rows : []
    const createMissing = body.createMissing === true
    if (rows.length === 0) return errorResponse('File không có dòng nào', 400)

    let updated = 0, created = 0
    const notFound: string[] = []
    const loi: Array<{ dong: number; ly_do: string }> = []
    for (let i = 0; i < rows.length; i++) {
      const code = String(rows[i].materialCode || '').trim()
      const stock = Number(rows[i].stock)
      if (!code) { loi.push({ dong: i + 2, ly_do: 'thiếu mã kho' }); continue }
      if (!Number.isFinite(stock) || stock < 0) { loi.push({ dong: i + 2, ly_do: `mã "${code}" số tồn không hợp lệ` }); continue }
      const r = await prisma.material.updateMany({ where: { materialCode: code }, data: { currentStock: stock } })
      if (r.count > 0) { updated++; continue }
      if (createMissing) {
        // Tạo mã tạm — chờ chuẩn hóa. name/unit lấy từ file nếu có, else fallback.
        try {
          await prisma.material.create({
            data: {
              materialCode: code, name: String(rows[i].materialName || code).trim() || code,
              unit: String(rows[i].unit || '').trim() || 'cái', category: 'OTHER',
              currentStock: stock, isProvisional: true, createdByUnit: user.roleCode,
            },
          })
          created++
        } catch { loi.push({ dong: i + 2, ly_do: `không tạo được mã "${code}"` }) }
      } else notFound.push(code)
    }
    await logAudit(user.userId, 'IMPORT_STOCK', 'Material', 'bulk', { updated, created, notFound: notFound.length, loi: loi.length }, undefined)
    return successResponse(
      { soDongNhan: rows.length, updated, created, soKhongThayMa: notFound.length, notFound: notFound.slice(0, 30), loi },
      `Đã cập nhật tồn ${updated} mã${created ? `, tạo mới ${created} mã tạm` : ''}${notFound.length ? `, ${notFound.length} mã không có trong danh mục` : ''}`,
    )
  } catch (err) {
    console.error('POST import-stock error:', err)
    return errorResponse('Lỗi nhập tồn kho', 500)
  }
}
