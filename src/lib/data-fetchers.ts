// ══════════════════════════════════════════════════════════════
// Data Fetcher Helpers — Eliminate duplicate DB queries
// Used by src/app/api/tasks/[id]/route.ts (and future consumers)
//
// Each function encapsulates a repeated query pattern.
// The route.ts migration (replacing inline queries with these
// helpers) happens in a separate step.
// ══════════════════════════════════════════════════════════════

import prisma from '@/lib/db'
import type { BomEntry, BomEntryWithSource } from '@/lib/types'

// ── Generic Step Result ─────────────────────────────────────

type StepResult = { resultData: unknown; status: string } | null

/**
 * Fetch a single workflow step's resultData + status.
 * This is the most common query in route.ts — repeated for every
 * previousStepData lookup.
 */
export async function fetchStepResult(
  projectId: string,
  stepCode: string,
): Promise<StepResult> {
  return prisma.workflowTask.findFirst({
    where: { projectId, stepCode },
    select: { resultData: true, status: true },
  })
}

// ── BOM Aggregation (P2.1 + P2.2 + P2.3) ───────────────────

/** Source labels used when aggregating BOM from P3.3/P3.4 (descriptive) */
const BOM_LABELS_DESCRIPTIVE: Record<string, string> = {
  'P2.1': 'P2.1 - VT chính',
  'P2.2': 'P2.2 - Hàn & Sơn',
  'P2.3': 'P2.3 - VT phụ',
}

/** Source labels used when aggregating BOM from P3.2/P3.5/P4.4 (short) */
const BOM_LABELS_SHORT: Record<string, string> = {
  'P2.1': 'P2.1',
  'P2.2': 'P2.2',
  'P2.3': 'P2.3',
}

/**
 * Fetch BOM items from P2.1 + P2.2 + P2.3 in parallel, merge with source labels.
 *
 * @param projectId  - The project to query
 * @param labels     - 'short' for P3.2/P3.5/P4.4 style ('P2.1')
 *                     'descriptive' for P3.3/P3.4 style ('P2.1 - VT chinh')
 *                     Defaults to 'short'.
 *
 * Matches route.ts lines 119-149, 323-353, 357-395, 474-509
 */
export async function aggregateBomItems(
  projectId: string,
  labels: 'short' | 'descriptive' = 'short',
): Promise<BomEntryWithSource[]> {
  const [p21Task, p22Task, p23Task] = await Promise.all([
    fetchStepResult(projectId, 'P2.1'),
    fetchStepResult(projectId, 'P2.2'),
    fetchStepResult(projectId, 'P2.3'),
  ])

  const labelMap = labels === 'descriptive' ? BOM_LABELS_DESCRIPTIVE : BOM_LABELS_SHORT
  const allItems: BomEntryWithSource[] = []

  const sources: Array<{ data: Record<string, unknown> | null; stepCode: 'P2.1' | 'P2.2' | 'P2.3' }> = [
    { data: p21Task?.resultData as Record<string, unknown> | null, stepCode: 'P2.1' },
    { data: p22Task?.resultData as Record<string, unknown> | null, stepCode: 'P2.2' },
    { data: p23Task?.resultData as Record<string, unknown> | null, stepCode: 'P2.3' },
  ]

  for (const src of sources) {
    const items = (src.data?.bomItems as BomEntry[]) || []
    for (const item of items) {
      if (item.name?.trim()) {
        allItems.push({
          ...item,
          // The `source` field uses the descriptive label for display in P3.3/P3.4,
          // but the type requires the stepCode literal. We cast because route.ts
          // originally used `string` — the descriptive labels are display-only.
          source: labelMap[src.stepCode] as BomEntryWithSource['source'],
        })
      }
    }
  }

  return allItems
}

// ── Estimate Data (P1.2) ────────────────────────────────────

/**
 * Fetch P1.2 estimate resultData.
 * If `mergeP21A` is true, also fetches P2.1A and merges (spread) on top.
 * This pattern is used by P2.4 and P2.5 where DT07 from P2.1A supplements P1.2.
 *
 * Matches route.ts lines 250-261 (P2.4), 290-301 (P2.5), 399-412 (P3.6), 574-585 (P6.2)
 */
export async function fetchEstimateData(
  projectId: string,
  options?: { mergeP21A?: boolean },
): Promise<Record<string, unknown> | null> {
  if (options?.mergeP21A) {
    const [p12Task, p21aTask] = await Promise.all([
      fetchStepResult(projectId, 'P1.2'),
      prisma.workflowTask.findFirst({
        where: { projectId, stepCode: 'P2.1A' },
        select: { resultData: true },
      }),
    ])
    const est12 = (p12Task?.resultData as Record<string, unknown>) || {}
    const est21a = (p21aTask?.resultData as Record<string, unknown>) || {}
    // Original code always returned {} (empty object), never null.
    // Keep this behavior for backward compat — consumers use `?.estimate` truthiness check.
    return { ...est12, ...est21a }
  }

  const p12Task = await fetchStepResult(projectId, 'P1.2')
  return (p12Task?.resultData as Record<string, unknown>) || null
}

// ── Supplier Data (P3.5) ────────────────────────────────────

/**
 * Fetch P3.5 supplier quotes resultData.
 * Used by P3.6, P3.7, P4.2, P4.3, P4.4.
 *
 * Matches route.ts lines 399-406 (P3.6), 417-420 (P3.7), 439-446 (P4.2), 457-464 (P4.3), 480-483 (P4.4)
 */
export async function fetchSupplierData(
  projectId: string,
): Promise<Record<string, unknown> | null> {
  const p35Task = await fetchStepResult(projectId, 'P3.5')
  return (p35Task?.resultData as Record<string, unknown>) || null
}

// ── PO Data (P3.7) ─────────────────────────────────────────

/**
 * Fetch P3.7 PO + payment terms + delivery plan resultData.
 * Used by P4.1, P4.2, P4.3.
 *
 * Matches route.ts lines 428-432 (P4.1), 439-443 (P4.2), 457-461 (P4.3)
 */
export async function fetchPoData(
  projectId: string,
): Promise<Record<string, unknown> | null> {
  const p37Task = await fetchStepResult(projectId, 'P3.7')
  return (p37Task?.resultData as Record<string, unknown>) || null
}

// ── Plan Data (P1.2A) ──────────────────────────────────────

/**
 * Fetch P1.2A plan resultData (WBS + MOM sections).
 * Used by P1.3, P3.1, P3.3/P3.4.
 *
 * Matches route.ts lines 201-206 (P1.3), 314-317 (P3.1), 358-362 (P3.3/P3.4)
 */
export async function fetchPlanData(
  projectId: string,
): Promise<Record<string, unknown> | null> {
  const p12aTask = await fetchStepResult(projectId, 'P1.2A')
  return (p12aTask?.resultData as Record<string, unknown>) || null
}

// ── Material Inventory ──────────────────────────────────────

/** Shape returned by both material queries (subset of Prisma Material) */
interface MaterialRow {
  materialCode: string
  name: string
  specification: string | null
  currentStock: unknown  // Prisma Decimal — callers convert with Number()
  unit: string
}

/**
 * Fetch ALL materials for stock comparison (P3.2 pattern).
 * No where filter, no category, no limit.
 *
 * Matches route.ts lines 152-154
 */
export async function fetchAllMaterials(): Promise<MaterialRow[]> {
  return prisma.material.findMany({
    select: {
      materialCode: true,
      name: true,
      specification: true,
      currentStock: true,
      unit: true,
    },
  })
}

/** Shape returned by fetchAvailableInventory (includes category) */
interface InventoryRow extends MaterialRow {
  category: string
}

/**
 * Fetch materials with stock > 0 for material issue (P4.5 pattern).
 * DIFFERENT from fetchAllMaterials — has where filter, category, orderBy, take.
 *
 * Matches route.ts lines 523-528
 */
export async function fetchAvailableInventory(): Promise<InventoryRow[]> {
  return prisma.material.findMany({
    where: { currentStock: { gt: 0 } },
    select: {
      materialCode: true,
      name: true,
      specification: true,
      currentStock: true,
      unit: true,
      category: true,
    },
    orderBy: { category: 'asc' },
    take: 200,
  })
}
