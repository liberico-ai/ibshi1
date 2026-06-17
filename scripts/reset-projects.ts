/**
 * Xóa TOÀN BỘ dự án + dữ liệu phụ thuộc để làm lại từ đầu (DB test).
 * Dùng TRUNCATE ... CASCADE: xóa projects và mọi bảng tham chiếu tới nó
 * (workflow_tasks, tasks động, budgets, boms, PR/PO, drawings, qc, ...).
 * GIỮ NGUYÊN: materials, warehouses, material_stocks, departments,
 * routing_suggestions, workflow_templates, template_steps, users.
 *
 * Usage:
 *   npx tsx scripts/reset-projects.ts            # dry-run (chỉ đếm)
 *   npx tsx scripts/reset-projects.ts --apply    # xóa thật
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ibs_erp_test?schema=public'

async function main() {
  const pool = new pg.Pool({ connectionString })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

  console.log(`\n🧹 Reset dự án — ${APPLY ? '🔴 APPLY (xóa thật)' : '🟢 DRY-RUN'}`)
  if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
    console.error('   ⛔ DATABASE_URL không phải localhost — DỪNG để an toàn.'); await pool.end(); return
  }

  const projects = await prisma.project.count()
  // đếm vài bảng để biết quy mô
  const counts = {
    projects,
    workflowTasks: await prisma.workflowTask.count().catch(() => 0),
    tasks: await prisma.task.count().catch(() => 0),
    budgets: await prisma.budget.count().catch(() => 0),
  }
  console.log('   Sẽ xóa (cascade từ projects):', counts)
  console.log('   GIỮ LẠI: materials, warehouses, material_stocks, departments, templates, users.')

  if (!APPLY) { console.log('\n   ⓘ DRY-RUN — chạy lại với --apply để xóa thật.\n'); await pool.end(); return }

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "projects" CASCADE;')
  console.log('   ✓ Đã xóa toàn bộ dự án + dữ liệu phụ thuộc.')
  console.log(`   Còn lại: projects=${await prisma.project.count()}, materials=${await prisma.material.count()}, warehouses=${await prisma.warehouse.count()}\n`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
