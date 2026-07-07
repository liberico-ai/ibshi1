/**
 * Nạp Budget.planned (baseline KH) + PO header từ CSV (Drive → ERP, lô 1).
 * Chạy:  npx tsx scripts/import-budget-po.ts            # dry-run (mặc định)
 *        npx tsx scripts/import-budget-po.ts --apply     # ghi vào DB
 * Idempotent. READ-ONLY khi chưa --apply.
 *
 * Nguồn: docs/handoff/import/budget_import.csv, po_import.csv
 *
 * PHẦN A — Budget: findFirst({projectId,category,month:null,year:null}) → update/create {planned}.
 *   (KHÔNG upsert vì null trong @@unique không match.) category giữ nguyên VAT_TU/NHAN_CONG/DICH_VU/CHI_PHI_CHUNG.
 * PHẦN B — PO header: idempotent theo poCode (đã tồn tại → skip). vendorId BẮT BUỘC → find/create Vendor theo tên.
 *   status='APPROVED' để control-dashboard tính committed (committed = Σ PO totalValue, live từ PO — không đụng Budget/actual).
 *   Không tạo PO item (schema không bắt buộc). KHÔNG gọi syncPOtoBudget (dashboard tự tính committed từ PO khi mở).
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as fs from 'fs'
import * as path from 'path'

const APPLY = process.argv.includes('--apply')
const IMPORT_DIR = path.join(process.cwd(), 'docs/handoff/import')
const IMPORTER_USERNAME = 'toannd'
const PO_STATUS = 'APPROVED'
const NEW_VENDOR_CATEGORY = 'OTHER'

// ── CSV parser (hỗ trợ field bọc ngoặc kép có dấu phẩy) ──
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function parseCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n').trim()
  const lines = text.split('\n').filter(l => l.trim())
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map(l => {
    const cols = parseCsvLine(l)
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = cols[i] ?? '' })
    return row
  })
}

// ── Slug vendorCode từ tên (bỏ dấu tiếng Việt) ──
function slugCode(name: string): string {
  const noDia = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  const s = noDia.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
  return `IMP-${s || 'X'}`
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) { console.error('❌ DATABASE_URL không set'); process.exit(1) }
  const isRemote = !connectionString.includes('@localhost') && !connectionString.includes('@127.0.0.1')
  const pool = new pg.Pool({ connectionString, max: 5, ...(isRemote && { ssl: { rejectUnauthorized: false } }) })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as never) })

  console.log(`=== Import Budget + PO — ${APPLY ? 'APPLY (ghi DB)' : 'DRY-RUN'} ===`)

  const importer = await prisma.user.findUnique({ where: { username: IMPORTER_USERNAME }, select: { id: true } })
  if (!importer) { console.error(`❌ Không tìm thấy user ${IMPORTER_USERNAME}`); process.exit(1) }

  // Cache projectCode → id
  const projectCache = new Map<string, string | null>()
  async function resolveProject(code: string): Promise<string | null> {
    if (projectCache.has(code)) return projectCache.get(code)!
    const p = await prisma.project.findUnique({ where: { projectCode: code }, select: { id: true } })
    projectCache.set(code, p?.id ?? null)
    return p?.id ?? null
  }

  // ─────────────── PHẦN A — Budget.planned ───────────────
  console.log('\n── PHẦN A: Budget.planned ──')
  const budgetRows = parseCsv(path.join(IMPORT_DIR, 'budget_import.csv'))
  let bCreated = 0, bUpdated = 0, bSkipNoProj = 0, bUnchanged = 0
  const usedVendorCodes = new Set<string>()

  for (const r of budgetRows) {
    const code = r.projectCode, category = r.category, planned = r.planned
    const projectId = await resolveProject(code)
    if (!projectId) { console.log(`  ⏭  SKIP budget (không thấy dự án): ${code} / ${category}`); bSkipNoProj++; continue }

    const existing = await prisma.budget.findFirst({ where: { projectId, category, month: null, year: null }, select: { id: true, planned: true } })
    if (existing) {
      if (Number(existing.planned) === Number(planned)) { bUnchanged++; continue }
      if (APPLY) await prisma.budget.update({ where: { id: existing.id }, data: { planned } })
      console.log(`  ~ UPDATE ${code}/${category}: planned ${Number(existing.planned).toLocaleString()} → ${Number(planned).toLocaleString()}`)
      bUpdated++
    } else {
      if (APPLY) await prisma.budget.create({ data: { projectId, category, planned, month: null, year: null } })
      console.log(`  + CREATE ${code}/${category}: planned ${Number(planned).toLocaleString()}`)
      bCreated++
    }
  }
  console.log(`  → Budget: +${bCreated} tạo, ~${bUpdated} cập nhật, =${bUnchanged} không đổi, ⏭${bSkipNoProj} skip (không dự án)`)

  // ─────────────── PHẦN B — PO header ───────────────
  console.log('\n── PHẦN B: PO header ──')
  const poRows = parseCsv(path.join(IMPORT_DIR, 'po_import.csv'))
  let poCreated = 0, poSkipExist = 0, poSkipNoProj = 0, vendorCreated = 0
  const committedByProject = new Map<string, number>()

  // vendor cache theo tên
  const vendorCache = new Map<string, string>()
  async function resolveVendor(name: string): Promise<string> {
    const key = name.toLowerCase()
    if (vendorCache.has(key)) return vendorCache.get(key)!
    const found = await prisma.vendor.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })
    if (found) { vendorCache.set(key, found.id); return found.id }
    // tạo mới — vendorCode duy nhất
    let vc = slugCode(name)
    let n = 1
    while (usedVendorCodes.has(vc) || await prisma.vendor.findUnique({ where: { vendorCode: vc }, select: { id: true } })) {
      n++; vc = `${slugCode(name)}-${n}`
    }
    usedVendorCodes.add(vc)
    console.log(`  + VENDOR mới: "${name}" (code ${vc}, category ${NEW_VENDOR_CATEGORY})`)
    vendorCreated++
    if (APPLY) {
      const v = await prisma.vendor.create({ data: { vendorCode: vc, name, category: NEW_VENDOR_CATEGORY, country: 'VN', isActive: true } })
      vendorCache.set(key, v.id); return v.id
    }
    const fakeId = `dry-${vc}`
    vendorCache.set(key, fakeId); return fakeId
  }

  for (const r of poRows) {
    const { projectCode, poCode, supplier, totalValue, orderDate, note } = r
    const existing = await prisma.purchaseOrder.findUnique({ where: { poCode }, select: { id: true } })
    if (existing) { console.log(`  ⏭  SKIP PO đã tồn tại: ${poCode}`); poSkipExist++; continue }

    const projectId = await resolveProject(projectCode)
    if (!projectId) { console.log(`  ⏭  SKIP PO (không thấy dự án ${projectCode}): ${poCode}`); poSkipNoProj++; continue }

    const vendorId = await resolveVendor(supplier)
    const val = Number(totalValue)
    committedByProject.set(projectCode, (committedByProject.get(projectCode) || 0) + val)

    console.log(`  + PO ${poCode} → ${projectCode} | ${supplier} | ${val.toLocaleString()}đ | ${orderDate} | status=${PO_STATUS}${note ? ` | ${note}` : ''}`)
    if (APPLY) {
      await prisma.purchaseOrder.create({
        data: {
          poCode, projectId, vendorId, status: PO_STATUS,
          totalValue: totalValue, currency: 'VND',
          orderDate: orderDate ? new Date(orderDate) : null,
          notes: note || null, createdBy: importer.id,
        },
      })
    }
    poCreated++
  }
  console.log(`  → PO: +${poCreated} tạo, ⏭${poSkipExist} skip (đã có), ⏭${poSkipNoProj} skip (không dự án); vendor mới: +${vendorCreated}`)

  // ── Đối chiếu committed dự kiến / dự án ──
  console.log('\n── Committed dự kiến (Σ PO totalValue APPROVED) theo dự án ──')
  for (const [code, sum] of [...committedByProject.entries()].sort()) {
    console.log(`  ${code}: ${sum.toLocaleString()}đ (${poRows.filter(r => r.projectCode === code).length} PO)`)
  }

  console.log(`\n${APPLY ? '✅ ĐÃ GHI DB' : '🔍 DRY-RUN — chưa ghi. Chạy với --apply để nạp.'}`)
  await prisma.$disconnect()
}

main().catch(err => { console.error('❌ Lỗi:', err); process.exit(1) })
