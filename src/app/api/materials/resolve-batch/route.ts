import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { resolveBatchSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

interface ResolvedLite { id: string; materialCode: string; name: string; unit: string; currentStock: number; status: string }

// POST /api/materials/resolve-batch  { codes: string[] }
// Returns { results: { [code]: ResolvedLite | null } } — resolves each code
// against canonical materialCode first, then the alias registry (old codes).
export async function POST(req: NextRequest) {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const parsed = await validateBody(req, resolveBatchSchema)
  if (!parsed.success) return parsed.response

  // de-dup + drop blanks
  const codes = Array.from(new Set(parsed.data.codes.map((c) => c.trim()).filter(Boolean)))
  const results: Record<string, ResolvedLite | null> = {}
  if (codes.length === 0) return successResponse({ results })

  const sel = { id: true, materialCode: true, name: true, unit: true, currentStock: true, status: true }
  const lite = (m: { id: string; materialCode: string; name: string; unit: string; currentStock: unknown; status: string }): ResolvedLite =>
    ({ id: m.id, materialCode: m.materialCode, name: m.name, unit: m.unit, currentStock: Number(m.currentStock), status: m.status })

  // 1) canonical
  const mats = await prisma.material.findMany({ where: { materialCode: { in: codes } }, select: sel })
  const byCanonical = new Map(mats.map((m) => [m.materialCode, m]))

  // 2) remaining → alias
  const remaining = codes.filter((c) => !byCanonical.has(c))
  const aliasByCode = new Map<string, ReturnType<typeof lite>>()
  if (remaining.length > 0) {
    const aliases = await prisma.materialCodeAlias.findMany({
      where: { aliasCode: { in: remaining } },
      select: { aliasCode: true, material: { select: sel } },
    })
    for (const a of aliases) if (a.material) aliasByCode.set(a.aliasCode, lite(a.material))
  }

  for (const c of codes) {
    if (byCanonical.has(c)) results[c] = lite(byCanonical.get(c)!)
    else if (aliasByCode.has(c)) results[c] = aliasByCode.get(c)!
    else results[c] = null
  }

  return successResponse({ results })
}
