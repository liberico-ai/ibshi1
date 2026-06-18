/**
 * Re-link file đính kèm SAU KHI migrate WorkflowTask → Task.
 *
 * Bối cảnh: file của luồng cũ lưu entityType='Task', entityId='{workflowTaskId}_{key}'.
 * Luồng /work/ hiển thị tài liệu qua TaskDocRequirement.fileAttachmentId
 * (getTaskDetail gắn fileUrl/fileName từ fileAttachmentId).
 * Script này: với mỗi task đã migrate (map từ TaskHistory action='MIGRATED'),
 * tạo TaskDocRequirement (kind=MUST_READ, fulfilled=true) trỏ tới FileAttachment cũ
 * → file cũ hiển thị lại trong /work/. CHỈ TẠO THÊM, không xóa/sửa file gốc.
 *
 * DÙNG:
 *   npx tsx scripts/relink-attachments-after-migrate.ts                                   # dry-run
 *   npx tsx scripts/relink-attachments-after-migrate.ts --apply --i-understand-production # ghi
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const PROD_OK = process.argv.includes('--i-understand-production')
const MIGRATE_TAG = 'MIGRATED_FROM_WORKFLOW'
if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const cs = process.env.DATABASE_URL

async function main() {
  const isRemote = !/@localhost|@127\.0\.0\.1|localhost|127\.0\.0\.1/.test(cs)
  const pool = new pg.Pool({ connectionString: cs, ...(isRemote && { ssl: { rejectUnauthorized: false } }) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

  console.log(`\n🔗 Re-link file sau migrate — ${APPLY ? '🔴 APPLY' : '🟢 DRY-RUN'} | DB: ${isRemote ? 'REMOTE/PROD' : 'localhost'}`)

  // 1) Map: workflowTaskId (cũ) -> taskId (mới) từ lịch sử migrate
  const migrated = await prisma.taskHistory.findMany({
    where: { action: 'MIGRATED', reason: MIGRATE_TAG },
    select: { taskId: true, meta: true },
  })
  const map: { oldId: string; newId: string }[] = []
  for (const h of migrated) {
    const meta = (h.meta || {}) as { sourceId?: string }
    if (meta.sourceId) map.push({ oldId: meta.sourceId, newId: h.taskId })
  }
  console.log(`   Task đã migrate: ${map.length}`)
  if (map.length === 0) { console.log('   ⓘ Chưa có task migrate nào. Chạy migrate trước.\n'); await pool.end(); return }

  // 2) Với mỗi map: tìm file cũ entityType='Task', entityId bắt đầu '{oldId}_'
  let planned = 0, created = 0, skipped = 0
  const samples: string[] = []
  for (const m of map) {
    const atts = await prisma.fileAttachment.findMany({
      where: { entityType: 'Task', entityId: { startsWith: `${m.oldId}_` } },
      select: { id: true, entityId: true, fileName: true },
    })
    for (const a of atts) {
      const key = a.entityId.slice(m.oldId.length + 1) || 'file'
      // idempotent: đã có doc requirement trỏ tới file này trên task mới thì bỏ qua
      const exists = await prisma.taskDocRequirement.findFirst({
        where: { taskId: m.newId, fileAttachmentId: a.id }, select: { id: true },
      })
      if (exists) { skipped++; continue }
      planned++
      if (samples.length < 15) samples.push(`${a.fileName} → task ${m.newId.slice(0, 8)} [${key}]`)
      if (APPLY) {
        await prisma.taskDocRequirement.create({
          data: { taskId: m.newId, kind: 'MUST_READ', label: `[Hồ sơ cũ] ${key}`, fileAttachmentId: a.id, fulfilled: true },
        })
        created++
      }
    }
  }

  console.log(`   File sẽ gắn lại: ${planned} | đã có sẵn (bỏ qua): ${skipped}`)
  if (samples.length) { console.log('   Ví dụ:'); samples.forEach((s) => console.log('     -', s)) }

  if (!APPLY) { console.log('\n   ⓘ DRY-RUN — chạy "--apply --i-understand-production" để ghi.\n'); await pool.end(); return }
  if (isRemote && !PROD_OK) { console.error('\n   ⛔ DB REMOTE/PROD: cần --i-understand-production và ĐÃ BACKUP. DỪNG.\n'); await pool.end(); return }
  console.log(`\n   ✓ Đã tạo ${created} liên kết tài liệu (TaskDocRequirement). Không đụng file gốc.\n`)
  await pool.end()
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
