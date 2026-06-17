/**
 * Seed cho Workflow động (Phase 1):
 *  1) Phòng ban theo cơ cấu mới (DEPARTMENTS_V2) — upsert vào Department.
 *  2) RoutingSuggestion: sinh từ WORKFLOW_RULES (mỗi step → next.role → phòng).
 *
 * Usage: npx tsx scripts/seed-dynamic-workflow.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { WORKFLOW_RULES } from '../src/lib/workflow-constants'
import { DEPARTMENTS_V2, ROLE_TO_DEPT } from '../src/lib/org-map'

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL

async function main() {
  const pool = new pg.Pool({ connectionString })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

  console.log('🌱 Seed Workflow động — DB:', connectionString.replace(/:[^:@/]+@/, ':***@'))

  // 1) Departments (cơ cấu mới)
  for (const d of DEPARTMENTS_V2) {
    await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name },
      create: { code: d.code, name: d.name, nameEn: '' },
    })
  }
  console.log(`   ✓ Phòng ban: ${DEPARTMENTS_V2.length}`)

  // 2) RoutingSuggestion từ 36 bước
  await prisma.routingSuggestion.deleteMany({ where: { source: 'WORKFLOW_SEED' } })
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
  console.log(`   ✓ RoutingSuggestion: ${data.length} (từ ${Object.keys(WORKFLOW_RULES).length} bước)`)

  // 3) Template "Dự án SX" từ 36 bước
  const HOOKS: Record<string, string[]> = { 'P2.2': ['syncBOMtoBudget'], 'P2.3': ['syncBOMtoBudget'], 'P3.3': ['syncPOtoBudget'] }
  const existing = await prisma.workflowTemplate.findUnique({ where: { code: 'SX-PROD' } })
  const tpl = existing
    ? await prisma.workflowTemplate.update({ where: { code: 'SX-PROD' }, data: { name: 'Dự án sản xuất (chuẩn 36 bước)' } })
    : await prisma.workflowTemplate.create({ data: { code: 'SX-PROD', name: 'Dự án sản xuất (chuẩn 36 bước)', projectType: 'EXTERNAL_PROD', version: 1 } })
  await prisma.templateStep.deleteMany({ where: { templateId: tpl.id } })
  const steps = Object.values(WORKFLOW_RULES)
  await prisma.templateStep.createMany({
    data: steps.map((s, i) => ({
      templateId: tpl.id, code: s.code, title: s.name, roleCode: s.role,
      deptCode: ROLE_TO_DEPT[s.role] || null, orderIndex: i, deadlineDays: s.deadlineDays || null,
      taskType: s.code, hookKeys: HOOKS[s.code] || [],
      nextCodes: s.next || [], gateCodes: s.gate || [],
    })),
  })
  console.log(`   ✓ Template "Dự án SX": ${steps.length} bước`)

  await pool.end()
  console.log('✅ Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
