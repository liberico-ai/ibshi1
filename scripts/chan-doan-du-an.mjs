/**
 * Vì sao một tài khoản không thấy dự án nào ở màn "Dự án"?
 *
 * CÁCH DÙNG
 *   node scripts/chan-doan-du-an.mjs "Đặng Quang Hưng"
 *   node scripts/chan-doan-du-an.mjs 0967428899          (dùng số điện thoại / username)
 *
 *   Chỉ ĐỌC, không sửa gì. Script in host + tên database ở dòng đầu để biết đang soi CSDL nào.
 *
 * NÓ KIỂM GÌ
 *   Màn "Dự án" gọi /api/projects, và API đó lọc theo luật ở src/lib/auth.ts (getUserProjectIds):
 *   ai KHÔNG phải R01 (BGĐ) hoặc R10 (CNTT) thì chỉ thấy dự án thoả MỘT trong hai —
 *      (1) mình là PM: cột projects.pm_user_id, hoặc có dòng trong bảng project_pms
 *      (2) mình có VIỆC trong dự án: tự tạo, được giao đích danh, hoặc được giao theo ROLE
 *
 *   Script chạy lại ĐÚNG hai điều kiện đó nên kết quả khớp với thứ người dùng thật sự thấy.
 *
 *   Trước đó nó kiểm bảng `project_pms` có tồn tại không. Bảng thiếu (do CSDL chưa chạy hết
 *   migration) thì truy vấn của API VĂNG LỖI, API trả 500, mà màn Dự án nuốt lỗi im lặng nên
 *   hiện "0 dự án" y như khi thật sự không có dự án — hai chuyện khác hẳn nhau.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const tim = process.argv.slice(2).filter(a => !a.startsWith('-')).join(' ').trim()
if (!tim) {
  console.error('Thiếu tên hoặc username. Ví dụ: node scripts/chan-doan-du-an.mjs "Đặng Quang Hưng"')
  process.exit(1)
}
const url = process.env.DATABASE_URL
if (!url) { console.error('Thiếu DATABASE_URL trong .env'); process.exit(1) }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, ssl: { rejectUnauthorized: false } }) })
const u = new URL(url)
console.log(`CSDL: ${u.hostname} / ${u.pathname.slice(1)}`)
console.log('Chế độ: chỉ đọc, không đổi gì\n')

// ── 0. CSDL đã chạy hết migration chưa? ──
const bangCan = ['project_pms', 'apl_imports', 'packing_lists', 'meetings', 'equipment']
const coBang = {}
for (const b of bangCan) {
  // Dùng information_schema thay to_regclass: kiểu regclass Prisma không đọc được.
  const r = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='${b}'`)
  coBang[b] = Number(r[0].n) > 0
}
const thieu = bangCan.filter(b => !coBang[b])

console.log('── CSDL có đủ bảng chưa ──')
for (const b of bangCan) console.log(`   ${coBang[b] ? 'có   ' : 'THIẾU'}  ${b}`)

if (!coBang.project_pms) {
  console.log(`
KẾT LUẬN: bảng "project_pms" CHƯA TỒN TẠI.

  Màn Dự án gọi /api/projects → hàm getUserProjectIds truy vấn nối vào bảng này → văng lỗi
  → API trả 500 → màn hình nuốt lỗi và hiện "0 dự án".

  Đây KHÔNG phải lỗi phân quyền, cũng không phải dữ liệu dự án bị mất. Chạy cho xong
  migration là màn Dự án hiện lại bình thường:

      npx prisma migrate deploy && npx prisma generate && npm run build && restart

  ${thieu.length} bảng khác cũng đang thiếu (${thieu.join(', ')}) — nghĩa là nhiều màn khác
  cũng đang hỏng theo, không riêng màn Dự án. Xem docs/DEPLOY_CONG_DOAN_2026-09.md.`)
  await prisma.$disconnect()
  process.exit(0)
}

// ── 1. Tìm người dùng ──
const users = await prisma.user.findMany({
  where: { OR: [{ fullName: { contains: tim, mode: 'insensitive' } }, { username: tim }] },
  select: { id: true, username: true, fullName: true, roleCode: true, isActive: true },
})
if (users.length === 0) { console.log(`\nKhông tìm thấy người dùng nào khớp "${tim}"`); await prisma.$disconnect(); process.exit(0) }
if (users.length > 1) {
  console.log(`\nCó ${users.length} người khớp — chạy lại với username cho chính xác:`)
  for (const x of users) console.log(`   ${x.username}  ${x.fullName}  (${x.roleCode})`)
  await prisma.$disconnect(); process.exit(0)
}

const me = users[0]
console.log(`\n── Người dùng ──`)
console.log(`   ${me.fullName} · ${me.username} · vai trò ${me.roleCode} · ${me.isActive ? 'đang hoạt động' : 'ĐÃ KHOÁ'}`)

if (me.roleCode === 'R01' || me.roleCode === 'R10') {
  const tong = await prisma.project.count({ where: { status: { not: 'DELETED' } } })
  console.log(`\n   Vai trò này thấy TOÀN BỘ dự án, không lọc. Hệ đang có ${tong} dự án chưa xoá.`)
  console.log(`   Vẫn không thấy gì thì vấn đề nằm ở chỗ khác — xem log lỗi máy chủ.`)
  await prisma.$disconnect(); process.exit(0)
}

// ── 2. Điều kiện 1: là PM ──
const pmProjects = await prisma.project.findMany({
  where: { OR: [{ pmUserId: me.id }, { projectPms: { some: { userId: me.id } } }] },
  select: { id: true, projectCode: true, projectName: true, status: true, pmUserId: true },
  orderBy: { projectCode: 'asc' },
})
console.log(`\n── Điều kiện 1: là PM của dự án nào? ──  ${pmProjects.length} dự án`)
for (const p of pmProjects.slice(0, 15)) {
  console.log(`   ${p.projectCode.padEnd(18)} ${p.status.padEnd(12)} ${p.pmUserId === me.id ? '(đầu mối)' : '(trong bảng project_pms)'}`)
}
if (pmProjects.length > 15) console.log(`   … và ${pmProjects.length - 15} dự án nữa`)

// ── 3. Điều kiện 2: có việc trong dự án ──
const dyn = await prisma.task.findMany({
  where: {
    projectId: { not: null },
    OR: [{ createdBy: me.id }, { assignees: { some: { OR: [{ userId: me.id }, { role: me.roleCode }] } } }],
  },
  select: { projectId: true },
  distinct: ['projectId'],
})
const tongViec = await prisma.task.count({
  where: { OR: [{ createdBy: me.id }, { assignees: { some: { OR: [{ userId: me.id }, { role: me.roleCode }] } } }] },
})
const viecKhongDuAn = await prisma.task.count({
  where: {
    projectId: null,
    OR: [{ createdBy: me.id }, { assignees: { some: { OR: [{ userId: me.id }, { role: me.roleCode }] } } }],
  },
})
console.log(`\n── Điều kiện 2: có việc gắn dự án? ──  ${dyn.length} dự án`)
console.log(`   Tổng số việc của người này: ${tongViec}`)
console.log(`   Trong đó KHÔNG gắn dự án nào: ${viecKhongDuAn}`)

// ── 4. Kết quả cuối: đúng danh sách API sẽ trả ──
const ids = new Set([...pmProjects.map(p => p.id), ...dyn.map(t => t.projectId)])
const thay = await prisma.project.findMany({
  where: { id: { in: [...ids] }, status: { not: 'DELETED' } },
  select: { projectCode: true, projectName: true, status: true },
  orderBy: { projectCode: 'asc' },
})
const tongDuAn = await prisma.project.count({ where: { status: { not: 'DELETED' } } })

console.log(`\n── KẾT QUẢ ──`)
console.log(`   Người này THẤY ${thay.length} / ${tongDuAn} dự án của hệ`)
for (const p of thay.slice(0, 25)) console.log(`   ${p.projectCode.padEnd(18)} ${p.status.padEnd(12)} ${p.projectName.slice(0, 44)}`)
if (thay.length > 25) console.log(`   … và ${thay.length - 25} dự án nữa`)

if (thay.length === 0) {
  console.log(`
   Không thoả điều kiện nào nên danh sách rỗng. Cách xử lý:
     • Gán làm PM dự án (màn Dự án → chi tiết → thêm PM), HOẶC
     • Giao cho người này ít nhất một việc thuộc dự án đó`)
  if (tongViec > 0 && viecKhongDuAn === tongViec) {
    console.log(`
   Lưu ý: người này CÓ ${tongViec} việc nhưng không việc nào gắn dự án — nên việc thì hiện
   ở màn Công việc, còn màn Dự án vẫn rỗng.`)
  }
} else {
  console.log(`
   Nếu trên giao diện vẫn thấy 0 dự án trong khi ở đây ra ${thay.length}, thì lỗi không nằm ở
   phân quyền — xem log lỗi máy chủ lúc gọi /api/projects.
   (Danh sách có bộ nhớ đệm 60 giây; đợi 1 phút rồi tải lại trước khi kết luận.)`)
}

await prisma.$disconnect()
