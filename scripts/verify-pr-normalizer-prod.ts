// CHỈ ĐỌC — chạy pr-normalizer trên toàn bộ dữ liệu thật của prod để đối chiếu.
// Không ghi gì. Dùng để xác minh bước 1 trước khi làm bước 3 (materialize).
// Chạy: DATABASE_URL=... npx tsx scripts/verify-pr-normalizer-prod.ts
import { Client } from 'pg'
import { normalizePrLines, PR_RESULT_KEYS } from '../src/lib/pr-normalizer'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Thiếu DATABASE_URL')
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const keyFilter = PR_RESULT_KEYS.map(k => `result_data ? '${k}'`).join(' or ')
  const { rows } = await client.query(
    `select t.id, t.title, t.task_type, coalesce(p.project_code,'(khong DA)') as pc, t.result_data
     from tasks t left join projects p on p.id = t.project_id
     where ${keyFilter} order by p.project_code, t.title`
  )

  // Đếm tổng số item thô để biết normalizer loại bao nhiêu và vì sao
  let thoTong = 0
  for (const r of rows) {
    for (const k of PR_RESULT_KEYS) {
      const raw = r.result_data?.[k]
      if (raw == null) continue
      try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(arr)) thoTong += arr.length
      } catch { /* JSON hỏng — normalizer sẽ bỏ */ }
    }
  }

  let chuanTong = 0
  let taskCoPr = 0
  const noMaterial = { co: 0, khong: 0 }
  console.log('┌─ TASK CÓ NHU CẦU MUA ─────────────────────────────────────')
  for (const r of rows) {
    const lines = normalizePrLines(r.result_data)
    chuanTong += lines.length
    if (lines.length > 0) {
      taskCoPr++
      for (const l of lines) l.materialId ? noMaterial.co++ : noMaterial.khong++
      const tong = lines.reduce((s, l) => s + l.quantity, 0)
      console.log(
        `│ ${r.pc.padEnd(14)} ${String(r.title).slice(0, 38).padEnd(38)} ` +
        `${String(r.task_type).padEnd(5)} → ${String(lines.length).padStart(3)} dòng, Σqty=${tong.toFixed(1)}`
      )
    }
  }
  console.log('└───────────────────────────────────────────────────────────')
  console.log(`Task chứa key PR      : ${rows.length}`)
  console.log(`Task sinh ra dòng PR  : ${taskCoPr}`)
  console.log(`Item THÔ trong JSON   : ${thoTong}`)
  console.log(`Dòng PR CHUẨN HOÁ     : ${chuanTong}  (loại ${thoTong - chuanTong} dòng: qty<=0/đủ kho/không định danh)`)
  console.log(`  ├─ có materialId    : ${noMaterial.co}`)
  console.log(`  └─ materialId NULL  : ${noMaterial.khong}   ← buộc schema phải nullable`)

  const pr = await client.query('select count(*)::int n from purchase_requests')
  console.log(`\npurchase_requests hiện tại: ${pr.rows[0].n}  (phải = 0 — chưa materialize gì)`)
  await client.end()
}

main().catch(e => { console.error('LỖI:', e.message); process.exit(1) })
