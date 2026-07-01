/**
 * SKELETON — Seed workflow templates per product type.
 * Currently SX-PROD (generic, productType=null) serves all product types.
 * When ready to split, uncomment the main() call and run: npx tsx prisma/seed-workflow-templates.ts
 *
 * Idempotent: upserts by template code.
 */
import { PrismaClient } from '@prisma/client'
import { WORKFLOW_RULES } from '../src/lib/workflow-constants'
import { ROLE_TO_DEPT } from '../src/lib/org-map'
import { PRODUCT_TYPES } from '../src/lib/constants'

const prisma = new PrismaClient()

async function main() {
  for (const pt of PRODUCT_TYPES) {
    const code = `TPL-${pt.value}-v1`
    const name = `${pt.label} (v1)`

    const tpl = await prisma.workflowTemplate.upsert({
      where: { code },
      update: { name, productType: pt.value },
      create: { code, name, projectType: 'EXTERNAL_PROD', productType: pt.value, version: 1, isActive: true },
    })

    const rules = Object.values(WORKFLOW_RULES)
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i]
      const stepCode = `${code}::${r.code}`
      const existing = await prisma.templateStep.findFirst({ where: { templateId: tpl.id, code: r.code } })
      if (existing) continue
      await prisma.templateStep.create({
        data: {
          templateId: tpl.id, code: r.code, title: r.name,
          roleCode: r.role, deptCode: ROLE_TO_DEPT[r.role] || null,
          orderIndex: i, deadlineDays: r.deadlineDays || null,
          taskType: r.code, hookKeys: [], nextCodes: r.next || [], gateCodes: r.gate || [],
        },
      })
    }
    const count = await prisma.templateStep.count({ where: { templateId: tpl.id } })
    console.log(`${code}: ${count} steps`)
  }
}

// Uncomment to run:
// main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1) })

export { main }
