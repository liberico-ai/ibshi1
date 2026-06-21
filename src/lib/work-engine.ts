import prisma from './db'
import type { CreateTaskInput, CompleteWorkTaskInput, ReassignTaskInput } from './schemas/work.schema'
import { ROLE_TO_DEPT, DEPT_KEYWORDS, DEPT_PRIMARY_ROLE, DEPT_NAME } from './org-map'
import { runHooks } from './work-hooks'
import { sendGroupMessage, escapeHtml, formatDeadline } from './telegram'

// ── Dynamic Workflow engine (Phase 1) ──
// Task động chạy song song WorkflowTask (legacy). Không đụng engine 36 bước.

const TASK_STATUS = { OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', AWAITING_REVIEW: 'AWAITING_REVIEW', DONE: 'DONE', RETURNED: 'RETURNED', CANCELLED: 'CANCELLED' } as const

// Trưởng phòng của 1 role = người giữ role đại diện phòng (DEPT_PRIMARY_ROLE), userLevel cao nhất (L1<L2).
// Trả null nếu phòng chưa có trưởng phòng → buộc người tạo chọn nhân sự cụ thể.
export async function getDeptHead(roleCode: string): Promise<{ id: string; fullName: string; deptCode: string; deptName: string } | null> {
  const dept = ROLE_TO_DEPT[roleCode]
  if (!dept) return null
  const primary = DEPT_PRIMARY_ROLE[dept]
  if (!primary) return null
  const head = await prisma.user.findFirst({
    where: { roleCode: primary, isActive: true },
    orderBy: [{ userLevel: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, fullName: true },
  })
  return head ? { id: head.id, fullName: head.fullName, deptCode: dept, deptName: DEPT_NAME[dept] || dept } : null
}

// Quy đổi danh sách người nhận:
//  - Chọn nhân sự cụ thể → giữ nguyên.
//  - Chọn cấp phòng (role) mà phòng ĐÃ có nhân sự cụ thể được chọn → bỏ qua (không gắn trưởng phòng).
//  - Chọn cấp phòng mà KHÔNG có nhân sự nào của phòng → gắn trưởng phòng; phòng không có trưởng phòng → báo lỗi.
async function resolveAssignees(assignees: { role?: string; userId?: string; isPrimary?: boolean }[]) {
  // Phòng nào đã được chọn nhân sự cụ thể (suy từ roleCode của user)
  const explicitUserIds = assignees.map((a) => a.userId).filter((x): x is string => !!x)
  const users = explicitUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: explicitUserIds } }, select: { id: true, fullName: true, username: true, roleCode: true, isActive: true } })
    : []

  const inactive = users.filter((u) => !u.isActive)
  if (inactive.length > 0) {
    const names = inactive.map((u) => `${u.fullName} (${u.username})`).join(', ')
    throw new Error(`Tài khoản đã vô hiệu, chọn tài khoản đang hoạt động: ${names}`)
  }

  const coveredDepts = new Set(users.map((u) => ROLE_TO_DEPT[u.roleCode]).filter(Boolean))

  const out: { role: string | null; userId: string | null; isPrimary: boolean }[] = []
  const needExplicit = new Set<string>()
  for (let i = 0; i < assignees.length; i++) {
    const a = assignees[i]
    if (a.userId) { out.push({ role: a.role || null, userId: a.userId, isPrimary: a.isPrimary ?? i === 0 }); continue }
    if (a.role) {
      const dept = ROLE_TO_DEPT[a.role]
      if (dept && coveredDepts.has(dept)) continue // phòng đã có nhân sự cụ thể → không cần trưởng phòng
      const head = await getDeptHead(a.role)
      if (head) out.push({ role: a.role, userId: head.id, isPrimary: a.isPrimary ?? i === 0 })
      else needExplicit.add(DEPT_NAME[dept] || a.role)
    }
  }
  if (needExplicit.size > 0) {
    throw new Error(`Phòng chưa có trưởng phòng, vui lòng chọn nhân sự cụ thể: ${[...needExplicit].join(', ')}`)
  }
  // khử trùng theo userId (giữ bản primary nếu có)
  const byUser = new Map<string, { role: string | null; userId: string | null; isPrimary: boolean }>()
  for (const a of out) {
    const key = a.userId || `role:${a.role}`
    const prev = byUser.get(key)
    if (!prev) byUser.set(key, a)
    else if (a.isPrimary) prev.isPrimary = true
  }
  return [...byUser.values()]
}

function rolesInSameDept(roleCode?: string | null): string[] {
  const dept = roleCode ? ROLE_TO_DEPT[roleCode] : null
  if (!dept) return roleCode ? [roleCode] : []
  return Object.entries(ROLE_TO_DEPT).filter(([, d]) => d === dept).map(([r]) => r)
}

async function notifyAssignees(
  taskId: string, title: string,
  assignees: { role?: string | null; userId?: string | null }[],
  opts?: { projectCode?: string; projectName?: string; createdByName?: string; deadline?: Date | null },
) {
  const userIds = new Set<string>()
  for (const a of assignees) {
    if (a.userId) userIds.add(a.userId)
    else if (a.role) {
      const us = await prisma.user.findMany({ where: { roleCode: a.role, isActive: true }, select: { id: true } })
      us.forEach((u) => userIds.add(u.id))
    }
  }
  if (userIds.size === 0) return

  // In-app notification
  try {
    await prisma.notification.createMany({
      data: [...userIds].map((uid) => ({
        userId: uid, title: `Công việc mới: ${title}`,
        message: 'Bạn được giao một công việc mới.', type: 'task_assigned',
        linkUrl: `/dashboard/work/${taskId}`,
      })),
    })
  } catch (e) { console.error('notifyAssignees DB error:', e, { taskId, userIds: [...userIds] }) }

  // Telegram group notification
  try {
    const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { fullName: true, telegramChatId: true } })
    const mentions = users.map((u) =>
      u.telegramChatId ? `<a href="tg://user?id=${u.telegramChatId}">${escapeHtml(u.fullName)}</a>` : `<b>${escapeHtml(u.fullName)}</b>`
    )
    const url = process.env.NEXT_PUBLIC_APP_URL || ''
    const msg = [
      `📋 <b>GIAO VIỆC MỚI</b>`,
      '━━━━━━━━━━━━━━━━',
      opts?.projectCode ? `📁 Dự án: <b>${escapeHtml(opts.projectCode)}</b>${opts.projectName ? ` — ${escapeHtml(opts.projectName)}` : ''}` : null,
      `📌 Việc: <b>${escapeHtml(title)}</b>`,
      `👥 Giao cho: ${mentions.join(', ')}`,
      opts?.createdByName ? `📝 Người giao: ${escapeHtml(opts.createdByName)}` : null,
      opts?.deadline ? `⏰ Deadline: <b>${formatDeadline(opts.deadline)}</b>` : null,
      url ? `🔗 <a href="${url}/dashboard/work/${taskId}">Xem chi tiết</a>` : null,
    ].filter(Boolean).join('\n')
    await sendGroupMessage(msg)
  } catch (e) { console.error('notifyAssignees Telegram error:', e) }
}

export async function createTask(input: CreateTaskInput, userId: string, opts?: { forwardedFromId?: string }) {
  const parent = input.parentId
    ? await prisma.task.findUnique({ where: { id: input.parentId }, select: { level: true } })
    : null
  const level = parent ? parent.level + 1 : 2

  // Giao cấp phòng (role-only) → tự gắn trưởng phòng; phòng không có trưởng phòng → buộc chọn người cụ thể.
  const assignees = await resolveAssignees(input.assignees || [])

  const task = await prisma.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        projectId: input.projectId || null,
        parentId: input.parentId || null,
        forwardedFromId: opts?.forwardedFromId || input.forwardedFromId || null,
        level,
        taskType: input.taskType || 'FREE',
        title: input.title,
        description: input.description,
        priority: input.priority,
        deadline: input.deadline ? new Date(input.deadline) : null,
        createdBy: userId,
        assignedAt: new Date(),
        status: TASK_STATUS.OPEN,
        checklistTemplateKey: input.checklistTemplateKey,
      },
    })
    if (assignees.length) {
      await tx.taskAssignee.createMany({
        data: assignees.map((a, i) => ({
          taskId: t.id, role: a.role || null, userId: a.userId || null,
          isPrimary: a.isPrimary ?? i === 0,
        })),
      })
    }
    if (input.docs?.length) {
      // tạo từng dòng để giữ thứ tự + lấy id (phục vụ gắn tệp nháp)
      for (const d of input.docs) {
        await tx.taskDocRequirement.create({
          data: { taskId: t.id, kind: d.kind, label: d.label, fileAttachmentId: d.fileAttachmentId || null },
        })
      }
    }
    await tx.taskHistory.createMany({
      data: [
        { taskId: t.id, action: parent ? 'SUBTASK_CREATED' : 'CREATED', byUserId: userId },
        ...assignees.map((a) => ({ taskId: t.id, action: 'ASSIGNED', byUserId: userId, toRole: a.role || null, toUserId: a.userId || null })),
      ],
    })
    return t
  })

  // ── Gắn tệp đính kèm vào tài liệu (an toàn kể cả khi fileAttachmentId chưa kịp lưu ở form) ──
  // Tệp được upload trước với entityType='TaskDoc', entityId=`${draftId}__${key}`.
  // Sau khi tạo task: với mỗi tài liệu, nếu chưa có fileAttachmentId thì dò theo (draftId, key);
  // đồng thời trỏ tệp về chính task để về sau liệt kê được.
  if (input.docs?.length) {
    const createdDocs = await prisma.taskDocRequirement.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: 'asc' },
    })
    for (let idx = 0; idx < input.docs.length; idx++) {
      const inp = input.docs[idx]
      const doc = createdDocs[idx]
      if (!doc) continue
      let fileId = inp.fileAttachmentId || null
      if (!fileId && input.draftId && inp.key) {
        const orphan = await prisma.fileAttachment.findFirst({
          where: { entityType: 'TaskDoc', entityId: `${input.draftId}__${inp.key}` },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        if (orphan) fileId = orphan.id
      }
      if (fileId) {
        await prisma.taskDocRequirement.update({ where: { id: doc.id }, data: { fileAttachmentId: fileId } })
        // trỏ tệp về task (giúp liệt kê & dọn dẹp), bỏ qua nếu lỗi
        await prisma.fileAttachment.update({ where: { id: fileId }, data: { entityType: 'TaskDoc', entityId: `${task.id}__${doc.id}` } }).catch(() => {})
      }
    }
  }

  // Fetch context for Telegram notification (project + creator name)
  const [project, creator] = await Promise.all([
    task.projectId ? prisma.project.findUnique({ where: { id: task.projectId }, select: { projectCode: true, projectName: true } }) : null,
    prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
  ])
  await notifyAssignees(task.id, task.title, assignees, {
    projectCode: project?.projectCode, projectName: project?.projectName,
    createdByName: creator?.fullName, deadline: task.deadline,
  })
  return task
}

function isAssignee(task: { createdBy: string; status: string; assignees: { role: string | null; userId: string | null }[] }, userId: string, roleCode: string) {
  if (task.status === 'RETURNED' && task.createdBy === userId) return true
  return task.assignees.some((a) => a.userId === userId || a.role === roleCode)
}

export async function completeTask(taskId: string, userId: string, roleCode: string, input: CompleteWorkTaskInput) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true, docs: true } })
  if (!task) throw new Error('Không tìm thấy công việc')
  if (task.status === TASK_STATUS.DONE) throw new Error('Công việc đã hoàn thành')
  if (!isAssignee(task, userId, roleCode)) throw new Error('Bạn không phải người nhận công việc này')

  // ── Điều kiện hoàn thành (áp dụng cho MỌI task) ──
  // (a) MUST_READ: phải tick "đã đọc" từng tài liệu mới được hoàn thành.
  // (b) MUST_RETURN: mỗi tài liệu phải có note (text) HOẶC file đính kèm.
  // "Giao tiếp" (reassign) và "Trả lại" (return) KHÔNG đi qua đây nên không bị ràng buộc.
  const mustRead = task.docs.filter((d) => d.kind === 'MUST_READ')
  const mustReturn = task.docs.filter((d) => d.kind === 'MUST_RETURN')

  // (a) kiểm tra đã đọc — THEO TỪNG NGƯỜI (lưu vết per-user, không dùng cờ chung).
  // Mỗi người nhận phải tự tick "đã đọc" tất cả tài liệu MUST_READ thì mới hoàn thành được.
  const ackIds = new Set(input.acknowledgedDocIds || [])
  const myPriorAcks = mustRead.length
    ? await prisma.taskDocAck.findMany({ where: { requirementId: { in: mustRead.map((d) => d.id) }, userId }, select: { requirementId: true } })
    : []
  const myAckedIds = new Set([...myPriorAcks.map((a) => a.requirementId), ...ackIds])
  const unread = mustRead.filter((d) => !myAckedIds.has(d.id))
  if (unread.length > 0) {
    throw new Error(`Cần tick "đã đọc" trước khi hoàn thành: ${unread.map((m) => m.label).join(', ')}`)
  }

  // (b) kiểm tra tài liệu trả lại có note hoặc file
  const returnedById = new Map((input.returnedDocs || []).map((r) => [r.requirementId, r]))
  const missingReturn = mustReturn.filter((d) => {
    if (d.fulfilled) return false
    const rd = returnedById.get(d.id)
    const hasNote = !!rd?.note?.trim()
    const hasFile = !!rd?.fileAttachmentId
    return !hasNote && !hasFile
  })
  if (missingReturn.length > 0) {
    throw new Error(`Cần nhập nội dung hoặc đính kèm tài liệu trả lại: ${missingReturn.map((m) => m.label).join(', ')}`)
  }

  // Lưu vết: ghi nhận người này đã đọc từng tài liệu MUST_READ
  for (const d of mustRead) {
    if (ackIds.has(d.id)) {
      await prisma.taskDocAck.upsert({
        where: { requirementId_userId: { requirementId: d.id, userId } },
        create: { requirementId: d.id, userId },
        update: {},
      })
    }
  }
  if (input.returnedDocs?.length) {
    for (const rd of input.returnedDocs) {
      await prisma.taskDocRequirement.update({
        where: { id: rd.requirementId },
        data: {
          fulfilled: true,
          fileAttachmentId: rd.fileAttachmentId || undefined,
          note: rd.note?.trim() || undefined,
        },
      })
    }
  }

  // ── Hoàn thành theo TỪNG người nhận ──
  // Khi creator hoàn thành task RETURNED → mark TẤT CẢ assignees done (creator đang finalize toàn bộ task)
  const isCreatorOnReturned = task.status === 'RETURNED' && task.createdBy === userId
  if (isCreatorOnReturned) {
    await prisma.taskAssignee.updateMany({
      where: { taskId, done: false },
      data: { done: true, doneAt: new Date(), doneBy: userId, outcome: input.mode },
    })
  } else {
    // Tìm dòng người nhận của user hiện tại (ưu tiên khớp userId, sau đó khớp role chưa xong).
    const myRow =
      task.assignees.find((a) => a.userId === userId) ||
      task.assignees.find((a) => a.role === roleCode && !a.done) ||
      task.assignees.find((a) => a.role === roleCode)
    if (myRow) {
      await prisma.taskAssignee.update({
        where: { id: myRow.id },
        data: { done: true, doneAt: new Date(), doneBy: userId, outcome: input.mode },
      })
    }
  }

  await prisma.taskHistory.create({
    data: { taskId, action: 'ASSIGNEE_DONE', byUserId: userId, toUserId: task.createdBy, reason: input.note, meta: { mode: input.mode } },
  })

  // Option 2: hoàn thành & CHUYỂN TIẾP sang bộ phận khác → sinh task mới liên kết (truy vết)
  let forwardedId: string | null = null
  if (input.mode === 'FORWARD' && input.forward) {
    const fwdDocs = input.forward.docs?.length
      ? input.forward.docs
      : task.docs.filter((d) => d.kind === 'MUST_READ' || d.kind === 'MUST_RETURN').map((d) => ({
          kind: d.kind as 'MUST_READ' | 'MUST_RETURN', label: d.label, fileAttachmentId: d.fileAttachmentId || undefined,
        }))
    const fwd = await createTask(
      {
        title: input.forward.title?.trim() || `[Chuyển tiếp] ${task.title}`,
        description: input.forward.note,
        projectId: task.projectId || undefined,
        taskType: input.forward.taskType || 'FREE',
        priority: 'NORMAL',
        deadline: input.forward.deadline,
        assignees: input.forward.assignees,
        docs: fwdDocs.length ? fwdDocs : undefined,
      },
      userId,
      { forwardedFromId: taskId }
    )
    forwardedId = fwd.id
    // Mang toàn bộ resultData sang task chuyển tiếp (dự toán, PR, BBH...) để người nhận xem & phê duyệt
    const srcRd = (task as { resultData?: unknown }).resultData
    if (srcRd && typeof srcRd === 'object' && Object.keys(srcRd as object).length > 0) {
      await prisma.task.update({ where: { id: fwd.id }, data: { resultData: JSON.parse(JSON.stringify(srcRd)) } }).catch(() => {})
    }
    const fwdAssigneeNames = input.forward.assignees.map((a: { userId?: string; role?: string }) => a.userId || a.role || '').filter(Boolean)
    await prisma.taskHistory.create({
      data: { taskId, action: 'FORWARDED', byUserId: userId, toUserId: fwdAssigneeNames[0] || null, reason: input.forward.note, meta: { forwardedTaskId: fwd.id } },
    })
  }

  // Task chỉ "xong phần thực thi" khi TẤT CẢ người nhận đã hoàn thành
  const rows = await prisma.taskAssignee.findMany({ where: { taskId }, select: { done: true } })
  const allDone = rows.length > 0 && rows.every((r) => r.done)
  const templateStepId = (task as { templateStepId?: string | null }).templateStepId

  if (allDone) {
    // Mọi người đã đọc xong → đánh dấu tài liệu MUST_READ là đã hoàn tất
    if (mustRead.length) await prisma.taskDocRequirement.updateMany({ where: { taskId, kind: 'MUST_READ' }, data: { fulfilled: true } })

    if (templateStepId) {
      // Task thuộc template: giữ luồng tự động — DONE + hook + sinh bước kế tiếp
      await prisma.$transaction([
        prisma.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.DONE, completedAt: new Date(), completedBy: userId, resultData: input.resultData ? JSON.parse(JSON.stringify(input.resultData)) : undefined } }),
        prisma.taskHistory.create({ data: { taskId, action: 'COMPLETED', byUserId: userId } }),
        prisma.notification.create({ data: { userId: task.createdBy, title: `Hoàn thành: ${task.title}`, message: 'Công việc bạn giao đã hoàn thành.', type: 'task_completed', linkUrl: `/dashboard/work/${taskId}` } }),
      ])
      const hookKeys = (task as { hookKeys?: string[] }).hookKeys
      await runHooks(hookKeys, { projectId: task.projectId, userId, resultData: input.resultData })
      // Nếu user chọn FORWARD thì KHÔNG chain next (forward task thay thế luồng tự động)
      if (!forwardedId) {
        await chainNextTemplateTasks(taskId, task.projectId, templateStepId, userId)
      }
    } else {
      // Task ad-hoc: trả về NGƯỜI GIAO để xem & kết thúc (chờ duyệt). Người giao sẽ chọn:
      // (1) Hoàn thành & kết thúc  hoặc  (2) Tạo việc tiếp theo.
      await prisma.$transaction([
        prisma.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.AWAITING_REVIEW, resultData: input.resultData ? JSON.parse(JSON.stringify(input.resultData)) : undefined } }),
        prisma.taskHistory.create({ data: { taskId, action: 'SUBMITTED_TO_CREATOR', byUserId: userId, toUserId: task.createdBy } }),
        prisma.notification.create({ data: { userId: task.createdBy, title: `Cần xem & kết thúc: ${task.title}`, message: 'Người nhận đã hoàn thành và trả lại. Hãy kết thúc hoặc tạo việc tiếp theo.', type: 'task_review', linkUrl: `/dashboard/work/${taskId}` } }),
      ])
    }
  } else {
    // Còn người chưa xong → chuyển sang đang xử lý, báo người tạo tiến độ
    const doneCount = rows.filter((r) => r.done).length
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.IN_PROGRESS } }),
      prisma.notification.create({
        data: { userId: task.createdBy, title: `Tiến độ: ${task.title}`, message: `Đã hoàn thành ${doneCount}/${rows.length} người nhận.`, type: 'task_progress', linkUrl: `/dashboard/work/${taskId}` },
      }),
    ])
  }

  return { ok: true, allDone, forwardedId }
}

// Người GIAO kết thúc task (sau khi người nhận đã hoàn thành & trả về — trạng thái AWAITING_REVIEW).
// Đây là lựa chọn (1) "Hoàn thành & kết thúc". Lựa chọn (2) "Tạo việc tiếp theo" dùng luồng tạo task có sẵn.
export async function finalizeTask(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Không tìm thấy công việc')
  if (task.createdBy !== userId) throw new Error('Chỉ người giao việc mới được kết thúc')
  if (task.status === TASK_STATUS.DONE) throw new Error('Công việc đã kết thúc')
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.DONE, completedAt: new Date(), completedBy: userId } }),
    prisma.taskHistory.create({ data: { taskId, action: 'CLOSED', byUserId: userId } }),
  ])
  // Chạy hook nghiệp vụ khi người giao chốt kết thúc
  const hookKeys = (task as { hookKeys?: string[] }).hookKeys
  await runHooks(hookKeys, { projectId: task.projectId, userId })
  return { ok: true }
}

// ── Admin status setter (briefing import / manual override) ──

export interface SetStatusAdminInput {
  status: string
  blocked?: boolean
  escalated?: boolean
  reason?: string
  briefingPatch?: Partial<{ criteria: string; proposal: string; decision: string; notes: string }>
  deadline?: string | null
}

export async function setTaskStatusAdmin(taskId: string, byUserId: string, input: SetStatusAdminInput): Promise<{ ok: true; status: string; wasEscalated?: boolean }> {
  const validStatuses = Object.values(TASK_STATUS) as string[]
  if (!validStatuses.includes(input.status)) throw new Error('Trạng thái không hợp lệ')

  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } })
  if (!task) throw new Error('Không tìm thấy công việc')

  // Merge resultData.briefing
  const rd = (task.resultData && typeof task.resultData === 'object') ? task.resultData as Record<string, unknown> : {}
  const oldBriefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
  const newBriefing: Record<string, unknown> = { ...oldBriefing }
  if (input.briefingPatch) {
    for (const [k, v] of Object.entries(input.briefingPatch)) {
      if (v && v.trim()) newBriefing[k] = v.trim()
    }
  }
  newBriefing.blocked = input.blocked ? 'true' : ''

  const newResultData = JSON.parse(JSON.stringify({ ...rd, briefing: newBriefing }))

  const isDoneOrCancelled = input.status === TASK_STATUS.DONE || input.status === TASK_STATUS.CANCELLED
  const blockedCol = isDoneOrCancelled ? false : !!input.blocked

  const now = new Date()
  const updateData: Record<string, unknown> = {
    status: input.status,
    blocked: blockedCol,
    resultData: newResultData,
  }
  if (input.deadline !== undefined) {
    updateData.deadline = input.deadline ? new Date(input.deadline) : null
  }

  // Escalation handling
  if (isDoneOrCancelled) {
    updateData.escalated = false
    updateData.escalatedAt = null
    updateData.escalatedBy = null
  } else if (input.escalated !== undefined) {
    updateData.escalated = input.escalated
    updateData.escalatedAt = input.escalated ? now : null
    updateData.escalatedBy = input.escalated ? byUserId : null
  }

  const historyMeta = JSON.parse(JSON.stringify({ source: 'briefing', blocked: !!input.blocked, escalated: !!input.escalated }))

  if (input.status === TASK_STATUS.DONE) {
    updateData.completedAt = now
    updateData.completedBy = byUserId
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: updateData }),
      prisma.taskAssignee.updateMany({ where: { taskId }, data: { done: true, doneAt: now } }),
      prisma.taskHistory.create({ data: { taskId, action: 'STATUS_DONE', byUserId, reason: input.reason, meta: historyMeta } }),
      prisma.notification.create({ data: { userId: task.createdBy, title: `Hoàn thành: ${task.title}`, message: 'Công việc đã được đánh dấu hoàn thành.', type: 'task_completed', linkUrl: `/dashboard/work/${taskId}` } }),
    ])
    const templateStepId = (task as { templateStepId?: string | null }).templateStepId
    if (templateStepId && task.projectId) {
      const hookKeys = (task as { hookKeys?: string[] }).hookKeys
      await runHooks(hookKeys, { projectId: task.projectId, userId: byUserId })
      await chainNextTemplateTasks(taskId, task.projectId, templateStepId, byUserId)
    }
  } else if (input.status === TASK_STATUS.RETURNED) {
    updateData.returnCount = { increment: 1 }
    const assigneeUserIds = task.assignees.map(a => a.userId).filter((uid): uid is string => !!uid)
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: updateData }),
      prisma.taskHistory.create({ data: { taskId, action: 'STATUS_RETURNED', byUserId, reason: input.reason, meta: historyMeta } }),
      ...assigneeUserIds.map(uid =>
        prisma.notification.create({ data: { userId: uid, title: `⚠️ Trả lại: ${task.title}`, message: input.reason || 'Công việc bị trả lại.', type: 'task_returned', linkUrl: `/dashboard/work/${taskId}` } })
      ),
    ])
  } else if (input.status === TASK_STATUS.CANCELLED) {
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: updateData }),
      prisma.taskHistory.create({ data: { taskId, action: 'STATUS_CANCELLED', byUserId, reason: input.reason, meta: historyMeta } }),
    ])
  } else {
    const label = input.blocked ? `${input.status} (Tắc)` : input.status
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: updateData }),
      prisma.taskHistory.create({ data: { taskId, action: 'STATUS_SET', byUserId, reason: input.reason || `Chuyển: ${label}`, meta: historyMeta } }),
    ])
  }

  const wasEscalated = !task.escalated && input.escalated === true
  return { ok: true, status: input.status, wasEscalated }
}

export async function returnTask(taskId: string, userId: string, roleCode: string, reason: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } })
  if (!task) throw new Error('Không tìm thấy công việc')
  if (!isAssignee(task, userId, roleCode)) throw new Error('Bạn không phải người nhận công việc này')

  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.RETURNED, returnCount: { increment: 1 } } }),
    prisma.taskHistory.create({ data: { taskId, action: 'RETURNED', byUserId: userId, fromUserId: task.createdBy, reason } }),
    prisma.notification.create({
      data: { userId: task.createdBy, title: `⚠️ Trả lại (sai phạm vi): ${task.title}`, message: `Lý do: ${reason}`, type: 'task_returned', linkUrl: `/dashboard/work/${taskId}` },
    }),
  ])
  return { ok: true, returnedTo: task.createdBy }
}

export async function reassignTask(taskId: string, userId: string, input: ReassignTaskInput) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, projectId: true, deadline: true } })
  if (!task) throw new Error('Không tìm thấy công việc')

  const reassignUserIds = (input.assignees || []).map((a) => a.userId).filter((x): x is string => !!x)
  if (reassignUserIds.length > 0) {
    const reassignUsers = await prisma.user.findMany({ where: { id: { in: reassignUserIds } }, select: { id: true, fullName: true, username: true, isActive: true } })
    const inactive = reassignUsers.filter((u) => !u.isActive)
    if (inactive.length > 0) {
      const names = inactive.map((u) => `${u.fullName} (${u.username})`).join(', ')
      throw new Error(`Tài khoản đã vô hiệu, chọn tài khoản đang hoạt động: ${names}`)
    }
  }

  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({ where: { taskId } }),
    prisma.taskAssignee.createMany({ data: input.assignees.map((a, i) => ({ taskId, role: a.role || null, userId: a.userId || null, isPrimary: a.isPrimary ?? i === 0 })) }),
    prisma.task.update({ where: { id: taskId }, data: { status: TASK_STATUS.OPEN, assignedAt: new Date() } }),
    prisma.taskHistory.create({ data: { taskId, action: 'REASSIGNED', byUserId: userId, toRole: input.assignees[0]?.role || null, toUserId: input.assignees[0]?.userId || null, reason: input.note } }),
  ])
  const [project, creator] = await Promise.all([
    task.projectId ? prisma.project.findUnique({ where: { id: task.projectId }, select: { projectCode: true, projectName: true } }) : null,
    prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
  ])
  await notifyAssignees(taskId, task.title, input.assignees, {
    projectCode: project?.projectCode, projectName: project?.projectName,
    createdByName: creator?.fullName, deadline: task.deadline,
  })
  return { ok: true }
}

export async function addComment(taskId: string, userId: string, content: string) {
  return prisma.taskHistory.create({ data: { taskId, action: 'COMMENT', byUserId: userId, reason: content } })
}

// Người TẠO sửa lại việc (tiêu đề/mô tả/deadline/ưu tiên) khi chưa hoàn thành
export async function updateTask(taskId: string, userId: string, data: { title?: string; description?: string; deadline?: string | null; priority?: string }) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { createdBy: true, status: true } })
  if (!task) throw new Error('Không tìm thấy công việc')
  if (task.createdBy !== userId) throw new Error('Chỉ người tạo việc mới được sửa')
  if (task.status === TASK_STATUS.DONE) throw new Error('Việc đã hoàn thành, không sửa được')
  await prisma.task.update({
    where: { id: taskId },
    data: {
      title: data.title?.trim() || undefined,
      description: data.description ?? undefined,
      deadline: data.deadline === null ? null : data.deadline ? new Date(data.deadline) : undefined,
      priority: data.priority || undefined,
    },
  })
  await prisma.taskHistory.create({ data: { taskId, action: 'EDITED', byUserId: userId } })
  return { ok: true }
}

// Danh sách nhân sự của phòng (theo role đại diện) — dùng để "mời cả phòng" khi tạo họp
export async function getDeptUsers(roleCode: string) {
  const dept = ROLE_TO_DEPT[roleCode]
  if (!dept) return []
  const roles = Object.entries(ROLE_TO_DEPT).filter(([, d]) => d === dept).map(([r]) => r)
  return prisma.user.findMany({ where: { roleCode: { in: roles }, isActive: true }, select: { id: true, fullName: true, roleCode: true }, orderBy: { userLevel: 'asc' } })
}

export async function getInbox(userId: string, roleCode: string, tab: string, page: number, opts?: { q?: string; projectId?: string }) {
  const PAGE = 20
  const deptRoles = rolesInSameDept(roleCode)
  const active = { in: [TASK_STATUS.OPEN, TASK_STATUS.IN_PROGRESS] }
  let where: Record<string, unknown>
  if (tab === 'created') where = { createdBy: userId }
  else if (tab === 'dept') where = { status: active, assignees: { some: { role: { in: deptRoles } } } }
  else if (tab === 'overdue') where = { status: active, deadline: { lt: new Date() }, assignees: { some: { OR: [{ userId }, { role: roleCode }] } } }
  // assigned: việc tôi đang nhận + việc tôi giao đang CHỜ TÔI KẾT THÚC hoặc BỊ TRẢ LẠI
  else where = {
    OR: [
      { status: active, assignees: { some: { OR: [{ userId }, { role: roleCode }] } } },
      { status: TASK_STATUS.AWAITING_REVIEW, createdBy: userId },
      { status: TASK_STATUS.RETURNED, createdBy: userId },
    ],
  }
  // Lọc thêm: từ khóa tiêu đề + dự án
  const extra: Record<string, unknown>[] = []
  if (opts?.q?.trim()) extra.push({ title: { contains: opts.q.trim(), mode: 'insensitive' } })
  if (opts?.projectId) extra.push({ projectId: opts.projectId })
  if (extra.length) where = { AND: [where, ...extra] }

  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        assignees: true,
        _count: { select: { children: true, docs: true } },
      },
      orderBy: [{ priority: 'desc' }, { deadline: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE, take: PAGE,
    }),
  ])
  // Gắn tên người nhận + createdBy (để hiển thị "ai" và nhãn "cần bạn kết thúc")
  const uids = new Set<string>()
  for (const t of tasks) { uids.add(t.createdBy); for (const a of t.assignees) if (a.userId) uids.add(a.userId) }
  const users = uids.size ? await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, fullName: true, roleCode: true } }) : []
  const nameById = new Map(users.map((u) => [u.id, u.fullName]))
  const tasksOut = tasks.map((t) => ({
    ...t,
    assigneeNames: t.assignees.map((a) => a.userId ? (nameById.get(a.userId) || 'NV') : (DEPT_NAME[ROLE_TO_DEPT[a.role || '']] || a.role || '—')),
    needsMyReview: t.status === TASK_STATUS.AWAITING_REVIEW && t.createdBy === userId,
  }))
  return { tasks: tasksOut, pagination: { page, limit: PAGE, total, totalPages: Math.ceil(total / PAGE) } }
}

export async function getTaskDetail(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      assignees: true,
      docs: { include: { acks: true } },
      children: { include: { assignees: true } },
      parent: { select: { id: true, title: true, status: true } },
      forwardedFrom: { select: { id: true, title: true, status: true } },
      forwards: { select: { id: true, title: true, status: true, taskType: true } },
      history: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!task) return null

  // (1) Gắn fileUrl/fileName cho tài liệu có đính kèm
  const fileIds = task.docs.map((d) => d.fileAttachmentId).filter((x): x is string => !!x)
  const files = fileIds.length
    ? await prisma.fileAttachment.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, fileName: true, fileUrl: true },
      })
    : []
  const fileById = new Map(files.map((f) => [f.id, f]))

  // (1b) Lịch họp tạo trực tiếp từ task này (liên kết module Lịch họp)
  const meetings = await prisma.meeting.findMany({
    where: { taskId: id },
    select: { id: true, title: true, status: true, startsAt: true },
    orderBy: { startsAt: 'desc' },
  })

  // (2) Phân giải tên người cho từng dòng lịch sử (ai tạo / giao cho ai / ai đã đọc)
  const userIds = new Set<string>()
  if (task.createdBy) userIds.add(task.createdBy)
  if (task.completedBy) userIds.add(task.completedBy)
  for (const a of task.assignees) { if (a.userId) userIds.add(a.userId); if (a.doneBy) userIds.add(a.doneBy) }
  for (const d of task.docs) for (const ak of d.acks) userIds.add(ak.userId)
  for (const h of task.history) {
    if (h.byUserId) userIds.add(h.byUserId)
    if (h.fromUserId) userIds.add(h.fromUserId)
    if (h.toUserId) userIds.add(h.toUserId)
  }
  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, fullName: true, roleCode: true },
      })
    : []
  const userById = new Map(users.map((u) => [u.id, u]))
  const nameOf = (uid?: string | null) => (uid ? userById.get(uid)?.fullName || 'Người dùng' : null)
  const roleName = (rc?: string | null) => (rc ? ROLE_TO_DEPT[rc] ? `${rc} (${ROLE_TO_DEPT[rc]})` : rc : null)

  // Tài liệu + tệp đính kèm + lưu vết người đã đọc
  const docs = task.docs.map((d) => ({
    ...d,
    file: d.fileAttachmentId ? fileById.get(d.fileAttachmentId) || null : null,
    acks: d.acks.map((ak) => ({ userId: ak.userId, userName: nameOf(ak.userId), createdAt: ak.createdAt })),
  }))

  const history = task.history.map((h) => ({
    ...h,
    byName: nameOf(h.byUserId),
    fromName: nameOf(h.fromUserId),
    toName: nameOf(h.toUserId),
    toRoleName: roleName(h.toRole),
  }))

  const assignees = task.assignees.map((a) => ({
    ...a,
    userName: nameOf(a.userId),
    roleName: roleName(a.role),
    doneByName: nameOf(a.doneBy),
  }))
  const doneCount = assignees.filter((a) => a.done).length

  return {
    ...task,
    docs,
    history,
    createdByName: nameOf(task.createdBy),
    completedByName: nameOf(task.completedBy),
    assignees,
    progress: { done: doneCount, total: assignees.length }, // tiến độ hoàn thành theo người
    meetings, // lịch họp tạo từ task này
  }
}

// Gợi ý phòng — kết hợp (1) quy trình cũ (RoutingSuggestion theo loại việc) +
// (2) quét từ khóa tiêu đề/mô tả theo chức năng phòng ban. Trả {toRoleCode,toDepartmentCode,reason}.
export async function suggestRoute(fromContext?: string, text?: string) {
  const out = new Map<string, { toRoleCode: string | null; toDepartmentCode: string | null; reason: string; score: number }>()

  // (1) Từ quy trình cũ — khi loại việc ứng với một bước (vd P2.1)
  if (fromContext && fromContext !== 'FREE') {
    const sg = await prisma.routingSuggestion.findMany({ where: { fromContext }, orderBy: { weight: 'desc' }, take: 6 })
    for (const s of sg) {
      const key = s.toDepartmentCode || s.toRoleCode || s.reason
      if (!out.has(key)) out.set(key, { toRoleCode: s.toRoleCode, toDepartmentCode: s.toDepartmentCode, reason: `quy trình: ${s.reason}`, score: 5 })
    }
  }

  // (2) Quét từ khóa tiêu đề + mô tả
  const t = (text || '').toLowerCase()
  if (t.trim()) {
    for (const [dept, kws] of Object.entries(DEPT_KEYWORDS)) {
      const hit = kws.filter((k) => t.includes(k))
      if (hit.length) {
        const prev = out.get(dept)
        if (prev) prev.score += hit.length
        else out.set(dept, { toRoleCode: DEPT_PRIMARY_ROLE[dept] || null, toDepartmentCode: dept, reason: `khớp: ${hit.slice(0, 2).join(', ')}`, score: hit.length })
      }
    }
  }

  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 6)
}

// Phase 3 (chained): chỉ sinh bước ĐẦU; xong bước nào → tự sinh bước kế (theo next/gate).
interface TStep { id: string; code: string; title: string; roleCode: string | null; taskType: string; hookKeys: string[]; nextCodes: string[]; gateCodes: string[]; deadlineDays: number | null; orderIndex: number }

async function spawnTemplateStep(step: TStep, projectId: string, byUser: string) {
  // tránh trùng: 1 bước template chỉ sinh 1 task/dự án
  const exists = await prisma.task.findFirst({ where: { projectId, templateStepId: step.id }, select: { id: true } })
  if (exists) return false
  const t = await prisma.task.create({
    data: {
      projectId, level: 2, taskType: step.taskType || step.code, title: step.title,
      priority: 'NORMAL', createdBy: byUser, assignedAt: new Date(), status: 'OPEN',
      hookKeys: step.hookKeys || [], templateStepId: step.id,
      deadline: step.deadlineDays ? new Date(Date.now() + step.deadlineDays * 86400000) : null,
    },
  })
  if (step.roleCode) await prisma.taskAssignee.create({ data: { taskId: t.id, role: step.roleCode, isPrimary: true } })
  await prisma.taskHistory.create({ data: { taskId: t.id, action: 'CREATED', byUserId: byUser, toRole: step.roleCode } })
  const [project, creator] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true, projectName: true } }),
    prisma.user.findUnique({ where: { id: byUser }, select: { fullName: true } }),
  ])
  await notifyAssignees(t.id, t.title, step.roleCode ? [{ role: step.roleCode }] : [], {
    projectCode: project?.projectCode, projectName: project?.projectName,
    createdByName: creator?.fullName, deadline: t.deadline,
  })
  return true
}

// Tập "code đã xong" = BƯỚC ĐẦU (orderIndex nhỏ nhất, coi như xong khi tạo dự án) + task template đã DONE.
async function doneCodesForProject(steps: TStep[], projectId: string): Promise<Set<string>> {
  const first = steps.slice().sort((a, b) => a.orderIndex - b.orderIndex)[0]
  const roots = first ? [first.code] : []
  const doneTasks = await prisma.task.findMany({ where: { projectId, status: 'DONE', NOT: { templateStepId: null } }, select: { taskType: true } })
  return new Set([...roots, ...doneTasks.map((t) => t.taskType)])
}

export async function applyTemplate(projectId: string, templateCode: string, byUser: string) {
  const tpl = await prisma.workflowTemplate.findFirst({
    where: { code: templateCode, isActive: true },
    include: { steps: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!tpl) throw new Error(`Không tìm thấy template "${templateCode}"`)
  const steps = tpl.steps as unknown as TStep[]
  const byCode = new Map(steps.map((s) => [s.code, s]))
  const done = await doneCodesForProject(steps, projectId) // = các bước gốc
  let created = 0
  // sinh các bước kế tiếp của bước gốc, nếu gate đã thỏa
  for (const rootCode of done) {
    const root = byCode.get(rootCode); if (!root) continue
    for (const nc of root.nextCodes || []) {
      const ns = byCode.get(nc); if (!ns) continue
      if ((ns.gateCodes || []).every((g) => done.has(g))) {
        if (await spawnTemplateStep(ns, projectId, byUser)) created++
      }
    }
  }
  return { ok: true, created, template: tpl.name }
}

// Gọi khi 1 task template hoàn thành → sinh các bước kế (theo next/gate).
async function chainNextTemplateTasks(taskId: string, projectId: string | null, templateStepId: string | null, byUser: string) {
  if (!templateStepId || !projectId) return
  const step = await prisma.templateStep.findUnique({ where: { id: templateStepId } })
  if (!step) return
  const steps = (await prisma.templateStep.findMany({ where: { templateId: step.templateId } })) as unknown as TStep[]
  const byCode = new Map(steps.map((s) => [s.code, s]))
  const done = await doneCodesForProject(steps, projectId) // đã gồm task vừa DONE
  for (const nc of (step as unknown as TStep).nextCodes || []) {
    const ns = byCode.get(nc); if (!ns) continue
    if ((ns.gateCodes || []).every((g) => done.has(g))) await spawnTemplateStep(ns, projectId, byUser)
  }
}

export async function listTemplates() {
  return prisma.workflowTemplate.findMany({
    where: { isActive: true }, orderBy: [{ projectType: 'asc' }, { version: 'desc' }],
    include: { _count: { select: { steps: true } } },
  })
}

export async function getTemplate(id: string) {
  return prisma.workflowTemplate.findUnique({ where: { id }, include: { steps: { orderBy: { orderIndex: 'asc' } } } })
}
