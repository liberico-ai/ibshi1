/**
 * Seed test data: 1 user, 1 project, 1 Drawing, 1 BOM + 8 BomItems (5 categories),
 * + some Materials, + 1 vendor, + 1 PR, + 1 PO (for impact testing).
 *
 * Run: npx tsx scripts/seed-bom-test-data.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import 'dotenv/config'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })

function hash(pw: string) {
  return bcrypt.hashSync(pw, 12)
}

async function main() {
  console.log('[seed] Creating test data...')

  // User (admin R01)
  const user = await prisma.user.upsert({
    where: { username: 'toannd' },
    update: {},
    create: {
      username: 'toannd',
      email: 'toannd@ibs.vn',
      passwordHash: hash('123456'),
      fullName: 'Nguyễn Đức Toàn',
      roleCode: 'R01',
      userLevel: 1,
    },
  })

  // Design user R04
  const designer = await prisma.user.upsert({
    where: { username: 'designer01' },
    update: {},
    create: {
      username: 'designer01',
      email: 'designer01@ibs.vn',
      passwordHash: hash('123456'),
      fullName: 'Nguyễn Thiết Kế',
      roleCode: 'R04',
      userLevel: 2,
    },
  })

  // Project
  const project = await prisma.project.upsert({
    where: { projectCode: 'TEST-BOM-001' },
    update: {},
    create: {
      projectCode: 'TEST-BOM-001',
      projectName: 'Dự án test BomVersion',
      clientName: 'KH Test',
      productType: 'Kết cấu thép',
      status: 'IN_PROGRESS',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      projectType: 'EPC',
    },
  })

  // Materials (5 categories)
  const materials = await Promise.all([
    prisma.material.upsert({ where: { materialCode: 'THEP-H200' }, update: {}, create: { materialCode: 'THEP-H200', name: 'Thép hình H200x200x8x12', unit: 'kg', category: 'STEEL', grade: 'SS400' } }),
    prisma.material.upsert({ where: { materialCode: 'THEP-T10' }, update: {}, create: { materialCode: 'THEP-T10', name: 'Thép tấm t=10mm', unit: 'kg', category: 'STEEL', grade: 'A36' } }),
    prisma.material.upsert({ where: { materialCode: 'THEP-O60' }, update: {}, create: { materialCode: 'THEP-O60', name: 'Thép ống D60.3x3.9', unit: 'kg', category: 'STEEL', grade: 'A106B' } }),
    prisma.material.upsert({ where: { materialCode: 'QUE-HAN-E7018' }, update: {}, create: { materialCode: 'QUE-HAN-E7018', name: 'Que hàn E7018 Ø3.2', unit: 'kg', category: 'WELD' } }),
    prisma.material.upsert({ where: { materialCode: 'SON-LOT-EP' }, update: {}, create: { materialCode: 'SON-LOT-EP', name: 'Sơn lót Epoxy 2K', unit: 'L', category: 'PAINT' } }),
    prisma.material.upsert({ where: { materialCode: 'BULONG-M20' }, update: {}, create: { materialCode: 'BULONG-M20', name: 'Bu-lông M20x60 cấp 8.8', unit: 'bộ', category: 'AUX' } }),
    prisma.material.upsert({ where: { materialCode: 'DA-MAI-125' }, update: {}, create: { materialCode: 'DA-MAI-125', name: 'Đá mài 125x6x22', unit: 'viên', category: 'CONSUMABLE' } }),
    prisma.material.upsert({ where: { materialCode: 'KHI-ARGON' }, update: {}, create: { materialCode: 'KHI-ARGON', name: 'Khí Argon công nghiệp', unit: 'bình', category: 'CONSUMABLE' } }),
  ])

  // Drawing
  const drawing = await prisma.drawing.upsert({
    where: { drawingCode: 'DWG-TEST-001' },
    update: {},
    create: {
      drawingCode: 'DWG-TEST-001',
      projectId: project.id,
      title: 'Bản vẽ chế tạo Beam B1',
      discipline: 'structural',
      currentRev: 'R0',
      status: 'IFC',
      drawnBy: designer.id,
    },
  })

  // Drawing Revision
  await prisma.drawingRevision.upsert({
    where: { drawingId_revision: { drawingId: drawing.id, revision: 'R0' } },
    update: {},
    create: {
      drawingId: drawing.id,
      revision: 'R0',
      description: 'Phiên bản ban đầu',
      issuedDate: new Date('2026-02-01'),
      issuedBy: designer.id,
    },
  })

  // BOM
  const bom = await prisma.billOfMaterial.upsert({
    where: { bomCode: 'BOM-TEST-001' },
    update: {},
    create: {
      bomCode: 'BOM-TEST-001',
      projectId: project.id,
      name: 'BOM Beam B1 - Rev R0',
      revision: 'R0',
      status: 'APPROVED',
      createdBy: user.id,
    },
  })

  // BomItems — 8 items across 5 categories
  const categories: Array<{ mat: typeof materials[0]; category: string; pieceMark: string | null; qty: number; profile?: string; grade?: string }> = [
    { mat: materials[0], category: 'MAIN', pieceMark: 'B1-FL1', qty: 850, profile: 'H200x200x8x12', grade: 'SS400' },
    { mat: materials[1], category: 'MAIN', pieceMark: 'B1-PL1', qty: 120, profile: 'PL10x200', grade: 'A36' },
    { mat: materials[2], category: 'MAIN', pieceMark: 'B1-BR1', qty: 45, profile: 'D60.3x3.9', grade: 'A106B' },
    { mat: materials[3], category: 'WELD', pieceMark: null, qty: 25.5 },
    { mat: materials[4], category: 'PAINT', pieceMark: null, qty: 18 },
    { mat: materials[5], category: 'AUX', pieceMark: 'B1-BL1', qty: 48 },
    { mat: materials[6], category: 'CONSUMABLE', pieceMark: null, qty: 12 },
    { mat: materials[7], category: 'CONSUMABLE', pieceMark: null, qty: 3 },
  ]

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i]
    await prisma.bomItem.upsert({
      where: { id: `bom-item-test-${i + 1}` },
      update: {},
      create: {
        id: `bom-item-test-${i + 1}`,
        bomId: bom.id,
        materialId: c.mat.id,
        category: c.category,
        pieceMark: c.pieceMark,
        quantity: c.qty,
        unit: c.mat.unit,
        profile: c.profile || null,
        grade: c.grade || null,
        sortOrder: i + 1,
      },
    })
  }

  // Vendor + PR + PO for impact testing
  const vendor = await prisma.vendor.upsert({
    where: { vendorCode: 'NCC-TEST-001' },
    update: {},
    create: {
      vendorCode: 'NCC-TEST-001',
      name: 'NCC Test Thép',
      contactName: 'Anh Test',
      category: 'steel',
    },
  })

  const pr = await prisma.purchaseRequest.create({
    data: {
      prCode: `PR-TEST-${Date.now()}`,
      projectId: project.id,
      requestedBy: user.id,
      status: 'APPROVED',
      items: {
        create: [
          { materialId: materials[0].id, quantity: 850 },
          { materialId: materials[1].id, quantity: 120 },
        ],
      },
    },
  })

  await prisma.purchaseOrder.create({
    data: {
      poCode: `PO-TEST-${Date.now()}`,
      projectId: project.id,
      vendorId: vendor.id,
      status: 'APPROVED',
      createdBy: user.id,
      items: {
        create: [
          { materialId: materials[0].id, quantity: 850, unitPrice: 15000, unit: 'kg' },
        ],
      },
    },
  })

  console.log(`[seed] Done:`)
  console.log(`  User: ${user.username} (${user.roleCode})`)
  console.log(`  Designer: ${designer.username} (${designer.roleCode})`)
  console.log(`  Project: ${project.projectCode}`)
  console.log(`  Drawing: ${drawing.drawingCode}`)
  console.log(`  BOM: ${bom.bomCode} (${categories.length} items)`)
  console.log(`  PR: ${pr.prCode} (2 items)`)
  console.log(`  Materials: ${materials.map(m => m.materialCode).join(', ')}`)

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
