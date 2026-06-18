import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { parseBriefingXlsx, classifyRows, mapStatusLabel, computeImportKey, type BriefingAction } from '@/lib/briefing-import-parser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

// POST /api/work/briefing/import   formData: file + mode=preview|apply
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được import biên bản')

    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') return errorResponse('Cần đính kèm file Excel', 400)
    const name = (file as File).name?.toLowerCase() || ''
    if (!/\.(xls|xlsx)$/.test(name)) return errorResponse('Chỉ hỗ trợ file Excel (.xls/.xlsx)', 400)

    const mode = (form.get('mode') as string) || 'preview'
    const buf = Buffer.from(await (file as File).arrayBuffer())
    const parsed = parseBriefingXlsx(buf)
    if (parsed.length === 0) return errorResponse('File không có dữ liệu hoặc sai định dạng', 400)

    const actions = classifyRows(parsed)

    // Resolve project codes -> ids for create actions
    const projectCodes = new Set<string>()
    for (const a of actions) {
      if (a.type === 'create' && a.row.projectCode.trim() && a.row.projectCode !== 'Công việc chung') {
        projectCodes.add(a.row.projectCode.trim())
      }
    }
    const projects = projectCodes.size > 0
      ? await prisma.project.findMany({ where: { projectCode: { in: [...projectCodes] } }, select: { id: true, projectCode: true } })
      : []
    const projectByCode = new Map(projects.map((p) => [p.projectCode, p.id]))

    // Resolve assignee names -> user ids for create actions
    const assigneeNames = new Set<string>()
    for (const a of actions) {
      if (a.type === 'create') {
        const names = a.row.assigneeName.split(',').map((n) => n.trim()).filter(Boolean)
        names.forEach((n) => assigneeNames.add(n.toLowerCase()))
      }
    }
    const allUsers = assigneeNames.size > 0
      ? await prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, username: true, roleCode: true } })
      : []
    const userByNameLower = new Map<string, { id: string; count: number }>()
    for (const u of allUsers) {
      const fn = u.fullName.toLowerCase()
      const existing = userByNameLower.get(fn)
      if (existing) { existing.count++; continue }
      userByNameLower.set(fn, { id: u.id, count: 1 })
      if (u.username) {
        const un = u.username.toLowerCase()
        if (!userByNameLower.has(un)) userByNameLower.set(un, { id: u.id, count: 1 })
      }
    }

    // Validate update targets exist
    const updateIds = actions.filter((a): a is Extract<BriefingAction, { type: 'update' }> => a.type === 'update').map((a) => a.taskId)
    const existingTasks = updateIds.length > 0
      ? await prisma.task.findMany({ where: { id: { in: updateIds } }, select: { id: true } })
      : []
    const existingIds = new Set(existingTasks.map((t) => t.id))

    // Build preview
    type PreviewAction = 'create' | 'update' | 'skip' | 'error'
    const preview: { row: number; action: PreviewAction; title: string; detail: string }[] = []
    const errors: { row: number; reason: string }[] = []
    const validUpdates: Extract<BriefingAction, { type: 'update' }>[] = []
    type ValidCreate = Extract<BriefingAction, { type: 'create' }> & { projectId: string | null; userId: string; importKey: string }
    const candidateCreates: ValidCreate[] = []

    for (const a of actions) {
      if (a.type === 'error') {
        errors.push({ row: a.row.rowIndex, reason: a.reason })
        preview.push({ row: a.row.rowIndex, action: 'error', title: a.row.title || '(trống)', detail: a.reason })
        continue
      }

      if (a.type === 'update') {
        if (!existingIds.has(a.taskId)) {
          errors.push({ row: a.row.rowIndex, reason: `Không tìm thấy task ID: ${a.taskId}` })
          preview.push({ row: a.row.rowIndex, action: 'error', title: a.row.title, detail: `Task ID không tồn tại: ${a.taskId}` })
          continue
        }
        const statusParsed = a.row.status.trim() ? mapStatusLabel(a.row.status) : null
        if (a.row.status.trim() && !statusParsed) {
          errors.push({ row: a.row.rowIndex, reason: `Trạng thái không hợp lệ: "${a.row.status}"` })
          preview.push({ row: a.row.rowIndex, action: 'error', title: a.row.title, detail: `Trạng thái "${a.row.status}" không nhận diện được` })
          continue
        }
        const changes: string[] = []
        if (statusParsed) changes.push(`Trạng thái → ${a.row.status}`)
        if (a.row.deadlineISO) changes.push(`Hạn → ${a.row.deadline}`)
        if (a.row.criteria.trim()) changes.push('Tiêu chí xong')
        if (a.row.proposal.trim()) changes.push('Đề xuất')
        if (a.row.decision.trim()) changes.push('Quyết định')
        if (a.row.notes.trim()) changes.push('Ghi chú')
        validUpdates.push(a)
        preview.push({ row: a.row.rowIndex, action: 'update', title: a.row.title, detail: changes.length ? changes.join(', ') : 'Không thay đổi' })
        continue
      }

      // create — resolve project + user first
      let projectId: string | null = null
      const pc = a.row.projectCode.trim()
      if (pc && pc !== 'Công việc chung') {
        const pid = projectByCode.get(pc)
        if (!pid) {
          errors.push({ row: a.row.rowIndex, reason: `Không tìm thấy dự án: "${pc}"` })
          preview.push({ row: a.row.rowIndex, action: 'error', title: a.row.title, detail: `Mã dự án "${pc}" không tồn tại` })
          continue
        }
        projectId = pid
      }

      const nameRaw = a.row.assigneeName.trim().toLowerCase()
      const matched = userByNameLower.get(nameRaw)
      if (!matched) {
        errors.push({ row: a.row.rowIndex, reason: `Không tìm thấy người: "${a.row.assigneeName}". Gợi ý: nhập đúng username.` })
        preview.push({ row: a.row.rowIndex, action: 'error', title: a.row.title, detail: `Người thực hiện "${a.row.assigneeName}" không tìm thấy` })
        continue
      }
      if (matched.count > 1) {
        errors.push({ row: a.row.rowIndex, reason: `Trùng tên "${a.row.assigneeName}" (${matched.count} người). Gợi ý: nhập username.` })
        preview.push({ row: a.row.rowIndex, action: 'error', title: a.row.title, detail: `Tên "${a.row.assigneeName}" khớp ${matched.count} người — dùng username` })
        continue
      }
      const importKey = computeImportKey(a.row.title, projectId, a.row.deadlineISO, matched.id)
      candidateCreates.push({ ...a, projectId, userId: matched.id, importKey })
    }

    // ── Dedup: check which importKeys already exist ──
    const keySet = new Set(candidateCreates.map((c) => c.importKey))
    const existingByKey = new Set<string>()
    if (keySet.size > 0) {
      const titles = [...new Set(candidateCreates.map((c) => c.row.title))]
      const projectIds = [...new Set(candidateCreates.map((c) => c.projectId))]
      const possibleDups = await prisma.task.findMany({
        where: {
          title: { in: titles },
          projectId: projectIds.includes(null) ? undefined : { in: projectIds.filter((p): p is string => p !== null) },
        },
        select: { resultData: true },
      })
      // Also query tasks with null projectId if needed
      if (projectIds.includes(null)) {
        const nullDups = await prisma.task.findMany({
          where: { title: { in: titles }, projectId: null },
          select: { resultData: true },
        })
        possibleDups.push(...nullDups)
      }
      for (const t of possibleDups) {
        const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
        const b = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
        if (typeof b.importKey === 'string' && keySet.has(b.importKey)) existingByKey.add(b.importKey)
      }
    }

    const validCreates: ValidCreate[] = []
    const skippedCreates: ValidCreate[] = []
    for (const c of candidateCreates) {
      if (existingByKey.has(c.importKey)) {
        skippedCreates.push(c)
        preview.push({ row: c.row.rowIndex, action: 'skip', title: c.row.title, detail: 'Đã tồn tại (import trước)' })
      } else {
        validCreates.push(c)
        preview.push({ row: c.row.rowIndex, action: 'create', title: c.row.title, detail: `Gán ${c.row.assigneeName}, hạn ${c.row.deadline}` })
      }
    }

    if (mode === 'preview') {
      return successResponse({
        preview,
        summary: { total: parsed.length, toCreate: validCreates.length, toUpdate: validUpdates.length, skipped: skippedCreates.length, errors: errors.length },
        errors,
      })
    }

    // ── APPLY ──
    let created = 0
    let updated = 0
    let skipped = skippedCreates.length

    for (const u of validUpdates) {
      const task = await prisma.task.findUnique({ where: { id: u.taskId }, select: { resultData: true, status: true, deadline: true } })
      if (!task) continue

      const rd = (task.resultData && typeof task.resultData === 'object') ? task.resultData as Record<string, unknown> : {}
      const oldBriefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}

      const newBriefing: Record<string, unknown> = { ...oldBriefing }
      if (u.row.criteria.trim()) newBriefing.criteria = u.row.criteria.trim()
      if (u.row.proposal.trim()) newBriefing.proposal = u.row.proposal.trim()
      if (u.row.decision.trim()) newBriefing.decision = u.row.decision.trim()
      if (u.row.notes.trim()) newBriefing.notes = u.row.notes.trim()

      const statusParsed = u.row.status.trim() ? mapStatusLabel(u.row.status) : null
      if (statusParsed) {
        newBriefing.blocked = statusParsed.blocked ? 'true' : (oldBriefing.blocked || '')
      }

      const updateData: Record<string, unknown> = {
        resultData: JSON.parse(JSON.stringify({ ...rd, briefing: newBriefing })),
      }
      if (statusParsed) updateData.status = statusParsed.status
      if (u.row.deadlineISO) updateData.deadline = new Date(u.row.deadlineISO)

      await prisma.$transaction([
        prisma.task.update({ where: { id: u.taskId }, data: updateData }),
        prisma.taskHistory.create({
          data: {
            taskId: u.taskId,
            action: 'BRIEFING_UPDATE',
            byUserId: payload.userId,
            meta: JSON.parse(JSON.stringify({
              source: 'briefing-import',
              row: u.row.rowIndex,
              statusChange: statusParsed ? u.row.status : null,
              deadlineChange: u.row.deadlineISO || null,
            })),
          },
        }),
      ])
      updated++
    }

    for (const c of validCreates) {
      // Re-check dedup at write time (race protection)
      const recheck = await prisma.task.findMany({
        where: { title: c.row.title, projectId: c.projectId },
        select: { resultData: true },
      })
      const alreadyExists = recheck.some((t) => {
        const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
        const b = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
        return typeof b.importKey === 'string' && b.importKey === c.importKey
      })
      if (alreadyExists) { skipped++; continue }

      await prisma.$transaction(async (tx) => {
        const t = await tx.task.create({
          data: {
            projectId: c.projectId,
            title: c.row.title,
            taskType: c.row.taskType.trim() || 'FREE',
            status: 'OPEN',
            priority: 'NORMAL',
            deadline: new Date(c.row.deadlineISO),
            createdBy: payload.userId,
            startedAt: new Date(),
            resultData: JSON.parse(JSON.stringify({
              briefing: {
                criteria: c.row.criteria.trim(),
                proposal: c.row.proposal.trim(),
                decision: c.row.decision.trim(),
                notes: c.row.notes.trim(),
                importKey: c.importKey,
              },
            })),
          },
        })
        await tx.taskAssignee.create({ data: { taskId: t.id, userId: c.userId, isPrimary: true } })
        await tx.taskHistory.create({
          data: {
            taskId: t.id,
            action: 'CREATED',
            byUserId: payload.userId,
            meta: JSON.parse(JSON.stringify({ source: 'briefing-import', row: c.row.rowIndex })),
          },
        })
      })
      created++
    }

    return successResponse({ created, updated, skipped, errors, summary: { total: parsed.length, created, updated, skipped, errors: errors.length } })
  } catch (err) {
    console.error('POST /api/work/briefing/import error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
