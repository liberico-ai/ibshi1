/**
 * Bóc PROFILE (quy cách) + MÁC (grade) từ Material.name.
 * AN TOÀN PRODUCTION: chỉ điền ô trống, mặc định DRY-RUN.
 *   --apply                ghi DB (local)
 *   --apply --i-understand-production   ghi DB remote
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const connStr = process.env.DATABASE_URL
if (!connStr) { console.error('DATABASE_URL missing'); process.exit(1) }

const isRemote = !connStr.includes('@localhost') && !connStr.includes('@127.0.0.1')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pool = new pg.Pool({ connectionString: connStr, max: 5, ...(isRemote && { ssl: { rejectUnauthorized: false } }) })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })

const apply = process.argv.includes('--apply')
const prodAck = process.argv.includes('--i-understand-production')
if (apply && isRemote && !prodAck) {
  console.error('DB is remote. Add --i-understand-production to confirm.')
  process.exit(1)
}

// ── Nhóm cần mác ──
const NEED_GRADE = new Set([
  '1.1','1.2','1.3','1.4','1.5',
  '2.1','2.2','2.3',
  '3.1','3.2',
  '4.1','4.2',
  '5.1',
  '6.1','6.2','6.3','6.4',
])
function needGrade(grp: string): boolean {
  return NEED_GRADE.has(grp)
}

// ════════════════════════════════════════════════
//  GRADE EXTRACTION
// ════════════════════════════════════════════════

function extractGrade(name: string, grp: string): string {
  const n = name

  // ── A. Hàn (group 6.x hoặc name chứa que/dây/thuốc hàn) ──
  const isWeld = grp.startsWith('6') || /que hàn|dây hàn|thuốc hàn/i.test(n)
  if (isWeld) {
    let w = n
    w = w.replace(/\/\s*.*weld.*/i, '')          // cắt "/ ...Welding..."
    w = w.replace(/^(dây hàn lõi thuốc|dây hàn tự động|dây hàn|que hàn|thuốc hàn)\s*/i, '') // bỏ tiền tố
    w = w.replace(/\([^)]*\)/g, '')                // bỏ (...)
    w = w.replace(/\b\d+(?:[.,]\d+)?\s*mm\b/gi, '') // bỏ đường kính có mm
    w = w.replace(/\b[FfØøDd]\d+(?:[.,]\d+)?\b/g, '') // bỏ F3.2, D4 đứng riêng
    w = w.replace(/\s+/g, ' ').trim()
    if (w.length > 0 && w.length <= 26) return w.toUpperCase()
    return ''
  }

  // ── C. Cấp bền bu lông — CHỈ group bắt đầu "4" ──
  if (grp.startsWith('4')) {
    const bolt = n.match(/(?<![\d.])(?:4\.8|8\.8|10\.9|12\.9)(?![\d])/i)
    if (bolt) return bolt[0].toUpperCase()
  }

  // ── B. Mác thép/inox — thử lần lượt, lấy match đầu ──
  const steelPatterns: RegExp[] = [
    /mác\s+([0-9]+\.?[0-9]*|[A-Z][0-9A-Z.\-]+)/i,                // 1
    /\bSM\d{3}(?:YA|YB|[ABC])?\b/i,                                // 2
    /\bSS\d{3}\b/i,                                                 // 3
    /\bSTKR?\d{3}[A-C]?\b/i,                                       // 4a
    /\bSTKM\d{2}[A-C]?\b/i,                                        // 4b
    /\bSPH[CE]\b/i, /\bSPCC\b/i, /\bSAPH\d{3}\b/i,               // 5
    /\bS\d{3}(?:J2H|J2W|J2G3|J2|J0|JR|K2|NL|N|ML|M)?\b/i,       // 6
    /\bE\d{3}\b/i,                                                   // 7
    /\bQ\d{3}[A-E]?\b/i,                                            // 8
    /\bSA-?\d{2,3}(?:\s*GR\.?\s*[0-9A-Z]+)?\b/i,                  // 9
    /\bASTM\s*[AB]\d+\w*(?:\s*GR\.?\s*\w+)?\b/i,                  // 10a
    /\bSA479\s*GR\s*\w+\b/i,                                       // 10b
    /\bA(?:36|53|105|106|182|193|194|234|240|283|285|325|350|387|420|490|500|516|515|563|572|573|587|789)\b(?:\s*GR\.?\s*[0-9A-Z]+)?/i, // 11
    /\b1\.4\d{3}\b/,                                                // 12
    /\b(?:SUS|SUH)\d{3}[A-Z]?\b/i, /\bAISI\s?\d{3}\b/i, /\bTP\d{3}[A-Z]*\b/i, // 13
    /\bC276\b/i, /\bDUPLEX\b/i,                                    // 14
    /\b(?:304L|316L|321|310S|309|304|316|201|430|410)\b/,          // 15
    /\bINOX\b/i,                                                     // 16
  ]
  for (const re of steelPatterns) {
    const m = re.exec(n)
    if (m) {
      const raw = (m[1] || m[0]).replace(/\s+/g, ' ').trim()
      return raw.toUpperCase()
    }
  }

  // ── D. Bông bảo ôn (group 5.1) ──
  if (grp === '5.1') {
    const density = n.match(/(\d+)\s*kg\/m3/i)
    if (density) return `${density[1]}KG/M3`
  }

  return ''
}

// ════════════════════════════════════════════════
//  PROFILE (SPECIFICATION) EXTRACTION
// ════════════════════════════════════════════════

interface Candidate { text: string; score: number }

function extractProfile(name: string): string {
  const n = name.replace(/\s*[×*]\s*/g, 'x').replace(/\s*[xX]\s*/g, 'x')

  const RE_SECTION = /(?<![a-zA-ZÀ-ỹ\d])([UIHLC])\s?(\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)+)/gi
  const RE_METRIC  = /(?<![a-zA-ZÀ-ỹ\d])(M)\s?(\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)*)/gi
  const RE_DIA     = /(?<![a-zA-ZÀ-ỹ\d])([ØDФ])\s?(\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)*)/gi
  const RE_MULTI   = /(\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)+)/gi

  const candidates: Candidate[] = []

  function collect(re: RegExp, prefixBonus: boolean) {
    let m: RegExpExecArray | null
    while ((m = re.exec(n)) !== null) {
      const full = m[0].replace(/\s/g, '')
      const xCount = (full.match(/x/gi) || []).length
      const score = (prefixBonus ? 1 : 0) + xCount * 0.5 + full.length * 0.01
      candidates.push({ text: full, score })
    }
  }

  collect(RE_SECTION, true)
  collect(RE_METRIC, true)
  collect(RE_DIA, true)
  collect(RE_MULTI, false)

  if (candidates.length === 0) return ''
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].text.replace(/[×*]/g, 'x')
}

// ════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════

async function main() {
  const materials = await prisma.material.findMany({
    select: { id: true, materialCode: true, name: true, category: true, groupCode: true, specification: true, grade: true },
    orderBy: { materialCode: 'asc' },
  })

  console.log(`\nParse spec/grade from Material.name`)
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`Total materials: ${materials.length}\n`)

  let willGrade = 0, willSpec = 0, updatedGrade = 0, updatedSpec = 0
  const gradeByGroup = new Map<string, number>()
  const specByGroup = new Map<string, number>()
  const samples: string[] = []

  for (const m of materials) {
    const grp = m.groupCode || m.category
    const gradeEmpty = !m.grade || m.grade.trim() === ''
    const specEmpty = !m.specification || m.specification.trim() === ''

    let newGrade = ''
    let newSpec = ''

    if (gradeEmpty && needGrade(grp)) {
      newGrade = extractGrade(m.name, grp)
    }
    if (specEmpty) {
      newSpec = extractProfile(m.name)
    }

    if (!newGrade && !newSpec) continue

    if (newGrade) {
      willGrade++
      gradeByGroup.set(grp, (gradeByGroup.get(grp) || 0) + 1)
    }
    if (newSpec) {
      willSpec++
      specByGroup.set(grp, (specByGroup.get(grp) || 0) + 1)
    }

    if (samples.length < 15) {
      samples.push(`  ${m.materialCode} | ${m.name}\n    -> spec="${newSpec}" grade="${newGrade}"`)
    }

    if (apply) {
      const data: Record<string, string> = {}
      if (newGrade && gradeEmpty) { data.grade = newGrade; updatedGrade++ }
      if (newSpec && specEmpty) { data.specification = newSpec; updatedSpec++ }
      if (Object.keys(data).length > 0) {
        await prisma.material.update({ where: { id: m.id }, data })
      }
    }
  }

  console.log(`--- RESULT ---`)
  console.log(`Will fill grade: ${willGrade}`)
  console.log(`Will fill spec:  ${willSpec}`)

  console.log(`\nGrade by group:`)
  const gs = [...gradeByGroup.entries()].sort((a, b) => b[1] - a[1])
  for (const [g, c] of gs) console.log(`  ${g}: ${c}`)

  console.log(`\nSpec by group:`)
  const ss = [...specByGroup.entries()].sort((a, b) => b[1] - a[1])
  for (const [g, c] of ss) console.log(`  ${g}: ${c}`)

  console.log(`\nSamples (15):`)
  for (const s of samples) console.log(s)

  if (apply) {
    console.log(`\nAPPLIED: grade=${updatedGrade}, spec=${updatedSpec}`)
  } else {
    console.log(`\nDRY-RUN. Run with --apply to write DB.`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
