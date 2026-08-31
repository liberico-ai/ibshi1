import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { describeDbError } from '@/lib/db-missing-table'
import { aplNeedsRepair } from '@/lib/apl-backfill'

export const dynamic = 'force-dynamic'

// GET /api/design/apl/items?projectId=[&importId=]
// Danh sách ITEM của bản APL mới nhất trong dự án — dùng cho màn "Tạo WO từ APL".
// Mỗi ITEM kèm: số dòng vàng (mỗi dòng = 1 WO) + tổng khối lượng.
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const sp = req.nextUrl.searchParams
    const projectId = (sp.get('projectId') || '').trim()
    const importId = (sp.get('importId') || '').trim()
    if (!projectId && !importId) return errorResponse('Cần projectId hoặc importId')

    let imp = importId
      ? await prisma.aplImport.findUnique({ where: { id: importId } })
      : await prisma.aplImport.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } })

    // APL nhập từ màn biểu mẫu có thể chỉ gắn taskId (chưa có projectId) → dò qua công việc.
    if (!imp && projectId) {
      const tasks = await prisma.task.findMany({ where: { projectId }, select: { id: true } })
      if (tasks.length) {
        imp = await prisma.aplImport.findFirst({
          where: { taskId: { in: tasks.map(t => t.id) } },
          orderBy: { createdAt: 'desc' },
        })
      }
    }
    if (!imp) return successResponse({ apl: null, items: [] }, 'Dự án chưa có bản APL nào')

    // Bản nhập hỏng giữa chừng: header có nhưng không dòng nào. Nói thẳng, đừng để người dùng
    // nhìn thấy "24.829 dòng" ở header rồi thắc mắc sao không chọn được gì.
    const lineCount = await prisma.aplLine.count({ where: { importId: imp.id } })
    if (lineCount === 0) {
      return successResponse({ apl: null, items: [], brokenImportId: imp.id },
        `Bản APL "${imp.fileName}" nhập lỗi giữa chừng (không có dòng nào). Hãy xoá và nhập lại.`)
    }

    // Chỉ đếm DÒNG VÀNG — mỗi dòng vàng về sau là một lệnh sản xuất.
    const grouped = await prisma.aplLine.groupBy({
      by: ['item'],
      where: { importId: imp.id, isAssembly: true },
      _count: { _all: true },
      _sum: { rollupWeightKg: true },
    })
    // ITEM nào đã phát hành lệnh rồi thì báo ngay ở danh sách — một ITEM chỉ có một lệnh,
    // không nói trước thì PM bấm vào mới biết là trùng.
    const issued = await prisma.workOrder.findMany({
      where: { aplImportId: imp.id },
      select: { woCode: true, aplItem: true, teamCode: true, status: true },
    })
    const issuedByItem = new Map(issued.map(w => [w.aplItem || '', w]))

    const items = grouped
      .map(g => {
        const key = g.item || ''
        const wo = issuedByItem.get(key)
        return {
          item: key,
          blocks: g._count._all,
          weightKg: g._sum.rollupWeightKg || 0,
          issuedWoCode: wo?.woCode ?? null,
          issuedTeamCode: wo?.teamCode || null,
          issuedStatus: wo?.status ?? null,
        }
      })
      .sort((a, b) => b.blocks - a.blocks)

    return successResponse({
      apl: {
        id: imp.id, fileName: imp.fileName, sheetName: imp.sheetName,
        revision: imp.revision, createdAt: imp.createdAt,
        totalRows: imp.totalRows, partRows: imp.partRows,
      },
      items,
      // Bản nhập trước khi có phần gộp khối → mọi dòng rơi vào nhóm "(không có ITEM)" và 0 kg.
      // Báo cho giao diện hiện nút sửa, khỏi phải nhập lại file 13MB.
      needsRepair: await aplNeedsRepair(imp.id),
    })
  } catch (err) {
    console.error('GET /api/design/apl/items error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi đọc danh sách ITEM'), 500)
  }
}
