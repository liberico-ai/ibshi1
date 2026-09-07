import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { computePricingTotals, getAcceptanceByItem } from '@/lib/apl-pricing'

// KTKH nhập đơn giá khoán; BGĐ xem/sửa được. Vai khác chỉ đọc.
const PRICE_EDIT_ROLES = ['R01', 'R03', 'R03a']


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

  // ── Xổ một ITEM: hiện CÁC XƯỞNG ĐƯỢC GIAO ──
  //
  // Trước đây xổ ra hàng nghìn dòng cụm/chi tiết. Từ khi một ITEM giao được cho nhiều xưởng,
  // thứ KTKH cần nhìn là xưởng nào làm tới đâu — báo bao nhiêu, nghiệm thu bao nhiêu, ra tiền
  // bao nhiêu — chứ không phải danh sách chi tiết bản vẽ.
  const rawItem = url.searchParams.get('item')
  if (rawItem !== null) {
    const item = rawItem.trim()

    const acc = acceptance.get(item)

    // Đơn giá khoán đặt theo CÔNG ĐOẠN của từng lệnh. Không còn đơn giá cho cả hạng mục:
    // pha cắt và bảo ôn là hai phần việc khác nhau, không có một đơn giá chung nào đúng cả hai.
    const shopPrices = await prisma.aplItemWorkshopPrice.findMany({
      where: { importId: imp.id, item }, select: { teamCode: true, stageCode: true, unitPrice: true },
    })
    // Khoá "teamCode::stageCode"; stageCode '' = lệnh chạy nguyên khối.
    const priceOfShop = new Map(shopPrices.map(x => [`${x.teamCode}::${x.stageCode}`, Number(x.unitPrice)]))
    const giaCua = (team: string | null, stageCode = '') => priceOfShop.get(`${team || ''}::${stageCode}`) ?? null

    // Từng ĐỢT nghiệm thu của mỗi lệnh — xưởng báo nhiều lần thì mỗi lần một phiếu ITP.
    const woCodes = (acc?.wos ?? []).map(w => w.woCode)
    const itps = woCodes.length
      ? await prisma.inspectionTestPlan.findMany({
          where: { workOrder: { woCode: { in: woCodes } } },
          orderBy: { createdAt: 'asc' },
          select: {
            itpCode: true, status: true, acceptedQty: true, inspectionDate: true, createdAt: true,
            workOrder: { select: { woCode: true } },
            checkpoints: {
              orderBy: { sortOrder: 'asc' },
              select: {
                status: true, acceptedQty: true,
                stage: { select: { stageCode: true, name: true, category: true, unit: true } },
              },
            },
          },
        })
      : []
    // Lệnh chia công đoạn: MỖI DÒNG công đoạn là một mục riêng, ký riêng — không gộp khối lượng
    // các công đoạn của cùng một ITP lại, vì đó là các lượt việc khác nhau trên cùng khối thép.
    const batchesByWo = new Map<string, {
      itpCode: string; stageCode: string; stage: string | null; qty: number
      date: Date | null; signed: boolean; failed: boolean
    }[]>()
    for (const i of itps) {
      const code = i.workOrder?.woCode
      if (!code) continue
      const cps = i.checkpoints
      const arr = batchesByWo.get(code) || []
      const dongCongDoan = cps.filter(c => c.stage)
      if (dongCongDoan.length > 0) {
        for (const cp of dongCongDoan) {
          arr.push({
            itpCode: i.itpCode,
            stageCode: cp.stage!.stageCode,
            stage: `${cp.stage!.stageCode} ${cp.stage!.name}${cp.stage!.category ? ' · ' + cp.stage!.category : ''}`,
            qty: cp.acceptedQty !== null ? Number(cp.acceptedQty) : 0,
            date: i.inspectionDate ?? i.createdAt,
            signed: cp.status === 'PASSED',
            failed: cp.status === 'FAILED',
          })
        }
      } else {
        arr.push({
          itpCode: i.itpCode,
          stageCode: '',
          stage: null,
          qty: i.acceptedQty !== null ? Number(i.acceptedQty) : 0,
          date: i.inspectionDate ?? i.createdAt,
          signed: cps.length > 0 && cps.every(c => c.status === 'PASSED'),
          failed: cps.some(c => c.status === 'FAILED'),
        })
      }
      batchesByWo.set(code, arr)
    }

    return successResponse({
      workshops: (acc?.wos ?? []).map(w => ({
        batches: (batchesByWo.get(w.woCode) || []).map(b => ({
          ...b,
          date: b.date ? b.date.toISOString() : null,
          // Tiền của ĐỢT tính theo đơn giá CỦA CÔNG ĐOẠN đó. Đợt chưa đủ hai chữ ký thì chưa tính.
          amount: giaCua(w.teamCode, b.stageCode) === null
            ? null
            : Math.round((b.signed ? b.qty : 0) * (giaCua(w.teamCode, b.stageCode) as number)),
        })),
        // Công đoạn của lệnh — nơi KTKH nhập đơn giá. Rỗng = lệnh chạy nguyên khối.
        stages: w.stages.map(st => {
          const gia = giaCua(w.teamCode, st.stageCode)
          return {
            id: st.id, stageCode: st.stageCode, name: st.name, category: st.category,
            unit: st.unit,
            plannedKg: st.plannedKg, reportedKg: st.reportedKg, acceptedKg: st.acceptedKg,
            ratio: st.ratio,
            unitPrice: gia,
            // Tiền của công đoạn = KL đã nghiệm thu của công đoạn × đơn giá của công đoạn.
            amount: gia === null ? null : Math.round(st.acceptedKg * gia),
            // Giá trị khoán nếu làm xong trọn công đoạn.
            plannedAmount: gia === null ? null : Math.round(st.plannedKg * gia),
          }
        }),
        woCode: w.woCode,
        teamCode: w.teamCode,
        status: w.status,
        // Đơn vị của lệnh — xưởng sơn tính m², xưởng hàn tính mét. Đơn giá của xưởng là
        // đồng trên ĐƠN VỊ NÀY, không phải đồng/kg.
        unit: w.unit,
        plannedKg: w.plannedKg,
        reportedKg: w.reportedKg,
        acceptedKg: w.acceptedKg,
        ratio: w.ratio,
        // Lệnh chia công đoạn: đơn giá nằm ở từng công đoạn, cấp lệnh không có giá riêng.
        unitPrice: w.stages.length > 0 ? null : giaCua(w.teamCode),
        // Tiền của lệnh = tổng tiền các công đoạn; lệnh nguyên khối thì theo giá của lệnh.
        amount: w.stages.length > 0
          ? Math.round(w.stages.reduce((s, st) => s + st.acceptedKg * (giaCua(w.teamCode, st.stageCode) ?? 0), 0))
          : Math.round(w.acceptedKg * (giaCua(w.teamCode) ?? 0)),
      })),
      // Không còn đơn giá cho cả hạng mục — giá đặt theo từng công đoạn.
      itemUnitPrice: null,
      // "Tổng" của hạng mục = giá trị khoán nếu làm xong hết: Σ (đơn giá công đoạn × KL giao).
      itemCap: (acc?.wos ?? []).reduce((s, w) => s + (w.stages.length > 0
        ? w.stages.reduce((n, st) => n + st.plannedKg * (giaCua(w.teamCode, st.stageCode) ?? 0), 0)
        : w.plannedKg * (giaCua(w.teamCode) ?? 0)), 0),
      // ITEM xong tới đâu = xưởng chậm nhất tới đó
      itemRatio: acc?.ratio ?? 0,
      itemAcceptedKg: acc?.acceptedKg ?? 0,
      itemPlannedKg: acc?.plannedKg ?? 0,
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
      // Một ITEM giao được cho nhiều xưởng — dòng ITEM phải nói ĐỦ, không lấy một lệnh đại diện.
      shops: a.wos.map(w => ({ teamCode: w.teamCode, woCode: w.woCode, status: w.status })),
      unitPrice: unit,
      overrides: overrideByItem.get(item) || 0,
      // Thành tiền = tổng tiền các xưởng (KL nghiệm thu của xưởng × đơn giá của xưởng).
      amount: totals.byItem.get(item)?.amount ?? 0,
      // TRẦN của hạng mục = đơn giá ITEM × KL thiết kế.
      cap: totals.byItem.get(item)?.cap ?? null,
      // Đã nghiệm thu xong ở MỌI xưởng mà tiền vẫn vượt trần → báo đỏ cho KTKH tính lại.
      overCap: totals.byItem.get(item)?.overCap ?? false,
      // Số xưởng đã có khối lượng nghiệm thu nhưng chưa đặt đơn giá (tiền của họ đang là 0).
      shopsWithoutPrice: totals.byItem.get(item)?.shopsWithoutPrice ?? 0,
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
  const shopPrices = Array.isArray(body.shopPrices) ? body.shopPrices : []
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  if (itemPrices.length === 0 && linePrices.length === 0 && shopPrices.length === 0) {
    return errorResponse('Chưa có đơn giá nào để lưu', 400)
  }
  if (itemPrices.length + linePrices.length + shopPrices.length > 5000) {
    return errorResponse('Mỗi lần lưu tối đa 5000 dòng', 400)
  }

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

  // ── Đơn giá khoán của TỪNG XƯỞNG trong một ITEM ──
  // Chỉ nhận cặp (ITEM, xưởng) có lệnh sản xuất thật, chặn ghi giá cho xưởng không được giao.
  if (shopPrices.length > 0) {
    // Đơn giá đặt theo CÔNG ĐOẠN của lệnh. Chỉ nhận đúng cặp (hạng mục, xưởng, công đoạn) có
    // thật trong các lệnh đã phát hành — gõ bừa một mã công đoạn thì không được ghi.
    const wos = await prisma.workOrder.findMany({
      where: { aplImportId: imp.id, status: { not: 'CANCELLED' } },
      select: {
        aplItem: true, teamCode: true, departmentId: true,
        department: { select: { code: true } },
        stages: { select: { stageCode: true } },
      },
    })
    const known = new Set<string>()
    for (const w of wos) {
      const team = w.department?.code || w.teamCode || ''
      const dau = `${w.aplItem || ''}::${team}`
      // '' = lệnh chạy nguyên khối; lệnh có công đoạn thì chỉ nhận theo từng mã công đoạn.
      if (w.stages.length === 0) known.add(`${dau}::`)
      else for (const st of w.stages) known.add(`${dau}::${st.stageCode}`)
    }
    for (const p of shopPrices) {
      const item = String(p.item ?? '')
      const teamCode = String(p.teamCode ?? '')
      const stageCode = String(p.stageCode ?? '')
      if (!teamCode || !known.has(`${item}::${teamCode}::${stageCode}`)) continue
      const price = parsePrice(p.unitPrice)
      if (price === undefined) continue
      if (price === null) {
        const del = await prisma.aplItemWorkshopPrice.deleteMany({
          where: { importId: imp.id, item, teamCode, stageCode },
        })
        cleared += del.count
        continue
      }
      await prisma.aplItemWorkshopPrice.upsert({
        where: { importId_item_teamCode_stageCode: { importId: imp.id, item, teamCode, stageCode } },
        create: { importId: imp.id, item, teamCode, stageCode, unitPrice: price, updatedBy: user.userId },
        update: { unitPrice: price, updatedBy: user.userId },
      })
      saved++
    }
  }

  // ── Đơn giá riêng của dòng chi tiết (giữ cho dữ liệu cũ; không còn tham gia tính tiền) ──
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
