import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { hashPassword } from '../src/lib/auth'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/ibs_erp?schema=public'

/**
 * Import 56 real users from IBSHI_Users_Roles.xlsx
 * Conflict resolutions applied per user confirmation:
 *   - STT 24,25: R02/R02a → R08/R08a (Kế toán)
 *   - STT 42: R05 → R04 (Phòng Kỹ Thuật)
 *   - STT 10,11: R11 → R03a (Phó KT-KH)
 *   - STT 44: R12 → R10 (Quản trị HT)
 *   - STT 31: R05 Quản lý → R05a Nhân viên
 */

interface UserRecord {
  username: string
  fullName: string
  roleCode: string
  userLevel: number // 1=manager, 2=staff
  deptCode: string
}

const USERS: UserRecord[] = [
  // ── Quản Lý Sản Xuất (SX) ──
  { username: 'toanpd',    fullName: 'Phạm Đăng Toàn',      roleCode: 'R06',  userLevel: 1, deptCode: 'SX' },
  { username: 'thangnc',   fullName: 'Nguyễn Công Thắng',    roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
  { username: 'hiennm',    fullName: 'Nguyễn Minh Hiển',     roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
  { username: 'tunt',      fullName: 'Nguyễn Tuấn Tú',       roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
  { username: 'toanph',    fullName: 'Phạm Hồng Toàn',       roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
  { username: 'hungtt',    fullName: 'Trần Thanh Hưng',       roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
  { username: 'kienlt',    fullName: 'Lê Trọng Kiên',        roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },

  // ── Phòng Kinh Tế Kế Hoạch (KTKH) ──
  { username: 'samld',     fullName: 'Lê Đình Sâm',          roleCode: 'R03',  userLevel: 1, deptCode: 'KTKH' },
  { username: 'thanhnv',   fullName: 'Nguyễn Văn Thanh',      roleCode: 'R03a', userLevel: 2, deptCode: 'KTKH' },
  { username: 'hungdm',    fullName: 'Đỗ Mạnh Hùng',         roleCode: 'R03a', userLevel: 2, deptCode: 'KTKH' }, // Fixed: R11 → R03a
  { username: 'ngoantt',   fullName: 'Trần Thị Ngoãn',       roleCode: 'R03a', userLevel: 2, deptCode: 'KTKH' }, // Fixed: R11 → R03a

  // ── Quản Lý Chất Lượng (QC) ──
  { username: 'haitq',     fullName: 'Trần Quang Hải',       roleCode: 'R09',  userLevel: 1, deptCode: 'QC' },
  { username: 'vietnh',    fullName: 'Nguyễn Hồng Việt',     roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'quynh',     fullName: 'Nguyễn Hoàng Quý',     roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'liendt',    fullName: 'Đỗ Thị Liên',          roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'vinhvq',    fullName: 'Vũ Quang Vinh',        roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'quynhdtx',  fullName: 'Đồng Thị Xuân Quỳnh',  roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'hungnd',    fullName: 'Nguyễn Duy Hùng',      roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'manhnd',    fullName: 'Nguyễn Duy Mạnh',      roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'dongnt',    fullName: 'Nguyễn Tiến Đông',     roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'tamnv',     fullName: 'Nguyễn Văn Tâm',       roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'thangnv',   fullName: 'Nguyễn Văn Thắng',     roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
  { username: 'anhnq',     fullName: 'Nguyễn Quang Anh',     roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },

  // ── Phòng Kế Toán (KT) — Fixed: R02/R02a → R08/R08a ──
  { username: 'doannd',    fullName: 'Nguyễn Đình Đoan',     roleCode: 'R08',  userLevel: 1, deptCode: 'KT' },
  { username: 'thuynth',   fullName: 'Nguyễn Thị Hương Thúy', roleCode: 'R08a', userLevel: 2, deptCode: 'KT' },

  // ── Ban Giám Đốc (BGD) ──
  { username: 'toandv',    fullName: 'Đoàn Văn Toàn',        roleCode: 'R01',  userLevel: 1, deptCode: 'BGD' },
  { username: 'banghn',    fullName: 'Hoàng Ngọc Bằng',      roleCode: 'R01',  userLevel: 1, deptCode: 'BGD' },
  { username: 'vinhnq',    fullName: 'Nguyễn Quang Vinh',    roleCode: 'R01',  userLevel: 1, deptCode: 'BGD' },
  { username: 'hatt',      fullName: 'Trịnh Thị Hà',         roleCode: 'R01',  userLevel: 1, deptCode: 'BGD' },

  // ── Phòng Kho Vật Tư (KHO) — Fixed: Bùi Thị Thương → R05a ──
  { username: 'luongnth',  fullName: 'Nguyễn Thị Hiền Lương', roleCode: 'R05',  userLevel: 1, deptCode: 'KHO' },
  { username: 'thuongbt',  fullName: 'Bùi Thị Thương',       roleCode: 'R05a', userLevel: 2, deptCode: 'KHO' }, // Fixed: R05 L1 → R05a L2

  // ── Phòng Thương Mại (TM) ──
  { username: 'hungth',    fullName: 'Trịnh Hữu Hưng',       roleCode: 'R07',  userLevel: 1, deptCode: 'TM' },
  { username: 'duccv',     fullName: 'Chu Văn Đức',           roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
  { username: 'khanhlt',   fullName: 'Lê Thị Khánh',         roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
  { username: 'phongdb',   fullName: 'Đinh Bá Phong',        roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
  { username: 'nganvt',    fullName: 'Vũ Thị Ngần',          roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },

  // ── Quản Lý Dự Án (QLDA) ──
  { username: 'giangdd',   fullName: 'Đinh Đức Giang',       roleCode: 'R02',  userLevel: 1, deptCode: 'QLDA' },
  { username: 'thunnb',    fullName: 'Nguyễn Bảo Thư',       roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
  { username: 'hungdq',    fullName: 'Đặng Quang Hưng',      roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
  { username: 'duongnq',   fullName: 'Nguyễn Quý Dương',     roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
  { username: 'anhtv',     fullName: 'Trần Việt Anh',        roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },

  // ── Phòng Kỹ Thuật → Thiết kế (TK) — Fixed: STT 42 R05 → R04 ──
  { username: 'nampq',     fullName: 'Phạm Quốc Nam',        roleCode: 'R04',  userLevel: 1, deptCode: 'TK' }, // Fixed: R05 → R04

  // ── Tổ Sản Xuất (SX) ──
  { username: 'trungdv',   fullName: 'Đặng Văn Trung',       roleCode: 'R06b', userLevel: 1, deptCode: 'SX' },

  // ── Quản Trị Hệ Thống — Fixed: R12 → R10 ──
  { username: 'toannd',    fullName: 'Nguyễn Đức Toàn',      roleCode: 'R10',  userLevel: 1, deptCode: 'BGD' }, // Fixed: R12 → R10

  // ── Phòng Thiết Kế (TK) ──
  { username: 'luudt',     fullName: 'Đỗ Trọng Lưu',        roleCode: 'R04',  userLevel: 1, deptCode: 'TK' },
  { username: 'tuanpm',    fullName: 'Phạm Minh Tuấn',       roleCode: 'R04a', userLevel: 1, deptCode: 'TK' },
  { username: 'longlh',    fullName: 'Lê Hồng Long',         roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'nguyennth', fullName: 'Ninh Thị Hồng Nguyệt', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'anhvp',     fullName: 'Vũ Phương Anh',        roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'uoclv',     fullName: 'Lê Văn Ước',           roleCode: 'R04',  userLevel: 1, deptCode: 'TK' },
  { username: 'thuantx',   fullName: 'Trần Xuân Thuận',      roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'nhungnt',   fullName: 'Nguyễn Thúy Nhung',    roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'quannv',    fullName: 'Nguyễn Văn Quân',      roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'hieutt',    fullName: 'Trần Trung Hiếu',      roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'huynq',     fullName: 'Nguyễn Quốc Huy',      roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
  { username: 'cuongld',   fullName: 'Lê Đình Cường',        roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
]

async function main() {
  const pool = new pg.Pool({ connectionString })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any)
  const prisma = new PrismaClient({ adapter })

  console.log('🔄 Importing 56 real users from IBSHI_Users_Roles.xlsx...\n')

  // 1. Ensure R10 role exists
  console.log('  → Ensuring R10 role exists...')
  await prisma.role.upsert({
    where: { code: 'R10' },
    update: { name: 'Quản trị Hệ thống', nameEn: 'System Admin' },
    create: { code: 'R10', name: 'Quản trị Hệ thống', nameEn: 'System Admin', permissions: [] },
  })

  // 2. Fetch departments
  const departments = await prisma.department.findMany()
  const deptMap = new Map(departments.map(d => [d.code, d.id]))
  console.log(`  → Found ${departments.length} departments: ${departments.map(d => d.code).join(', ')}`)

  // 3. Hash default password
  const defaultPassword = await hashPassword('ibshi2026')
  console.log('  → Default password: ibshi2026')

  // 4. Import users
  let created = 0
  let updated = 0
  let errors = 0

  for (const u of USERS) {
    try {
      const deptId = deptMap.get(u.deptCode)
      const result = await prisma.user.upsert({
        where: { username: u.username.toLowerCase() },
        update: {
          fullName: u.fullName,
          roleCode: u.roleCode,
          userLevel: u.userLevel,
          departmentId: deptId ?? undefined,
          isActive: true,
        },
        create: {
          username: u.username.toLowerCase(),
          fullName: u.fullName,
          passwordHash: defaultPassword,
          roleCode: u.roleCode,
          userLevel: u.userLevel,
          departmentId: deptId ?? undefined,
          isActive: true,
        },
      })

      // Check if this was a create or update
      const isNew = result.createdAt.getTime() > Date.now() - 5000
      if (isNew) {
        created++
        console.log(`  ✅ Created: ${u.username} — ${u.fullName} (${u.roleCode}, L${u.userLevel}, ${u.deptCode})`)
      } else {
        updated++
        console.log(`  🔄 Updated: ${u.username} — ${u.fullName} (${u.roleCode}, L${u.userLevel}, ${u.deptCode})`)
      }
    } catch (err) {
      errors++
      console.error(`  ❌ Error: ${u.username} — ${(err as Error).message}`)
    }
  }

  // 5. Summary
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`📊 Import Summary:`)
  console.log(`  Total:   ${USERS.length}`)
  console.log(`  Created: ${created}`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Errors:  ${errors}`)

  // 6. Verification — count by role
  console.log(`\n📋 Users by Role:`)
  const roleCounts = await prisma.user.groupBy({
    by: ['roleCode'],
    _count: { id: true },
    where: { isActive: true },
  })
  for (const rc of roleCounts.sort((a, b) => a.roleCode.localeCompare(b.roleCode))) {
    console.log(`  ${rc.roleCode}: ${rc._count.id} users`)
  }

  console.log(`\n✅ Import complete!`)
  await pool.end()
}

main().catch(console.error)
