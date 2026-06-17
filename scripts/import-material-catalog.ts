/**
 * Import & reconcile the finalized material catalog into the Material table.
 *
 * Source: Danh_Muc_Vat_Tu_Hop_Nhat.xlsx → sheet "DANH MỤC ĐẦY ĐỦ"
 * (cols: Mã vật tư = canonical, Mã gốc (cũ) = dotted legacy, Tên vật tư, ĐVT,
 *  Nhóm, Trạng thái mã, Tồn kho NAS, Đơn giá BQ (VND))
 *
 * Catalog is treated as the source of truth: it OVERWRITES stock + metadata of
 * existing codes (per business decision 2026-06-02).
 *
 * Matching order (to avoid duplicates):
 *   1) Material.materialCode == canonical              → UPDATE
 *   2) alias.aliasCode == canonical OR == dotted       → UPDATE (via alias)
 *   3) Material.materialCode == dotted                 → RENAME to canonical + alias old
 *   4) same normalized name + unit (fuzzy)             → REVIEW (skip, report only)
 *   5) none                                            → CREATE
 *
 * Usage:
 *   npx tsx scripts/import-material-catalog.ts                 # dry-run (default)
 *   npx tsx scripts/import-material-catalog.ts --apply         # write to DB
 *   npx tsx scripts/import-material-catalog.ts --apply --no-stock   # don't touch stock
 *   flags: --file=<path> --report=<path> --system-user=<id>
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

// ── args ──
const args = process.argv.slice(2)
const has = (f: string) => args.includes(f)
const val = (f: string, d: string) => { const a = args.find((x) => x.startsWith(`${f}=`)); return a ? a.split('=')[1] : d }
const APPLY = has('--apply')
const SYNC_STOCK = !has('--no-stock')      // default: overwrite stock (per decision)
const SYNC_META = !has('--no-meta')        // default: overwrite metadata
const FILE = val('--file', path.resolve(process.cwd(), 'Danh_Muc_Vat_Tu_Hop_Nhat.xlsx'))
const REPORT = val('--report', path.resolve(process.cwd(), `material-sync-report-${Date.now()}.csv`))
const SYSTEM_USER = val('--system-user', 'SYSTEM_CATALOG_SYNC')
const SHEET = 'DANH MỤC ĐẦY ĐỦ'

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const mapStatus = (s: string) => (s.startsWith('ACTIVE') ? 'ACTIVE' : s === 'OBSOLETE' ? 'OBSOLETE' : s === 'ARCHIVE' ? 'ARCHIVE' : 'ACTIVE')

interface Row { canonical: string; dotted: string; name: string; unit: string; prefix: string; status: string; stock: number; price: number | null }

function readCatalog(): Row[] {
  if (!fs.existsSync(FILE)) throw new Error(`Không tìm thấy file catalog: ${FILE}`)
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`Không có sheet "${SHEET}" trong file`)
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const rows: Row[] = []
  for (const r of raw) {
    const name = String(r['Tên vật tư'] ?? '').trim()
    const canonical = String(r['Mã vật tư'] ?? '').trim()
    if (!name || !canonical) continue // chỉ import mã CÓ TÊN (ACTIVE)
    rows.push({
      canonical,
      dotted: String(r['Mã gốc (cũ)'] ?? '').trim(),
      name,
      unit: String(r['ĐVT'] ?? '').trim() || 'cái',
      prefix: String(r['Nhóm'] ?? '').trim(),
      status: mapStatus(String(r['Trạng thái mã'] ?? 'ACTIVE')),
      stock: num(r['Tồn kho NAS']),
      price: r['Đơn giá BQ (VND)'] == null ? null : num(r['Đơn giá BQ (VND)']),
    })
  }
  return rows
}

type Action = 'CREATE' | 'UPDATE' | 'RENAME' | 'REVIEW_FUZZY' | 'ERROR'
interface Plan { row: Row; action: Action; matchId?: string; matchCode?: string; detail: string }

async function main() {
  const pool = new pg.Pool({ connectionString })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any)
  const prisma = new PrismaClient({ adapter })

  console.log(`\n📋 Material Catalog Sync — ${APPLY ? '🔴 APPLY (ghi DB)' : '🟢 DRY-RUN (chỉ rà soát)'}`)
  console.log(`   File: ${FILE}`)
  console.log(`   Đồng bộ tồn: ${SYNC_STOCK ? 'CÓ (ghi đè theo NAS)' : 'KHÔNG'} | metadata: ${SYNC_META ? 'CÓ (ghi đè)' : 'KHÔNG'}\n`)

  const rows = readCatalog()
  console.log(`   Đọc được ${rows.length} mã có tên từ catalog.\n`)

  // preload existing materials + aliases for matching (explicit types so it
  // compiles independent of generated-client inference)
  interface MatLite { id: string; materialCode: string; name: string; unit: string; currentStock: unknown }
  const mats = (await prisma.material.findMany({ select: { id: true, materialCode: true, name: true, unit: true, currentStock: true } })) as MatLite[]
  const byCode = new Map<string, MatLite>(mats.map((m) => [m.materialCode, m]))
  const byNameUnit = new Map<string, MatLite>()
  for (const m of mats) byNameUnit.set(`${norm(m.name)}|${norm(m.unit)}`, m)
  const aliasesRaw = (await prisma.materialCodeAlias.findMany({ select: { aliasCode: true, materialId: true } })) as { aliasCode: string; materialId: string }[]
  const aliasMap = new Map<string, string>(aliasesRaw.map((a) => [a.aliasCode, a.materialId]))
  const matById = new Map<string, MatLite>(mats.map((m) => [m.id, m]))

  const plans: Plan[] = []
  for (const row of rows) {
    let p: Plan
    if (byCode.has(row.canonical)) {
      const m = byCode.get(row.canonical)!
      p = { row, action: 'UPDATE', matchId: m.id, matchCode: m.materialCode, detail: 'khớp mã chuẩn' }
    } else if (aliasMap.has(row.canonical) || (row.dotted && aliasMap.has(row.dotted))) {
      const id = aliasMap.get(row.canonical) || aliasMap.get(row.dotted)!
      p = { row, action: 'UPDATE', matchId: id, matchCode: matById.get(id)?.materialCode, detail: 'khớp qua bí danh' }
    } else if (row.dotted && byCode.has(row.dotted)) {
      const m = byCode.get(row.dotted)!
      p = { row, action: 'RENAME', matchId: m.id, matchCode: m.materialCode, detail: 'đổi mã chấm → mã chuẩn, giữ mã cũ làm alias' }
    } else if (byNameUnit.has(`${norm(row.name)}|${norm(row.unit)}`)) {
      const m = byNameUnit.get(`${norm(row.name)}|${norm(row.unit)}`)!
      p = { row, action: 'REVIEW_FUZZY', matchId: m.id, matchCode: m.materialCode, detail: 'trùng tên+ĐVT (cần xác nhận thủ công, BỎ QUA)' }
    } else {
      p = { row, action: 'CREATE', detail: 'tạo mới' }
    }
    plans.push(p)
  }

  // orphans: system materials whose code is not a canonical in catalog and not an alias target
  const canonicalSet = new Set(rows.map((r) => r.canonical))
  const orphans = mats.filter((m) => !canonicalSet.has(m.materialCode))

  const count = (a: Action) => plans.filter((p) => p.action === a).length
  console.log('   ── KẾT QUẢ RÀ SOÁT ──')
  console.log(`   CREATE (mã mới)        : ${count('CREATE')}`)
  console.log(`   UPDATE (đã khớp)       : ${count('UPDATE')}`)
  console.log(`   RENAME (chấm → chuẩn)  : ${count('RENAME')}`)
  console.log(`   REVIEW (trùng tên, bỏ qua): ${count('REVIEW_FUZZY')}`)
  console.log(`   Mã trong DB không có trong catalog (orphan, chỉ báo cáo): ${orphans.length}\n`)

  // write CSV report
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = ['action,canonical,dotted,name,unit,prefix,catalog_stock,catalog_price,matched_code,detail']
  for (const p of plans) lines.push([p.action, p.row.canonical, p.row.dotted, p.row.name, p.row.unit, p.row.prefix, p.row.stock, p.row.price ?? '', p.matchCode ?? '', p.detail].map(esc).join(','))
  lines.push('')
  lines.push('ORPHAN (trong DB, không có trong catalog),,,,,,,,,')
  for (const m of orphans) lines.push(['ORPHAN', m.materialCode, '', m.name, m.unit, '', Number(m.currentStock), '', m.materialCode, 'không có trong catalog'].map(esc).join(','))
  fs.writeFileSync(REPORT, '﻿' + lines.join('\n'), 'utf8')
  console.log(`   📄 Báo cáo chi tiết: ${REPORT}\n`)

  if (!APPLY) {
    console.log('   ⓘ Đây là DRY-RUN. Xem báo cáo, rồi chạy lại với --apply để ghi DB.\n')
    await pool.end()
    return
  }

  // ── APPLY ──
  let created = 0, updated = 0, renamed = 0, skipped = 0, errored = 0
  for (const p of plans) {
    const r = p.row
    try {
      if (p.action === 'REVIEW_FUZZY') { skipped++; continue }

      await prisma.$transaction(async (tx) => {
        const meta = {
          name: r.name, unit: r.unit, category: r.prefix,
          ...(r.price != null ? { unitPrice: r.price } : {}),
          status: r.status,
        }

        if (p.action === 'CREATE') {
          const m = await tx.material.create({
            data: { materialCode: r.canonical, ...meta, currentStock: SYNC_STOCK ? r.stock : 0 },
          })
          if (SYNC_STOCK && r.stock > 0) {
            await tx.stockMovement.create({ data: { materialId: m.id, type: 'IN', quantity: r.stock, reason: 'catalog_sync', referenceNo: 'CATALOG-2026-04-19', performedBy: SYSTEM_USER, notes: `Khởi tạo tồn từ catalog: ${r.stock}` } })
          }
          if (r.dotted && r.dotted !== r.canonical) {
            await tx.materialCodeAlias.upsert({ where: { aliasCode: r.dotted }, update: {}, create: { materialId: m.id, aliasCode: r.dotted, source: 'LEGACY_DOT', createdBy: SYSTEM_USER } })
          }
          created++
          return
        }

        // UPDATE or RENAME → operate on matched material
        const id = p.matchId!
        const before = matById.get(id)!
        const data: Record<string, unknown> = {}
        if (SYNC_META) Object.assign(data, meta)
        if (p.action === 'RENAME') {
          data.materialCode = r.canonical
          // keep old dotted code as alias
          await tx.materialCodeAlias.upsert({ where: { aliasCode: before.materialCode }, update: {}, create: { materialId: id, aliasCode: before.materialCode, source: 'LEGACY_DOT', createdBy: SYSTEM_USER } })
        }
        if (SYNC_STOCK) {
          const oldStock = Number(before.currentStock)
          const delta = r.stock - oldStock
          data.currentStock = r.stock
          if (delta !== 0) {
            await tx.stockMovement.create({ data: { materialId: id, type: 'ADJUST', quantity: Math.abs(delta), reason: 'catalog_sync', referenceNo: 'CATALOG-2026-04-19', performedBy: SYSTEM_USER, notes: `Đồng bộ catalog: ${oldStock} → ${r.stock} (${delta > 0 ? '+' : ''}${delta})` } })
          }
        }
        if (Object.keys(data).length > 0) await tx.material.update({ where: { id }, data })
        // ensure dotted alias exists
        if (r.dotted && r.dotted !== r.canonical && !aliasMap.has(r.dotted)) {
          await tx.materialCodeAlias.upsert({ where: { aliasCode: r.dotted }, update: {}, create: { materialId: id, aliasCode: r.dotted, source: 'LEGACY_DOT', createdBy: SYSTEM_USER } })
        }
        if (p.action === 'RENAME') renamed++; else updated++
      })
    } catch (e) {
      errored++
      console.error(`   ✗ ${r.canonical}: ${(e as Error).message}`)
    }
  }

  console.log(`\n   ── ĐÃ GHI DB ──`)
  console.log(`   Tạo mới: ${created} | Cập nhật: ${updated} | Đổi mã: ${renamed} | Bỏ qua (review): ${skipped} | Lỗi: ${errored}\n`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
