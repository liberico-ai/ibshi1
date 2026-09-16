import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { describeDbError } from '@/lib/db-missing-table'
import { canManageProject, notProjectPmMessage } from '@/lib/project-pm'
import { aplItemWoCode, aplItemWoDescription, rollupItemMaterials, formatMaterialsColumn } from '@/lib/apl-wo'
import { DEFAULT_WO_UNIT, isValidUnit } from '@/lib/wo-units'
import { findStage, categoriesOf, KHAC_CATEGORY, WHOLE_PROJECT_STAGES, isWholeProjectWorkshop } from '@/lib/work-catalog'
import { SUBCONTRACT_TEAM_CODE } from '@/lib/material-request-constants'
import { ensureWeeklyReportTask } from '@/lib/workflow-engine'

export const dynamic = 'force-dynamic'

// GET ?importId=&item= — xem trước một ITEM sẽ ra lệnh thế nào (khối lượng, vật tư đã cộng dồn)
// trước khi phát hành. Không ghi gì.
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const sp = req.nextUrl.searchParams
    const importId = (sp.get('importId') || '').trim()
    if (!importId) return errorResponse('Thiếu bản APL')
    // Xem trước lệnh Pha cắt CẢ DỰ ÁN: không gắn hạng mục nào nên cũng không có ITEM.
    // Chỉ cần biết những chủng loại đã giao, để màn phát hành khỏi cho giao lại.
    if (sp.get('toanDuAn') === '1') {
      const daGiao = await prisma.workOrder.findMany({
        where: { aplImportId: importId, aplItem: null },
        select: {
          woCode: true, teamCode: true, status: true,
          stages: { select: { stageCode: true, categoryCode: true, name: true, category: true, qty: true, unit: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      return successResponse({
        issuedWos: daGiao.map(w => ({
          ...w,
          stages: w.stages.map(st => ({ ...st, qty: Number(st.qty) || 0 })),
        })),
      })
    }

    const rawItem = sp.get('item')
    if (rawItem === null) return errorResponse('Thiếu ITEM')
    const item = rawItem.trim()
    const itemWhere = item ? { item } : { OR: [{ item: null }, { item: '' }] }

    const [heads, details, existing] = await Promise.all([
      prisma.aplLine.findMany({
        where: { importId, isAssembly: true, ...itemWhere },
        select: { rollupWeightKg: true },
      }),
      prisma.aplLine.findMany({
        where: { importId, isAssembly: false, ...itemWhere },
        select: { profile: true, grade: true, totalWeightKg: true },
      }),
      // Một ITEM giao được cho NHIỀU xưởng (xưởng cắt, xưởng hàn, xưởng sơn…) nên trả về
      // trọn danh sách lệnh đã phát hành, không phải một cái.
      prisma.workOrder.findMany({
        where: { aplImportId: importId, aplItem: item || null },
        // Kèm công đoạn: cùng một xưởng nhận nhiều lệnh được, miễn khác phần việc — màn phát
        // hành phải biết xưởng đó ĐÃ nhận công đoạn nào để không cho giao lại.
        select: {
          woCode: true, teamCode: true, status: true,
          stages: { select: { stageCode: true, categoryCode: true, name: true, category: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const mats = rollupItemMaterials(details)
    return successResponse({
      item,
      blocks: heads.length,
      detailLines: details.length,
      weightKg: heads.reduce((s, h) => s + (Number(h.rollupWeightKg) || 0), 0),
      materials: mats,
      // Giữ tên cũ cho chỗ nào còn đọc một lệnh; issuedWos mới là danh sách đầy đủ.
      alreadyIssued: existing[0] ?? null,
      issuedWos: existing,
    })
  } catch (err) {
    console.error('GET /api/production/work-orders/from-apl error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi xem trước ITEM'), 500)
  }
}

// POST /api/production/work-orders/from-apl
// body: { projectId, importId, item, teamCode?, plannedStart?, plannedEnd? }
//
// MỘT ITEM = MỘT WO = MỘT XƯỞNG (chốt nghiệp vụ 2026-08).
//   • Khối lượng  = tổng rollupWeightKg của mọi dòng vàng trong ITEM (đúng cột xanh ở màn chọn)
//   • Vật tư      = gom mọi dòng chi tiết trong ITEM, trùng (profile+grade) thì cộng dồn kg
//   • Thời gian   = PM nhập tay
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json().catch(() => null) as {
      projectId?: string; importId?: string; item?: string
      teamCode?: string; plannedStart?: string; plannedEnd?: string
      /** Tên thầu phụ khi teamCode = THAUPHU (giao ra ngoài). */
      subcontractorName?: string
      unit?: string; plannedQty?: number
      /** Công đoạn bên trong lệnh — tổng khối lượng không được vượt plannedQty */
      stages?: { stageCode?: string; categoryCode?: string; categoryLabel?: string; qty?: number; unit?: string; note?: string }[]
      /**
       * Giao PHA CẮT cho CẢ DỰ ÁN, không gắn hạng mục nào.
       * Pha cắt chuẩn bị vật tư cho mọi công đoạn sau nên giao một lần cho toàn dự án:
       * một lệnh mang nhiều chủng loại (tôn tấm, thép hình, khoan, sấn lốc…), mỗi chủng loại
       * một khối lượng RIÊNG do PM nhập — khác hẳn lệnh theo hạng mục, nơi các công đoạn
       * chạy qua cùng một khối thép.
       */
      toanDuAn?: boolean
    } | null
    if (!body?.projectId) return errorResponse('Thiếu dự án')
    if (!body.importId) return errorResponse('Thiếu bản APL')
    // ITEM rỗng là hợp lệ: bản APL cũ dồn hết vào nhóm "(không có ITEM)".
    const item = String(body.item ?? '').trim()
    // Lệnh Pha cắt cả dự án cố tình KHÔNG gắn hạng mục — nó phục vụ mọi hạng mục trong APL.
    if (body.toanDuAn !== true && (body.item === undefined || body.item === null)) {
      return errorResponse('Chưa chọn ITEM để phát hành')
    }

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, projectCode: true },
    })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    // XPC/XHT chỉ giao CẢ DỰ ÁN — chặn sớm việc giao theo hạng mục (trước cả kiểm tra ITEM).
    if (body.toanDuAn !== true && isWholeProjectWorkshop((body.teamCode || '').trim())) {
      return errorResponse(`Xưởng ${(body.teamCode || '').trim()} chỉ giao cả dự án, không giao theo hạng mục — dùng khối "giao cả dự án"`, 422)
    }

    // Quyền: PM phụ trách dự án (nhiều PM ngang quyền) hoặc BGĐ
    if (!(await canManageProject(user.roleCode, user.userId, project.id))) {
      const pmCount = await prisma.projectPm.count({ where: { projectId: project.id } })
      return errorResponse(notProjectPmMessage(pmCount > 0), 403)
    }

    // Khớp ITEM: chuỗi rỗng ứng với cả null lẫn '' trong DB.
    const itemWhere = item ? { item } : { OR: [{ item: null }, { item: '' }] }

    // Lệnh Pha cắt cả dự án KHÔNG đọc dòng APL: khối lượng do PM nhập theo từng chủng loại,
    // còn vật tư thì gom cả bản APL (hàng trăm nghìn dòng) vừa chậm vừa vô nghĩa — cột vật
    // tư chỉ hiện được 40 quy cách.
    const heads = body.toanDuAn === true ? [] : await prisma.aplLine.findMany({
      where: { importId: body.importId, isAssembly: true, ...itemWhere },
      select: { id: true, rollupWeightKg: true },
    })
    if (body.toanDuAn !== true && heads.length === 0) {
      return errorResponse('ITEM này không có cụm nào trong bản APL đã chọn')
    }

    // Một ITEM giao cho NHIỀU xưởng, và CÙNG một xưởng nhiều lần — mỗi lần một phần việc khác.
    // Mỗi lệnh MANG TRỌN khối lượng của ITEM (xưởng cắt cắt hết 71.504 kg, xưởng hàn hàn hết
    // 71.504 kg) — không chia nhỏ theo tỉ lệ.
    // Luật chặn trùng nằm ở dưới, sau khi đọc công đoạn: khoá là (ITEM, xưởng, công đoạn,
    // chủng loại) chứ không phải (ITEM, xưởng).
    const team = (body.teamCode || '').trim()
    // Giao THẦU PHỤ ra ngoài: teamCode=THAUPHU, woType=EXTERNAL, PM tự nhập tên thầu phụ.
    const isSub = team.toUpperCase() === SUBCONTRACT_TEAM_CODE
    const subName = String(body.subcontractorName || '').trim()
    if (isSub && !subName) return errorResponse('Chọn "Thầu phụ" thì phải nhập tên thầu phụ', 422)
    if (isSub && body.toanDuAn === true) return errorResponse('Thầu phụ giao theo hạng mục, không giao cả dự án', 422)

    const weightKg = heads.reduce((s, h) => s + (Number(h.rollupWeightKg) || 0), 0)

    // Vật tư: quét MỌI dòng chi tiết của ITEM. Một ITEM tới ~3.200 dòng nên chỉ lấy đúng
    // ba cột cần dùng, không kéo cả bản ghi về.
    const details = body.toanDuAn === true ? [] : await prisma.aplLine.findMany({
      where: { importId: body.importId, isAssembly: false, ...itemWhere },
      select: { profile: true, grade: true, totalWeightKg: true },
    })
    const mats = rollupItemMaterials(details)

    const unit = isValidUnit(body.unit) ? String(body.unit) : DEFAULT_WO_UNIT
    const rawQty = Number(body.plannedQty)
    const givenQty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : null
    // kg: mặc định lấy khối lượng thiết kế của ITEM. Đơn vị khác: chỉ nhận số PM nhập.
    const plannedQty = givenQty ?? (unit === DEFAULT_WO_UNIT && weightKg > 0 ? weightKg : null)
    // Giao diện đã chặn, server chặn lại: đơn vị khác kg thì không suy được số lượng từ khối
    // lượng ITEM. Để lệnh trống khối lượng thì nghiệm thu và tính tiền đều hỏng về sau.
    // Lệnh cả dự án lấy số PM nhập cho từng chủng loại nên không cần số ở cấp lệnh.
    if (body.toanDuAn !== true && unit !== DEFAULT_WO_UNIT && !givenQty) {
      return errorResponse(`Lệnh đo bằng ${unit} thì phải nhập số lượng — không quy đổi được từ kg`, 422)
    }

    // ── Công đoạn bên trong lệnh ──
    // MỖI công đoạn chạy qua TRỌN khối lượng đã giao cho xưởng, giống như mỗi xưởng nhận trọn
    // khối lượng của ITEM. Lệnh 24.784 kg giao ba công đoạn thì cả ba đều là 24.784 kg —
    // đó là ba lượt việc trên cùng khối thép, KHÔNG phải chia nhỏ ra để cộng lại.
    // Vì vậy KHÔNG chặn theo tổng.
    // Công đoạn phải nằm trong DANH MỤC công việc; chủng loại phải thuộc đúng công đoạn đó.
    // Nhận cả mã lẫn nhãn để báo cáo cũ vẫn đọc được khi danh mục đổi tên về sau.
    const rawStages = Array.isArray(body.stages) ? body.stages : []
    const stages: {
      stageCode: string; name: string; categoryCode: string | null; category: string | null
      qty: number; unit: string; note: string | null
    }[] = []
    for (const st of rawStages) {
      const def = findStage(String(st?.stageCode ?? '').trim())
      const qty = Number(st?.qty)
      if (!def) return errorResponse(`Công đoạn "${st?.stageCode ?? ''}" không có trong danh mục công việc`, 422)
      if (!Number.isFinite(qty) || qty <= 0) return errorResponse(`Công đoạn ${def.code} phải có khối lượng lớn hơn 0`, 422)
      // Đơn vị riêng cho từng chủng loại (cả dự án: sơn m², hàn kg…); thiếu thì lấy đơn vị lệnh.
      const stUnit = isValidUnit(st?.unit) ? String(st.unit) : unit
      const catCode = String(st?.categoryCode ?? '').trim()
      const cats = categoriesOf(def.code)
      // "Khác" — chủng loại ngoài danh mục, PM/Xưởng tự gõ tên. Khi ra tiền, chủng loại lạ ăn
      // đơn giá "Khác" của (ITEM × Xưởng). Lưu categoryCode = chính tên tự gõ để phân biệt các
      // dòng "Khác" khác nhau (không đụng mã danh mục).
      if (catCode === KHAC_CATEGORY) {
        const label = String(st?.categoryLabel ?? '').trim()
        if (!label) return errorResponse(`Công đoạn ${def.code}: chọn "Khác" thì phải nhập tên chủng loại`, 422)
        if (cats.some(c => c.code === label)) return errorResponse(`"${label}" trùng mã chủng loại có sẵn — đặt tên khác cho mục Khác`, 422)
        stages.push({
          stageCode: def.code, name: def.label,
          categoryCode: label.slice(0, 80), category: label.slice(0, 120),
          qty, unit: stUnit, note: st?.note ? String(st.note).trim() : null,
        })
        continue
      }
      const cat = catCode ? cats.find(c => c.code === catCode) : null
      if (catCode && !cat) return errorResponse(`Chủng loại "${catCode}" không thuộc công đoạn ${def.code}`, 422)
      if (!catCode && cats.length > 0) return errorResponse(`Công đoạn ${def.code} phải chọn chủng loại`, 422)
      stages.push({
        stageCode: def.code, name: def.label,
        categoryCode: cat?.code ?? null, category: cat?.label ?? null,
        qty, unit: stUnit, note: st?.note ? String(st.note).trim() : null,
      })
    }
    // ── Pha cắt cho CẢ DỰ ÁN ──
    // Một lệnh mang nhiều chủng loại, mỗi chủng loại một khối lượng riêng do PM nhập.
    // Đây là ngoại lệ có chủ ý của luật "mỗi lệnh một công đoạn": các chủng loại ở đây là
    // những khối lượng RỜI NHAU (tôn tấm ≠ thép hình), không phải nhiều lượt việc trên cùng
    // khối thép — nên gộp một lệnh mới đúng, và tiến độ phải CỘNG chứ không lấy chậm nhất.
    const toanDuAn = body.toanDuAn === true
    if (toanDuAn) {
      // Giao cả dự án chỉ áp dụng cho XƯỞNG whole-project (XPC pha cắt, XHT hoàn thiện) và chỉ
      // các công đoạn của xưởng đó. Mỗi (công đoạn × chủng loại) là một khối lượng RỜI NHAU.
      if (!isWholeProjectWorkshop(team)) {
        return errorResponse('Giao cả dự án chỉ áp dụng cho Xưởng Pha cắt hoặc Xưởng Hoàn thiện', 422)
      }
      if (stages.length === 0) {
        return errorResponse('Nhập khối lượng cho ít nhất một chủng loại', 422)
      }
      const allowed = WHOLE_PROJECT_STAGES[team] || []
      const ngoai = stages.find(x => !allowed.includes(x.stageCode))
      if (ngoai) {
        return errorResponse(`Công đoạn "${ngoai.stageCode}" không thuộc phần giao cả dự án của xưởng ${team}`, 422)
      }
      // CHO GIAO NHIỀU LẦN: một chủng loại có thể phát hành nhiều đợt (Lần 1, Lần 2…) — mỗi lần
      // là một lệnh cả-dự-án riêng, khối lượng CỘNG DỒN. Không chặn trùng như trước.
    } else if (stages.length > 1) {
      // MỖI LỆNH ĐÚNG MỘT CÔNG ĐOẠN. Gộp nhiều công đoạn vào một lệnh theo hạng mục thì không
      // tách được tiến độ, nghiệm thu và tiền của từng phần việc.
      return errorResponse(
        'Mỗi lệnh chỉ nhận MỘT công đoạn + một chủng loại. Giao thêm phần việc khác thì phát hành lệnh riêng.',
        422)
    }
    const cd = toanDuAn ? null : (stages[0] ?? null)

    // ── Chặn trùng ──
    // Cùng một xưởng nhận được NHIỀU lệnh của cùng ITEM, miễn là khác phần việc.
    // Đã giao Xưởng Hàn "Hàn · Kết cấu" rồi thì lần sau chỉ giao được hàn thứ khác.
    const cungXuong = toanDuAn ? [] : await prisma.workOrder.findMany({
      where: { aplImportId: body.importId, aplItem: item || null, teamCode: team },
      select: { woCode: true, stages: { select: { stageCode: true, categoryCode: true, name: true, category: true } } },
    })
    if (cd) {
      const trung = cungXuong.find(w =>
        w.stages.some(x => x.stageCode === cd.stageCode && (x.categoryCode ?? '') === (cd.categoryCode ?? '')))
      if (trung) {
        return errorResponse(
          `Xưởng ${team || '(chưa gán)'} đã nhận "${cd.name}${cd.category ? ' · ' + cd.category : ''}"`
          + ` của hạng mục này ở lệnh ${trung.woCode} — chọn công đoạn hoặc chủng loại khác`,
          409)
      }
    } else {
      // Lệnh chạy nguyên khối (không khai công đoạn): vẫn giữ luật cũ — một lệnh cho một xưởng.
      const trung = cungXuong.find(w => w.stages.length === 0)
      if (trung) {
        return errorResponse(
          team
            ? `ITEM này đã phát hành lệnh ${trung.woCode} cho xưởng ${team} rồi — khai công đoạn để giao thêm phần việc khác`
            : `ITEM này đã phát hành lệnh ${trung.woCode} (chưa gán xưởng) rồi`,
          409)
      }
    }

    // Mã WO: gắn xưởng và CÔNG ĐOẠN vào tên ITEM để nhiều lệnh cùng xưởng phân biệt được;
    // trùng nữa mới thêm số thứ tự.
    const itemForCode = toanDuAn
      ? ['CA-DU-AN', team || null].filter(Boolean).join('-')
      : [item, team || null, cd ? cd.stageCode : null, cd?.categoryCode || null].filter(Boolean).join('-')
    let woCode = aplItemWoCode(project.projectCode, itemForCode)
    for (let n = 2; n <= 50; n++) {
      const dup = await prisma.workOrder.findUnique({ where: { woCode }, select: { id: true } })
      if (!dup) break
      woCode = aplItemWoCode(project.projectCode, itemForCode, n)
    }

    const dept = team
      ? await prisma.department.findFirst({ where: { code: team }, select: { id: true } })
      : null
    const toDate = (s?: string) => (s ? new Date(s) : null)

    // Lệnh Pha cắt cả dự án: khối lượng = TỔNG các chủng loại PM nhập. Chúng là những khối
    // lượng rời nhau (tôn tấm ≠ thép hình) nên cộng mới đúng — khác lệnh theo hạng mục, nơi
    // các công đoạn cùng chạy qua một khối lượng.
    const klLenh = toanDuAn
      ? Math.round(stages.reduce((n, x) => n + x.qty, 0) * 100) / 100
      : (plannedQty !== null && plannedQty > 0 ? plannedQty : null)

    // Lệnh cả-dự-án: đơn vị lấy theo stage (mọi chủng loại cùng đơn vị thì lệnh mang đơn vị đó,
    // trộn nhiều đơn vị thì để mặc định). Mô tả theo đúng XƯỞNG được giao.
    const caDuAnUnit = toanDuAn && stages.length > 0
      ? (stages.every(s => s.unit === stages[0].unit) ? stages[0].unit : DEFAULT_WO_UNIT)
      : unit
    const caLabel = team === 'XPC' ? 'Pha cắt' : team === 'XHT' ? 'Hoàn thiện' : 'Cả dự án'

    const wo = await prisma.workOrder.create({
      data: {
        woCode,
        projectId: project.id,
        description: toanDuAn
          ? `${caLabel} — cả dự án (${stages.length} chủng loại)`
          : aplItemWoDescription(item, heads.length) + (isSub ? ` — Thầu phụ: ${subName}` : ''),
        // Vật tư để CỘT RIÊNG, không nhét vào mô tả — nhét vào thì cắt ngắn là mất chữ,
        // mà lọc/tìm theo vật tư cũng không được.
        materials: formatMaterialsColumn(mats),
        aplImportId: body.importId,
        // Lệnh cả dự án KHÔNG gắn hạng mục — nó phục vụ mọi hạng mục trong bản APL.
        aplItem: toanDuAn ? null : (item || null),
        pieceMark: toanDuAn ? null : (item || null),
        teamCode: isSub ? SUBCONTRACT_TEAM_CODE : team,
        departmentId: isSub ? null : (dept?.id || null),
        woType: isSub ? 'EXTERNAL' : 'INTERNAL',
        subcontractorName: isSub ? subName : null,
        // Đơn vị của lệnh: kg thì lấy thẳng khối lượng ITEM; đơn vị khác (m², mét…) thì
        // KHÔNG quy đổi được từ kg — phải dùng số lượng PM nhập, thiếu thì để trống.
        unit: caDuAnUnit,
        plannedWeight: klLenh,
        // Công đoạn của lệnh này rời nhau hay chồng nhau — quyết định cách cộng tiến độ.
        stagesDisjoint: toanDuAn,
        plannedStart: toDate(body.plannedStart),
        plannedEnd: toDate(body.plannedEnd),
        createdBy: user.userId,
      },
      select: { id: true, woCode: true },
    })

    if (stages.length > 0) {
      await prisma.workOrderStage.createMany({
        data: stages.map((st, i) => ({
          workOrderId: wo.id, stageCode: st.stageCode, name: st.name,
          categoryCode: st.categoryCode, category: st.category,
          qty: st.qty, unit: st.unit || unit, sortOrder: i, note: st.note, createdBy: user.userId,
        })),
      })
    }

    // Phát hành WO = xưởng sắp làm → mở sẵn bước báo cáo khối lượng tuần (P5.2).
    // Trước đây bước này chỉ sinh khi Kho cấp ĐỦ vật tư; từ khi cổng vật tư không còn chặn
    // "Bắt đầu SX", xưởng có thể làm mà chưa được cấp gì — chờ Kho thì P5.2 không bao giờ mở
    // và cả nghiệm thu P5.3/P5.4 phía sau cũng tắc theo.
    await ensureWeeklyReportTask(project.id, user.userId).catch(e =>
      console.error('[from-apl] ensureWeeklyReportTask:', e))

    await logAudit(user.userId, 'CREATE_WO_FROM_APL', 'Project', project.id,
      { importId: body.importId, item, woCode, blocks: heads.length, weightKg, materials: mats.length },
      getClientIP(req))

    return successResponse(
      {
        workOrder: { id: wo.id, woCode: wo.woCode },
        blocks: heads.length,
        detailLines: details.length,
        weightKg,
        materials: mats.slice(0, 20),
        materialCount: mats.length,
      },
      `Đã phát hành ${wo.woCode} — ${heads.length} cụm, ${Math.round(weightKg).toLocaleString('vi-VN')} kg, ${mats.length} loại vật tư`,
      201,
    )
  } catch (err) {
    console.error('POST /api/production/work-orders/from-apl error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi phát hành WO từ APL'), 500)
  }
}
