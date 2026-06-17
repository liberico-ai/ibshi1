import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })

// Extract spec/grade from material name using regex patterns
function extractSpecGrade(name: string, code: string, category: string): { spec: string; grade: string } {
  let spec = ''
  let grade = ''
  const n = name.trim()

  // ── Thép (VLC) ──
  // "Thép tấm 1.5x1250x2500 SS400" → spec: "1.5x1250x2500", grade: "SS400"
  // "Thép hình H200x200x8x12-12000L SS400" → spec: "H200x200x8x12-12000L", grade: "SS400"
  // Grade: match full standard codes like "SA240 GR 304", "SA312 TP304L", "SS400", "A106 Gr.B"
  // Compound patterns first: SA516 GR70, SA240 GR 304, A106 GRB, A193-B8M, SA312 TP304L
  const compoundGrade = n.match(/\b((?:NV|DNV|LR|ABS|BV|GL|KR|NK|CCS)\s+\w+(?:\s+\w+)?|ASTM\s*A\d+\s*(?:GR\.?\s*\w+)?|SA-?516\s*GR\.?\s*\w+|SA-?240\s*GR\.?\s*\w+|SA-?312\s*TP\s*\w+|A106\s*GR\.?\s*\w+|A105\s*#?\d+|A193\s*[-]?\s*B\d+\w*|A194\s*[-]?\s*\w+)/i)
  if (compoundGrade) {
    grade = compoundGrade[1].replace(/\s+/g, ' ').trim().toUpperCase()
  } else {
    const fullGradeMatch = n.match(/(?:^|[\s(/-])(SA-?\d{3}\s*(?:GR\.?\s*\w+|TP\s*\w+)?|SS\d{3}|SUS\d{3}[A-Z]?|A\d{2,3}\s*(?:Gr\.?\s*\w+)?|ASTM\s*A\d+[A-Za-z0-9.\s]*|Hardox\s*\d*|SM\d{3}[A-Z]*|S[23]\d{2}[A-Z]*|Q[23]\d{2}[A-Z]?)/i)
    if (fullGradeMatch) grade = fullGradeMatch[1].trim()
  }

  // Dimension pattern: extract full profile dimensions from name
  // "Thép U100x50x5x7.5x12000" → "100x50x5x7.5x12000"
  // "C100X50X5X7.5-12000L" → "100X50X5X7.5-12000"
  // "PL10X2000X6000" → "10X2000X6000"
  // "M24x150" stays "M24x150" (M = metric bolt prefix)
  // Strategy: find the longest chain of numbers connected by x/X/×/*/-/spaces around x
  // "3 x 610 x 20000mm" → "3x610x20000"
  // "C100X50X5X7.5-12000L" → "100X50X5X7.5-12000"
  // First normalize: replace " x " / " X " with "x"
  const normalized = n.replace(/\s*[xX×]\s*/g, 'x').replace(/\s*\*\s*/g, '*')
  const dimMatch = normalized.match(/(?<![A-Za-z])([A-Z]{0,3})(\d+\.?\d*(?:[x*-]\d+\.?\d*){1,})/i)
  if (dimMatch && dimMatch[2] && dimMatch[2].length >= 3) {
    const prefix2 = (dimMatch[1] || '').toUpperCase()
    const keepPrefix = ['M', 'DN'].includes(prefix2) || prefix2 === ''
    spec = ((keepPrefix ? prefix2 : '') + dimMatch[2].trim()).replace(/\*/g, 'x')
  }

  // ── Bu lông (BL) ──
  // "Bu lông M20x80 10.9" → spec: "M20x80", grade: "10.9"
  // "Bu lông inox 304 M16x150 - DIN 933" → spec: "M16x150", grade: "Inox 304 DIN 933"
  const boltSpec = n.match(/M\d+[xX×]\d+/i)
  if (boltSpec && !spec) spec = boltSpec[0]
  
  // Bolt strength grade: only "8.8", "10.9", "12.9" — not pipe dimensions like "9.53"
  const boltGrade = n.match(/\b(4\.6|4\.8|5\.6|5\.8|6\.8|8\.8|10\.9|12\.9)\b/)
  if (boltGrade && !grade) grade = boltGrade[1]
  
  const dinMatch = n.match(/DIN\s*\d+/i)
  if (dinMatch && !grade) grade = dinMatch[0]
  
  const isoMatch = n.match(/ISO\s*\d+/i)
  if (isoMatch && !grade) grade = isoMatch[0]

  // "inox 304", "inox 316"
  const inoxMatch = n.match(/inox\s*(\d{3})/i)
  if (inoxMatch) {
    if (!grade) grade = `Inox ${inoxMatch[1]}`
    else if (!grade.toLowerCase().includes('inox')) grade = `Inox ${inoxMatch[1]} ${grade}`
  }

  // ── Ê cu (BL) ──
  // "Ê cu M16 cấp bền 10" → spec: "M16", grade: "cấp 10"
  const nutSpec = n.match(/[MmØø]\d+(?:\.\d+)?/)
  if (nutSpec && !spec) spec = nutSpec[0]
  
  const capBen = n.match(/cấp\s*(?:bền\s*)?(\d+)/i)
  if (capBen && !grade) grade = `Cấp ${capBen[1]}`

  // ── Que hàn (VLH) ──
  // "Que hàn E7018 ø3.2" → spec: "ø3.2", grade: "E7018"
  // "Que hàn TG-S50 1.2mm" → spec: "1.2mm", grade: "TG-S50"
  const isWelding = category === 'VLH' || category === 'welding' || n.match(/que hàn|dây hàn|thuốc hàn/i)
  const weldGrade = n.match(/[ET][A-Z]?[-]?[A-Z]?\d{3,5}[A-Z]?\d*/i)
  if (weldGrade && !grade && isWelding) grade = weldGrade[0]

  // ø diameter — only for welding consumables, not general materials
  if (isWelding && !spec) {
    const weldDia = n.match(/[øØ]\s?\d+\.?\d*/i)
    if (weldDia) spec = weldDia[0].replace(/\s/, '')
    else {
      const mmMatch = n.match(/(\d+\.?\d*)\s*mm\b/i)
      if (mmMatch && Number(mmMatch[1]) < 20) spec = `ø${mmMatch[1]}`
    }
  }

  // ── Sơn (VTS) ──  
  // "Sơn epoxy Jotun Jotamastic 87" → spec: "Jotamastic 87", grade: "Epoxy"
  const paintTypes = ['Epoxy', 'PU', 'Polyurethane', 'Alkyd', 'Zinc', 'Primer', 'Penguard', 'Jotamastic', 'Hardtop', 'Intergard', 'Interzone']
  for (const pt of paintTypes) {
    if (n.toLowerCase().includes(pt.toLowerCase())) {
      const ptMatch = n.match(new RegExp(`${pt}[\\s-]?\\d*[\\w]*`, 'i'))
      if (ptMatch) { if (!spec) spec = ptMatch[0]; break }
    }
  }

  // ── Ống (VLC, VLP) ──
  // "Ống thép DN100 SCH40" → spec: "DN100 SCH40"
  const pipeMatch = n.match(/DN\d+\s*(?:SCH\s?\d+)?/i)
  if (pipeMatch && !spec) spec = pipeMatch[0]
  
  // "ASTM A106" etc
  const astmMatch = n.match(/ASTM\s*A\d+/i)
  if (astmMatch && !grade) grade = astmMatch[0]
  
  // "API 6D", "API 5L"
  const apiMatch = n.match(/API\s*\d+[A-Z]?/i)
  if (apiMatch && !grade) grade = apiMatch[0]

  // "AWS A5.1"
  const awsMatch = n.match(/AWS\s*A\d+\.\d+/i)
  if (awsMatch && !grade) grade = awsMatch[0]

  // ── Đĩa cắt, đá mài (COC) ──
  // "Đĩa cắt 350x3x25.4" → spec: "350x3x25.4"
  // Already caught by dimension pattern above

  return { spec: spec.trim(), grade: grade.trim() }
}

async function main() {
  const dryRun = !process.argv.includes('--apply')
  
  const materials = await prisma.material.findMany({
    where: { OR: [{ specification: null }, { specification: '' }] },
    select: { id: true, materialCode: true, name: true, category: true, specification: true, grade: true },
  })

  console.log(`\n📋 Extract Spec/Grade từ tên vật tư`)
  console.log(`   Mode: ${dryRun ? '🟢 DRY-RUN' : '🔴 APPLY'}`)
  console.log(`   Vật tư thiếu spec: ${materials.length}\n`)

  let extracted = 0, skipped = 0, updated = 0
  const samples: string[] = []

  for (const m of materials) {
    const { spec, grade } = extractSpecGrade(m.name, m.materialCode, m.category)
    
    if (!spec && !grade) { skipped++; continue }
    extracted++

    if (samples.length < 20) {
      samples.push(`${m.materialCode} | ${m.name} → spec: "${spec}" | grade: "${grade}"`)
    }

    if (!dryRun) {
      const data: Record<string, string> = {}
      if (spec) data.specification = spec
      if (grade && (!m.grade || m.grade === '')) data.grade = grade
      await prisma.material.update({ where: { id: m.id }, data })
      updated++
    }
  }

  console.log(`   ── KẾT QUẢ ──`)
  console.log(`   Extracted (có spec/grade): ${extracted}`)
  console.log(`   Skipped (không extract được): ${skipped}`)
  if (!dryRun) console.log(`   Updated in DB: ${updated}`)
  console.log(`\n   ── MẪU ──`)
  samples.forEach(s => console.log(`   ${s}`))
  
  if (dryRun) console.log(`\n   ⓘ DRY-RUN. Chạy lại với --apply để ghi DB.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
