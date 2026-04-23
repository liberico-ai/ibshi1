import { prisma } from '../src/lib/db'

async function main() {
  const tasks = await prisma.workflowTask.findMany({
    where: { stepCode: 'P3.6' }
  })
  let count = 0
  for (const t of tasks) {
    const rd = t.resultData as any
    const groups = rd?.groups || []
    for (const g of groups) {
      if (g.status === 'APPROVED') {
        const poCode = `PO-${g.prCode || 'PR-000'}-${Math.floor(Math.random()*1000)}`
        
        // Find existing to avoid duplicates
        const existing = await prisma.purchaseOrder.findFirst({
          where: { poCode: { contains: g.prCode || 'XXX' } }
        })
        
        if (!existing && g.prCode) {
          const actSup = g.assignedSupplier || 'NCC 11'
          const vCode = 'VND-'+actSup.substring(0,5).toUpperCase()
          
          const v = await prisma.vendor.upsert({
            where: { vendorCode: vCode },
            update: { name: actSup },
            create: { vendorCode: vCode, name: actSup, category: 'SUPPLIER' }
          })
          
          const actVal = g.totalValue || 500000
          
          await prisma.purchaseOrder.create({
             data: { poCode, vendorId: v.id, status: 'APPROVED', totalValue: actVal, currency: 'VND', orderDate: new Date(), createdBy: 'SYSTEM', notes: 'SYNC' }
          })
          console.log('SYNCED PO: ', poCode)
          count++
        }
      }
    }
  }
  console.log(`Finished syncing ${count} POs.`)
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect())
