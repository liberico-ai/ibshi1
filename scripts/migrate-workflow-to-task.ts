/**
 * Migrate WorkflowTask (36-step rigid) → Task (dynamic engine).
 *
 * Strategy:
 *   1. Seed template SX-PROD + TemplateStep + Departments + RoutingSuggestion (if missing)
 *   2. For each project with WorkflowTasks:
 *      - DONE tasks     → create Task(status=DONE) + TaskAssignee(done=true) + TaskHistory
 *      - IN_PROGRESS    → create Task(status=IN_PROGRESS) + TaskAssignee(done=false) + TaskHistory
 *      - PENDING        → SKIP (engine creates lazily when gates are met)
 *   3. WorkflowTask table is NOT touched (kept for rollback comparison)
 *
 * Usage:
 *   npx tsx scripts/migrate-workflow-to-task.ts                # dry-run
 *   npx tsx scripts/migrate-workflow-to-task.ts --apply         # execute migration
 *   npx tsx scripts/migrate-workflow-to-task.ts --apply --rollback  # delete migrated Tasks
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { WORKFLOW_RULES } from '../src/lib/workflow-constants'
import { DEPARTMENTS_V2, ROLE_TO_DEPT, DEPT_PRIMARY_ROLE } from '../src/lib/org-map'

const APPLY = process.argv.includes('--apply')
const ROLLBACK = process.argv.includes('--rollback')
if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL

const MIGRATE_TAG = 'MIGRATED_FROM_WORKFLOW'

const STATUS_MAP: Record<string, string> = {
  DONE: 'DONE',
  COMPLETED: 'DONE',
  IN_PROGRESS: 'IN_PROGRESS',
  ACTIVE: 'IN_PROGRESS',
}

const PRIORITY_MAP: Record<number, string> = {
  0: 'NORMAL', 1: 'HIGH', 2: 'URGENT',
}

const HOOKS: Record<string, string[]> = {
  'P2.2': ['syncBOMtoBudget'],
  'P2.3': ['syncBOMtoBudget'],
  'P3.3': ['syncPOtoBudget'],
}

async function seedTemplate(prisma: PrismaClient) {
  // Departments
  for (const d of DEPARTMENTS_V2) {
    await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name },
      create: { code: d.code, name: d.name, nameEn: '' },
    })
  }
  console.log(`   ✓ Departments: ${DEPARTMENTS_V2.length}`)

  // RoutingSuggestion
  const existingRoutes = await prisma.routingSuggestion.count({ where: { source: 'WORKFLOW_SEED' } })
  if (existingRoutes === 0) {
    const data: { fromContext: string; toRoleCode: string; toDepartmentCode: string | null; reason: string }[] = []
    for (const step of Object.values(WORKFLOW_RULES)) {
      for (const nextCode of step.next || []) {
        const n = WORKFLOW_RULES[nextCode]
        if (!n) continue
        data.push({
          fromContext: step.code,
          toRoleCode: n.role,
          toDepartmentCode: ROLE_TO_DEPT[n.role] || null,
          reason: n.name,
        })
      }
    }
    if (data.length) await prisma.routingSuggestion.createMany({ data })
    console.log(`   ✓ RoutingSuggestion: ${data.length}`)
  } else {
    console.log(`   ✓ RoutingSuggestion: ${existingRoutes} (already exists)`)
  }

  // Template SX-PROD
  const existing = await prisma.workflowTemplate.findUnique({ where: { code: 'SX-PROD' } })
  const tpl = existing
    ? await prisma.workflowTemplate.update({ where: { code: 'SX-PROD' }, data: { name: 'Dự án sản xuất (chuẩn 36 bước)' } })
    : await prisma.workflowTemplate.create({ data: { code: 'SX-PROD', name: 'Dự án sản xuất (chuẩn 36 bước)', projectType: 'EXTERNAL_PROD', version: 1 } })

  // AN TOÀN: upsert từng step theo (templateId, code) — KHÔNG deleteMany,
  // để giữ nguyên templateStepId mà các Task /work/ đang chạy có thể đang tham chiếu.
  const steps = Object.values(WORKFLOW_RULES)
  const existingSteps = await prisma.templateStep.findMany({ where: { templateId: tpl.id }, select: { id: true, code: true } })
  const byCode = new Map(existingSteps.map((s) => [s.code, s.id]))
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const data = {
      templateId: tpl.id, code: s.code, title: s.name, roleCode: s.role,
      deptCode: ROLE_TO_DEPT[s.role] || null, orderIndex: i, deadlineDays: s.deadlineDays || null,
      taskType: s.code, hookKeys: HOOKS[s.code] || [],
      nextCodes: s.next || [], gateCodes: s.gate || [],
    }
    const existingId = byCode.get(s.code)
    if (existingId) await prisma.templateStep.update({ where: { id: existingId }, data })
    else await prisma.templateStep.create({ data })
  }
  console.log(`   ✓ Template SX-PROD: ${steps.length} steps (upsert, không xóa)`)
  return tpl.id
}

async function rollback(prisma: PrismaClient) {
  // Find all tasks tagged as migrated
  const migrated = await prisma.taskHistory.findMany({
    where: { action: 'MIGRATED', reason: MIGRATE_TAG },
    select: { taskId: true },
  })
  const ids = [...new Set(migrated.map((m) => m.taskId))]
  if (ids.length === 0) { console.log('   ⓘ No migrated tasks found.'); return }

  console.log(`   🗑️  Rolling back ${ids.length} migrated tasks...`)
  // Cascade deletes TaskAssignee, TaskDocRequirement, TaskHistory
  const BATCH = 100
  for (let i = 0; i < ids.length; i += BATCH) {
    await prisma.task.deleteMany({ where: { id: { in: ids.slice(i, i + BATCH) } } })
  }
  console.log(`   ✓ Deleted ${ids.length} tasks`)
}

async function main() {
  const isRemote = !/localhost|127\.0\.0\.1/.test(connectionString)
  const pool = new pg.Pool({ connectionString, ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

  console.log(`\n🔄 Migrate WorkflowTask → Task — ${ROLLBACK ? '🔙 ROLLBACK' : APPLY ? '🔴 APPLY' : '🟢 DRY-RUN'}`)
  console.log(`   DB: ${connectionString.replace(/:[^:@/]+@/, ':***@')}`)

  // An toàn production: ghi/rollback vào DB remote phải xác nhận tường minh + đã backup.
  const PROD_OK = process.argv.includes('--i-understand-production')
  if (isRemote && APPLY && !PROD_OK) {
    console.error('\n   ⛔ DB REMOTE/PRODUCTION + --apply: cần thêm cờ --i-understand-production và ĐÃ BACKUP (pg_dump). DỪNG.\n')
    await pool.end()
    return
  }

  if (ROLLBACK && APPLY) {
    await rollback(prisma)
    await pool.end()
    return
  }

  // ── Step 0: Survey ──
  const projects = await prisma.project.findMany({
    select: { id: true, projectCode: true, projectName: true },
    orderBy: { createdAt: 'asc' },
  })
  const allWt = await prisma.workflowTask.findMany({
    orderBy: [{ projectId: 'asc' }, { stepCode: 'asc' }],
  })
  const existingMigrated = await prisma.taskHistory.count({ where: { action: 'MIGRATED', reason: MIGRATE_TAG } })

  console.log(`\n📊 Survey:`)
  console.log(`   Projects: ${projects.length}`)
  console.log(`   WorkflowTasks: ${allWt.length} (DONE: ${allWt.filter((t) => t.status === 'DONE').length}, IN_PROGRESS: ${allWt.filter((t) => t.status === 'IN_PROGRESS').length}, PENDING: ${allWt.filter((t) => t.status === 'PENDING').length})`)
  console.log(`   Already migrated: ${existingMigrated}`)

  const RESUME = process.argv.includes('--resume')
  if (existingMigrated > 0) {
    console.log(`\n   ⚠️  Already migrated tasks found (${existingMigrated}).`)
    if (APPLY && !RESUME) {
      console.log('   → Dùng --resume để migrate BỔ SUNG task còn thiếu (per-task idempotent: bỏ qua task đã có).')
      console.log('   → Hoặc --apply --rollback để xóa hết bản migrate cũ rồi làm lại.')
      await pool.end(); return
    }
    if (RESUME) console.log('   → --resume: chỉ tạo task còn thiếu, bỏ qua task đã migrate.')
  }

  const eligible = allWt.filter((t) => STATUS_MAP[t.status])

  // Keep ALL eligible entries (DONE + IN_PROGRESS).
  // Rejection cycles produce multiple entries for the same (projectId, stepCode)
  // — e.g. one DONE (first attempt) and one IN_PROGRESS (retry). Both are real tasks.
  const toMigrate = eligible

  console.log(`   Eligible: ${eligible.length} (DONE + IN_PROGRESS)`)
  console.log(`   Will migrate: ${toMigrate.length} tasks`)
  console.log(`   Will skip: ${allWt.length - eligible.length} PENDING tasks (engine creates lazily)`)

  if (!APPLY) {
    // Dry-run: show plan per project
    console.log(`\n📋 Migration plan:`)
    for (const proj of projects) {
      const pwt = toMigrate.filter((t) => t.projectId === proj.id)
      if (pwt.length === 0) continue
      const done = pwt.filter((t) => t.status === 'DONE').length
      const active = pwt.filter((t) => t.status === 'IN_PROGRESS').length
      console.log(`   ${proj.projectCode}: ${pwt.length} tasks (${done} DONE, ${active} IN_PROGRESS)`)
      for (const t of pwt) {
        console.log(`     ${t.stepCode.padEnd(6)} ${t.status.padEnd(12)} ${t.stepName}`)
      }
    }
    console.log(`\n   ⓘ DRY-RUN — run with --apply to execute.\n`)
    await pool.end()
    return
  }

  // ── Step 1: Seed template ──
  console.log(`\n🌱 Step 1: Seed template...`)
  const templateId = await seedTemplate(prisma)

  // Build stepCode → templateStepId map
  const templateSteps = await prisma.templateStep.findMany({ where: { templateId } })
  const stepMap = new Map(templateSteps.map((s) => [s.code, s]))

  // Find a system user for createdBy (first R01 user)
  const systemUser = await prisma.user.findFirst({
    where: { roleCode: 'R01', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, username: true },
  })
  if (!systemUser) { console.error('❌ No R01 user found for createdBy'); await pool.end(); return }
  console.log(`   System user (createdBy): ${systemUser.username} (${systemUser.id})`)

  // ── Step 2: Migrate per project ──
  console.log(`\n🔄 Step 2: Migrate tasks...`)
  let totalCreated = 0
  let totalAssignees = 0
  let totalHistory = 0
  let totalSkipped = 0

  for (const proj of projects) {
    const pwt = toMigrate.filter((t) => t.projectId === proj.id)
    if (pwt.length === 0) continue

    console.log(`\n   📁 ${proj.projectCode} (${proj.projectName})`)

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const wt of pwt) {
        const step = stepMap.get(wt.stepCode)
        if (!step) {
          console.log(`     ⚠️  Skip ${wt.stepCode}: no matching template step`)
          totalSkipped++
          continue
        }

        // Check duplicate by sourceId (idempotent per WorkflowTask record, not per stepCode)
        const alreadyMigrated = await tx.taskHistory.findFirst({
          where: { action: 'MIGRATED', reason: MIGRATE_TAG, meta: { path: ['sourceId'], equals: wt.id } },
          select: { taskId: true },
        })
        if (alreadyMigrated) {
          console.log(`     ⚠️  Skip ${wt.stepCode}: already migrated (${alreadyMigrated.taskId})`)
          totalSkipped++
          continue
        }

        const newStatus = STATUS_MAP[wt.status] || 'OPEN'
        const isDone = newStatus === 'DONE'

        // Create Task
        const task = await tx.task.create({
          data: {
            projectId: proj.id,
            level: 2,
            taskType: wt.stepCode,
            title: wt.stepName,
            description: wt.description,
            status: newStatus,
            priority: PRIORITY_MAP[wt.priority] || 'NORMAL',
            deadline: wt.deadline,
            createdBy: systemUser.id,
            assignedAt: wt.createdAt,
            startedAt: wt.startedAt || (wt.status === 'IN_PROGRESS' ? wt.updatedAt : null),
            completedAt: isDone ? wt.completedAt : null,
            completedBy: isDone ? wt.completedBy : null,
            resultData: wt.resultData ? JSON.parse(JSON.stringify(wt.resultData)) : undefined,
            hookKeys: HOOKS[wt.stepCode] || [],
            templateStepId: step.id,
          },
        })

        // Create TaskAssignee
        const assigneeData: {
          taskId: string; role: string | null; userId: string | null;
          isPrimary: boolean; done: boolean; doneAt: Date | null; doneBy: string | null
        } = {
          taskId: task.id,
          role: wt.assignedRole,
          userId: wt.assignedTo || null,
          isPrimary: true,
          done: isDone,
          doneAt: isDone ? wt.completedAt : null,
          doneBy: isDone ? wt.completedBy : null,
        }
        await tx.taskAssignee.create({ data: assigneeData })
        totalAssignees++

        // Create TaskHistory entries
        const historyEntries: { taskId: string; action: string; byUserId: string; toRole?: string; toUserId?: string; reason?: string; meta?: object }[] = [
          { taskId: task.id, action: 'MIGRATED', byUserId: systemUser.id, reason: MIGRATE_TAG, meta: { sourceId: wt.id, sourceStepCode: wt.stepCode, sourceStatus: wt.status } },
          { taskId: task.id, action: 'CREATED', byUserId: systemUser.id, toRole: wt.assignedRole },
          { taskId: task.id, action: 'ASSIGNED', byUserId: systemUser.id, toRole: wt.assignedRole, toUserId: wt.assignedTo || undefined },
        ]

        if (isDone) {
          historyEntries.push({
            taskId: task.id,
            action: 'COMPLETED',
            byUserId: wt.completedBy || systemUser.id,
          })
        }

        if (wt.notes) {
          historyEntries.push({
            taskId: task.id, action: 'COMMENT', byUserId: systemUser.id,
            reason: wt.notes,
          })
        }

        await tx.taskHistory.createMany({ data: historyEntries })
        totalHistory += historyEntries.length

        const icon = isDone ? '✅' : '🔵'
        console.log(`     ${icon} ${wt.stepCode.padEnd(6)} → Task ${task.id.substring(0, 12)}... (${newStatus})`)
        totalCreated++
      }
    }, { timeout: 120_000 })
  }

  // ── Step 3: Verify ──
  console.log(`\n📊 Step 3: Verify...`)
  const taskCount = await prisma.task.count()
  const doneCount = await prisma.task.count({ where: { status: 'DONE' } })
  const activeCount = await prisma.task.count({ where: { status: 'IN_PROGRESS' } })

  console.log(`\n✅ Migration complete:`)
  console.log(`   Tasks created:    ${totalCreated}`)
  console.log(`   Assignees:        ${totalAssignees}`)
  console.log(`   History entries:   ${totalHistory}`)
  console.log(`   Skipped:          ${totalSkipped}`)
  console.log(`\n   DB totals — Tasks: ${taskCount} (DONE: ${doneCount}, IN_PROGRESS: ${activeCount})`)

  // Verify gate logic per project
  console.log(`\n🔗 Gate verification:`)
  for (const proj of projects) {
    const tasks = await prisma.task.findMany({
      where: { projectId: proj.id, NOT: { templateStepId: null } },
      select: { taskType: true, status: true, templateStepId: true },
    })
    const doneCodes = new Set(tasks.filter((t) => t.status === 'DONE').map((t) => t.taskType))
    const activeCodes = tasks.filter((t) => t.status === 'IN_PROGRESS').map((t) => t.taskType)

    // Check: for each IN_PROGRESS task, its gate should be satisfied
    let gateOk = true
    for (const code of activeCodes) {
      const rule = WORKFLOW_RULES[code]
      if (rule?.gate) {
        const unmet = rule.gate.filter((g) => !doneCodes.has(g))
        if (unmet.length > 0) {
          console.log(`   ⚠️  ${proj.projectCode}: ${code} IN_PROGRESS but gate unmet: ${unmet.join(', ')}`)
          gateOk = false
        }
      }
    }

    // Check: what steps should the engine create next when IN_PROGRESS tasks complete?
    const nextPending: string[] = []
    for (const code of activeCodes) {
      const rule = WORKFLOW_RULES[code]
      if (!rule) continue
      for (const nc of rule.next) {
        const nr = WORKFLOW_RULES[nc]
        if (!nr) continue
        const gate = nr.gate || []
        // If this IN_PROGRESS task completes, would the gate be met?
        const futureGateMet = gate.every((g) => g === code || doneCodes.has(g))
        if (futureGateMet) nextPending.push(nc)
      }
    }

    if (gateOk) {
      console.log(`   ✅ ${proj.projectCode}: DONE=${doneCodes.size}, ACTIVE=${activeCodes.length}, next-ready=${nextPending.join(',') || 'none'}`)
    }
  }

  console.log('')
  await pool.end()
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
