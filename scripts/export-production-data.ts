import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import * as fs from 'fs'
import * as path from 'path'

const connectionString = process.env.DATABASE_URL || ''

// ── PRODUCTION GUARD: script này ĐƯỢC PHÉP chạy trên production (read-only export) ──
// Nhưng vẫn cảnh báo rõ ràng
if (/103\.141\.177\.194/.test(connectionString)) {
  console.log('⚠️  PRODUCTION DB detected — running in READ-ONLY export mode')
}

async function main() {
  const pool = new pg.Pool({ connectionString, max: 3 })
  const adapter = new PrismaPg(pool as any)
  const prisma = new PrismaClient({ adapter })

  try {
    console.log('📦 Exporting production data...\n')

    // 1. Projects
    const projects = await prisma.project.findMany({
      include: {
        budgets: true,
        milestones: true,
        wbsNodes: true,
        inspections: true,
      },
    })
    console.log(`  Projects: ${projects.length}`)

    // 2. WorkflowTasks (hệ 36 bước cũ)
    const workflowTasks = await prisma.workflowTask.findMany({
      include: {
        assignee: { select: { id: true, fullName: true, username: true, roleCode: true } },
      },
    })
    console.log(`  WorkflowTasks: ${workflowTasks.length}`)
    const byStatus: Record<string, number> = {}
    workflowTasks.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1 })
    console.log(`    Status: ${JSON.stringify(byStatus)}`)

    // 3. Materials (giữ nguyên nhưng export để tham chiếu)
    const materialCount = await prisma.material.count()
    console.log(`  Materials: ${materialCount} (not exported — will be re-imported from catalog)`)

    // 4. BOM
    const boms = await prisma.billOfMaterial.findMany({ include: { items: true } })
    console.log(`  BOMs: ${boms.length}, items: ${boms.reduce((s, b) => s + b.items.length, 0)}`)

    // 5. Purchase Requests
    const prs = await prisma.purchaseRequest.findMany({ include: { items: true } })
    console.log(`  Purchase Requests: ${prs.length}, items: ${prs.reduce((s, p) => s + p.items.length, 0)}`)

    // 6. Purchase Orders
    const pos = await prisma.purchaseOrder.findMany({ include: { items: true } })
    console.log(`  Purchase Orders: ${pos.length}, items: ${pos.reduce((s, p) => s + p.items.length, 0)}`)

    // 7. Stock Movements
    const movements = await prisma.stockMovement.findMany()
    console.log(`  Stock Movements: ${movements.length}`)

    // 8. FileAttachments
    const files = await prisma.fileAttachment.findMany()
    console.log(`  FileAttachments: ${files.length}`)

    // 9. Vendors
    const vendors = await prisma.vendor.findMany()
    console.log(`  Vendors: ${vendors.length}`)

    // 10. Users & Roles
    const users = await prisma.user.findMany({
      select: { id: true, username: true, fullName: true, roleCode: true, isActive: true, departmentId: true },
    })
    console.log(`  Users: ${users.length}`)

    // 11. Notifications
    const notifications = await prisma.notification.findMany()
    console.log(`  Notifications: ${notifications.length}`)

    // 12. Drawings
    const drawings = await prisma.drawing.findMany({ include: { revisions: true } })
    console.log(`  Drawings: ${drawings.length}`)

    // 13. Inspections
    const inspections = await prisma.inspection.findMany({ include: { checklistItems: true } })
    console.log(`  Inspections: ${inspections.length}`)

    // 14. Work Orders
    const workOrders = await prisma.workOrder.findMany()
    console.log(`  Work Orders: ${workOrders.length}`)

    // 15. Budgets
    const budgets = await prisma.budget.findMany()
    console.log(`  Budgets: ${budgets.length}`)

    // 16. AuditLogs (recent 1000)
    const auditLogs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 })
    console.log(`  AuditLogs: ${auditLogs.length} (latest 1000)`)

    const exportData = {
      exportedAt: new Date().toISOString(),
      dbUrl: connectionString.replace(/:[^:@]+@/, ':***@'),
      summary: {
        projects: projects.length,
        workflowTasks: workflowTasks.length,
        tasksByStatus: byStatus,
        boms: boms.length,
        purchaseRequests: prs.length,
        purchaseOrders: pos.length,
        stockMovements: movements.length,
        files: files.length,
        vendors: vendors.length,
        users: users.length,
      },
      data: {
        projects,
        workflowTasks,
        boms,
        purchaseRequests: prs,
        purchaseOrders: pos,
        stockMovements: movements,
        fileAttachments: files,
        vendors,
        users,
        notifications,
        drawings,
        inspections,
        workOrders,
        budgets,
        auditLogs,
      },
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outFile = path.resolve(process.cwd(), `backup_production_${timestamp}.json`)
    fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2), 'utf-8')
    console.log(`\n✅ Exported to: ${outFile}`)
    console.log(`   File size: ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB`)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
