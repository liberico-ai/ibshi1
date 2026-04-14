import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  console.log('--- START THE ORCHESTRATION CLEANUP (VIA API) ---');

  try {
    const projectsToDelete = await prisma.project.findMany({
      where: {
        AND: [
          { NOT: { projectCode: { contains: '104' } } },
          { NOT: { projectCode: { contains: '109' } } }
        ]
      },
      select: { id: true, projectCode: true }
    });

    const projectIds = projectsToDelete.map(p => p.id);
    const codes = projectsToDelete.map(p => p.projectCode).join(', ');
    console.log(`Found ${projectIds.length} projects to delete:`, codes);

    if (projectIds.length > 0) {
      console.log('>> Deleting project-dependent records without Cascade first...');
      
      await prisma.bomItem.deleteMany({ where: { bom: { projectId: { in: projectIds } } } });
      await prisma.billOfMaterial.deleteMany({ where: { projectId: { in: projectIds } } });
      
      await prisma.drawingRevision.deleteMany({ where: { drawing: { projectId: { in: projectIds } } } });
      await prisma.drawing.deleteMany({ where: { projectId: { in: projectIds } } });
      
      await prisma.engineeringChangeOrder.deleteMany({ where: { projectId: { in: projectIds } } });
      
      await prisma.inspectionItem.deleteMany({ where: { inspection: { projectId: { in: projectIds } } } });
      await prisma.inspection.deleteMany({ where: { projectId: { in: projectIds } } });

      await prisma.iTPCheckpoint.deleteMany({ where: { itp: { projectId: { in: projectIds } } } });
      await prisma.inspectionTestPlan.deleteMany({ where: { projectId: { in: projectIds } } });

      await prisma.ncrAction.deleteMany({ where: { ncr: { projectId: { in: projectIds } } } });
      await prisma.nonConformanceReport.deleteMany({ where: { projectId: { in: projectIds } } });
      
      await prisma.purchaseRequestItem.deleteMany({ where: { purchaseRequest: { projectId: { in: projectIds } } } });
      await prisma.purchaseRequest.deleteMany({ where: { projectId: { in: projectIds } } });
      
      await prisma.jobCard.deleteMany({ where: { workOrder: { projectId: { in: projectIds } } } });
      await prisma.materialIssue.deleteMany({ where: { workOrder: { projectId: { in: projectIds } } } });
      await prisma.deliveryRecord.deleteMany({ where: { workOrder: { projectId: { in: projectIds } } } });
      await prisma.workOrder.deleteMany({ where: { projectId: { in: projectIds } } });
      
      await prisma.stockMovement.deleteMany({ where: { projectId: { in: projectIds } } });
      
      console.log('>> Deleting Projects and cascading records...');
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      console.log('✅ Projects deleted.');
    } else {
      console.log('No extra projects to delete.');
    }

    // Now wipe orphaned records
    // WorkOrders, PurchaseOrders, etc without projects? We want to specifically clear data!
    console.log('>> Wiping Global Purchase Orders');
    await prisma.purchaseOrderItem.deleteMany();
    await prisma.purchaseOrder.deleteMany();

    console.log('>> Wiping Global Subcontracts');
    await prisma.subcontractorContract.deleteMany();

    // Check project count remaining
    const remainingProjects = await prisma.project.findMany({ select: { projectCode: true } });

    console.log('--- CLEANUP COMPLETE ---');
    return NextResponse.json({ 
      success: true, 
      message: 'Cleanup successful', 
      deletedCount: projectIds.length,
      remainingProjects: remainingProjects.map(p => p.projectCode)
    });

  } catch (err: any) {
    console.error('API Cleanup Error:', err.message || err);
    return NextResponse.json({ success: false, error: err.message || 'Error occurred' }, { status: 500 });
  }
}
