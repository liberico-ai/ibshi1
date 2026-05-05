import prisma from '../src/lib/db'

async function main() {
  const materials = await prisma.material.groupBy({ by: ['category'], _count: true })
  console.log(materials)
}

main().catch(console.error).finally(() => prisma.$disconnect())
