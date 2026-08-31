import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import prisma from '@/lib/db'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

// GET /api/design/apl/[id]/export[?item=]
// Xuất bảng phân giao: MỖI DÒNG VÀNG một dòng Excel, để phân giao ngoài file rồi nhập ngược lại.
//
// Ba cột cuối bỏ trống cho người dùng điền (Đơn vị nhận / Bắt đầu / Hạn hoàn thành).
// Cột "Mã hệ thống" ở cuối là khoá khớp tuyệt đối khi nhập lại — ITEM + mã cụm đã gần như
// duy nhất (2.929/2.930 trên file thật) nhưng vẫn còn 1 ca trùng, có cột này thì khỏi phải đoán.
//
// KHÔNG có dropdown chọn xưởng: thư viện xlsx bản CE không ghi được data validation. Thay vào
// đó kèm sheet "Danh mục" liệt kê mã xưởng để copy cho chuẩn, và lúc nhập lại thì nhận diện mềm.

const HEAD = [
  'ITEM', 'Mã cụm', 'Mô tả', 'Khối lượng (kg)', 'Vật tư', 'Số chi tiết', 'Loại',
  'Đơn vị nhận', 'Bắt đầu (dd/mm/yyyy)', 'Hạn hoàn thành (dd/mm/yyyy)', 'Ghi chú',
  'Mã hệ thống — KHÔNG SỬA',
]
const COLS = [34, 24, 34, 14, 22, 10, 12, 14, 20, 22, 24, 28]

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params

    const imp = await prisma.aplImport.findUnique({
      where: { id },
      select: { id: true, fileName: true, sheetName: true, revision: true, createdAt: true, projectId: true },
    })
    if (!imp) return errorResponse('Không tìm thấy bản APL này', 404)

    const item = req.nextUrl.searchParams.get('item')
    const heads = await prisma.aplLine.findMany({
      where: { importId: id, isAssembly: true, ...(item !== null ? { item: item === '' ? null : item } : {}) },
      orderBy: { rowNo: 'asc' },
      select: {
        id: true, item: true, assembly: true, description: true,
        rollupWeightKg: true, rollupMaterials: true, childCount: true, blockNo: true,
      },
    })
    if (heads.length === 0) return errorResponse('Không có dòng nào để xuất', 404)

    // "Loại" để người phân giao biết ngay cái nào bỏ qua được: hàng mua thì không phải việc của
    // xưởng, cụm dưới 50kg chiếm 31% số lệnh nhưng chỉ 0,6% khối lượng.
    const blockNos = heads.map(h => h.blockNo)
    const kids = await prisma.aplLine.findMany({
      where: { importId: id, isAssembly: false, blockNo: { in: blockNos } },
      select: { blockNo: true, typeCutting: true },
    })
    const buyOnly = new Map<number, boolean>()
    for (const k of kids) {
      const isBuy = /hang mua/i.test((k.typeCutting || '').normalize('NFD').replace(/[̀-ͯ]/g, ''))
      buyOnly.set(k.blockNo, (buyOnly.get(k.blockNo) ?? true) && isBuy)
    }

    const project = imp.projectId
      ? await prisma.project.findUnique({ where: { id: imp.projectId }, select: { projectCode: true, projectName: true } })
      : null

    const rows = heads.map(h => {
      const w = h.rollupWeightKg || 0
      const mats = Array.isArray(h.rollupMaterials) ? (h.rollupMaterials as string[]) : []
      const loai = buyOnly.get(h.blockNo) ? 'HÀNG MUA' : (w > 0 && w < 50 ? 'Cụm nhỏ' : '')
      return [
        h.item || '', h.assembly || '', h.description || '',
        w ? Number(w.toFixed(2)) : '', mats.join(', '), h.childCount, loai,
        '', '', '', '',            // 4 ô để trống cho người dùng điền
        h.id,
      ]
    })

    // Khối đầu file — nhập lại thì đối chiếu để phát hiện file xuất từ bản APL cũ
    const meta = [
      ['BẢNG PHÂN GIAO LỆNH SẢN XUẤT (xuất từ APL)'],
      ['Dự án:', project ? `${project.projectCode} — ${project.projectName}` : ''],
      ['Nguồn APL:', imp.fileName, 'Sheet:', imp.sheetName, 'Bản sửa:', imp.revision || ''],
      ['Mã bản APL:', imp.id],
      ['Lọc theo ITEM:', item === null ? '(tất cả)' : (item || '(không có ITEM)'), 'Số dòng:', rows.length],
      ['Cách điền:', 'Điền cột "Đơn vị nhận" bằng MÃ XƯỞNG ở sheet Danh mục. Không sửa cột cuối.'],
      [],
    ]

    const ws = XLSX.utils.aoa_to_sheet([...meta, HEAD, ...rows])
    ws['!cols'] = COLS.map(wch => ({ wch }))
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: meta.length, c: 0 }, e: { r: meta.length + rows.length, c: HEAD.length - 1 } }) }

    const wsCat = XLSX.utils.aoa_to_sheet([
      ['MÃ XƯỞNG', 'TÊN XƯỞNG'],
      ...PRODUCTION_WORKSHOPS.map(w => [w.code, w.name]),
      [],
      ['Ghi chú:', 'Điền đúng MÃ ở cột trái vào cột "Đơn vị nhận".'],
      ['', 'Một cụm giao cho nhiều xưởng thì ghi cách nhau bằng dấu phẩy, ví dụ: XCT1, XHAN'],
    ])
    wsCat['!cols'] = [{ wch: 14 }, { wch: 30 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Phân giao')
    XLSX.utils.book_append_sheet(wb, wsCat, 'Danh mục')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const safe = (project?.projectCode || 'APL').replace(/[^A-Za-z0-9._-]+/g, '-')
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="PhanGiao-${safe}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('GET /api/design/apl/[id]/export error:', err)
    return errorResponse('Lỗi xuất bảng phân giao', 500)
  }
}
