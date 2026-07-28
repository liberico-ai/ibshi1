/**
 * Sync TemplateStep records for WorkflowTemplate code='SX-PROD'
 * against WORKFLOW_RULES (src/lib/workflow-constants.ts).
 *
 * The SX-PROD template was created MANUALLY in the DB, causing drift:
 * the UI shows 33 steps but WORKFLOW_RULES defines 32. Several steps
 * (P3.2, P3.7, P4.1, P4.2) were moved to sidebar-driven flows and
 * removed from WORKFLOW_RULES but never cleaned from the template.
 *
 * This script performs a full reconciliation:
 *   1. Steps in DB but NOT in WORKFLOW_RULES  -> DELETE (orphaned)
 *   2. Steps in WORKFLOW_RULES but NOT in DB  -> CREATE (missing)
 *   3. Steps in both -> UPDATE if any field drifted
 *
 * SAFETY:
 *   - Default mode is DRY-RUN (prints report, writes nothing)
 *   - Pass --apply to actually write changes
 *   - Before deleting a TemplateStep, checks if any Task references it
 *     via templateStepId; if so, logs a WARNING and skips the delete
 *
 * Usage:
 *   npx tsx scripts/sync-template-sxprod.ts            # dry-run (default)
 *   npx tsx scripts/sync-template-sxprod.ts --apply     # apply changes
 *
 * Requires DATABASE_URL in environment.
 */
import { PrismaClient } from '@prisma/client'
import { WORKFLOW_RULES } from '../src/lib/workflow-constants'
import { ROLE_TO_DEPT } from '../src/lib/org-map'

const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const TEMPLATE_CODE = 'SX-PROD'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sameArr = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

const fmtArr = (a: string[]): string => (a.length ? `[${a.join(', ')}]` : '[]')

interface DiffLine { field: string; from: string; to: string }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n========================================`)
  console.log(`  Sync SX-PROD template  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`)
  console.log(`========================================\n`)

  // 1. Find the template
  const template = await prisma.workflowTemplate.findUnique({
    where: { code: TEMPLATE_CODE },
  })
  if (!template) {
    console.error(`ERROR: WorkflowTemplate with code='${TEMPLATE_CODE}' not found.`)
    process.exit(1)
  }
  console.log(`Template: ${template.code} - "${template.name}" (id=${template.id})`)
  console.log(`  projectType=${template.projectType}, productType=${template.productType ?? 'null'}, version=${template.version}\n`)

  // 2. Get all existing TemplateStep records
  const dbSteps = await prisma.templateStep.findMany({
    where: { templateId: template.id },
    orderBy: { orderIndex: 'asc' },
  })
  console.log(`Existing TemplateStep count in DB: ${dbSteps.length}`)

  const ruleEntries = Object.entries(WORKFLOW_RULES)
  console.log(`WORKFLOW_RULES step count: ${ruleEntries.length}\n`)

  const dbByCode = new Map(dbSteps.map((s) => [s.code, s]))
  const ruleCodes = new Set(ruleEntries.map(([code]) => code))

  // ---------------------------------------------------------------------------
  // 3. Classify steps
  // ---------------------------------------------------------------------------

  const toDelete: typeof dbSteps = []      // in DB, not in rules
  const toCreate: string[] = []            // in rules, not in DB
  const toCheck: string[] = []             // in both

  for (const step of dbSteps) {
    if (!ruleCodes.has(step.code)) {
      toDelete.push(step)
    } else {
      toCheck.push(step.code)
    }
  }

  for (const [code] of ruleEntries) {
    if (!dbByCode.has(code)) {
      toCreate.push(code)
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Report & apply: DELETIONS (orphan steps)
  // ---------------------------------------------------------------------------

  console.log(`--- STEPS TO DELETE (in DB, not in WORKFLOW_RULES): ${toDelete.length} ---`)
  if (toDelete.length === 0) {
    console.log('  (none)\n')
  }

  for (const step of toDelete) {
    // Check for tasks referencing this templateStepId
    const taskCount = await prisma.task.count({
      where: { templateStepId: step.id },
    })

    console.log(`  ${step.code} - "${step.title}" (id=${step.id})`)
    console.log(`    roleCode=${step.roleCode}, orderIndex=${step.orderIndex}`)
    console.log(`    nextCodes=${fmtArr(step.nextCodes)}, gateCodes=${fmtArr(step.gateCodes)}`)

    if (taskCount > 0) {
      console.log(`    WARNING: ${taskCount} task(s) reference this templateStepId - SKIPPING delete`)
      console.log(`    (Manual cleanup required: reassign or nullify templateStepId on those tasks first)`)
    } else {
      if (APPLY) {
        await prisma.templateStep.delete({ where: { id: step.id } })
        console.log(`    -> DELETED`)
      } else {
        console.log(`    -> would DELETE (0 task references)`)
      }
    }
  }
  console.log()

  // ---------------------------------------------------------------------------
  // 5. Report & apply: CREATIONS (missing steps)
  // ---------------------------------------------------------------------------

  console.log(`--- STEPS TO CREATE (in WORKFLOW_RULES, not in DB): ${toCreate.length} ---`)
  if (toCreate.length === 0) {
    console.log('  (none)\n')
  }

  for (const code of toCreate) {
    const rule = WORKFLOW_RULES[code]
    const orderIndex = ruleEntries.findIndex(([c]) => c === code)
    const deptCode = ROLE_TO_DEPT[rule.role] || null

    console.log(`  ${code} - "${rule.name}"`)
    console.log(`    role=${rule.role}, dept=${deptCode}, phase=${rule.phase}`)
    console.log(`    deadlineDays=${rule.deadlineDays ?? 'null'}`)
    console.log(`    next=${fmtArr(rule.next)}, gate=${fmtArr(rule.gate || [])}`)

    if (APPLY) {
      await prisma.templateStep.create({
        data: {
          templateId: template.id,
          code: rule.code,
          title: rule.name,
          roleCode: rule.role,
          deptCode,
          orderIndex,
          deadlineDays: rule.deadlineDays ?? null,
          taskType: rule.code,
          hookKeys: [],
          nextCodes: rule.next,
          gateCodes: rule.gate || [],
        },
      })
      console.log(`    -> CREATED`)
    } else {
      console.log(`    -> would CREATE`)
    }
  }
  console.log()

  // ---------------------------------------------------------------------------
  // 6. Report & apply: UPDATES (steps in both, check field drift)
  // ---------------------------------------------------------------------------

  let updatedCount = 0
  let unchangedCount = 0

  console.log(`--- STEPS TO CHECK FOR UPDATES: ${toCheck.length} ---`)

  for (const code of toCheck) {
    const db = dbByCode.get(code)!
    const rule = WORKFLOW_RULES[code]
    const orderIndex = ruleEntries.findIndex(([c]) => c === code)
    const deptCode = ROLE_TO_DEPT[rule.role] || null

    const diffs: DiffLine[] = []

    // Compare title
    if (db.title !== rule.name) {
      diffs.push({ field: 'title', from: db.title, to: rule.name })
    }

    // Compare roleCode
    if ((db.roleCode ?? null) !== rule.role) {
      diffs.push({ field: 'roleCode', from: db.roleCode ?? 'null', to: rule.role })
    }

    // Compare deptCode
    if ((db.deptCode ?? null) !== deptCode) {
      diffs.push({ field: 'deptCode', from: db.deptCode ?? 'null', to: deptCode ?? 'null' })
    }

    // Compare orderIndex
    if (db.orderIndex !== orderIndex) {
      diffs.push({ field: 'orderIndex', from: String(db.orderIndex), to: String(orderIndex) })
    }

    // Compare deadlineDays
    if ((db.deadlineDays ?? null) !== (rule.deadlineDays ?? null)) {
      diffs.push({ field: 'deadlineDays', from: String(db.deadlineDays ?? 'null'), to: String(rule.deadlineDays ?? 'null') })
    }

    // Compare nextCodes
    if (!sameArr(db.nextCodes || [], rule.next || [])) {
      diffs.push({ field: 'nextCodes', from: fmtArr(db.nextCodes || []), to: fmtArr(rule.next || []) })
    }

    // Compare gateCodes
    if (!sameArr(db.gateCodes || [], rule.gate || [])) {
      diffs.push({ field: 'gateCodes', from: fmtArr(db.gateCodes || []), to: fmtArr(rule.gate || []) })
    }

    // Compare taskType (should equal step code)
    if (db.taskType !== rule.code) {
      diffs.push({ field: 'taskType', from: db.taskType, to: rule.code })
    }

    if (diffs.length === 0) {
      unchangedCount++
      continue
    }

    updatedCount++
    console.log(`  ${code} - "${rule.name}" (${diffs.length} change${diffs.length > 1 ? 's' : ''}):`)
    for (const d of diffs) {
      console.log(`    ${d.field}: ${d.from}  ->  ${d.to}`)
    }

    if (APPLY) {
      await prisma.templateStep.update({
        where: { id: db.id },
        data: {
          title: rule.name,
          roleCode: rule.role,
          deptCode,
          orderIndex,
          deadlineDays: rule.deadlineDays ?? null,
          nextCodes: rule.next,
          gateCodes: rule.gate || [],
          taskType: rule.code,
        },
      })
      console.log(`    -> UPDATED`)
    } else {
      console.log(`    -> would UPDATE`)
    }
  }

  if (updatedCount === 0 && unchangedCount === toCheck.length) {
    console.log('  (all matching steps are already in sync)\n')
  } else {
    console.log()
  }

  // ---------------------------------------------------------------------------
  // 7. Summary
  // ---------------------------------------------------------------------------

  console.log(`========================================`)
  console.log(`  SUMMARY`)
  console.log(`========================================`)
  console.log(`  Template:    ${TEMPLATE_CODE} (id=${template.id})`)
  console.log(`  DB steps:    ${dbSteps.length}`)
  console.log(`  Rule steps:  ${ruleEntries.length}`)
  console.log(`  --------------------------------`)
  console.log(`  To delete:   ${toDelete.length}  ${toDelete.map((s) => s.code).join(', ') || '-'}`)
  console.log(`  To create:   ${toCreate.length}  ${toCreate.join(', ') || '-'}`)
  console.log(`  To update:   ${updatedCount}`)
  console.log(`  Unchanged:   ${unchangedCount}`)
  console.log(`  --------------------------------`)
  const expectedAfter = dbSteps.length - toDelete.length + toCreate.length
  console.log(`  Expected step count after sync: ${expectedAfter}`)
  console.log(`  WORKFLOW_RULES count:           ${ruleEntries.length}`)
  if (expectedAfter !== ruleEntries.length) {
    // Some deletions were skipped due to task references
    const skipped = toDelete.length - (dbSteps.length - expectedAfter - toCreate.length + toDelete.length)
    console.log(`  NOTE: Counts may differ if deletions were skipped due to task references`)
  }
  console.log()

  if (!APPLY) {
    console.log(`[DRY-RUN] No changes written. Run with --apply to execute.\n`)
  } else {
    console.log(`[APPLIED] Changes written to database.\n`)
    console.log(`Run again without --apply to verify 0 diffs (idempotent check).\n`)
  }
}

main()
  .catch((e) => {
    console.error('Fatal error:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
