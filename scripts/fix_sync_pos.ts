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
      if (g.status === 'APPROVED' && g.prCode) {
        
        // Find correct supplier
        const actualSupplier = g.assignedSupplier || (g.items?.length > 0 ? (g.items[0].quotes?.[g.items[0].selectedQuoteIndex || 0]?.ncc || 'NCC Mặc định') : 'NCC Mặc định')
        
        // Find the PO we synced earlier
        const existing = await prisma.purchaseOrder.findFirst({
          where: { poCode: { contains: g.prCode } }
        })
        
        if (existing) {
          // If we assigned it to 'NCC 11', fix the actual vendor and PO!
          const vCode = 'VND-'+actualSupplier.substring(0,5).toUpperCase()
          
          let v = await prisma.vendor.upsert({
            where: { vendorCode: vCode },
            update: { name: actualSupplier },
            create: { vendorCode: vCode, name: actualSupplier, category: 'SUPPLIER' }
          })
          
          const actualTotalValue = g.totalValue || (g.items || []).reduce((sum: number, item: any) => sum + ((item.quotes?.[item.selectedQuoteIndex || 0]?.price || 0) * (item.shortfall || 0)), 0)

          await prisma.purchaseOrder.update({
            where: { id: existing.id },
            data: { vendorId: v.id, totalValue: Number(actualTotalValue) || existing.totalValue }
          })
          count++
        }
      }
    }
  }
  console.log(`Updated ${count} POs with their real nested supplier names.`)
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect())
