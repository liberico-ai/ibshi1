// ─────────────────────────────────────────────────────────────────────────────
// DIAG (READ-ONLY) — soi vì sao task Pxx của 1 dự án không thuộc chuỗi (templateStepId=null)
// và quy trình đang dừng ở đâu. TUYỆT ĐỐI KHÔNG ghi/sửa DB (chỉ findMany/findFirst/count).
//
// Chạy:   node scripts/diag-wnc-111.mjs                 (mặc định 26-WNC-I-111)
//         node scripts/diag-wnc-111.mjs 26-SED-I-110    (dự án khác để đối chiếu)
//         node scripts/diag-wnc-111.mjs 26-WNC-I-111 P3.5   (soi kỹ 1 bước)
//
// Cần DATABASE_URL trong .env (script đọc như app). Không commit file này.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const PROJECT_CODE = process.argv[2] || '26-WNC-I-111'
const FOCUS_STEP = process.argv[3] || 'P3.5'
const L = (...a) => console.log(...a)
const pad = (s, n) => String(s ?? '').padEnd(n)

async function main() {
  // 1) Dự án
  const project = await prisma.project.findFirst({
    where: { projectCode: PROJECT_CODE },
    select: { id: true, projectCode: true, projectName: true, status: true, createdAt: true },
  })
  if (!project) { L(`❌ Không thấy dự án ${PROJECT_CODE}`); return }
  L('══════════════════════════════════════════════════════════════')
  L(`DỰ ÁN  ${project.projectCode} — ${project.projectName}`)
  L(`id=${project.id} · status=${project.status} · tạo=${fmt(project.createdAt)}`)
  L('══════════════════════════════════════════════════════════════')

  // 2) Toàn bộ task của dự án
  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    select: {
      id: true, taskType: true, title: true, status: true, templateStepId: true,
      createdBy: true, createdAt: true, completedAt: true, revisionRound: true, originStepCode: true,
      assignees: { select: { userId: true, role: true, done: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const linked = tasks.filter(t => t.templateStepId)
  const unlinked = tasks.filter(t => !t.templateStepId)
  L(`\nTASK: tổng ${tasks.length} · CÓ templateStepId ${linked.length} · THIẾU link ${unlinked.length}`)

  // 3) Template của dự án (suy từ 1 task có link — giống engine)
  let template = null, steps = []
  const anchor = linked[0]
  if (anchor) {
    const ts = await prisma.templateStep.findUnique({ where: { id: anchor.templateStepId }, select: { templateId: true } })
    if (ts?.templateId) {
      template = await prisma.workflowTemplate.findUnique({ where: { id: ts.templateId }, select: { id: true, code: true, name: true } })
      steps = await prisma.templateStep.findMany({
        where: { templateId: ts.templateId },
        select: { code: true, taskType: true, title: true, nextCodes: true, gateCodes: true },
        orderBy: { code: 'asc' },
      })
    }
  }
  L(template
    ? `TEMPLATE dự án: ${template.code} — ${template.name} (${steps.length} bước mẫu)`
    : `⚠ KHÔNG suy được template (không task nào có templateStepId) → chuỗi chưa từng chạy chuẩn cho dự án này`)

  // 4) Danh sách task (rút gọn) + đánh dấu thiếu link
  const users = await usersMap(tasks)
  L(`\n── TẤT CẢ TASK (theo thời gian tạo) ──`)
  L(`${pad('taskType',10)} ${pad('status',14)} link ${pad('người tạo',22)} ${pad('tạo',17)} nhận`)
  for (const t of tasks) {
    const who = users.get(t.createdBy) || t.createdBy
    const asg = t.assignees.map(a => a.userId ? (users.get(a.userId) || a.userId) : `@${a.role}`).join(', ')
    L(`${pad(t.taskType,10)} ${pad(t.status,14)} ${t.templateStepId ? ' ✓ ' : ' ✗ '} ${pad(who,22)} ${pad(fmt(t.createdAt),17)} ${asg}`)
  }

  // 5) Các task THIẾU link (nghi tạo tay/import)
  if (unlinked.length) {
    L(`\n── ⚠ TASK THIẾU templateStepId (${unlinked.length}) — không do chuỗi sinh ──`)
    for (const t of unlinked) L(`   ${pad(t.taskType,10)} ${pad(t.status,14)} "${t.title}"  (tạo ${fmt(t.createdAt)} bởi ${users.get(t.createdBy) || t.createdBy})`)
  }

  // 6) Soi kỹ bước FOCUS (vd P3.5)
  const focus = tasks.filter(t => t.taskType === FOCUS_STEP)
  L(`\n── SOI KỸ BƯỚC ${FOCUS_STEP} (${focus.length} task) ──`)
  if (!focus.length) L(`   (dự án KHÔNG có task ${FOCUS_STEP} nào)`)
  for (const t of focus) {
    L(`   id=${t.id}`)
    L(`      status=${t.status} · templateStepId=${t.templateStepId ?? 'NULL ✗'} · revisionRound=${t.revisionRound}`)
    L(`      tạo=${fmt(t.createdAt)} bởi ${users.get(t.createdBy) || t.createdBy} · xong=${t.completedAt ? fmt(t.completedAt) : '—'}`)
    L(`      người nhận: ${t.assignees.map(a => `${a.userId ? (users.get(a.userId) || a.userId) : '@'+a.role}${a.done ? '(done)' : ''}`).join(', ') || '(trống)'}`)
  }
  const stepDef = steps.find(s => s.code === FOCUS_STEP || s.taskType === FOCUS_STEP)
  if (stepDef) L(`   ➜ Bước mẫu ${FOCUS_STEP}: gate=[${stepDef.gateCodes.join(',')}] → next=[${stepDef.nextCodes.join(',')}]`)
  else if (template) L(`   ⚠ Template ${template.code} KHÔNG có bước mẫu ${FOCUS_STEP} → task ${FOCUS_STEP} không thể do chuỗi sinh`)

  // 7) Chẩn đoán chuỗi: bước nào xong / đang mở / chưa có task
  if (steps.length) {
    const byCode = new Map()
    for (const t of tasks) {
      const c = t.taskType
      const cur = byCode.get(c)
      // ưu tiên hiển thị task DONE, else task mở nhất
      if (!cur || (t.status === 'DONE') || (cur.status !== 'DONE')) byCode.set(c, t)
    }
    const doneCodes = new Set(tasks.filter(t => t.status === 'DONE').map(t => t.taskType))
    L(`\n── CHUỖI: bước sẵn sàng nhưng CHƯA có task (gate đã đủ mà chưa sinh) ──`)
    let flagged = 0
    for (const s of steps) {
      const has = byCode.get(s.code)
      const gateOk = (s.gateCodes || []).every(g => doneCodes.has(g))
      if (!has && gateOk) { L(`   ⛔ ${pad(s.code,8)} "${s.title}" — gate [${s.gateCodes.join(',')}] đã đủ nhưng KHÔNG có task`); flagged++ }
    }
    if (!flagged) L('   (không có — mọi bước đủ gate đều đã có task)')
  }

  L('\n✔ Xong (read-only, không ghi gì).')
}

async function usersMap(tasks) {
  const ids = new Set()
  for (const t of tasks) { if (t.createdBy) ids.add(t.createdBy); for (const a of t.assignees) if (a.userId) ids.add(a.userId) }
  if (!ids.size) return new Map()
  const us = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true, username: true } })
  return new Map(us.map(u => [u.id, u.fullName || u.username]))
}

function fmt(d) {
  if (!d) return '—'
  const x = new Date(d)
  const p = n => String(n).padStart(2, '0')
  return `${p(x.getDate())}/${p(x.getMonth() + 1)} ${p(x.getHours())}:${p(x.getMinutes())}`
}

main().catch(e => { console.error('LỖI:', e.message) }).finally(() => prisma.$disconnect())
