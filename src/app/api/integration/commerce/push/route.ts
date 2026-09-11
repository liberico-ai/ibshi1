import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { dayTronDuAn, dayDuAn, dayDuToan, dayNhuCau, dayDanhMucVatTu, dayTonKho } from '@/lib/integration/day-sang-tm'

export const dynamic = 'force-dynamic'

// POST /api/integration/commerce/push
// body: { what: 'project' | 'estimate' | 'demand' | 'all' | 'materials' | 'stock', projectId? }
//
// Đẩy TAY một phần dữ liệu sang Thương mại. Bình thường nghiệp vụ tự xếp hàng khi dữ liệu đổi;
// đường này dành cho hai tình huống có thật:
//   • nối hệ lần đầu — phải đẩy toàn bộ dự án/vật tư đang có sang một lượt
//   • một bản tin hỏng đã bị bỏ — đẩy lại đúng phần đó thay vì chờ chu kỳ sau
//
// Chỉ XẾP HÀNG, không gọi mạng. Việc gửi do /api/cron/sync-commerce làm.

const DUOC_DAY = ['R01', 'R10']

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!DUOC_DAY.includes(user.roleCode)) {
      return errorResponse('Chỉ BGĐ và Quản trị được đẩy dữ liệu sang Thương mại', 403)
    }

    const body = await req.json().catch(() => ({})) as { what?: string; projectId?: string }
    const what = String(body.what || 'all').trim()
    const projectId = String(body.projectId || '').trim()

    const canDuAn = ['project', 'estimate', 'demand', 'all'].includes(what)
    if (canDuAn && !projectId) return errorResponse(`"${what}" cần projectId`, 400)

    switch (what) {
      case 'project':   return successResponse({ results: [await dayDuAn(projectId)] })
      case 'estimate':  return successResponse({ results: [await dayDuToan(projectId)] })
      case 'demand':    return successResponse({ results: [await dayNhuCau(projectId)] })
      case 'all':       return successResponse({ results: await dayTronDuAn(projectId) })
      case 'materials': return successResponse({ results: [await dayDanhMucVatTu()] })
      case 'stock':     return successResponse({ results: [await dayTonKho()] })
      default:
        return errorResponse(`"what" phải là project | estimate | demand | all | materials | stock`, 400)
    }
  } catch (err) {
    console.error('POST /api/integration/commerce/push error:', err)
    return errorResponse('Lỗi xếp hàng dữ liệu sang Thương mại', 500)
  }
}
