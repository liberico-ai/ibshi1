import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { describeDbError } from '@/lib/db-missing-table'
import { indexCatalogue, matchAplMaterial, aplAliasKey, buildHistoryIndex, type IndexedMaterial } from '@/lib/apl-material-match'

export const dynamic = 'force-dynamic'

// GET /api/design/apl/[id]/material-map[?status=all|matched|unmatched|alias|grade][&q=]
// Bảng ánh xạ vật tư: mỗi cặp (mác thép × quy cách) trong APL kèm mã kho khớp được.
// Xếp theo KHỐI LƯỢNG giảm dần — khai từ trên xuống thì phủ nhanh nhất
// (đo trên file thật: ~100 cặp đầu đã phủ 80% khối lượng).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params

    const imp = await prisma.aplImport.findUnique({ where: { id }, select: { id: true, fileName: true } })
    if (!imp) return errorResponse('Không tìm thấy bản APL này', 404)

    const sp = req.nextUrl.searchParams
    const status = sp.get('status') || 'all'
    const q = (sp.get('q') || '').trim().toUpperCase()

    // Kho tri thức LỊCH SỬ: PR/BOM các dự án trước đã có người gắn quy cách với mã kho.
    // Dùng lại được vì PR ghi quy cách theo đúng ký hiệu bản vẽ như APL.
    const [pairs, materials, aliasRows, prHist, bomHist] = await Promise.all([
      prisma.aplLine.groupBy({
        by: ['grade', 'profile'],
        where: { importId: id, isAssembly: false, grade: { not: null } },
        _sum: { totalWeightKg: true },
        _count: { _all: true },
      }),
      prisma.material.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, materialCode: true, name: true, grade: true, specification: true, unit: true },
      }),
      prisma.materialCodeAlias.findMany({
        where: { aliasCode: { startsWith: 'APL:' } },
        select: { aliasCode: true, material: { select: { id: true, materialCode: true, name: true, grade: true, specification: true, unit: true } } },
      }),
      prisma.purchaseRequestItem.findMany({ where: { materialId: { not: null }, profile: { not: null } }, select: { profile: true, grade: true, materialId: true } }),
      prisma.bomItem.findMany({ where: { profile: { not: null } }, select: { profile: true, grade: true, materialId: true } }),
    ])

    const index = indexCatalogue(materials)
    const history = buildHistoryIndex([
      ...prHist.map(x => ({ profile: x.profile, grade: x.grade, materialId: x.materialId! })),
      ...bomHist.map(x => ({ profile: x.profile, grade: x.grade, materialId: x.materialId })),
    ])
    const byId = new Map(index.map(m => [m.id, m]))
    const aliases = new Map<string, IndexedMaterial>()
    for (const a of aliasRows) {
      const m = byId.get(a.material.id) || indexCatalogue([a.material])[0]
      aliases.set(a.aliasCode, m)
    }

    let rows = pairs.map(p => {
      const m = matchAplMaterial(p.grade, p.profile, index, aliases, history)
      return {
        key: aplAliasKey(p.grade, p.profile),
        grade: p.grade || '',
        profile: p.profile || '',
        lines: p._count._all,
        weightKg: p._sum.totalWeightKg || 0,
        ...m,
      }
    }).sort((a, b) => b.weightKg - a.weightKg)

    const totalW = rows.reduce((s, r) => s + r.weightKg, 0)
    const stat = {
      pairs: rows.length,
      totalWeightKg: totalW,
      alias: rows.filter(r => r.via === 'alias').length,
      rule: rows.filter(r => r.via === 'rule').length,
      history: rows.filter(r => r.via === 'history').length,
      historyWeightKg: rows.filter(r => r.via === 'history').reduce((s, r) => s + r.weightKg, 0),
      unmatched: rows.filter(r => !r.via).length,
      gradeMismatch: rows.filter(r => r.via === 'rule' && r.gradeMismatch).length,
      matchedWeightKg: rows.filter(r => r.via).reduce((s, r) => s + r.weightKg, 0),
      aliasWeightKg: rows.filter(r => r.via === 'alias').reduce((s, r) => s + r.weightKg, 0),
    }

    if (status === 'matched') rows = rows.filter(r => !!r.via)
    else if (status === 'unmatched') rows = rows.filter(r => !r.via)
    else if (status === 'alias') rows = rows.filter(r => r.via === 'alias')
    else if (status === 'history') rows = rows.filter(r => r.via === 'history')
    else if (status === 'grade') rows = rows.filter(r => r.via === 'rule' && r.gradeMismatch)
    if (q) rows = rows.filter(r => (r.grade + ' ' + r.profile + ' ' + (r.materialCode || '') + ' ' + (r.materialName || '')).toUpperCase().includes(q))

    return successResponse({ apl: imp, stat, rows: rows.slice(0, 500), shown: Math.min(rows.length, 500), matching: rows.length })
  } catch (err) {
    console.error('GET material-map error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi dựng bảng ánh xạ vật tư'), 500)
  }
}
