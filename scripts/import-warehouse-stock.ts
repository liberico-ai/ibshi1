/**
 * Import per-warehouse (per-project) inventory into the system.
 *
 * Source: Ton_Kho_SKU_Theo_DuAn.xlsx (sheets: "DANH MỤC SKU", "TỒN THEO DỰ ÁN-KHO",
 * "KHO - DỰ ÁN"). Canonical materialCode = DOTTED MISA code (vd VLC.P005.007).
 *
 * Writes: Material (SKU + specs + total stock), Warehouse (kho ↔ dự án),
 * MaterialStock (tồn theo SKU × kho/dự án).
 *
 * Usage:
 *   npx tsx scripts/import-warehouse-stock.ts                 # dry-run (mặc định)
 *   npx tsx scripts/import-warehouse-stock.ts --apply         # ghi DB
 *   npx tsx scripts/import-warehouse-stock.ts --apply --reset # xóa Material/Warehouse cũ rồi nạp lại
 *   flags: --file=<path>
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const RESET = args.includes('--reset')
const FILE = (args.find((a) => a.startsWith('--file=')) || '').split('=')[1]
  || path.resolve(process.cwd(), 'Ton_Kho_SKU_Theo_DuAn.xlsx')
if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1) }
const connectionString: string = process.env.DATABASE_URL

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const str = (v: unknown) => (v == null ? '' : String(v).trim())

// ── Trích Profile (quy cách) + Mác (grade) từ tên vật tư ──
const GRADES = ['SS400','SM490YB','SM490YA','SM490A','SM490B','SM490','SM520','SM570','S355JR','S355','S275','S235',
  'Q345B','Q345','Q235B','Q235','SA-516','SA516','A516','A515','A572','A573','A283','A36','A240','SA240','SA-240',
  'A105','A106','A234','A53','A193','A194','16MO3','16MN','16MND5','09MN2','CT3','CT38','S45C','SCM440',
  'SUS304','SUS316L','SUS316','SUS201','SUS430','TP304L','TP316L','TP304','TP316','304L','316L','316','304','201','430',
  'HARDOX 450','HARDOX 400','HARDOX','8.8','10.9','12.9','4.8','A2-70','A4-80','GR.70','GR70','GR.B','DUPLEX','INOX']
const RE_SECTION = /\b[UIHL]\d+(?:[.,]\d+)?(?:\s*[xX×*]\s*\d+(?:[.,]\d+)?)+/  // U100x50x..., H200x200...
const RE_MULTI = /\d+(?:[.,]\d+)?(?:\s*[xX×*]\s*\d+(?:[.,]\d+)?)+/             // 5x1500x6000, 50x50
const RE_METRIC = /\bM\d+(?:[.,]\d+)?(?:\s*[xX×*]\s*\d+(?:[.,]\d+)?)?/i        // M24, M12x80
const RE_DIA = /\b[DØF]\s?\d+(?:[.,]\d+)?/i                                    // D50, F18.5
const RE_MM = /\b\d+(?:[.,]\d+)?\s*mm\b/i                                      // 1.2mm
function parseSpec(name: string): { profile: string; grade: string } {
  let grade = ''
  // First try compound patterns: NV A36, ASTM A572 GR50, SA516 GR70, SA240 GR 304, A106 GRB, A193 B8M, SA312 TP304L
  const compoundMatch = name.match(/\b((?:NV|DNV|LR|ABS|BV|GL|KR|NK|CCS)\s+\w+(?:\s+\w+)?|ASTM\s*A\d+\s*(?:GR\.?\s*\w+)?|SA-?516\s*GR\.?\s*\w+|SA-?240\s*GR\.?\s*\w+|SA-?312\s*TP\s*\w+|A106\s*GR\.?\s*\w+|A105\s*#?\d+|A193\s*[-]?\s*B\d+\w*|A194\s*[-]?\s*\w+)/i)
  if (compoundMatch) {
    grade = compoundMatch[1].replace(/\s+/g, ' ').trim().toUpperCase()
  } else {
    for (const g of GRADES) {
      const re = new RegExp('(?<![A-Z0-9])' + g.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(?![A-Z0-9])', 'i')
      if (re.test(name)) { grade = g === 'INOX' ? 'INOX' : g.toUpperCase(); break }
    }
  }
  const cands: string[] = []
  const sec = name.match(RE_SECTION); if (sec) cands.push(sec[0])
  for (const re of [RE_MULTI, RE_METRIC, RE_DIA, RE_MM]) {
    const m = name.match(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'))
    if (m) cands.push(...m)
  }
  let profile = ''
  if (cands.length) {
    profile = cands.reduce((a, b) => {
      const score = (s: string) => (s.toLowerCase().split('x').length - 1) * 100 + s.length
      return score(b) > score(a) ? b : a
    })
    profile = profile.replace(/\s+/g, '').replace(/\*/g, 'x')
  }
  return { profile, grade }
}

function kindOf(loaiKho: string, project: string): string {
  if (project) return 'PROJECT'
  const l = loaiKho.toLowerCase()
  if (l.includes('ký gửi') || l.includes('kh cấp')) return 'CONSIGNED'
  if (l.includes('chung')) return 'COMMON'
  return 'OTHER'
}

interface SkuRow { code: string; name: string; unit: string; group: string; profile: string; grade: string; qty: number; value: number }
interface StockRow { code: string; whCode: string; whName: string; project: string; qty: number; value: number }
interface WhRow { code: string; name: string; project: string; kind: string }

function read() {
  if (!fs.existsSync(FILE)) throw new Error(`Không tìm thấy file: ${FILE}`)
  const wb = XLSX.readFile(FILE)
  const sku = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['DANH MỤC SKU'], { defval: null })
  const det = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['TỒN THEO DỰ ÁN-KHO'], { defval: null })
  const kho = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['KHO - DỰ ÁN'], { defval: null })

  const skus: SkuRow[] = []
  for (const r of sku) {
    const code = str(r['Mã SKU'])
    if (!code || code === 'TỔNG') continue
    const name = str(r['Tên vật tư'])
    const spec = parseSpec(name) // parse từ tên (mạnh hơn cột Excel), fallback về cột nếu rỗng
    skus.push({
      code, name, unit: str(r['ĐVT']) || 'cái',
      group: str(r['Nhóm (loại VT)']),
      profile: spec.profile || str(r['Profile / Quy cách']),
      grade: spec.grade || str(r['Mác VL']),
      qty: num(r['Tổng tồn']), value: num(r['Tổng giá trị (VND)']),
    })
  }
  const kindByCode = new Map<string, string>()
  for (const r of kho) {
    const code = str(r['Mã kho']); if (!code || code === 'TỔNG') continue
    kindByCode.set(code, kindOf(str(r['Loại kho']), str(r['Dự án'])))
  }
  const stocks: StockRow[] = []
  const whMap = new Map<string, WhRow>()
  for (const r of det) {
    const code = str(r['Mã SKU']); const whCode = str(r['Mã kho'])
    if (!code || code === 'TỔNG' || !whCode) continue
    const project = str(r['Dự án']); const whName = str(r['Tên kho'])
    stocks.push({ code, whCode, whName, project, qty: num(r['SL tồn']), value: num(r['Giá trị (VND)']) })
    if (!whMap.has(whCode)) whMap.set(whCode, { code: whCode, name: whName, project, kind: kindByCode.get(whCode) || (project ? 'PROJECT' : 'OTHER') })
  }
  return { skus, stocks, warehouses: [...whMap.values()] }
}

async function main() {
  const pool = new pg.Pool({ connectionString })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) })

  console.log(`\n📦 Import tồn kho theo SKU × dự án — ${APPLY ? '🔴 APPLY' : '🟢 DRY-RUN'}${RESET ? ' + RESET' : ''}`)
  console.log(`   File: ${FILE}`)
  if (!/localhost|127\.0\.0\.1/.test(connectionString)) {
    console.error('   ⛔ DATABASE_URL không phải localhost — DỪNG để an toàn.'); await pool.end(); return
  }

  const { skus, stocks, warehouses } = read()
  console.log(`   SKU: ${skus.length} | Kho: ${warehouses.length} | Dòng tồn (SKU×kho): ${stocks.length}`)
  console.log(`   Tổng giá trị tồn: ${stocks.reduce((s, x) => s + x.value, 0).toLocaleString('vi-VN')} đ`)
  console.log(`   SKU có profile: ${skus.filter((s) => s.profile).length} | có mác: ${skus.filter((s) => s.grade).length}`)

  if (!APPLY) { console.log('\n   ⓘ DRY-RUN — chạy lại với --apply để ghi DB.\n'); await pool.end(); return }

  if (RESET) {
    console.log('   🧹 RESET: xóa MaterialStock, Warehouse, alias, counter, Material cũ…')
    await prisma.materialStock.deleteMany({})
    await prisma.warehouse.deleteMany({})
    await prisma.materialCodeAlias.deleteMany({})
    await prisma.materialCodeCounter.deleteMany({})
    // Clear FK dependencies before deleting materials
    await prisma.purchaseRequestItem.deleteMany({})
    await prisma.purchaseOrderItem.deleteMany({})
    await prisma.bomItem.deleteMany({})
    await prisma.stockMovement.deleteMany({})
    await prisma.materialIssue.deleteMany({})
    await prisma.millCertificate.deleteMany({})
    await prisma.material.deleteMany({})
    console.log('   ✓ RESET hoàn tất')
  }

  // 1) Warehouses
  const whId = new Map<string, string>()
  for (const w of warehouses) {
    const rec = await prisma.warehouse.upsert({
      where: { code: w.code },
      update: { name: w.name, projectCode: w.project || null, kind: w.kind },
      create: { code: w.code, name: w.name, projectCode: w.project || null, kind: w.kind },
    })
    whId.set(w.code, rec.id)
  }
  console.log(`   ✓ Kho: ${whId.size}`)

  // 2) Materials (canonical = dotted code) + specs + total stock
  const matId = new Map<string, string>()
  let mCreated = 0, mUpdated = 0
  for (const s of skus) {
    const unitPrice = s.qty > 0 ? s.value / s.qty : undefined
    const data = {
      name: s.name, unit: s.unit, category: s.group || 'Khác',
      specification: s.profile || undefined, grade: s.grade || undefined,
      currentStock: s.qty, unitPrice, status: 'ACTIVE',
    }
    const existed = await prisma.material.findUnique({ where: { materialCode: s.code }, select: { id: true } })
    const rec = await prisma.material.upsert({
      where: { materialCode: s.code },
      update: data,
      create: { materialCode: s.code, ...data },
    })
    matId.set(s.code, rec.id)
    if (existed) mUpdated++; else mCreated++
  }
  console.log(`   ✓ SKU: tạo ${mCreated}, cập nhật ${mUpdated}`)

  // 3) MaterialStock per (material, warehouse)
  let sCount = 0, sSkip = 0
  for (const st of stocks) {
    const mId = matId.get(st.code); const wId = whId.get(st.whCode)
    if (!mId || !wId) { sSkip++; continue }
    await prisma.materialStock.upsert({
      where: { materialId_warehouseId: { materialId: mId, warehouseId: wId } },
      update: { quantity: st.qty, value: st.value },
      create: { materialId: mId, warehouseId: wId, quantity: st.qty, value: st.value },
    })
    sCount++
  }
  console.log(`   ✓ Tồn theo kho: ${sCount} dòng${sSkip ? ` (bỏ qua ${sSkip})` : ''}\n`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
