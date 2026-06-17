import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as XLSX from 'xlsx'
import * as path from 'path'
import * as fs from 'fs'

const FILE = path.resolve(process.cwd(), 'data/Danh mục nhóm VTHH.xlsx')
const SHEET = 'Nhom_vat_tu__hang_hoa__dich_vu'
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ibs_erp_test'

if (/103\.141\.177\.194/.test(connectionString)) {
  console.error('❌ PRODUCTION DB detected — aborting!')
  process.exit(1)
}

const ROOT_CODES = new Set(['NVL', 'HH', 'CCDC', 'DV', 'OTO', 'TP', 'XEMAY'])

interface GroupRow {
  code: string
  name: string
  parentCode: string | null
  level: number
  inactive: boolean
}

function readGroups(): GroupRow[] {
  if (!fs.existsSync(FILE)) throw new Error(`File not found: ${FILE}`)
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(', ')}`)
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

  const rows: GroupRow[] = []
  for (let i = 2; i < data.length; i++) {
    const r = data[i] as unknown[]
    const rawCode = String(r[0] ?? '').trim()
    if (!rawCode || rawCode.startsWith('Số dòng')) break

    const code = rawCode
    const name = String(r[1] ?? '').trim()
    const inactiveRaw = String(r[2] ?? '').trim().toLowerCase()
    const inactive = inactiveRaw === 'true' || inactiveRaw === '1'

    let level: number
    let parentCode: string | null

    if (ROOT_CODES.has(code)) {
      level = 0
      parentCode = null
    } else if (/^VT\d{2}$/.test(code)) {
      level = 1
      parentCode = 'NVL'
    } else if (/^\d+\.\d+$/.test(code)) {
      level = 2
      const majorDigit = code.split('.')[0]
      parentCode = `VT0${majorDigit}`
    } else {
      level = 0
      parentCode = null
    }

    rows.push({ code, name, parentCode, level, inactive })
  }

  return rows
}

async function main() {
  const pool = new pg.Pool({ connectionString, max: 5 })
  const adapter = new PrismaPg(pool as any)
  const prisma = new PrismaClient({ adapter })

  try {
    const groups = readGroups()
    console.log(`📦 Read ${groups.length} groups from file`)

    let created = 0, updated = 0
    for (const g of groups) {
      const result = await prisma.materialGroup.upsert({
        where: { code: g.code },
        create: { code: g.code, name: g.name, parentCode: g.parentCode, level: g.level, inactive: g.inactive },
        update: { name: g.name, parentCode: g.parentCode, level: g.level, inactive: g.inactive },
      })
      if (result) updated++
    }
    created = groups.length

    console.log(`✅ Upserted ${created} material groups`)
    const byLevel = [0, 1, 2].map(l => groups.filter(g => g.level === l).length)
    console.log(`   Level 0 (root): ${byLevel[0]}, Level 1 (VTxx): ${byLevel[1]}, Level 2 (n.m): ${byLevel[2]}`)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
