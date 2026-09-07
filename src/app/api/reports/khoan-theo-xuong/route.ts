import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { getWorkshopScope } from '@/lib/workshop-scope'
import { getAcceptanceByItem, shopKey } from '@/lib/apl-pricing'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

// GET /api/reports/khoan-theo-xuong
//
// Báo cáo khối lượng hoàn thành & giá trị khoán theo XƯỞNG → DỰ ÁN → LỆNH.
//
// Tiền của MỘT LỆNH = KL đã nghiệm thu của lệnh × ĐƠN GIÁ CỦA XƯỞNG nhận lệnh đó.
//
// Mỗi xưởng làm một khâu nên có đơn giá riêng (KTKH nhập ở màn Đơn giá khoán). Xưởng chưa
// có đơn giá thì tiền = 0. Lấy đúng cùng một phép tính với màn đơn giá để hai nơi không lệch.

interface WoRow {
  woId: string; woCode: string; item: string | null; status: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  amount: number | null
}

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  // Xưởng chỉ thấy xưởng mình; BGĐ/PM/KTKH/Kế toán thấy toàn bộ. Dùng chung luật với
  // màn Sản xuất và Phiếu công việc để ba nơi không nói ba số khác nhau.
  const { scope, scopeMissing } = await getWorkshopScope(user.userId, user.roleCode)
  if (scopeMissing) {
    return successResponse({ workshops: [], scope: null, scopeMissing: true })
  }

  const wos = await prisma.workOrder.findMany({
    where: {
      status: { not: 'CANCELLED' },
      ...(scope ? { OR: [{ departmentId: scope.departmentId }, { teamCode: scope.code }] } : {}),
    },
    select: {
      id: true, woCode: true, status: true, teamCode: true, departmentId: true,
      aplImportId: true, aplItem: true, plannedWeight: true, completedQty: true,
      projectId: true, project: { select: { projectCode: true, projectName: true } },
      department: { select: { code: true, name: true } },
    },
  })

  // Gom theo bản APL để mỗi bản chỉ tính tiền MỘT lần (một ITEM có thể nhiều lệnh).
  const importIds = [...new Set(wos.map(w => w.aplImportId).filter(Boolean) as string[])]
  const priced = new Map<string, {
    acceptance: Awaited<ReturnType<typeof getAcceptanceByItem>>
    priceOfShop: Map<string, number>
  }>()
  for (const importId of importIds) {
    const [acceptance, shopPrices] = await Promise.all([
      getAcceptanceByItem(importId),
      prisma.aplItemWorkshopPrice.findMany({
        where: { importId }, select: { item: true, teamCode: true, unitPrice: true },
      }),
    ])
    const priceOfShop = new Map(shopPrices.map(x => [shopKey(x.item, x.teamCode), Number(x.unitPrice)]))
    priced.set(importId, { acceptance, priceOfShop })
  }

  /** Tra số của một lệnh trong bản APL của nó. */
  const woNumbers = (w: (typeof wos)[number]): WoRow => {
    const plannedKg = Number(w.plannedWeight) || 0
    const reportedKg = Number(w.completedQty) || 0
    const p = w.aplImportId ? priced.get(w.aplImportId) : null
    const acc = p?.acceptance.get(w.aplItem || '')
    const mine = acc?.wos.find(x => x.woCode === w.woCode)
    const acceptedKg = mine?.acceptedKg ?? 0
    // Xưởng chưa có đơn giá → để null (0 đọc như "làm không công"); màn đơn giá tính là 0.
    const team = w.department?.code || w.teamCode || ''
    const unit = p?.priceOfShop.get(shopKey(w.aplItem || '', team))
    const amount = unit === undefined ? null : Math.round(acceptedKg * unit)
    return {
      woId: w.id, woCode: w.woCode, item: w.aplItem, status: w.status,
      plannedKg, reportedKg, acceptedKg,
      ratio: plannedKg > 0 ? Math.min(1, acceptedKg / plannedKg) : 0,
      amount,
    }
  }

  // ── Xưởng → Dự án → Lệnh ──
  const nameOfTeam = new Map(PRODUCTION_WORKSHOPS.map(w => [w.code, w.name]))
  const byTeam = new Map<string, Map<string, {
    projectId: string; projectCode: string; projectName: string; wos: WoRow[]
  }>>()
  for (const w of wos) {
    const team = w.department?.code || w.teamCode || ''
    if (!team) continue                       // lệnh chưa gắn xưởng thì không thuộc báo cáo này
    const projects = byTeam.get(team) || new Map()
    const p = projects.get(w.projectId) || {
      projectId: w.projectId,
      projectCode: w.project.projectCode,
      projectName: w.project.projectName,
      wos: [] as WoRow[],
    }
    p.wos.push(woNumbers(w))
    projects.set(w.projectId, p)
    byTeam.set(team, projects)
  }

  const sum = (rows: WoRow[], f: (r: WoRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const workshops = [...byTeam.entries()].map(([code, projects]) => {
    const projectRows = [...projects.values()].map(p => {
      const plannedKg = sum(p.wos, r => r.plannedKg)
      const acceptedKg = sum(p.wos, r => r.acceptedKg)
      return {
        ...p,
        wos: p.wos.sort((a, b) => b.acceptedKg - a.acceptedKg),
        woCount: p.wos.length,
        plannedKg, acceptedKg,
        reportedKg: sum(p.wos, r => r.reportedKg),
        ratio: plannedKg > 0 ? acceptedKg / plannedKg : 0,
        amount: sum(p.wos, r => r.amount ?? 0),
        // Còn xưởng chưa đặt đơn giá → tổng tiền chưa đủ, phải nói ra chứ không im lặng.
        woWithoutPrice: p.wos.filter(r => r.amount === null).length,
      }
    }).sort((a, b) => b.amount - a.amount)

    const allWos = projectRows.flatMap(p => p.wos)
    const plannedKg = sum(allWos, r => r.plannedKg)
    const acceptedKg = sum(allWos, r => r.acceptedKg)
    return {
      teamCode: code,
      teamName: nameOfTeam.get(code) || code,
      projectCount: projectRows.length,
      woCount: allWos.length,
      plannedKg, acceptedKg,
      reportedKg: sum(allWos, r => r.reportedKg),
      ratio: plannedKg > 0 ? acceptedKg / plannedKg : 0,
      amount: sum(allWos, r => r.amount ?? 0),
      woWithoutPrice: allWos.filter(r => r.amount === null).length,
      projects: projectRows,
    }
  }).sort((a, b) => b.amount - a.amount)

  // ── Tổng TOÀN BÁO CÁO: mỗi ITEM chỉ tính MỘT lần ──
  //
  // Một ITEM 68.888 kg giao cho 5 xưởng thì mỗi xưởng nhận trọn 68.888 kg — đó là KHỐI LƯỢNG
  // VIỆC của từng xưởng, đúng khi nhìn theo xưởng. Nhưng cộng ngang qua các xưởng thì thành
  // 344.440 kg, trong khi thép chỉ có 68.888 kg. Tổng phải đếm mỗi ITEM một lần.
  //
  // Khoá gộp là (bản APL, ITEM). Với mỗi khoá, lấy khối lượng của MỘT xưởng — cụ thể là xưởng
  // có tổng lớn nhất, vì lệnh cũ phát hành theo từng cụm nên một xưởng có thể giữ nhiều lệnh
  // cùng ITEM mà mỗi lệnh là một phần khác nhau; lấy max thì không hụt phần nào.
  const perKey = new Map<string, Map<string, { planned: number; reported: number; accepted: number }>>()
  const standalone = { planned: 0, reported: 0, accepted: 0 }
  for (const w of wos) {
    const team = w.department?.code || w.teamCode || ''
    if (!team) continue
    const n = woNumbers(w)
    // Lệnh không gắn ITEM thì không chia sẻ khối lượng với ai — cộng thẳng.
    if (!w.aplImportId || !w.aplItem) {
      standalone.planned += n.plannedKg
      standalone.reported += n.reportedKg
      standalone.accepted += n.acceptedKg
      continue
    }
    const key = `${w.aplImportId}::${w.aplItem}`
    const byTeamOfKey = perKey.get(key) || new Map()
    const cur = byTeamOfKey.get(team) || { planned: 0, reported: 0, accepted: 0 }
    cur.planned += n.plannedKg
    cur.reported += n.reportedKg
    cur.accepted += n.acceptedKg
    byTeamOfKey.set(team, cur)
    perKey.set(key, byTeamOfKey)
  }
  const totals = { ...standalone }
  for (const byTeamOfKey of perKey.values()) {
    const rows = [...byTeamOfKey.values()]
    totals.planned += Math.max(...rows.map(r => r.planned))
    totals.reported += Math.max(...rows.map(r => r.reported))
    totals.accepted += Math.max(...rows.map(r => r.accepted))
  }

  return successResponse({
    workshops,
    // Tổng đã khử trùng ITEM — KHÔNG bằng tổng cộng ngang các xưởng, và đó là chủ ý.
    totals: {
      plannedKg: Math.round(totals.planned * 100) / 100,
      reportedKg: Math.round(totals.reported * 100) / 100,
      acceptedKg: Math.round(totals.accepted * 100) / 100,
      // Tổng khối lượng VIỆC (cộng ngang các xưởng) — để đối chiếu, không phải tấn thép.
      workloadKg: workshops.reduce((s, w) => s + w.plannedKg, 0),
    },
    scope, scopeMissing: false,
  })
}
