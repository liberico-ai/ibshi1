import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { hashPassword } from '../src/lib/auth'
import { DEPARTMENTS, ROLES } from '../src/lib/constants'
import { WORKFLOW_RULES } from '../src/lib/workflow-engine'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/ibs_erp?schema=public'

async function main() {
  const pool = new pg.Pool({ connectionString })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @types/pg version mismatch
  const adapter = new PrismaPg(pool as any)
  const prisma = new PrismaClient({ adapter })

  console.log('🌱 Seeding database...')

  // ── Seed Roles ──
  console.log('  → Roles...')
  for (const r of Object.values(ROLES)) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, nameEn: r.nameEn },
      create: { code: r.code, name: r.name, nameEn: r.nameEn, permissions: [] },
    })
  }

  // ── Seed Departments ──
  console.log('  → Departments...')
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name, nameEn: d.nameEn },
      create: { code: d.code, name: d.name, nameEn: d.nameEn },
    })
  }

  // ── Seed Users (55 real users from IBSHI export) ──
  console.log('  → Users (55 real users)...')
  const deptMap = new Map<string, string>()
  for (const d of DEPARTMENTS) {
    const dept = await prisma.department.findUnique({ where: { code: d.code } })
    if (dept) deptMap.set(d.code, dept.id)
  }

  const defaultPassword = await hashPassword('123456')

  // Source: IBSHI_Users_Roles_Export.xls (56 users, tuanpm excluded due to data inconsistency)
  const realUsers: { username: string; fullName: string; roleCode: string; userLevel: number; deptCode: string }[] = [
    { username: 'toanpd', fullName: 'Phạm Đăng Toàn', roleCode: 'R06', userLevel: 1, deptCode: 'SX' },
    { username: 'thangnc', fullName: 'Nguyễn Công Thắng', roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
    { username: 'hiennm', fullName: 'Nguyễn Minh Hiển', roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
    { username: 'tunt', fullName: 'Nguyễn Tuấn Tú', roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
    { username: 'toanph', fullName: 'Phạm Hồng Toàn', roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
    { username: 'hungtt', fullName: 'Trần Thanh Hưng', roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
    { username: 'kienlt', fullName: 'Lê Trọng Kiên', roleCode: 'R06a', userLevel: 2, deptCode: 'SX' },
    { username: 'trungdv', fullName: 'Đặng Văn Trung', roleCode: 'R06b', userLevel: 1, deptCode: 'SX' },
    { username: 'samld', fullName: 'Lê Đình Sâm', roleCode: 'R03', userLevel: 1, deptCode: 'KTKH' },
    { username: 'thanhnv', fullName: 'Nguyễn Văn Thanh', roleCode: 'R03a', userLevel: 2, deptCode: 'KTKH' },
    { username: 'hungdm', fullName: 'Đỗ Mạnh Hùng', roleCode: 'R03a', userLevel: 2, deptCode: 'KTKH' },
    { username: 'ngoantt', fullName: 'Trần Thị Ngoãn', roleCode: 'R03a', userLevel: 2, deptCode: 'KTKH' },
    { username: 'haitq', fullName: 'Trần Quang Hải', roleCode: 'R09', userLevel: 1, deptCode: 'QC' },
    { username: 'vietnh', fullName: 'Nguyễn Hồng Việt', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'quynh', fullName: 'Nguyễn Hoàng Quý', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'liendt', fullName: 'Đỗ Thị Liên', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'vinhvq', fullName: 'Vũ Quang Vinh', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'quynhdtx', fullName: 'Đồng Thị Xuân Quỳnh', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'hungnd', fullName: 'Nguyễn Duy Hùng', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'manhnd', fullName: 'Nguyễn Duy Mạnh', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'dongnt', fullName: 'Nguyễn Tiến Đông', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'tamnv', fullName: 'Nguyễn Văn Tâm', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'thangnv', fullName: 'Nguyễn Văn Thắng', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'anhnq', fullName: 'Nguyễn Quang Anh', roleCode: 'R09a', userLevel: 2, deptCode: 'QC' },
    { username: 'doannd', fullName: 'Nguyễn Đình Đoan', roleCode: 'R08', userLevel: 1, deptCode: 'KT' },
    { username: 'thuynth', fullName: 'Nguyễn Thị Hương Thúy', roleCode: 'R08a', userLevel: 2, deptCode: 'KT' },
    { username: 'toandv', fullName: 'Đoàn Văn Toàn', roleCode: 'R01', userLevel: 1, deptCode: 'BGD' },
    { username: 'banghn', fullName: 'Hoàng Ngọc Bằng', roleCode: 'R01', userLevel: 1, deptCode: 'BGD' },
    { username: 'vinhnq', fullName: 'Nguyễn Quang Vinh', roleCode: 'R01', userLevel: 1, deptCode: 'BGD' },
    { username: 'hatt', fullName: 'Trịnh Thị Hà', roleCode: 'R01', userLevel: 1, deptCode: 'BGD' },
    { username: 'luongnth', fullName: 'Nguyễn Thị Hiền Lương', roleCode: 'R05', userLevel: 1, deptCode: 'KHO' },
    { username: 'thuongbt', fullName: 'Bùi Thị Thương', roleCode: 'R05a', userLevel: 2, deptCode: 'KHO' },
    { username: 'hungth', fullName: 'Trịnh Hữu Hưng', roleCode: 'R07', userLevel: 1, deptCode: 'TM' },
    { username: 'duccv', fullName: 'Chu Văn Đức', roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
    { username: 'khanhlt', fullName: 'Lê Thị Khánh', roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
    { username: 'phongdb', fullName: 'Đinh Bá Phong', roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
    { username: 'nganvt', fullName: 'Vũ Thị Ngần', roleCode: 'R07a', userLevel: 2, deptCode: 'TM' },
    { username: 'giangdd', fullName: 'Đinh Đức Giang', roleCode: 'R02', userLevel: 1, deptCode: 'QLDA' },
    { username: 'thunnb', fullName: 'Nguyễn Bảo Thư', roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
    { username: 'hungdq', fullName: 'Đặng Quang Hưng', roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
    { username: 'duongnq', fullName: 'Nguyễn Quý Dương', roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
    { username: 'anhtv', fullName: 'Trần Việt Anh', roleCode: 'R02a', userLevel: 2, deptCode: 'QLDA' },
    { username: 'luudt', fullName: 'Đỗ Trọng Lưu', roleCode: 'R04', userLevel: 1, deptCode: 'TK' },
    { username: 'nampq', fullName: 'Phạm Quốc Nam', roleCode: 'R04', userLevel: 1, deptCode: 'TK' },
    { username: 'longlh', fullName: 'Lê Hồng Long', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'nguyennth', fullName: 'Ninh Thị Hồng Nguyệt', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'anhvp', fullName: 'Vũ Phương Anh', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'uoclv', fullName: 'Lê Văn Ước', roleCode: 'R04', userLevel: 1, deptCode: 'TK' },
    { username: 'thuantx', fullName: 'Trần Xuân Thuận', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'nhungnt', fullName: 'Nguyễn Thúy Nhung', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'quannv', fullName: 'Nguyễn Văn Quân', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'hieutt', fullName: 'Trần Trung Hiếu', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'huynq', fullName: 'Nguyễn Quốc Huy', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'cuongld', fullName: 'Lê Đình Cường', roleCode: 'R04a', userLevel: 2, deptCode: 'TK' },
    { username: 'toannd', fullName: 'Nguyễn Đức Toàn', roleCode: 'R10', userLevel: 1, deptCode: 'BGD' },
  ]

  for (const u of realUsers) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { fullName: u.fullName, roleCode: u.roleCode, userLevel: u.userLevel, departmentId: deptMap.get(u.deptCode) },
      create: {
        username: u.username,
        fullName: u.fullName,
        passwordHash: defaultPassword,
        roleCode: u.roleCode,
        userLevel: u.userLevel,
        departmentId: deptMap.get(u.deptCode),
      },
    })
  }
  console.log(`    ✓ ${realUsers.length} users upserted`)

  // ── Seed Demo Project ──
  console.log('  → Demo project...')
  const pm = await prisma.user.findUnique({ where: { username: 'giangdd' } })

  const project = await prisma.project.upsert({
    where: { projectCode: 'DA-26-001' },
    update: {},
    create: {
      projectCode: 'DA-26-001',
      projectName: 'Pressure Vessel - Siemens PV-2026',
      clientName: 'Siemens Energy',
      productType: 'pressure_vessel',
      contractValue: 15000000000,
      currency: 'VND',
      status: 'ACTIVE',
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-09-30'),
      pmUserId: pm?.id,
      description: 'Chế tạo 2 bình chịu áp cho nhà máy điện Siemens',
    },
  })

  const existingTasks = await prisma.workflowTask.count({ where: { projectId: project.id } })
  if (existingTasks === 0) {
    console.log('  → Workflow tasks for DA-26-001...')
    const steps = Object.values(WORKFLOW_RULES)
    for (const step of steps) {
      await prisma.workflowTask.create({
        data: {
          projectId: project.id,
          stepCode: step.code,
          stepName: step.name,
          stepNameEn: step.nameEn,
          assignedRole: step.role,
          status: step.code === 'P1.1' ? 'IN_PROGRESS' : 'PENDING',
          startedAt: step.code === 'P1.1' ? new Date() : null,
          deadline: step.deadlineDays
            ? new Date(Date.now() + step.deadlineDays * 24 * 60 * 60 * 1000)
            : null,
        },
      })
    }
  }

  // ── Seed second project ──
  const project2 = await prisma.project.upsert({
    where: { projectCode: 'DA-26-002' },
    update: {},
    create: {
      projectCode: 'DA-26-002',
      projectName: 'HRSG Module - Hyundai HE-2026',
      clientName: 'Hyundai Engineering',
      productType: 'hrsg_fgd',
      contractValue: 25000000000,
      currency: 'USD',
      status: 'ACTIVE',
      startDate: new Date('2026-02-15'),
      endDate: new Date('2026-12-31'),
      pmUserId: pm?.id,
      description: 'Chế tạo HRSG module cho nhà máy nhiệt điện Hyundai',
    },
  })

  const existingTasks2 = await prisma.workflowTask.count({ where: { projectId: project2.id } })
  if (existingTasks2 === 0) {
    console.log('  → Workflow tasks for DA-26-002...')
    const steps = Object.values(WORKFLOW_RULES)
    for (const step of steps) {
      let status = 'PENDING'
      let startedAt: Date | null = null
      let completedAt: Date | null = null
      const phaseOneSteps = ['P1.1', 'P1.2', 'P1.3A', 'P1.3B', 'P1.4']
      if (phaseOneSteps.includes(step.code)) {
        status = 'DONE'
        startedAt = new Date('2026-02-15')
        completedAt = new Date('2026-03-01')
      } else if (step.code === 'P2.1') {
        status = 'IN_PROGRESS'
        startedAt = new Date('2026-03-01')
      }

      await prisma.workflowTask.create({
        data: {
          projectId: project2.id,
          stepCode: step.code,
          stepName: step.name,
          stepNameEn: step.nameEn,
          assignedRole: step.role,
          status,
          startedAt,
          completedAt,
          deadline: step.deadlineDays && status !== 'DONE'
            ? new Date(Date.now() + step.deadlineDays * 24 * 60 * 60 * 1000)
            : null,
        },
      })
    }
  }

  // ── Seed Workshops ──
  console.log('  → Workshops...')
  const workshops = [
    { code: 'WS1', name: 'Xưởng 1 - Gia công', nameEn: 'Workshop 1 - Fabrication', capacity: 100 },
    { code: 'WS2', name: 'Xưởng 2 - Lắp ráp', nameEn: 'Workshop 2 - Assembly', capacity: 80 },
    { code: 'WS3', name: 'Xưởng 3 - Hàn', nameEn: 'Workshop 3 - Welding', capacity: 90 },
    { code: 'WS4', name: 'Xưởng 4 - Cơ khí', nameEn: 'Workshop 4 - Machining', capacity: 70 },
    { code: 'DRY_DOCK', name: 'Ụ khô', nameEn: 'Dry Dock', capacity: 50 },
    { code: 'PAINTING', name: 'Xưởng Sơn', nameEn: 'Painting Workshop', capacity: 60 },
  ]
  for (const ws of workshops) {
    await prisma.workshop.upsert({
      where: { code: ws.code },
      update: { name: ws.name, nameEn: ws.nameEn },
      create: ws,
    })
  }

  // ── Seed Vendors ──
  console.log('  → Vendors...')
  const vendors = [
    { vendorCode: 'NCC-001', name: 'POSCO Vietnam', category: 'steel_supplier', country: 'KR', contactName: 'Kim Sung Ho', email: 'kim@posco-vn.com' },
    { vendorCode: 'NCC-002', name: 'Thép Hòa Phát', category: 'steel_supplier', country: 'VN', contactName: 'Nguyễn Minh', email: 'minh@hoaphat.com' },
    { vendorCode: 'NCC-003', name: 'Valve Tech Asia', category: 'equipment', country: 'SG', contactName: 'David Lee', email: 'david@valvetech.sg' },
  ]
  for (const v of vendors) {
    await prisma.vendor.upsert({
      where: { vendorCode: v.vendorCode },
      update: {},
      create: v,
    })
  }

  // ── Seed Materials ──
  console.log('  → Materials...')
  const materials = [
    { materialCode: 'STL-001', name: 'Thép tấm SA-516 Gr.70', nameEn: 'Steel Plate SA-516 Gr.70', unit: 'kg', category: 'steel', specification: 'SA-516', grade: 'Gr.70', minStock: 5000, currentStock: 12000 },
    { materialCode: 'STL-002', name: 'Thép tấm A106 Gr.B', nameEn: 'Steel Pipe A106 Gr.B', unit: 'kg', category: 'steel', specification: 'A106', grade: 'Gr.B', minStock: 3000, currentStock: 8000 },
    { materialCode: 'PIP-001', name: 'Ống thép DN100 SCH40', nameEn: 'Steel Pipe DN100 SCH40', unit: 'm', category: 'pipe', specification: 'ASTM A106', grade: 'Gr.B', minStock: 200, currentStock: 500 },
    { materialCode: 'VLV-001', name: 'Van bi DN50 PN40', nameEn: 'Ball Valve DN50 PN40', unit: 'cái', category: 'valve', specification: 'API 6D', grade: '', minStock: 10, currentStock: 25 },
    { materialCode: 'BLT-001', name: 'Bu lông M20x80 10.9', nameEn: 'Bolt M20x80 10.9', unit: 'cái', category: 'bolt', specification: 'DIN 931', grade: '10.9', minStock: 500, currentStock: 2000 },
    { materialCode: 'WLD-001', name: 'Que hàn E7018 ø3.2', nameEn: 'Welding Rod E7018 ø3.2', unit: 'kg', category: 'welding', specification: 'AWS A5.1', grade: 'E7018', minStock: 200, currentStock: 600 },
    { materialCode: 'PNT-001', name: 'Sơn epoxy Jotun', nameEn: 'Jotun Epoxy Paint', unit: 'lít', category: 'paint', specification: 'Jotamastic 87', grade: '', minStock: 100, currentStock: 300 },
    { materialCode: 'STL-003', name: 'Thép hình H200x200', nameEn: 'H-Beam 200x200', unit: 'kg', category: 'steel', specification: 'JIS G3101', grade: 'SS400', minStock: 2000, currentStock: 5000 },
  ]
  for (const m of materials) {
    await prisma.material.upsert({
      where: { materialCode: m.materialCode },
      update: {},
      create: { ...m, minStock: m.minStock, currentStock: m.currentStock, reservedStock: 0 },
    })
  }

  // ── Seed Work Orders ──
  console.log('  → Work Orders...')
  const ws1 = await prisma.workshop.findUnique({ where: { code: 'WS1' } })
  const ws3 = await prisma.workshop.findUnique({ where: { code: 'WS3' } })
  const painting = await prisma.workshop.findUnique({ where: { code: 'PAINTING' } })
  const sxUser = await prisma.user.findUnique({ where: { username: 'toanpd' } })

  const workOrders = [
    { woCode: 'WO-26-001', projectId: project.id, workshopId: ws1?.id, description: 'Cắt thép tấm SA-516 cho shell section', woType: 'INTERNAL', teamCode: 'TO-01', status: 'IN_PROGRESS', plannedStart: new Date('2026-03-15'), plannedEnd: new Date('2026-04-15'), actualStart: new Date('2026-03-16') },
    { woCode: 'WO-26-002', projectId: project.id, workshopId: ws3?.id, description: 'Hàn giáp mối shell course 1-2', woType: 'INTERNAL', teamCode: 'TO-03', status: 'PENDING_MATERIAL', plannedStart: new Date('2026-04-01'), plannedEnd: new Date('2026-05-01') },
    { woCode: 'WO-26-003', projectId: project2.id, workshopId: ws1?.id, description: 'Gia công header HRSG module A', woType: 'INTERNAL', teamCode: 'TO-02', status: 'IN_PROGRESS', plannedStart: new Date('2026-03-10'), plannedEnd: new Date('2026-04-20'), actualStart: new Date('2026-03-12') },
    { woCode: 'WO-26-004', projectId: project2.id, workshopId: painting?.id, description: 'Sơn lót + sơn phủ module B', woType: 'SUBCONTRACT', teamCode: 'TO-05', status: 'OPEN', plannedStart: new Date('2026-05-01'), plannedEnd: new Date('2026-05-20') },
  ]
  for (const wo of workOrders) {
    await prisma.workOrder.upsert({
      where: { woCode: wo.woCode },
      update: {},
      create: { ...wo, createdBy: sxUser?.id || '' },
    })
  }

  // ── Seed Job Cards ──
  console.log('  → Job Cards...')
  const wo1 = await prisma.workOrder.findUnique({ where: { woCode: 'WO-26-001' } })
  const wo3 = await prisma.workOrder.findUnique({ where: { woCode: 'WO-26-003' } })
  const worker = await prisma.user.findUnique({ where: { username: 'trungdv' } })

  if (wo1 && worker) {
    const jobCards = [
      { jobCode: 'JC-26-001', workOrderId: wo1.id, teamCode: 'TO-01', workType: 'cutting', description: 'Cắt shell plate 20mm x 3000mm', plannedQty: 500, actualQty: 320, unit: 'kg', workDate: new Date('2026-03-18'), manpower: 4, status: 'COMPLETED', reportedBy: worker.id },
      { jobCode: 'JC-26-002', workOrderId: wo1.id, teamCode: 'TO-01', workType: 'cutting', description: 'Cắt nozzle reinforcement pad', plannedQty: 200, actualQty: 150, unit: 'kg', workDate: new Date('2026-03-19'), manpower: 3, status: 'IN_PROGRESS', reportedBy: worker.id },
    ]
    for (const jc of jobCards) {
      await prisma.jobCard.upsert({
        where: { jobCode: jc.jobCode },
        update: {},
        create: jc,
      })
    }
  }
  if (wo3 && worker) {
    await prisma.jobCard.upsert({
      where: { jobCode: 'JC-26-003' },
      update: {},
      create: { jobCode: 'JC-26-003', workOrderId: wo3.id, teamCode: 'TO-02', workType: 'assembly', description: 'Lắp ráp header tube sheet', plannedQty: 1, actualQty: 0, unit: 'bộ', workDate: new Date('2026-03-19'), manpower: 6, status: 'OPEN', reportedBy: worker?.id || '' },
    })
  }

  // ── Seed QC Inspections ──
  console.log('  → QC Inspections...')
  const qcUser = await prisma.user.findUnique({ where: { username: 'haitq' } })

  const inspections = [
    { inspectionCode: 'QC-26-001', projectId: project.id, type: 'material_incoming', stepCode: 'P3.4', status: 'PASSED', inspectorId: qcUser?.id, inspectedAt: new Date('2026-03-12'), remarks: 'Thép tấm SA-516 Gr.70 lot #HN2026-A1 — đạt yêu cầu ASME' },
    { inspectionCode: 'QC-26-002', projectId: project.id, type: 'dimensional', stepCode: 'P4.3_QC', status: 'PENDING', remarks: 'Kiểm tra kích thước shell section 1 sau cắt' },
    { inspectionCode: 'QC-26-003', projectId: project2.id, type: 'ndt', stepCode: 'P4.5', status: 'PENDING', remarks: 'NDT mối hàn giáp mối header tube sheet — RT 100%' },
  ]
  for (const insp of inspections) {
    const existing = await prisma.inspection.findUnique({ where: { inspectionCode: insp.inspectionCode } })
    if (!existing) {
      await prisma.inspection.create({ data: insp })
    }
  }

  // ── Seed Purchase Requests ──
  console.log('  → Purchase Requests...')
  const khoUser = await prisma.user.findUnique({ where: { username: 'luongnth' } })
  const vendor1 = await prisma.vendor.findFirst({ where: { vendorCode: 'NCC-001' } })

  if (khoUser && project) {
    const pr1Exists = await prisma.purchaseRequest.findUnique({ where: { prCode: 'PR-26-001' } })
    if (!pr1Exists) {
      const mat1 = await prisma.material.findFirst({ where: { materialCode: 'STL-001' } })
      const mat2 = await prisma.material.findFirst({ where: { materialCode: 'WLD-001' } })
      await prisma.purchaseRequest.create({
        data: {
          prCode: 'PR-26-001', projectId: project.id, requestedBy: khoUser.id,
          status: 'SUBMITTED', urgency: 'URGENT', notes: 'Cần gấp cho WO-26-001 — cắt thép shell',
          items: {
            create: [
              ...(mat1 ? [{ materialId: mat1.id, quantity: 20, requiredDate: new Date('2026-04-01'), notes: 'SA-516 Gr.70 cho shell section' }] : []),
              ...(mat2 ? [{ materialId: mat2.id, quantity: 50, notes: 'Que hàn E7018 cho hàn giáp mối' }] : []),
            ],
          },
        },
      })
    }

    const pr2Exists = await prisma.purchaseRequest.findUnique({ where: { prCode: 'PR-26-002' } })
    if (!pr2Exists) {
      const mat4 = await prisma.material.findFirst({ where: { materialCode: 'VLV-001' } })
      await prisma.purchaseRequest.create({
        data: {
          prCode: 'PR-26-002', projectId: project2.id, requestedBy: khoUser.id,
          status: 'APPROVED', urgency: 'NORMAL', notes: 'Bổ sung gasket cho HRSG module A',
          approvedBy: khoUser.id, approvedAt: new Date('2026-03-18'),
          items: {
            create: [
              ...(mat4 ? [{ materialId: mat4.id, quantity: 100, requiredDate: new Date('2026-04-15'), notes: 'Gasket ASME B16.20' }] : []),
            ],
          },
        },
      })
    }
  }

  console.log('✅ Seed completed!')
  await prisma.$disconnect()
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
