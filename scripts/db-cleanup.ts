import prisma from '../src/lib/db'

async function cleanup() {
  console.log('--- START THE ORCHESTRATION CLEANUP ---')
  console.log('Target: KEEP Users, Roles, Departments, Employees, HR Data.')
  console.log('Target: KEEP Projects with code containing 104 or 109 and their related data.')

  let projectsToDelete = [];
  try {
    const allProjects = await prisma.project.findMany({ select: { id: true, projectCode: true } });
    projectsToDelete = allProjects.filter(p => !p.projectCode.includes('104') && !p.projectCode.includes('109'));
  } catch (err: any) {
    console.error("FIND_MANY ERROR:", err.message || err);
    return;
  }

  const projectIds = projectsToDelete.map(p => p.id)
  console.log(`Found ${projectIds.length} projects to delete.`);

  if (projectIds.length > 0) {
    try {
      console.log('>> Deleting project-dependent records...')
      
      // Level 2 (children of children)
      await prisma.bomItem.deleteMany({ where: { bom: { projectId: { in: projectIds } } } })
      await prisma.drawingRevision.deleteMany({ where: { drawing: { projectId: { in: projectIds } } } })
      await prisma.inspectionItem.deleteMany({ where: { inspection: { projectId: { in: projectIds } } } })
      await prisma.iTPCheckpoint.deleteMany({ where: { itp: { projectId: { in: projectIds } } } })
      await prisma.ncrAction.deleteMany({ where: { ncr: { projectId: { in: projectIds } } } })
      await prisma.purchaseRequestItem.deleteMany({ where: { purchaseRequest: { projectId: { in: projectIds } } } })
      await prisma.jobCard.deleteMany({ where: { workOrder: { projectId: { in: projectIds } } } })
      await prisma.materialIssue.deleteMany({ where: { workOrder: { projectId: { in: projectIds } } } })
      await (prisma as any).dailyProductionLog.deleteMany({ where: { projectId: { in: projectIds } } })
      await (prisma as any).weeklyAcceptanceLog.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.deliveryRecord.deleteMany({ where: { projectId: { in: projectIds } } })
      
      // Level 1 relations to project
      await prisma.billOfMaterial.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.budget.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.cashflowEntry.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.changeEvent.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.drawing.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.engineeringChangeOrder.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.inspection.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.inspectionTestPlan.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.invoice.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.lessonLearned.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.milestone.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.nonConformanceReport.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.pieceRateContract.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.purchaseRequest.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.safetyIncident.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.subcontractorContract.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.timesheet.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.wbsNode.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.workOrder.deleteMany({ where: { projectId: { in: projectIds } } })
      await prisma.workflowTask.deleteMany({ where: { projectId: { in: projectIds } } })
      
      await prisma.stockMovement.deleteMany({ where: { projectId: { in: projectIds } } })
      
      // Finally level 0 (projects)
      console.log('>> Deleting Projects...')
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
      
      console.log('✅ Projects deleted.')

    } catch (err: any) {
      console.error('Error deleting project dependencies:', err.message || err)
      return
    }
  } else {
    console.log('No extra projects to delete.')
  }

  console.log('--- CLEANUP COMPLETE ---')
}

cleanup().catch(console.error).finally(() => prisma.$disconnect())
