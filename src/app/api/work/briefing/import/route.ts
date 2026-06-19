import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { parseBriefingXlsx, classifyRows, mapStatusLabel, mapDept, computeImportKey } from '@/lib/briefing-import-parser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

function normalizeCode(s: string): string {
  return s.replace(/[\s\-_]/g, '').toUpperCase()
}

// ════════════════════════════════════════
//  Types
// ════════════════════════════════════════

interface PreviewRow {
  rowIndex: number
  action: 'update' | 'create' | 'error'
  taskId: string | null
  projectCode: string
  projectNameNew: string
  projectExists: boolean
  willCreateProject: boolean
  title: string
  deptText: string
  roleCode: string | null
  assigneeName: string
  assigneeUserId: string | null
  assignBy: 'user' | 'role' | null
  userMatch: 'ok' | 'ambiguous' | 'none' | null
  deadlineISO: string
  deadline: string
  status: string
  criteria: string
  proposal: string
  decision: string
  notes: string
  detail: string
}

interface FinalRow {
  include: boolean
  action: 'update' | 'create'
  taskId?: string
  projectMode: 'existing' | 'create' | 'none'
  projectId?: string
  projectCode?: string
  projectNameNew?: string
  title: string
  roleCode?: string
  assigneeUserId?: string
  deadlineISO: string
  status: string
  criteria: string
  proposal: string
  decision: string
  notes: string
}

// ════════════════════════════════════════
//  POST handler
// ════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được import biên bản')

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      return handlePreview(req, payload)
    }
    if (contentType.includes('application/json')) {
      return handleApply(req, payload)
    }
    return errorResponse('Content-Type phải là multipart/form-data (preview) hoặc application/json (apply)', 400)
  } catch (err) {
    console.error('POST /api/work/briefing/import error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// ════════════════════════════════════════
//  PREVIEW — parse file, return editable rows
// ════════════════════════════════════════

async function handlePreview(req: NextRequest, payload: { userId: string; roleCode: string }) {
  const form = await req.formData()
  const file = form.get('file')
  if (!file || typeof file === 'string') return errorResponse('Cần đính kèm file Excel', 400)
  const fname = (file as File).name?.toLowerCase() || ''
  if (!/\.(xls|xlsx)$/.test(fname)) return errorResponse('Chỉ hỗ trợ file Excel (.xls/.xlsx)', 400)

  const buf = Buffer.from(await (file as File).arrayBuffer())
  const parsed = parseBriefingXlsx(buf)
  if (parsed.length === 0) return errorResponse('File không có dữ liệu hoặc sai định dạng', 400)

  const actions = classifyRows(parsed)

  // Resolve projects
  const dbProjects = await prisma.project.findMany({ select: { id: true, projectCode: true, projectName: true } })
  const projectByNorm = new Map(dbProjects.map((p) => [normalizeCode(p.projectCode), { id: p.id, code: p.projectCode }]))

  // Resolve users
  const allUsers = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, username: true, roleCode: true } })
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
  const updateIds = actions.filter((a) => a.type === 'update').map((a) => (a as { taskId: string }).taskId)
  const existingTasks = updateIds.length > 0
    ? await prisma.task.findMany({ where: { id: { in: updateIds } }, select: { id: true } })
    : []
  const existingIds = new Set(existingTasks.map((t) => t.id))

  const rows: PreviewRow[] = []
  const newProjectCodes = new Set<string>()

  for (const a of actions) {
    if (a.type === 'error') {
      rows.push({
        rowIndex: a.row.rowIndex, action: 'error', taskId: null,
        projectCode: a.row.projectCode, projectNameNew: a.row.projectNameNew,
        projectExists: false, willCreateProject: false,
        title: a.row.title || '', deptText: a.row.deptText, roleCode: mapDept(a.row.deptText),
        assigneeName: a.row.assigneeName, assigneeUserId: null, assignBy: null, userMatch: null,
        deadlineISO: a.row.deadlineISO, deadline: a.row.deadline,
        status: a.row.status, criteria: a.row.criteria, proposal: a.row.proposal,
        decision: a.row.decision, notes: a.row.notes, detail: a.reason,
      })
      continue
    }

    if (a.type === 'update') {
      const found = existingIds.has(a.taskId)
      rows.push({
        rowIndex: a.row.rowIndex, action: found ? 'update' : 'error', taskId: a.taskId,
        projectCode: a.row.projectCode, projectNameNew: '',
        projectExists: true, willCreateProject: false,
        title: a.row.title, deptText: a.row.deptText, roleCode: mapDept(a.row.deptText),
        assigneeName: a.row.assigneeName, assigneeUserId: null, assignBy: null, userMatch: null,
        deadlineISO: a.row.deadlineISO, deadline: a.row.deadline,
        status: a.row.status, criteria: a.row.criteria, proposal: a.row.proposal,
        decision: a.row.decision, notes: a.row.notes,
        detail: found ? '' : `Task ID không tồn tại: ${a.taskId}`,
      })
      continue
    }

    // create
    const pc = a.row.projectCode.trim()
    let projectExists = false
    let willCreateProject = false
    if (pc && pc !== 'Công việc chung') {
      const match = projectByNorm.get(normalizeCode(pc))
      if (match) { projectExists = true } else { willCreateProject = true; newProjectCodes.add(pc) }
    }

    let assignBy: 'user' | 'role' | null = null
    let assigneeUserId: string | null = null
    let roleCode = mapDept(a.row.deptText)
    let userMatch: 'ok' | 'ambiguous' | 'none' | null = null
    let detail = ''

    const nameRaw = a.row.assigneeName.trim()
    if (nameRaw) {
      const matched = userByNameLower.get(nameRaw.toLowerCase())
      if (!matched) { userMatch = 'none'; detail = `Người "${nameRaw}" không tìm thấy` }
      else if (matched.count > 1) { userMatch = 'ambiguous'; detail = `Tên "${nameRaw}" khớp ${matched.count} người` }
      else { userMatch = 'ok'; assignBy = 'user'; assigneeUserId = matched.id }
    }
    if (!assigneeUserId && roleCode) { assignBy = 'role' }

    rows.push({
      rowIndex: a.row.rowIndex, action: 'create', taskId: null,
      projectCode: pc, projectNameNew: a.row.projectNameNew,
      projectExists, willCreateProject,
      title: a.row.title, deptText: a.row.deptText, roleCode,
      assigneeName: a.row.assigneeName, assigneeUserId, assignBy, userMatch,
      deadlineISO: a.row.deadlineISO, deadline: a.row.deadline,
      status: a.row.status, criteria: a.row.criteria, proposal: a.row.proposal,
      decision: a.row.decision, notes: a.row.notes, detail,
    })
  }

  const summary = {
    total: rows.length,
    toCreate: rows.filter((r) => r.action === 'create').length,
    toUpdate: rows.filter((r) => r.action === 'update').length,
    projectsNew: newProjectCodes.size,
    errors: rows.filter((r) => r.action === 'error').length,
  }

  return successResponse({ rows, summary, projects: dbProjects })
}

// ════════════════════════════════════════
//  APPLY — receive edited JSON rows
// ════════════════════════════════════════

async function handleApply(req: NextRequest, payload: { userId: string; roleCode: string }) {
  const body = await req.json()
  const finalRows: FinalRow[] = body.rows
  if (!Array.isArray(finalRows)) return errorResponse('Body cần { rows: FinalRow[] }', 400)

  const included = finalRows.filter((r) => r.include)
  if (included.length === 0) return successResponse({ created: 0, updated: 0, projectsCreated: 0, skipped: 0, errors: [] })

  // Load projects + users for validation
  const dbProjects = await prisma.project.findMany({ select: { id: true, projectCode: true } })
  const projectByNorm = new Map(dbProjects.map((p) => [normalizeCode(p.projectCode), p.id]))
  const projectById = new Set(dbProjects.map((p) => p.id))

  const userIds = included.filter((r) => r.assigneeUserId).map((r) => r.assigneeUserId!)
  const validUsers = userIds.length > 0
    ? new Set((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })).map((u) => u.id))
    : new Set<string>()

  let created = 0, updated = 0, projectsCreated = 0, skipped = 0
  const errors: { row: number; reason: string }[] = []
  const createdProjectIds = new Map<string, string>()

  for (let i = 0; i < included.length; i++) {
    const r = included[i]
    const rowNum = i + 1

    try {
      if (r.action === 'update') {
        await applyUpdate(r, payload.userId, rowNum, errors)
        if (!errors.find((e) => e.row === rowNum)) updated++
        continue
      }

      // action === 'create'
      // Resolve project
      let projectId: string | null = null
      if (r.projectMode === 'existing') {
        if (r.projectId && projectById.has(r.projectId)) {
          projectId = r.projectId
        } else {
          errors.push({ row: rowNum, reason: `Project ID "${r.projectId}" không tồn tại` })
          continue
        }
      } else if (r.projectMode === 'create') {
        const code = (r.projectCode || '').trim()
        if (!code) { errors.push({ row: rowNum, reason: 'projectCode trống khi projectMode=create' }); continue }

        // Check cache first (already created this run)
        if (createdProjectIds.has(code)) {
          projectId = createdProjectIds.get(code)!
        } else {
          // Idempotent: check if exists by normalizeCode
          const norm = normalizeCode(code)
          const existingId = projectByNorm.get(norm)
          if (existingId) {
            projectId = existingId
            createdProjectIds.set(code, existingId)
          } else {
            const proj = await prisma.project.create({
              data: {
                projectCode: code,
                projectName: (r.projectNameNew || '').trim() || code,
                clientName: '(BBH)',
                productType: 'OTHER',
                projectType: 'OTHER',
                status: 'ACTIVE',
              },
            })
            projectId = proj.id
            createdProjectIds.set(code, proj.id)
            projectByNorm.set(norm, proj.id)
            projectsCreated++
          }
        }
      }

      // Validate assignee
      if (r.assigneeUserId && !validUsers.has(r.assigneeUserId)) {
        errors.push({ row: rowNum, reason: `User ID "${r.assigneeUserId}" không tồn tại` })
        continue
      }

      // Idempotent importKey
      const keyUser = r.assigneeUserId || r.roleCode || ''
      const importKey = computeImportKey(r.title, r.projectCode || null, r.deadlineISO, keyUser)

      const existingDup = await prisma.task.findMany({
        where: { title: r.title, projectId },
        select: { resultData: true },
      })
      const alreadyExists = existingDup.some((t) => {
        const rd = (t.resultData && typeof t.resultData === 'object') ? t.resultData as Record<string, unknown> : {}
        const b = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
        return typeof b.importKey === 'string' && b.importKey === importKey
      })
      if (alreadyExists) { skipped++; continue }

      // Create task
      await prisma.$transaction(async (tx) => {
        const t = await tx.task.create({
          data: {
            projectId,
            title: r.title,
            taskType: 'FREE',
            status: 'OPEN',
            priority: 'NORMAL',
            deadline: new Date(r.deadlineISO),
            createdBy: payload.userId,
            startedAt: new Date(),
            resultData: JSON.parse(JSON.stringify({
              briefing: {
                criteria: (r.criteria || '').trim(),
                proposal: (r.proposal || '').trim(),
                decision: (r.decision || '').trim(),
                notes: (r.notes || '').trim(),
                deptRole: r.roleCode || '',
                importKey,
              },
            })),
          },
        })
        const assigneeData: { taskId: string; isPrimary: boolean; userId?: string; role?: string } = { taskId: t.id, isPrimary: true }
        if (r.assigneeUserId) { assigneeData.userId = r.assigneeUserId }
        else if (r.roleCode) { assigneeData.role = r.roleCode }
        await tx.taskAssignee.create({ data: assigneeData })
        await tx.taskHistory.create({
          data: { taskId: t.id, action: 'CREATED', byUserId: payload.userId, meta: JSON.parse(JSON.stringify({ source: 'briefing-import' })) },
        })
      })
      created++
    } catch (err) {
      errors.push({ row: rowNum, reason: `Lỗi: ${(err as Error).message}` })
    }
  }

  return successResponse({
    created, updated, projectsCreated, skipped, errors,
    summary: { total: included.length, created, updated, projectsCreated, skipped, errors: errors.length },
  })
}

async function applyUpdate(r: FinalRow, byUserId: string, rowNum: number, errors: { row: number; reason: string }[]) {
  if (!r.taskId) { errors.push({ row: rowNum, reason: 'update thiếu taskId' }); return }

  const task = await prisma.task.findUnique({ where: { id: r.taskId }, select: { resultData: true, status: true } })
  if (!task) { errors.push({ row: rowNum, reason: `Task "${r.taskId}" không tồn tại` }); return }

  const rd = (task.resultData && typeof task.resultData === 'object') ? task.resultData as Record<string, unknown> : {}
  const oldBriefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
  const newBriefing: Record<string, unknown> = { ...oldBriefing }
  if (r.criteria?.trim()) newBriefing.criteria = r.criteria.trim()
  if (r.proposal?.trim()) newBriefing.proposal = r.proposal.trim()
  if (r.decision?.trim()) newBriefing.decision = r.decision.trim()
  if (r.notes?.trim()) newBriefing.notes = r.notes.trim()

  const statusParsed = r.status?.trim() ? mapStatusLabel(r.status) : null
  if (statusParsed) {
    newBriefing.blocked = statusParsed.blocked ? 'true' : (oldBriefing.blocked || '')
  }

  const updateData: Record<string, unknown> = {
    resultData: JSON.parse(JSON.stringify({ ...rd, briefing: newBriefing })),
  }
  if (statusParsed) updateData.status = statusParsed.status
  if (r.deadlineISO) updateData.deadline = new Date(r.deadlineISO)

  await prisma.$transaction([
    prisma.task.update({ where: { id: r.taskId }, data: updateData }),
    prisma.taskHistory.create({
      data: {
        taskId: r.taskId,
        action: 'BRIEFING_UPDATE',
        byUserId,
        meta: JSON.parse(JSON.stringify({ source: 'briefing-import', statusChange: statusParsed ? r.status : null, deadlineChange: r.deadlineISO || null })),
      },
    }),
  ])
}
