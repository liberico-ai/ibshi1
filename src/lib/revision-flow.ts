import prisma from './db'
import { isEnabled } from './feature-flags'
import { runCascade } from './cascade-tasks'

// ── Types ──

interface CreateRevisionWithEcoParams {
  drawingId: string
  revCode: string
  description: string
  bomId: string
  ecoTitle: string
  ecoDescription: string
  changeType: string
  userId: string
  projectId: string
}

// ── Helpers ──

async function generateEcoCode(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2)
  const count = await tx.engineeringChangeOrder.count()
  return `ECO-${year}-${String(count + 1).padStart(3, '0')}`
}

// ── 1. Create revision + ECO + BOM version in one transaction ──

export async function createRevisionWithEco(params: CreateRevisionWithEcoParams) {
  const {
    drawingId, revCode, description, bomId,
    ecoTitle, ecoDescription, changeType,
    userId, projectId,
  } = params

  return prisma.$transaction(async (tx) => {
    // 1. Create DrawingRevision (DRAFT — issuedDate = now, issuedBy = userId)
    const drawingRevision = await tx.drawingRevision.create({
      data: {
        drawingId,
        revision: revCode,
        description,
        issuedDate: new Date(),
        issuedBy: userId,
      },
    })

    // 2. Create ECO (DRAFT)
    const ecoCode = await generateEcoCode(tx)
    const eco = await tx.engineeringChangeOrder.create({
      data: {
        ecoCode,
        projectId,
        title: ecoTitle,
        description: ecoDescription,
        changeType,
        requestedBy: userId,
        status: 'DRAFT',
      },
    })

    // 3. Create BomVersion (DRAFT) copying lines from the ACTIVE version
    const activeVersion = await tx.bomVersion.findFirst({
      where: { bomId, status: 'ACTIVE' },
      include: { lines: true },
    })

    // Determine next versionNo
    const maxVersion = await tx.bomVersion.aggregate({
      where: { bomId },
      _max: { versionNo: true },
    })
    const nextVersionNo = (maxVersion._max.versionNo ?? 0) + 1

    const bomVersion = await tx.bomVersion.create({
      data: {
        bomId,
        versionNo: nextVersionNo,
        status: 'DRAFT',
        sourceRevisionId: drawingRevision.id,
        ecoId: eco.id,
        reason: description,
        createdBy: userId,
      },
    })

    // Copy BomItems from ACTIVE version → new version, remapping parentId
    if (activeVersion && activeVersion.lines.length > 0) {
      // Build old-id → new-id map in two passes:
      // Pass 1: create all items without parentId to get new IDs
      // Pass 2: update items that had a parentId

      const oldIdToNewId = new Map<string, string>()

      // Sort so root items (parentId = null) come first
      const rootItems = activeVersion.lines.filter((item) => !item.parentId)
      const childItems = activeVersion.lines.filter((item) => item.parentId)

      // Create root items
      for (const item of rootItems) {
        const created = await tx.bomItem.create({
          data: {
            bomId,
            bomVersionId: bomVersion.id,
            materialId: item.materialId,
            parentId: null,
            category: item.category,
            pieceMark: item.pieceMark,
            quantity: item.quantity,
            unit: item.unit,
            profile: item.profile,
            grade: item.grade,
            remarks: item.remarks,
            sortOrder: item.sortOrder,
          },
        })
        oldIdToNewId.set(item.id, created.id)
      }

      // Create child items (may be multi-level — iterate until all are placed)
      const pending = [...childItems]
      let safetyLimit = pending.length * pending.length + 1 // avoid infinite loops on bad data
      while (pending.length > 0 && safetyLimit > 0) {
        safetyLimit--
        const item = pending.shift()!
        const newParentId = oldIdToNewId.get(item.parentId!)
        if (!newParentId) {
          // Parent hasn't been created yet — push to end
          pending.push(item)
          continue
        }
        const created = await tx.bomItem.create({
          data: {
            bomId,
            bomVersionId: bomVersion.id,
            materialId: item.materialId,
            parentId: newParentId,
            category: item.category,
            pieceMark: item.pieceMark,
            quantity: item.quantity,
            unit: item.unit,
            profile: item.profile,
            grade: item.grade,
            remarks: item.remarks,
            sortOrder: item.sortOrder,
          },
        })
        oldIdToNewId.set(item.id, created.id)
      }

      if (pending.length > 0) {
        throw new Error(
          `Không thể copy ${pending.length} BomItem do cây parentId bị vòng lặp hoặc thiếu gốc`
        )
      }
    }

    return { drawingRevision, eco, bomVersion }
  })
}

// ── 2. Approve a BOM version (DRAFT → ACTIVE) ──

export async function approveRevision(bomVersionId: string, userId: string) {
  const { updated, cascadeParams, reQcCount, reQcContext } = await prisma.$transaction(async (tx) => {
    const version = await tx.bomVersion.findUnique({
      where: { id: bomVersionId },
      include: { bom: { select: { projectId: true } } },
    })
    if (!version) {
      throw new Error('BomVersion không tồn tại')
    }
    if (version.status !== 'DRAFT') {
      throw new Error(`BomVersion đang ở trạng thái "${version.status}", chỉ DRAFT mới duyệt được`)
    }

    if (version.ecoId) {
      const eco = await tx.engineeringChangeOrder.findUnique({
        where: { id: version.ecoId },
      })
      if (!eco) {
        throw new Error('ECO liên kết không tồn tại')
      }
      if (eco.status !== 'APPROVED') {
        throw new Error(
          `ECO "${eco.ecoCode}" đang ở trạng thái "${eco.status}" — cần APPROVED trước khi duyệt BOM version`
        )
      }
    }

    await tx.bomVersion.updateMany({
      where: { bomId: version.bomId, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    })

    const result = await tx.bomVersion.update({
      where: { id: bomVersionId },
      data: {
        status: 'ACTIVE',
        approvedBy: userId,
        approvedAt: new Date(),
      },
    })

    let params: { oldVersionId: string; newVersionId: string; projectId: string; ecoCode: string; ecoId: string | null; userId: string; bomId: string } | null = null
    let reQcCount = 0
    // Finding F: context re-QC ĐỘC LẬP cascadeParams (cascadeParams=null khi FF cascade tắt).
    // Cờ needsReQc trên WO set không gate FF → task re-QC cũng PHẢI dispatch (an toàn chất lượng).
    let reQcContext: { projectId: string; ecoLabel: string } | null = null

    const oldVersion = await tx.bomVersion.findFirst({
      where: { bomId: version.bomId, status: 'SUPERSEDED' },
      orderBy: { versionNo: 'desc' },
      select: { id: true },
    })

    if (isEnabled('BOM_REVISION_CASCADE') && oldVersion) {
      const eco = version.ecoId
        ? await tx.engineeringChangeOrder.findUnique({
            where: { id: version.ecoId },
            select: { ecoCode: true, projectId: true },
          })
        : null

      params = {
        oldVersionId: oldVersion.id,
        newVersionId: bomVersionId,
        // Finding B: KHÔNG dùng version.bomId làm projectId (là BillOfMaterial id, không phải project!).
        // Lấy projectId THẬT từ bom → cascade không còn FK-fail + mất âm thầm khi revision không gắn ECO.
        projectId: eco?.projectId || version.bom.projectId,
        ecoCode: eco?.ecoCode || `BOM-v${version.versionNo}`,
        ecoId: version.ecoId ?? null,     // revisionId khi mở vòng revise (mode artifact)
        userId,
        bomId: version.bomId,
      }
    }

    // Re-QC gate: flag affected WOs (QC_PASSED/COMPLETED) when piece-marks change
    if (oldVersion) {
      const [oldItems, newItems] = await Promise.all([
        tx.bomItem.findMany({ where: { bomVersionId: oldVersion.id }, select: { pieceMark: true, materialId: true, quantity: true } }),
        tx.bomItem.findMany({ where: { bomVersionId }, select: { pieceMark: true, materialId: true, quantity: true } }),
      ])
      const oldKey = (i: { pieceMark: string | null; materialId: string; quantity: unknown }) =>
        `${i.pieceMark || ''}::${i.materialId}::${Number(i.quantity)}`
      const oldSet = new Set(oldItems.map(oldKey))
      const affectedMarks = new Set<string>()
      for (const item of newItems) {
        if (item.pieceMark && !oldSet.has(oldKey(item))) affectedMarks.add(item.pieceMark)
      }
      for (const item of oldItems) {
        if (item.pieceMark && !new Set(newItems.map(oldKey)).has(oldKey(item))) affectedMarks.add(item.pieceMark)
      }

      if (affectedMarks.size > 0) {
        const eco = version.ecoId
          ? await tx.engineeringChangeOrder.findUnique({ where: { id: version.ecoId }, select: { ecoCode: true, projectId: true } })
          : null
        const projectId = eco?.projectId || version.bom.projectId // Finding B: projectId thật từ bom, không phải bomId
        const ecoLabel = eco?.ecoCode || `BOM-v${version.versionNo}`
        const { count } = await tx.workOrder.updateMany({
          where: {
            projectId,
            pieceMark: { in: [...affectedMarks] },
            status: { in: ['QC_PASSED', 'COMPLETED'] },
          },
          data: { needsReQc: true, reQcReason: `Re-QC do ${ecoLabel}` },
        })
        reQcCount = count
        reQcContext = { projectId, ecoLabel }
      }
    }

    return { updated: result, cascadeParams: params, reQcCount, reQcContext }
  })

  // ── Revise Flow36 (Phase 1b): FF ON → mở VÒNG REVISE thay cascade phẳng; FF OFF → cascade cũ y nguyên. ──
  // Khối re-QC bên dưới ĐỘC LẬP FF (Finding F) → CHẠY cả 2 nhánh. TUYỆT ĐỐI không gộp vào đây.
  if (cascadeParams && !isEnabled('REVISE_FLOW')) {
    try {
      const cascadeResult = await runCascade(
        cascadeParams.oldVersionId,
        cascadeParams.newVersionId,
        cascadeParams.projectId,
        cascadeParams.ecoCode,
        cascadeParams.userId,
        cascadeParams.bomId,
      )
      // Finding B: cascade lẽ ra chạy (có thay đổi BOM) mà ra 0 task → CẢNH BÁO, không im lặng.
      if (!cascadeResult.skippedNoChanges && cascadeResult.taskIds.length === 0) {
        console.warn(
          `[approveRevision] ⚠️ Cascade ${cascadeParams.ecoCode} (project ${cascadeParams.projectId}): có thay đổi BOM nhưng KHÔNG sinh task rework nào — kiểm classifyLine/impact.`,
        )
      }
    } catch (err) {
      // Finding B: trước nuốt âm thầm ("non-blocking"). Nay projectId đã đúng → throw là lỗi THẬT, log rõ để không mất cascade lặng lẽ.
      console.error(
        `[approveRevision] ❌ Cascade THẤT BẠI — ${cascadeParams.ecoCode} (project ${cascadeParams.projectId}): revision KHÔNG lan sang phòng khác. Cần xử lý:`,
        err,
      )
    }
  } else if (cascadeParams && isEnabled('REVISE_FLOW')) {
    // FF ON — REV_DESIGN (artifact): mở vòng revise entry P2.1, revisionId=ecoId. runCascade KHÔNG chạy.
    try {
      const { openRevisionRound, nextRevisionRound } = await import('./work-engine')
      const { REVISE_TYPE_MAP } = await import('./revise-map')
      const round = await nextRevisionRound(cascadeParams.projectId)
      await openRevisionRound(cascadeParams.projectId, REVISE_TYPE_MAP.REV_DESIGN.entryStepCode, round, cascadeParams.userId, { revisionId: cascadeParams.ecoId })
    } catch (err) {
      console.error(
        `[approveRevision] ❌ Mở vòng revise THẤT BẠI — ${cascadeParams.ecoCode} (project ${cascadeParams.projectId}):`,
        err,
      )
    }
  }

  // Create re-QC task if any WOs were flagged.
  // Finding F: gate trên reQcContext (ĐỘC LẬP FF), KHÔNG trên cascadeParams — nếu không, FF cascade tắt →
  // WO bị cờ needsReQc nhưng task R09 KHÔNG dispatch → mất âm thầm (cùng lớp bug đợt này nhắm).
  if (reQcCount > 0 && reQcContext) {
    try {
      const { createTask } = await import('./work-engine')
      await createTask({
        title: `[Re-QC] Kiểm tra lại ${reQcCount} WO — ${reQcContext.ecoLabel}`,
        description: `${reQcContext.ecoLabel} thay đổi BOM ảnh hưởng ${reQcCount} Work Order đã QC. Cần kiểm tra lại chất lượng các hạng mục bị ảnh hưởng.`,
        projectId: reQcContext.projectId,
        taskType: 'RE_QC',
        priority: 'HIGH',
        assignees: [{ role: 'R09' }],
      }, userId)
    } catch (err) {
      console.error(
        `[approveRevision] ❌ Tạo task Re-QC THẤT BẠI (${reQcContext.ecoLabel}, project ${reQcContext.projectId}) — ${reQcCount} WO đã cờ re-QC nhưng R09 CHƯA được giao:`,
        err,
      )
    }
  }

  return updated
}

// ── 3. Get revision history for a BOM ──

export async function getRevisionHistory(bomId: string) {
  return prisma.bomVersion.findMany({
    where: { bomId },
    orderBy: { versionNo: 'desc' },
    include: {
      sourceRevision: true,
      eco: true,
    },
  })
}
