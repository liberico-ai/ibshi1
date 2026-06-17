import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as XLSX from 'xlsx'
import * as path from 'path'
import * as fs from 'fs'

const FILE = path.resolve(process.cwd(), 'data/Danh mục mã VTHH.xlsx')
const SHEET = 'Vat_tu__hang_hoa__dich_vu'
const SYSTEM_USER = 'SYSTEM_CATALOG_IMPORT'
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ibs_erp_test'

if (/103\.141\.177\.194/.test(connectionString)) {
  console.error('❌ PRODUCTION DB detected — aborting!')
  process.exit(1)
}

const S = (v: unknown) => String(v ?? '').trim()
const N = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

const DOT_PATTERN = /^([A-Z]{2,5})\.([A-Z]{2,5})\.(\d{3})$/

interface RawRow {
  rawCode: string
  name: string
  groupCode: string
  unit: string
  currentStock: number
  specification: string | null
}

function readMaterials(): RawRow[] {
  if (!fs.existsSync(FILE)) throw new Error(`File not found: ${FILE}`)
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(', ')}`)
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true })

  const rows: RawRow[] = []
  for (let i = 2; i < data.length; i++) {
    const r = data[i] as unknown[]
    const rawCode = S(r[0])
    if (!rawCode) continue

    const name = S(r[1])
    const groupCode = S(r[3])
    const unit = S(r[7]) || 'cái'
    const currentStock = N(r[31])
    // Specification: combine AG (Đặc tính) + BD (Mã quy cách)
    const attr = S(r[32])
    const specCode = S(r[55])
    const specification = [attr, specCode].filter(Boolean).join(' | ') || null

    rows.push({ rawCode, name, groupCode, unit, currentStock, specification })
  }

  return rows
}

interface NormalizedRow extends RawRow {
  materialCode: string
  aliasCode: string | null // legacy dot code → alias if normalized to dash
}

function normalizeCode(raw: string): { materialCode: string; aliasCode: string | null } {
  const match = raw.match(DOT_PATTERN)
  if (match) {
    return {
      materialCode: `${match[1]}-${match[2]}-${match[3]}`,
      aliasCode: raw,
    }
  }
  return { materialCode: raw, aliasCode: null }
}

function normalizeAll(rows: RawRow[]): NormalizedRow[] {
  return rows.map(r => {
    const { materialCode, aliasCode } = normalizeCode(r.rawCode)
    return { ...r, materialCode, aliasCode }
  })
}

// Group by materialCode to detect duplicates
function dedup(rows: NormalizedRow[]): { primary: Map<string, NormalizedRow>; dupes: NormalizedRow[] } {
  const primary = new Map<string, NormalizedRow>()
  const dupes: NormalizedRow[] = []

  for (const r of rows) {
    if (primary.has(r.materialCode)) {
      dupes.push(r)
    } else {
      primary.set(r.materialCode, r)
    }
  }

  return { primary, dupes }
}

async function main() {
  const pool = new pg.Pool({ connectionString, max: 5 })
  const adapter = new PrismaPg(pool as any)
  const prisma = new PrismaClient({ adapter })

  try {
    const raw = readMaterials()
    console.log(`📦 Read ${raw.length} materials from file`)

    const normalized = normalizeAll(raw)
    const { primary, dupes } = dedup(normalized)
    console.log(`📋 Unique codes: ${primary.size}, duplicates: ${dupes.length}`)
    if (dupes.length > 0) {
      console.log(`   Duplicate codes: ${dupes.slice(0, 10).map(d => d.rawCode).join(', ')}${dupes.length > 10 ? '...' : ''}`)
    }

    // Find materials with FK references (cannot delete)
    const referencedIds = new Set<string>()
    const refTables = ['stockMovement', 'purchaseOrderItem', 'purchaseRequestItem', 'bomItem', 'materialIssue', 'millCertificate'] as const
    for (const table of refTables) {
      const refs = await (prisma[table] as any).findMany({ select: { materialId: true }, distinct: ['materialId'] })
      for (const r of refs) referencedIds.add(r.materialId)
    }
    console.log(`🔒 ${referencedIds.size} materials have FK references (will upsert, not delete)`)

    // Transaction: refresh materials
    let created = 0, upserted = 0, aliasCount = 0, counterCount = 0, skippedProv = 0

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Delete non-referenced, non-provisional materials (and their aliases/stocks)
      //    Cascade handles aliases + stocks (onDelete: Cascade)
      const existingMaterials = await tx.material.findMany({ select: { id: true, isProvisional: true } })
      const toDelete: string[] = []
      for (const m of existingMaterials) {
        if (m.isProvisional) { skippedProv++; continue }
        if (referencedIds.has(m.id)) continue
        toDelete.push(m.id)
      }

      if (toDelete.length > 0) {
        // Delete in batches to avoid parameter limit
        const BATCH = 500
        for (let i = 0; i < toDelete.length; i += BATCH) {
          const batch = toDelete.slice(i, i + BATCH)
          await tx.material.deleteMany({ where: { id: { in: batch } } })
        }
        console.log(`🗑️  Deleted ${toDelete.length} old materials (kept ${skippedProv} provisional, ${referencedIds.size} referenced)`)
      }

      // 2. Upsert each material from catalog
      for (const [code, row] of primary) {
        const existing = await tx.material.findUnique({ where: { materialCode: code }, select: { id: true } })
        if (existing) {
          await tx.material.update({
            where: { materialCode: code },
            data: {
              name: row.name,
              unit: row.unit,
              category: row.groupCode || 'OTHER',
              groupCode: row.groupCode || null,
              currentStock: row.currentStock,
              specification: row.specification,
              status: 'ACTIVE',
              isProvisional: false,
            },
          })
          upserted++
        } else {
          await tx.material.create({
            data: {
              materialCode: code,
              name: row.name,
              unit: row.unit,
              category: row.groupCode || 'OTHER',
              groupCode: row.groupCode || null,
              currentStock: row.currentStock,
              specification: row.specification,
              status: 'ACTIVE',
              isProvisional: false,
            },
          })
          created++
        }

        // 3. Create LEGACY_DOT alias if code was normalized
        if (row.aliasCode) {
          const mat = await tx.material.findUnique({ where: { materialCode: code }, select: { id: true } })
          if (mat) {
            const existingAlias = await tx.materialCodeAlias.findUnique({ where: { aliasCode: row.aliasCode } })
            if (!existingAlias) {
              await tx.materialCodeAlias.create({
                data: {
                  materialId: mat.id,
                  aliasCode: row.aliasCode,
                  source: 'LEGACY_DOT',
                  createdBy: SYSTEM_USER,
                },
              })
              aliasCount++
            }
          }
        }

        // Duplicate raw codes → alias to the primary
        for (const dup of dupes.filter(d => d.materialCode === code)) {
          if (dup.aliasCode && dup.aliasCode !== row.aliasCode) {
            const mat = await tx.material.findUnique({ where: { materialCode: code }, select: { id: true } })
            if (mat) {
              const existingAlias = await tx.materialCodeAlias.findUnique({ where: { aliasCode: dup.aliasCode } })
              if (!existingAlias) {
                await tx.materialCodeAlias.create({
                  data: {
                    materialId: mat.id,
                    aliasCode: dup.aliasCode,
                    source: 'LEGACY_DOT',
                    createdBy: SYSTEM_USER,
                  },
                })
                aliasCount++
              }
            }
          }
          if (dup.rawCode !== dup.materialCode && dup.rawCode !== row.rawCode) {
            const mat = await tx.material.findUnique({ where: { materialCode: code }, select: { id: true } })
            if (mat) {
              const existingAlias = await tx.materialCodeAlias.findUnique({ where: { aliasCode: dup.rawCode } })
              if (!existingAlias) {
                await tx.materialCodeAlias.create({
                  data: {
                    materialId: mat.id,
                    aliasCode: dup.rawCode,
                    source: 'LEGACY_DOT',
                    createdBy: SYSTEM_USER,
                  },
                })
                aliasCount++
              }
            }
          }
        }
      }

      // 4. Seed MaterialCodeCounter from canonical codes PREFIX-SUBGROUP-NNN
      const counterMap = new Map<string, number>()
      for (const code of primary.keys()) {
        const m = code.match(/^([A-Z]{2,5})-([A-Z]{2,5})-(\d{3})$/)
        if (m) {
          const key = `${m[1]}|${m[2]}`
          const seq = parseInt(m[3], 10)
          counterMap.set(key, Math.max(counterMap.get(key) || 0, seq))
        }
      }
      for (const [key, maxSeq] of counterMap) {
        const [prefix, subgroup] = key.split('|')
        await tx.materialCodeCounter.upsert({
          where: { prefix_subgroup: { prefix, subgroup } },
          create: { prefix, subgroup, lastSeq: maxSeq },
          update: { lastSeq: { set: maxSeq } },
        })
        counterCount++
      }
    }, { timeout: 120_000 })

    console.log(`\n✅ Import complete:`)
    console.log(`   Created: ${created}`)
    console.log(`   Updated: ${upserted}`)
    console.log(`   Aliases (LEGACY_DOT): ${aliasCount}`)
    console.log(`   Counters seeded: ${counterCount}`)
    console.log(`   Provisional kept: ${skippedProv}`)

    // Verify
    const totalMats = await prisma.material.count()
    const totalAliases = await prisma.materialCodeAlias.count()
    const totalCounters = await prisma.materialCodeCounter.count()
    console.log(`\n📊 DB totals: ${totalMats} materials, ${totalAliases} aliases, ${totalCounters} counters`)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
