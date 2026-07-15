// CHỈ ĐỌC — xuất 178 dòng BOM của task "Lên báo giá" (26-WNC-I-111) để PM đối chiếu.
// Nghi mang mã I104-* (dự án khác). KHÔNG ghi DB, KHÔNG materialize.
// Chạy: DATABASE_URL=... npx tsx scripts/export-bom-i111-reconcile.ts
import { Client } from 'pg'
import * as XLSX from 'xlsx'
import path from 'path'

const OUT = path.join(process.cwd(), 'docs/handoff/out/BOM_I111_doi_chieu.xlsx')

function parseArr(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
const s = (v: unknown) => (v == null ? '' : String(v))
const prefix = (stt: string) => (stt.includes('-') ? stt.split('-')[0] : (stt || '(trống)'))

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Thiếu DATABASE_URL')
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const { rows } = await client.query(
    `select t.id, t.title, t.task_type, p.project_code, t.result_data
     from tasks t left join projects p on p.id = t.project_id
     where p.project_code = '26-WNC-I-111' and t.title = 'Lên báo giá' limit 1`
  )
  await client.end()
  if (rows.length === 0) throw new Error('Không tìm thấy task')

  const rd = rows[0].result_data as Record<string, unknown>
  const items = parseArr(rd.bomPrItems) // bản đã enrich: có needToBuyQty + materialId

  const tally: Record<string, number> = {}
  const aoa: (string | number)[][] = []
  aoa.push(['STT', 'Mã (stt)', 'Tên / mô tả', 'Tiết diện (profile)', 'Mác (grade)', 'ĐVT',
            'Số lượng', 'Cần mua (needToBuyQty)', 'Có materialId?', 'Tiền tố mã'])

  items.forEach((it, i) => {
    const stt = s(it.stt || it.code)
    const pfx = prefix(stt)
    tally[pfx] = (tally[pfx] || 0) + 1
    aoa.push([
      i + 1,
      stt,
      s(it.description || it.name),
      s(it.profile),
      s(it.grade),
      s(it.unit || it.uom),
      s(it.quantity),
      s(it.needToBuyQty),
      it.materialId ? 'Có' : 'Không',
      pfx,
    ])
  })

  // Dòng tổng theo tiền tố
  aoa.push([])
  aoa.push(['TỔNG THEO TIỀN TỐ MÃ'])
  for (const [pfx, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    aoa.push(['', pfx, `${n} dòng`])
  }
  aoa.push(['', 'TỔNG CỘNG', `${items.length} dòng`])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 34 }, { wch: 26 }, { wch: 10 }, { wch: 8 },
                 { wch: 11 }, { wch: 20 }, { wch: 14 }, { wch: 11 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BOM đối chiếu I-111')
  XLSX.writeFile(wb, OUT)

  console.log(`Task: ${rows[0].title} | ${rows[0].task_type} | ${rows[0].project_code}`)
  console.log(`Đã ghi: ${OUT}`)
  console.log(`Tổng dòng: ${items.length}`)
  for (const [pfx, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pfx}- : ${n} dòng`)
  }
}
main().catch(e => { console.error('LỖI:', e.message); process.exit(1) })
