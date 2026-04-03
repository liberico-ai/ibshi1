import { prisma } from '../src/lib/db'

async function main() {
  console.log('🚀 Starting Data Cleanup...')
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Logs & Events
      console.log('🗑️ Clearing Logs & Events...')
      await tx.fileAttachment.deleteMany({})
      await tx.notification.deleteMany({})
      await tx.auditLog.deleteMany({})
      await tx.changeEvent.deleteMany({})

      // 2. Operations & Finance
      console.log('🗑️ Clearing Operations & Finance...')
      await tx.deliveryRecord.deleteMany({})
      await tx.timesheet.deleteMany({})
      await tx.monthlyPieceRateOutput.deleteMany({})
      await tx.pieceRateContract.deleteMany({})
      await tx.cashflowEntry.deleteMany({})
      await tx.payment.deleteMany({})
      await tx.invoice.deleteMany({})
      await tx.budget.deleteMany({})
      await tx.safetyIncident.deleteMany({})

      // 3. Quality & QC
      console.log('🗑️ Clearing Quality & QC...')
      await tx.ncrAction.deleteMany({})
      await tx.nonConformanceReport.deleteMany({})
      await tx.iTPCheckpoint.deleteMany({})
      await tx.inspectionTestPlan.deleteMany({})
      await tx.inspectionItem.deleteMany({})
      await tx.inspection.deleteMany({})

      // 4. Engineering & Production
      console.log('🗑️ Clearing Engineering & Production...')
      await tx.jobCard.deleteMany({})
      await tx.materialIssue.deleteMany({})
      await tx.workOrder.deleteMany({})
      await tx.engineeringChangeOrder.deleteMany({})
      await tx.bomItem.deleteMany({})
      await tx.billOfMaterial.deleteMany({})
      await tx.drawingRevision.deleteMany({})
      await tx.drawing.deleteMany({})

      // 5. Procurement & Inventory
      console.log('🗑️ Clearing Procurement & Inventory...')
      await tx.stockMovement.deleteMany({})
      await tx.material.deleteMany({})
      await tx.millCertificate.deleteMany({})
      await tx.purchaseOrderItem.deleteMany({})
      await tx.purchaseOrder.deleteMany({})
      await tx.purchaseRequestItem.deleteMany({})
      await tx.purchaseRequest.deleteMany({})

      // 6. Workshop & Employees (ONLY Transactional Employee Data, KEEPING Employee table per user requested)
      console.log('🗑️ Clearing Employee Transactions (Keeping Master Employees)...')
      await tx.salaryRecord.deleteMany({})
      await tx.attendance.deleteMany({})
      await tx.employeeContract.deleteMany({})

      // 7. Project Management & Core Workflow
      console.log('🗑️ Clearing Core Projects...')
      await tx.workflowTask.deleteMany({})
      await tx.lessonLearned.deleteMany({})
      await tx.subcontractorContract.deleteMany({})
      await tx.milestone.deleteMany({})
      await tx.wbsNode.deleteMany({})
      await tx.project.deleteMany({})

      return true
    }, {
      maxWait: 5000, 
      timeout: 20000 // In case database is slightly slow
    });

    console.log('✅ DATABASE CLEANED SUCCESSFULLY!')
    console.log('Master Data (Users, Roles, Departments, Employees, Vendors) were PRESERVED.')
  } catch (error) {
    console.error('❌ FAILED TO CLEANUP DATABASE:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
