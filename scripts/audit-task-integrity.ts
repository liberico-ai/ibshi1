/**
 * Audit task ↔ personnel integrity after org rebuild.
 * READ-ONLY — does not modify any data.
 *
 * Usage:
 *   set -a; source .env.backup.production; set +a
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/audit-task-integrity.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

function createPrisma() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL required')
  const isRemote = !cs.includes('@localhost') && !cs.includes('@127.0.0.1')
  const pool = new pg.Pool({
    connectionString: cs, max: 3, connectionTimeoutMillis: 5000,
    ...(isRemote && { ssl: { rejectUnauthorized: false } }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter: new PrismaPg(pool as any) })
}

const DONE_STATUSES = new Set(['DONE', 'CANCELLED', 'COMPLETED'])

const DELETED_DEPT_CODES = [
  'PB-HCNS', 'BOM', 'BPCNTT', 'BP-KHO', 'HCNS', 'HSE', 'KHO', 'KT',
  'PB-DA', 'PB-EPC', 'PB-KD', 'PB-KTKH', 'PB-KTTC', 'PB-QAQC',
  'PB-QLSX', 'PB-TK', 'PB-TM', 'PB-TTB', 'PKT', 'PKTKT', 'PQAQC',
  'PSXDA', 'PTCKTKHO', 'PTTBCG', 'TEST', 'TO-GL1',
]

function pad(s: string, n: number) { return s.length >= n ? s : s + ' '.repeat(n - s.length) }
function rpad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length) }

async function main() {
  const prisma = createPrisma()
  const log = (s: string) => console.log(s)

  log(`\n${'═'.repeat(70)}`)
  log(`  AUDIT TASK ↔ NHÂN SỰ SAU REBUILD — READ-ONLY`)
  log(`${'═'.repeat(70)}\n`)

  // ── Pre-load users ──
  const allUsers = await prisma.user.findMany({
    select: { id: true, username: true, fullName: true, roleCode: true, isActive: true, departmentId: true },
  })
  const userById = new Map(allUsers.map(u => [u.id, u]))
  const userByUsername = new Map(allUsers.map(u => [u.username, u]))

  let manhTotalTasks = 'N/A'

  // R11 user IDs
  const r11Users = allUsers.filter(u => u.roleCode === 'R11')
  const r11Ids = new Set(r11Users.map(u => u.id))

  // Dept lookup
  const allDepts = await prisma.department.findMany()
  const deptById = new Map(allDepts.map(d => [d.id, d]))
  const deletedDeptIds = new Set(allDepts.filter(d => DELETED_DEPT_CODES.includes(d.code)).map(d => d.id))

  // ══════════════════════════════════════════════════════════════
  // 1. TASK MỒ CÔI — 13 user R11 bị vô hiệu
  // ══════════════════════════════════════════════════════════════
  log('┌──────────────────────────────────────────────────────────┐')
  log('│ 1. TASK MỒ CÔI — 13 user R11/HCNS sắp vô hiệu         │')
  log('└──────────────────────────────────────────────────────────┘')

  // 1a. Task (new system) — assignee via TaskAssignee
  const taskAssignments = await prisma.taskAssignee.findMany({
    where: { userId: { in: [...r11Ids] } },
    select: { taskId: true, userId: true, task: { select: { id: true, title: true, status: true, projectId: true } } },
  })
  const orphanTasksAssignee = taskAssignments.filter(ta => !DONE_STATUSES.has(ta.task.status))

  // 1b. Task — createdBy
  const tasksByCreator = await prisma.task.findMany({
    where: { createdBy: { in: [...r11Ids] }, NOT: { status: { in: ['DONE', 'CANCELLED'] } } },
    select: { id: true, title: true, status: true, projectId: true, createdBy: true },
  })

  // 1c. WorkflowTask — assignedTo
  const wfOrphanAssigned = await prisma.workflowTask.findMany({
    where: { assignedTo: { in: [...r11Ids] }, NOT: { status: { in: ['DONE', 'CANCELLED', 'COMPLETED'] } } },
    select: { id: true, stepCode: true, stepName: true, status: true, projectId: true, assignedTo: true, assignedRole: true },
  })

  // 1d. WorkflowTask — assignedRole = R11
  const wfOrphanRole = await prisma.workflowTask.findMany({
    where: { assignedRole: 'R11', NOT: { status: { in: ['DONE', 'CANCELLED', 'COMPLETED'] } } },
    select: { id: true, stepCode: true, stepName: true, status: true, projectId: true, assignedTo: true, assignedRole: true },
  })

  // Projects for display
  const projIds = new Set([
    ...orphanTasksAssignee.map(t => t.task.projectId),
    ...tasksByCreator.map(t => t.projectId),
    ...wfOrphanAssigned.map(t => t.projectId),
    ...wfOrphanRole.map(t => t.projectId),
  ].filter(Boolean) as string[])
  const projects = await prisma.project.findMany({ where: { id: { in: [...projIds] } }, select: { id: true, projectCode: true, projectName: true } })
  const projById = new Map(projects.map(p => [p.id, p]))

  log('\n  [Task] Assignee là R11 user, chưa xong:')
  if (orphanTasksAssignee.length === 0) {
    log('    (không có)')
  } else {
    log(`    ${rpad('TaskID', 28)} ${rpad('Status', 14)} ${rpad('Project', 12)} ${rpad('User', 25)} Title`)
    log(`    ${'─'.repeat(28)} ${'─'.repeat(14)} ${'─'.repeat(12)} ${'─'.repeat(25)} ${'─'.repeat(30)}`)
    for (const ta of orphanTasksAssignee) {
      const u = userById.get(ta.userId!)
      const p = ta.task.projectId ? projById.get(ta.task.projectId) : null
      log(`    ${rpad(ta.taskId, 28)} ${rpad(ta.task.status, 14)} ${rpad(p?.projectCode || '—', 12)} ${rpad(u?.fullName || ta.userId!, 25)} ${ta.task.title.slice(0, 50)}`)
    }
  }

  log('\n  [Task] CreatedBy là R11 user, chưa xong:')
  if (tasksByCreator.length === 0) {
    log('    (không có)')
  } else {
    log(`    ${rpad('TaskID', 28)} ${rpad('Status', 14)} ${rpad('Project', 12)} ${rpad('User', 25)} Title`)
    log(`    ${'─'.repeat(28)} ${'─'.repeat(14)} ${'─'.repeat(12)} ${'─'.repeat(25)} ${'─'.repeat(30)}`)
    for (const t of tasksByCreator) {
      const u = userById.get(t.createdBy)
      const p = t.projectId ? projById.get(t.projectId) : null
      log(`    ${rpad(t.id, 28)} ${rpad(t.status, 14)} ${rpad(p?.projectCode || '—', 12)} ${rpad(u?.fullName || t.createdBy, 25)} ${t.title.slice(0, 50)}`)
    }
  }

  log('\n  [WorkflowTask] AssignedTo là R11 user, chưa xong:')
  if (wfOrphanAssigned.length === 0) {
    log('    (không có)')
  } else {
    log(`    ${rpad('WfTaskID', 28)} ${rpad('Step', 8)} ${rpad('Status', 12)} ${rpad('Project', 12)} ${rpad('User', 25)} StepName`)
    log(`    ${'─'.repeat(28)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(25)} ${'─'.repeat(25)}`)
    for (const wt of wfOrphanAssigned) {
      const u = wt.assignedTo ? userById.get(wt.assignedTo) : null
      const p = projById.get(wt.projectId)
      log(`    ${rpad(wt.id, 28)} ${rpad(wt.stepCode, 8)} ${rpad(wt.status, 12)} ${rpad(p?.projectCode || '—', 12)} ${rpad(u?.fullName || wt.assignedTo || '—', 25)} ${wt.stepName.slice(0, 25)}`)
    }
  }

  log('\n  [WorkflowTask] AssignedRole = R11, chưa xong:')
  if (wfOrphanRole.length === 0) {
    log('    (không có)')
  } else {
    log(`    ${rpad('WfTaskID', 28)} ${rpad('Step', 8)} ${rpad('Status', 12)} ${rpad('Project', 12)} StepName`)
    log(`    ${'─'.repeat(28)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(25)}`)
    for (const wt of wfOrphanRole) {
      const p = projById.get(wt.projectId)
      log(`    ${rpad(wt.id, 28)} ${rpad(wt.stepCode, 8)} ${rpad(wt.status, 12)} ${rpad(p?.projectCode || '—', 12)} ${wt.stepName.slice(0, 25)}`)
    }
  }

  const total1 = orphanTasksAssignee.length + tasksByCreator.length + wfOrphanAssigned.length + wfOrphanRole.length
  log(`\n  ► TỔNG MỤC 1: ${total1} task/wf-task mồ côi (${orphanTasksAssignee.length} Task-assignee, ${tasksByCreator.length} Task-creator, ${wfOrphanAssigned.length} WfTask-user, ${wfOrphanRole.length} WfTask-role)`)

  // ══════════════════════════════════════════════════════════════
  // 2. MANHTV — task chưa xong
  // ══════════════════════════════════════════════════════════════
  log('\n┌──────────────────────────────────────────────────────────┐')
  log('│ 2. MANHTV (R04→R13) — task chưa xong                    │')
  log('└──────────────────────────────────────────────────────────┘')

  const manh = userByUsername.get('manhtv')
  if (!manh) {
    log('  ⚠ User manhtv KHÔNG tìm thấy!')
  } else {
    log(`  User: ${manh.fullName} (${manh.username}), role: ${manh.roleCode}, active: ${manh.isActive}`)
    log(`  Ghi chú: role sẽ đổi R04→R13, dept→TBCG\n`)

    const manhTaskAssign = await prisma.taskAssignee.findMany({
      where: { userId: manh.id },
      select: { taskId: true, task: { select: { id: true, title: true, status: true, projectId: true } } },
    })
    const manhOpenTasks = manhTaskAssign.filter(ta => !DONE_STATUSES.has(ta.task.status))

    const manhCreated = await prisma.task.findMany({
      where: { createdBy: manh.id, NOT: { status: { in: ['DONE', 'CANCELLED'] } } },
      select: { id: true, title: true, status: true, projectId: true },
    })

    const manhWf = await prisma.workflowTask.findMany({
      where: { assignedTo: manh.id, NOT: { status: { in: ['DONE', 'CANCELLED', 'COMPLETED'] } } },
      select: { id: true, stepCode: true, stepName: true, status: true, projectId: true },
    })

    log('  [Task] Assignee, chưa xong:')
    if (manhOpenTasks.length === 0) {
      log('    (không có)')
    } else {
      for (const ta of manhOpenTasks) {
        const p = ta.task.projectId ? projById.get(ta.task.projectId) : null
        log(`    ${rpad(ta.taskId, 28)} ${rpad(ta.task.status, 14)} ${rpad(p?.projectCode || '—', 12)} ${ta.task.title.slice(0, 50)}`)
      }
    }

    log('  [Task] CreatedBy, chưa xong:')
    if (manhCreated.length === 0) {
      log('    (không có)')
    } else {
      for (const t of manhCreated) {
        const p = t.projectId ? projById.get(t.projectId) : null
        log(`    ${rpad(t.id, 28)} ${rpad(t.status, 14)} ${rpad(p?.projectCode || '—', 12)} ${t.title.slice(0, 50)}`)
      }
    }

    log('  [WorkflowTask] Assigned, chưa xong:')
    if (manhWf.length === 0) {
      log('    (không có)')
    } else {
      for (const wt of manhWf) {
        const p = projById.get(wt.projectId)
        log(`    ${rpad(wt.id, 28)} ${rpad(wt.stepCode, 8)} ${rpad(wt.status, 12)} ${rpad(p?.projectCode || '—', 12)} ${wt.stepName.slice(0, 30)}`)
      }
    }

    manhTotalTasks = `${manhOpenTasks.length + manhCreated.length + manhWf.length} (${manhOpenTasks.length} Task-assignee, ${manhCreated.length} Task-creator, ${manhWf.length} WfTask)`
    log(`\n  ► TỔNG MỤC 2: ${manhTotalTasks}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 3. ROLE R11 trong code & data
  // ══════════════════════════════════════════════════════════════
  log('\n┌──────────────────────────────────────────────────────────┐')
  log('│ 3. ROLE R11 — code refs & task assignments by role       │')
  log('└──────────────────────────────────────────────────────────┘')

  // 3a. Code scan (static — done at script build time, report here)
  log('\n  [Code scan] R11 trong workflow-constants / step-form-configs / work-engine:')

  const codeFiles = [
    { label: 'workflow-constants.ts', path: 'src/lib/workflow-constants.ts' },
    { label: 'step-form-configs.ts', path: 'src/lib/step-form-configs.ts' },
    { label: 'work-engine.ts', path: 'src/lib/work-engine.ts' },
    { label: 'constants.ts', path: 'src/lib/constants.ts' },
  ]
  let codeR11Count = 0
  const fs = await import('fs')
  for (const f of codeFiles) {
    try {
      const content = fs.readFileSync(f.path, 'utf-8')
      const lines = content.split('\n')
      const hits = lines
        .map((line, i) => ({ line: i + 1, text: line.trim() }))
        .filter(l => /['"]R11['"]/.test(l.text) && !l.text.startsWith('//'))
      if (hits.length > 0) {
        for (const h of hits) {
          log(`    ⚠ ${f.label}:${h.line} — ${h.text.slice(0, 80)}`)
          codeR11Count++
        }
      }
    } catch { /* file might not exist */ }
  }
  if (codeR11Count === 0) log('    ✅ Không có R11 trong step-form-configs / workflow-constants / work-engine')
  else log(`    ⚠ ${codeR11Count} chỗ có R11 trong code`)

  // 3b. WorkflowTask where assignedRole = R11 (all statuses)
  const allWfR11 = await prisma.workflowTask.count({ where: { assignedRole: 'R11' } })
  const openWfR11 = await prisma.workflowTask.count({ where: { assignedRole: 'R11', NOT: { status: { in: ['DONE', 'CANCELLED', 'COMPLETED'] } } } })
  log(`\n  [DB] WorkflowTask.assignedRole = R11: tổng ${allWfR11} (chưa xong: ${openWfR11})`)

  // 3c. TaskAssignee where role = R11 (new Task system assigns by role string)
  const taskAssignR11 = await prisma.taskAssignee.count({ where: { role: 'R11' } })
  const taskAssignR11Open = await prisma.taskAssignee.findMany({
    where: { role: 'R11' },
    select: { taskId: true, task: { select: { status: true } } },
  })
  const openR11Assign = taskAssignR11Open.filter(ta => !DONE_STATUSES.has(ta.task.status)).length
  log(`  [DB] TaskAssignee.role = R11: tổng ${taskAssignR11} (task chưa xong: ${openR11Assign})`)

  log(`\n  ► TỔNG MỤC 3: code refs=${codeR11Count}, WfTask-role-open=${openWfR11}, TaskAssignee-role-open=${openR11Assign}`)

  // ══════════════════════════════════════════════════════════════
  // 4. POOL R04 sau khi manhtv rời
  // ══════════════════════════════════════════════════════════════
  log('\n┌──────────────────────────────────────────────────────────┐')
  log('│ 4. POOL R04 — sau khi manhtv rời đi                      │')
  log('└──────────────────────────────────────────────────────────┘')

  const r04Active = allUsers.filter(u => u.roleCode === 'R04' && u.isActive && u.username !== 'manhtv')
  log(`\n  R04 active (trừ manhtv): ${r04Active.length}`)
  if (r04Active.length > 0) {
    for (const u of r04Active) {
      const d = u.departmentId ? deptById.get(u.departmentId) : null
      log(`    ${rpad(u.fullName, 25)} (${rpad(u.username, 12)}) dept: ${d?.code || '—'}`)
    }
  }

  // Tasks/WfTasks assigned to role=R04 still open
  const wfR04Open = await prisma.workflowTask.findMany({
    where: { assignedRole: 'R04', NOT: { status: { in: ['DONE', 'CANCELLED', 'COMPLETED'] } } },
    select: { id: true, stepCode: true, status: true, projectId: true, assignedTo: true },
  })
  const taskR04Open = await prisma.taskAssignee.findMany({
    where: { role: 'R04' },
    select: { taskId: true, userId: true, task: { select: { status: true, title: true, projectId: true } } },
  })
  const taskR04OpenFiltered = taskR04Open.filter(ta => !DONE_STATUSES.has(ta.task.status))

  log(`\n  WfTask assignedRole=R04 chưa xong: ${wfR04Open.length}`)
  if (wfR04Open.length > 0) {
    for (const wt of wfR04Open.slice(0, 20)) {
      const p = projById.get(wt.projectId)
      const u = wt.assignedTo ? userById.get(wt.assignedTo) : null
      log(`    ${rpad(wt.id.slice(0, 20), 22)} ${rpad(wt.stepCode, 8)} ${rpad(wt.status, 12)} ${rpad(p?.projectCode || '—', 12)} user: ${u?.username || wt.assignedTo || '(role)'}`)
    }
    if (wfR04Open.length > 20) log(`    ... và ${wfR04Open.length - 20} nữa`)
  }

  log(`  TaskAssignee role=R04 chưa xong: ${taskR04OpenFiltered.length}`)
  if (taskR04OpenFiltered.length > 0) {
    for (const ta of taskR04OpenFiltered.slice(0, 10)) {
      const p = ta.task.projectId ? projById.get(ta.task.projectId) : null
      log(`    ${rpad(ta.taskId.slice(0, 20), 22)} ${rpad(ta.task.status, 14)} ${rpad(p?.projectCode || '—', 12)} ${ta.task.title.slice(0, 40)}`)
    }
    if (taskR04OpenFiltered.length > 10) log(`    ... và ${taskR04OpenFiltered.length - 10} nữa`)
  }

  const r04Thin = r04Active.length <= 1
  log(`\n  ► TỔNG MỤC 4: pool R04 = ${r04Active.length} (${r04Thin ? '⚠ MỎNG' : 'OK'}), WfTask-R04-open=${wfR04Open.length}, Task-R04-open=${taskR04OpenFiltered.length}`)

  // ══════════════════════════════════════════════════════════════
  // 5. FK PHÒNG ĐÃ XOÁ
  // ══════════════════════════════════════════════════════════════
  log('\n┌──────────────────────────────────────────────────────────┐')
  log('│ 5. FK PHÒNG ĐÃ XOÁ — bản ghi trỏ dept sẽ bị xoá       │')
  log('└──────────────────────────────────────────────────────────┘')

  // User.departmentId pointing to soon-deleted depts
  const usersInDeletedDepts = allUsers.filter(u => u.departmentId && deletedDeptIds.has(u.departmentId))
  log(`\n  User.departmentId → dept sẽ xoá: ${usersInDeletedDepts.length}`)
  if (usersInDeletedDepts.length > 0) {
    for (const u of usersInDeletedDepts.slice(0, 20)) {
      const d = deptById.get(u.departmentId!)
      log(`    ${rpad(u.fullName, 25)} (${rpad(u.username, 12)}) → ${d?.code} "${d?.name}"`)
    }
    if (usersInDeletedDepts.length > 20) log(`    ... và ${usersInDeletedDepts.length - 20} nữa`)
  }

  // Employee.departmentId
  const employeesInDeleted = await prisma.employee.count({ where: { departmentId: { in: [...deletedDeptIds] } } })
  log(`  Employee.departmentId → dept sẽ xoá: ${employeesInDeleted}`)

  // Check if any other models reference departmentId (they don't per schema — only User and Employee)
  // But let's also verify no Task/WorkflowTask has department references via resultData (unlikely but check)
  log(`  (Task/WorkflowTask không có FK departmentId — chỉ User, Employee có)`)

  const total5 = usersInDeletedDepts.length + employeesInDeleted
  log(`\n  ► TỔNG MỤC 5: ${total5} bản ghi trỏ dept sẽ xoá (${usersInDeletedDepts.length} User, ${employeesInDeleted} Employee)`)

  // ══════════════════════════════════════════════════════════════
  // 6. GIAO BAN / DIGEST — task không người phụ trách
  // ══════════════════════════════════════════════════════════════
  log('\n┌──────────────────────────────────────────────────────────┐')
  log('│ 6. GIAO BAN / DIGEST — task rơi vào "không ai phụ trách"│')
  log('└──────────────────────────────────────────────────────────┘')

  // Tasks where ALL assignees are either:
  //   - R11 user (will be deactivated)
  //   - assigned by role=R11 (no active users)
  // AND task is not done

  const openTasks = await prisma.task.findMany({
    where: { NOT: { status: { in: ['DONE', 'CANCELLED'] } } },
    select: { id: true, title: true, status: true, projectId: true, createdBy: true,
      assignees: { select: { userId: true, role: true } } },
  })

  const unownedTasks: typeof openTasks = []
  for (const task of openTasks) {
    if (task.assignees.length === 0) continue // no assignees at all — not our problem
    const allAssigneesGone = task.assignees.every(a => {
      if (a.userId && r11Ids.has(a.userId)) return true
      if (a.role === 'R11') return true
      return false
    })
    if (allAssigneesGone) unownedTasks.push(task)
  }

  // Also check WfTasks where assignedTo is R11 user AND assignedRole is R11
  const wfUnowned = await prisma.workflowTask.findMany({
    where: {
      NOT: { status: { in: ['DONE', 'CANCELLED', 'COMPLETED'] } },
      OR: [
        { assignedTo: { in: [...r11Ids] }, assignedRole: 'R11' },
        { assignedRole: 'R11', assignedTo: null },
      ],
    },
    select: { id: true, stepCode: true, stepName: true, status: true, projectId: true },
  })

  log(`\n  [Task] Tất cả assignee là R11 user hoặc role R11 → không ai phụ trách: ${unownedTasks.length}`)
  if (unownedTasks.length > 0) {
    log(`    ${rpad('TaskID', 28)} ${rpad('Status', 14)} ${rpad('Project', 12)} Title`)
    log(`    ${'─'.repeat(28)} ${'─'.repeat(14)} ${'─'.repeat(12)} ${'─'.repeat(40)}`)
    for (const t of unownedTasks.slice(0, 20)) {
      const p = t.projectId ? projById.get(t.projectId) : null
      log(`    ${rpad(t.id, 28)} ${rpad(t.status, 14)} ${rpad(p?.projectCode || '—', 12)} ${t.title.slice(0, 40)}`)
    }
    if (unownedTasks.length > 20) log(`    ... và ${unownedTasks.length - 20} nữa`)
  }

  log(`\n  [WorkflowTask] AssignedRole=R11, không user khác → không ai phụ trách: ${wfUnowned.length}`)
  if (wfUnowned.length > 0) {
    for (const wt of wfUnowned.slice(0, 20)) {
      const p = projById.get(wt.projectId)
      log(`    ${rpad(wt.id.slice(0, 20), 22)} ${rpad(wt.stepCode, 8)} ${rpad(wt.status, 12)} ${rpad(p?.projectCode || '—', 12)} ${wt.stepName.slice(0, 30)}`)
    }
  }

  log(`\n  ► TỔNG MỤC 6: ${unownedTasks.length} Task + ${wfUnowned.length} WfTask không ai phụ trách sau rebuild`)

  // ══════════════════════════════════════════════════════════════
  // TỔNG KẾT
  // ══════════════════════════════════════════════════════════════
  log(`\n${'═'.repeat(70)}`)
  log('  TỔNG KẾT AUDIT')
  log(`${'═'.repeat(70)}`)
  log(`  1. Task mồ côi (R11 user):      ${total1}`)
  log(`  2. manhtv task chưa xong:        ${manhTotalTasks}`)
  log(`  3. R11 code refs:                ${codeR11Count} | WfTask-role-open: ${openWfR11} | TaskAssignee-role: ${openR11Assign}`)
  log(`  4. Pool R04 (trừ manhtv):        ${r04Active.length} ${r04Thin ? '⚠ MỎNG' : '✅'}`)
  log(`  5. FK dept sẽ xoá:               ${total5}`)
  log(`  6. Task không ai phụ trách:      ${unownedTasks.length} Task + ${wfUnowned.length} WfTask`)
  log('')

  await prisma.$disconnect()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
