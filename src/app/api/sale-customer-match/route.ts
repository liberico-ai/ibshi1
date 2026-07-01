import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { normName } from '@/lib/cron-jobs'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10']

// GET /api/sale-customer-match — suggest SaleCustomer matches for unlinked projects
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const projects = await prisma.project.findMany({
      where: { saleCustomerId: null, status: { not: 'CANCELLED' } },
      select: { id: true, projectCode: true, projectName: true, clientName: true },
    })

    const saleCustomers = await prisma.saleCustomer.findMany({
      select: { saleCustomerId: true, name: true, nameNorm: true, country: true, code: true },
    })

    const candidates: Array<{
      projectId: string
      projectCode: string
      clientName: string
      matches: Array<{ saleCustomerId: string; name: string; code: string | null; score: string }>
    }> = []

    for (const p of projects) {
      if (!p.clientName) continue
      const pNorm = normName(p.clientName)
      if (!pNorm) continue

      const matches: Array<{ saleCustomerId: string; name: string; code: string | null; score: string }> = []
      for (const sc of saleCustomers) {
        if (!sc.nameNorm) continue
        if (sc.nameNorm === pNorm) {
          matches.push({ saleCustomerId: sc.saleCustomerId, name: sc.name, code: sc.code, score: 'exact' })
        } else if (sc.nameNorm.includes(pNorm) || pNorm.includes(sc.nameNorm)) {
          matches.push({ saleCustomerId: sc.saleCustomerId, name: sc.name, code: sc.code, score: 'partial' })
        }
      }

      if (matches.length > 0) {
        matches.sort((a, b) => (a.score === 'exact' ? 0 : 1) - (b.score === 'exact' ? 0 : 1))
        candidates.push({
          projectId: p.id,
          projectCode: p.projectCode,
          clientName: p.clientName,
          matches: matches.slice(0, 5),
        })
      }
    }

    return successResponse({ candidates, total: candidates.length })
  } catch (err) {
    console.error('GET /api/sale-customer-match error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
