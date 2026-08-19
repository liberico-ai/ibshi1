import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']
const DEFAULT_WEIGHTS = { price: 0.5, quality: 0.3, paymentTerms: 0.2 } // Giá 50% · Chất lượng 30% · Thanh toán 20%

type Weights = { price: number; quality: number; paymentTerms: number }
function readWeights(v: unknown): Weights {
  const w = (v && typeof v === 'object') ? v as Record<string, unknown> : {}
  const num = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 ? x : d)
  return { price: num(w.price, DEFAULT_WEIGHTS.price), quality: num(w.quality, DEFAULT_WEIGHTS.quality), paymentTerms: num(w.paymentTerms, DEFAULT_WEIGHTS.paymentTerms) }
}

/** GET — danh sách điểm NCC (sắp theo điểm tổng giảm dần) + trọng số đang dùng. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const bid = await prisma.bidAnalysis.findUnique({ where: { id }, select: { weightingCriteria: true } })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)
    const scores = await prisma.bidVendorScore.findMany({
      where: { bidAnalysisId: id }, orderBy: { overallScore: 'desc' },
      select: { vendorName: true, priceScore: true, qualityScore: true, paymentScore: true, overallScore: true },
    })
    return successResponse({ scores, weights: readWeights(bid.weightingCriteria) })
  } catch (err) {
    console.error('GET vendor-scores error:', err)
    return errorResponse('Lỗi tải điểm NCC', 500)
  }
}

/** POST — chấm điểm 1 NCC. body: { vendorName, priceScore, qualityScore, paymentScore, criteria? } (điểm 0-100). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền chấm điểm', 403)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { vendorName?: string; priceScore?: number; qualityScore?: number; paymentScore?: number; criteria?: unknown }

    const vendorName = String(body.vendorName || '').trim()
    if (!vendorName) return errorResponse('Thiếu tên NCC', 400)
    const chk = (x: unknown, label: string): number | null => {
      const n = Number(x)
      if (!Number.isFinite(n) || n < 0 || n > 100) { badField = `Điểm ${label} phải trong khoảng 0–100`; return null }
      return n
    }
    let badField = ''
    const priceScore = chk(body.priceScore, 'giá')
    const qualityScore = chk(body.qualityScore, 'chất lượng')
    const paymentScore = chk(body.paymentScore, 'thanh toán')
    if (badField) return errorResponse(badField, 400)

    const bid = await prisma.bidAnalysis.findUnique({ where: { id }, select: { status: true, weightingCriteria: true, vendors: { select: { vendorName: true } } } })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)
    if (bid.status === 'CONTRACTED') return errorResponse('BID đã ký hợp đồng', 409)
    if (!bid.vendors.some(v => v.vendorName === vendorName)) return errorResponse('NCC không thuộc BID này', 404)

    // Trọng số: request.criteria đè & lưu lại; else lấy trên bid; else mặc định.
    const weights = body.criteria ? readWeights(body.criteria) : readWeights(bid.weightingCriteria)
    const overall = priceScore! * weights.price + qualityScore! * weights.quality + paymentScore! * weights.paymentTerms

    await prisma.$transaction(async (tx) => {
      if (body.criteria) await tx.bidAnalysis.update({ where: { id }, data: { weightingCriteria: weights } })
      await tx.bidVendorScore.upsert({
        where: { bidAnalysisId_vendorName: { bidAnalysisId: id, vendorName } },
        create: { bidAnalysisId: id, vendorName, priceScore: priceScore!, qualityScore: qualityScore!, paymentScore: paymentScore!, overallScore: overall, scoredBy: payload.userId },
        update: { priceScore: priceScore!, qualityScore: qualityScore!, paymentScore: paymentScore!, overallScore: overall, scoredBy: payload.userId, scoredAt: new Date() },
      })
    })
    return successResponse({ vendorName, overallScore: overall, weights }, `Đã chấm điểm ${vendorName}: ${overall.toFixed(1)}`)
  } catch (err) {
    console.error('POST vendor-scores error:', err)
    return errorResponse('Lỗi chấm điểm', 500)
  }
}
