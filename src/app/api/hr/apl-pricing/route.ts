import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { computePricingTotals, getAcceptanceByItem, effectiveUnitPrice } from '@/lib/apl-pricing'

// KTKH nhập đơn giá khoán; BGĐ xem/sửa được. Vai khác chỉ đọc.
const PRICE_EDIT_ROLES = ['R01', 'R03', 'R03a']

// Một ITEM có tới ~3.200 dòng chi tiết → xổ ra phải phân trang.
const CHILD_PAGE = 200

// GET /api/hr/apl-pricing?projectId=[&item=&childPage=]
//   Không có `item`  → danh sách ITEM (mỗi ITEM = 1 lệnh sản xuất) kèm đơn giá, KL, thành tiền.
//   Có `item`        → các dòng chi tiết của ITEM đó, để đặt giá riêng khi cần.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return errorResponse('Thiếu projectId', 400)

  const imp = await prisma.aplImport.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, fileName: true, createdAt: true, totalWeightKg: true },
  })
  if (!imp) return successResponse({ apl: null, rows: [], totals: null, pricing: null })

  const acceptance = await getAcceptanceByItem(imp.id)

  // ── Xổ dòng chi tiết của MỘT ITEM ──
  const rawItem = url.searchParams.get('item')
  if (rawItem !== null) {
    const item = rawItem.trim()
    const itemWhere = item ? { item } : { OR: [{ item: null }, { item: '' }] }
    const childPage = Math.max(1, parseInt(url.searchParams.get('childPage') || '1'))

    const [childTotal, children, itemPrice] = await Promise.all([
      prisma.aplLine.count({ where: { importId: imp.id, isAssembly: false, ...itemWhere } }),
      prisma.aplLine.findMany({
        where: { importId: imp.id, isAssembly: false, ...itemWhere },
        orderBy: { rowNo: 'asc' },
        skip: (childPage - 1) * CHILD_PAGE,
        take: CHILD_PAGE,
        select: {
          id: true, drawingNo: true, assembly: true, pos: true, part: true,
          totalWeightKg: true, category: true, item: true, profile: true, grade: true,
          price: { select: { unitPrice: true } },
        },
      }),
      prisma.aplItemPrice.findUnique({
        where: { importId_item: { importId: imp.id, item } },
        select: { unitPrice: true },
      }),
    ])

    const base = itemPrice ? Number(itemPrice.unitPrice) : null
    const ratio = acceptance.get(item)?.ratio ?? 0

    return successResponse({
      children: children.map(c => {
        const own = c.price ? Number(c.price.unitPrice) : null
        const unit = effectiveUnitPrice(own, base)
        const plannedKg = Number(c.totalWeightKg) || 0
        const acceptedKg = plannedKg * ratio
        return {
          id: c.id, drawingNo: c.drawingNo, assembly: c.assembly, pos: c.pos, part: c.part,
          category: c.category, item: c.item, profile: c.profile, grade: c.grade,
          plannedKg, acceptedKg,
          unitPrice: own,                       // giá RIÊNG của dòng (null = đang ăn theo giá ITEM)
          effectiveUnitPrice: unit,
          amount: unit === null ? null : Math.round(acceptedKg * unit),
        }
      }),
      childPagination: { page: childPage, limit: CHILD_PAGE, total: childTotal, totalPages: Math.ceil(childTotal / CHILD_PAGE) },
    })
  }

  // ── Danh sách ITEM ──
  const search = (url.searchParams.get('search') || '').trim().toLowerCase()

  const [itemPrices, totals, pricing, lineOverrides] = await Promise.all([
    prisma.aplItemPrice.findMany({ where: { importId: imp.id }, select: { item: true, unitPrice: true } }),
    computePricingTotals(imp.id),
    prisma.aplPricing.findUnique({ where: { importId: imp.id } }),
    // Đếm số dòng đã đặt giá riêng, để hiện dấu cho biết ITEM đó có ngoại lệ bên trong.
    prisma.aplLinePrice.groupBy({
      by: ['aplLineId'],
      where: { importId: imp.id },
      _count: true,
    }),
  ])
  const priceOfItem = new Map(itemPrices.map(p => [p.item, Number(p.unitPrice)]))

  const overrideIds = lineOverrides.map(o => o.aplLineId)
  const overrideByItem = new Map<string, number>()
  if (overrideIds.length > 0) {
    const rows = await prisma.aplLine.findMany({
      where: { id: { in: overrideIds } },
      select: { item: true },
    })
    for (const r of rows) {
      const k = r.item || ''
      overrideByItem.set(k, (overrideByItem.get(k) || 0) + 1)
    }
  }

  // Số dòng chi tiết của mỗi ITEM — hiện cho KTKH biết bên trong có bao nhiêu để xổ ra
  const detailCounts = await prisma.aplLine.groupBy({
    by: ['item'],
    where: { importId: imp.id, isAssembly: false },
    _count: { _all: true },
  })
  const detailByItem = new Map(detailCounts.map(d => [d.item || '', d._count._all]))

  let rows = [...acceptance.entries()].map(([item, a]) => {
    const unit = priceOfItem.get(item) ?? null
    return {
      item,
      blocks: a.blocks,
      detailLines: detailByItem.get(item) || 0,
      plannedKg: a.plannedKg,
      acceptedKg: a.acceptedKg,
      woCode: a.woCode,
      woStatus: a.woStatus,
      teamCode: a.teamCode,
      unitPrice: unit,
      overrides: overrideByItem.get(item) || 0,
      // Thành tiền cộng theo dòng chi tiết (giống hệt cách tính Tổng tiền) để dòng đặt giá
      // riêng vẫn được tính — nếu lấy acceptedKg × giá ITEM thì cộng các dòng sẽ không khớp tổng.
      amount: (totals.byItem.get(item)?.linesWithoutPrice ?? 0) > 0 && unit === null
        ? null
        : (totals.byItem.get(item)?.amount ?? 0),
    }
  })
  if (search) rows = rows.filter(r => (r.item || '(không có item)').toLowerCase().includes(search))
  rows.sort((a, b) => b.plannedKg - a.plannedKg)

  // Map không đi qua JSON được — client chỉ cần các số tổng, phần byItem đã dùng ở trên.
  const { byItem: _byItem, ...totalsForClient } = totals
  void _byItem

  return successResponse({
    apl: { id: imp.id, fileName: imp.fileName, createdAt: imp.createdAt, totalWeightKg: imp.totalWeightKg },
    rows,
    totals: totalsForClient,
    pricing,
    canEdit: PRICE_EDIT_ROLES.includes(user.roleCode),
  })
}

// POST /api/hr/apl-pricing — lưu đơn giá
// body: { projectId, itemPrices?: [{ item, unitPrice }], linePrices?: [{ aplLineId, unitPrice }] }
//   unitPrice = null → xoá giá của dòng/ITEM đó
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!PRICE_EDIT_ROLES.includes(user.roleCode)) {
    return errorResponse('Chỉ Kinh tế Kỹ thuật (KTKH) hoặc BGĐ được nhập đơn giá khoán', 403)
  }

  const body = await req.json()
  const projectId = String(body.projectId || '')
  const itemPrices = Array.isArray(body.itemPrices) ? body.itemPrices : []
  const linePrices = Array.isArray(body.linePrices) ? body.linePrices : []
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  if (itemPrices.length === 0 && linePrices.length === 0) return errorResponse('Chưa có đơn giá nào để lưu', 400)
  if (itemPrices.length + linePrices.length > 5000) return errorResponse('Mỗi lần lưu tối đa 5000 dòng', 400)

  const imp = await prisma.aplImport.findFirst({
    where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true },
  })
  if (!imp) return errorResponse('Dự án chưa có bảng APL', 404)

  const existing = await prisma.aplPricing.findUnique({ where: { importId: imp.id } })
  if (existing?.status === 'COMPLETED') {
    return errorResponse('Bảng đơn giá đã chốt — không sửa được nữa', 400)
  }

  const parsePrice = (raw: unknown): number | null | undefined => {
    if (raw === null || raw === undefined || raw === '') return null   // null = xoá
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : undefined                // undefined = bỏ qua
  }

  let saved = 0
  let cleared = 0

  // ── Đơn giá theo ITEM ──
  // Chỉ nhận ITEM có thật trong bản APL này, chặn ghi bừa tên item không tồn tại.
  if (itemPrices.length > 0) {
    const known = new Set(
      (await prisma.aplLine.findMany({
        where: { importId: imp.id, isAssembly: true },
        distinct: ['item'],
        select: { item: true },
      })).map(r => r.item || '')
    )
    for (const p of itemPrices) {
      const item = String(p.item ?? '')
      if (!known.has(item)) continue
      const price = parsePrice(p.unitPrice)
      if (price === undefined) continue
      if (price === null) {
        const del = await prisma.aplItemPrice.deleteMany({ where: { importId: imp.id, item } })
        cleared += del.count
        continue
      }
      await prisma.aplItemPrice.upsert({
        where: { importId_item: { importId: imp.id, item } },
        create: { importId: imp.id, item, unitPrice: price, updatedBy: user.userId },
        update: { unitPrice: price, updatedBy: user.userId },
      })
      saved++
    }
  }

  // ── Đơn giá riêng của dòng chi tiết ──
  if (linePrices.length > 0) {
    const ids = linePrices.map((p: { aplLineId: string }) => String(p.aplLineId))
    const valid = new Set(
      (await prisma.aplLine.findMany({
        where: { id: { in: ids }, importId: imp.id, isAssembly: false }, select: { id: true },
      })).map(l => l.id)
    )
    for (const p of linePrices) {
      const lineId = String(p.aplLineId)
      if (!valid.has(lineId)) continue
      const price = parsePrice(p.unitPrice)
      if (price === undefined) continue
      if (price === null) {
        const del = await prisma.aplLinePrice.deleteMany({ where: { aplLineId: lineId } })
        cleared += del.count
        continue
      }
      await prisma.aplLinePrice.upsert({
        where: { aplLineId: lineId },
        create: { importId: imp.id, aplLineId: lineId, unitPrice: price, updatedBy: user.userId },
        update: { unitPrice: price, updatedBy: user.userId },
      })
      saved++
    }
  }

  await prisma.aplPricing.upsert({
    where: { importId: imp.id },
    create: { importId: imp.id, status: 'DRAFT' },
    update: {},
  })

  const totals = await computePricingTotals(imp.id)
  await logAudit(user.userId, 'UPDATE', 'AplPricing', imp.id, { saved, cleared, totalAmount: totals.totalAmount })

  return successResponse({ saved, cleared, totals }, `Đã lưu ${saved} đơn giá${cleared ? `, xoá ${cleared}` : ''}`)
}
