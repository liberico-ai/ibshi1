/**
 * revise-readiness-check.ts — READ-ONLY. Không ghi gì.
 *
 * Trả lời: dự án nào trên DB đích ĐỦ ĐIỀU KIỆN mở vòng revise (Revise Flow36),
 * dự án nào KHÔNG (legacy — task không có template_step_id → openRevisionRound sẽ throw).
 *
 * Điều kiện mở revise (theo openRevisionRound trong work-engine.ts):
 *   1) Dự án có ≥1 task với template_step_id != null  → suy được templateId của dự án.
 *   2) Template đó có bước entry (mặc định kiểm P2.1) trong template_steps.
 *   3) (khuyến nghị) template có cạnh next_codes/gate_codes để expand chuỗi.
 *
 * Cách chạy (đích = DATABASE_URL):
 *   DATABASE_URL="<uat|prod>" npx tsx scripts/revise-readiness-check.ts
 *
 * In ra host DB (đã che user/mật khẩu) ở đầu để chắc chắn đúng môi trường.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

// Repo dùng driverAdapters (Prisma 7) → PHẢI truyền PrismaPg adapter (không dùng bare PrismaClient).
// SSL bật cho DB remote (UAT/prod), tắt cho localhost — khớp src/lib/db.ts.
const connectionString = process.env.DATABASE_URL || ''
const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
const pool = new pg.Pool({ connectionString, max: 3, ...(isRemote && { ssl: { rejectUnauthorized: false } }) })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

// Các bước entry mà 12 loại revise dùng (từ REVISE_TYPE_MAP). Template phải có các code này.
const ENTRY_CODES = ['P2.1', 'P2.2', 'P2.3', 'P1.2', 'P2.4', 'P1.2A', 'P2.1A', 'P3.5', 'P3.4', 'P5.1', 'P4.3', 'P5.3']

function maskDbUrl(u: string | undefined): string {
  if (!u) return '(DATABASE_URL trống!)'
  try {
    const url = new URL(u)
    return `${url.protocol}//***@${url.host}${url.pathname}`
  } catch {
    return '(không parse được DATABASE_URL)'
  }
}

async function main() {
  console.log('════════ REVISE READINESS CHECK (read-only) ════════')
  console.log('DB đích:', maskDbUrl(process.env.DATABASE_URL))
  console.log('')

  const projects = await prisma.project.findMany({
    select: { id: true, projectCode: true, projectName: true, status: true },
    orderBy: { projectCode: 'asc' },
  })

  // Cache: templateId → {codes:Set, hasEdges:boolean}
  const tplCache = new Map<string, { codes: Set<string>; hasEdges: boolean }>()
  async function loadTemplate(templateId: string) {
    if (tplCache.has(templateId)) return tplCache.get(templateId)!
    const steps = await prisma.templateStep.findMany({
      where: { templateId },
      select: { code: true, nextCodes: true, gateCodes: true },
    })
    const codes = new Set(steps.map((s) => s.code))
    const hasEdges = steps.some((s) => (s.nextCodes?.length ?? 0) > 0 || (s.gateCodes?.length ?? 0) > 0)
    const v = { codes, hasEdges }
    tplCache.set(templateId, v)
    return v
  }

  const eligible: Array<{ code: string; name: string; status: string; tplSteps: number; missingEntries: string[]; hasEdges: boolean }> = []
  const legacy: Array<{ code: string; name: string; status: string; totalTasks: number }> = []

  for (const p of projects) {
    // task template-driven đầu tiên của dự án
    const anyTplTask = await prisma.task.findFirst({
      where: { projectId: p.id, NOT: { templateStepId: null } },
      select: { templateStepId: true },
    })
    if (!anyTplTask?.templateStepId) {
      const totalTasks = await prisma.task.count({ where: { projectId: p.id } })
      legacy.push({ code: p.projectCode, name: p.projectName, status: p.status, totalTasks })
      continue
    }
    const ts = await prisma.templateStep.findUnique({ where: { id: anyTplTask.templateStepId }, select: { templateId: true } })
    if (!ts?.templateId) {
      legacy.push({ code: p.projectCode, name: p.projectName, status: p.status, totalTasks: -1 })
      continue
    }
    const tpl = await loadTemplate(ts.templateId)
    const missingEntries = ENTRY_CODES.filter((c) => !tpl.codes.has(c))
    eligible.push({
      code: p.projectCode,
      name: p.projectName,
      status: p.status,
      tplSteps: tpl.codes.size,
      missingEntries,
      hasEdges: tpl.hasEdges,
    })
  }

  console.log(`Tổng dự án: ${projects.length}`)
  console.log(`  ✅ ĐỦ ĐIỀU KIỆN revise (có template): ${eligible.length}`)
  console.log(`  ⛔ LEGACY (không template → KHÔNG mở được revise): ${legacy.length}`)
  console.log('')

  const activeEligible = eligible.filter((e) => e.status === 'ACTIVE')
  console.log(`Trong đó ACTIVE + đủ điều kiện: ${activeEligible.length}`)
  console.log('')

  console.log('──── ✅ ĐỦ ĐIỀU KIỆN ────')
  for (const e of eligible) {
    const warn: string[] = []
    if (e.missingEntries.length) warn.push(`thiếu entry: ${e.missingEntries.join(',')}`)
    if (!e.hasEdges) warn.push('template KHÔNG có next/gate edges (expand rỗng!)')
    console.log(`  ${e.status.padEnd(8)} ${e.code.padEnd(16)} tpl:${e.tplSteps} bước${warn.length ? '  ⚠ ' + warn.join(' · ') : ''}  ${e.name}`)
  }
  console.log('')
  console.log('──── ⛔ LEGACY (revise sẽ báo lỗi "không xác định được template") ────')
  for (const l of legacy) {
    console.log(`  ${l.status.padEnd(8)} ${l.code.padEnd(16)} tasks:${l.totalTasks}  ${l.name}`)
  }

  console.log('')
  console.log('Ghi chú: dự án LEGACY muốn dùng revise thì cần được đưa lên hệ process-template')
  console.log('(có task gắn template_step_id). Đây là quyết định vận hành, không phải lỗi.')
}

main()
  .catch((e) => { console.error('LỖI:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
