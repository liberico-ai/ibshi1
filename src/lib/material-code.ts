import type { Prisma } from '@prisma/client'

// ── Material canonical code generator ──
// Canonical format: PREFIX-SUBGROUP-NNN (e.g. BAH-AOBH-001)
// SEQ is generated atomically via the MaterialCodeCounter table to avoid
// race conditions when multiple units submit PRs concurrently.

const pad3 = (n: number) => String(n).padStart(3, '0')

/** Extract trailing integer of a canonical code's SEQ segment, else 0. */
function seqOf(code: string): number {
  const tail = code.split('-').pop() || ''
  const n = parseInt(tail, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Generate the next canonical material code for (prefix, subgroup) atomically.
 * MUST be called inside a prisma.$transaction so the counter increment and the
 * material create commit together.
 *
 * On first use of a (prefix, subgroup) the counter is seeded from the highest
 * existing numeric SEQ among materialCode + aliasCode so new codes never collide
 * with legacy ones.
 */
export async function generateMaterialCode(
  tx: Prisma.TransactionClient,
  prefix: string,
  subgroup: string,
): Promise<string> {
  const existing = await tx.materialCodeCounter.findUnique({
    where: { prefix_subgroup: { prefix, subgroup } },
  })

  if (!existing) {
    const base = `${prefix}-${subgroup}-`
    const [mats, aliases] = await Promise.all([
      tx.material.findMany({
        where: { materialCode: { startsWith: base } },
        select: { materialCode: true },
      }),
      tx.materialCodeAlias.findMany({
        where: { aliasCode: { startsWith: base } },
        select: { aliasCode: true },
      }),
    ])
    let maxSeq = 0
    for (const m of mats) maxSeq = Math.max(maxSeq, seqOf(m.materialCode))
    for (const a of aliases) maxSeq = Math.max(maxSeq, seqOf(a.aliasCode))
    await tx.materialCodeCounter.create({ data: { prefix, subgroup, lastSeq: maxSeq } })
  }

  const updated = await tx.materialCodeCounter.update({
    where: { prefix_subgroup: { prefix, subgroup } },
    data: { lastSeq: { increment: 1 } },
  })

  return `${prefix}-${subgroup}-${pad3(updated.lastSeq)}`
}
