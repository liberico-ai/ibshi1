import { syncBOMtoBudget, syncPOtoBudget, syncEstimateToBudget, type EstimateTotals } from './sync-engine'

// HookRegistry (Phase 3): logic tự động hóa nghiệp vụ giữ ở code, template/task chỉ gọi theo TÊN.
// Task động có `hookKeys[]`; khi hoàn thành, work-engine chạy lần lượt các hook tương ứng.

export interface HookCtx {
  projectId: string | null
  userId: string
  resultData?: Record<string, unknown> | null
}

type HookFn = (ctx: HookCtx) => Promise<void>

export const HOOK_REGISTRY: Record<string, HookFn> = {
  // BOM duyệt xong → đồng bộ ngân sách vật tư (planned)
  syncBOMtoBudget: async ({ projectId, userId }) => {
    if (projectId) await syncBOMtoBudget(projectId, userId)
  },
  // PO duyệt → cộng committed
  syncPOtoBudget: async ({ projectId, userId, resultData }) => {
    const poId = resultData?.poId as string | undefined
    if (projectId && poId) await syncPOtoBudget(projectId, poId, userId)
  },
  // Dự toán (form ESTIMATE) duyệt → đồng bộ planned các hạng mục ngân sách
  syncEstimateToBudget: async ({ projectId, userId, resultData }) => {
    await maybeSyncEstimateToBudget(projectId, userId, resultData)
  },
}

// ── Dự toán → Budget planned (tự phát hiện theo keys form ESTIMATE) ──

const ESTIMATE_TOTAL_KEYS = ['totalMaterial', 'totalLabor', 'totalService', 'totalOverhead'] as const

function extractEstimateTotals(rd?: Record<string, unknown> | null): EstimateTotals | null {
  if (!rd || typeof rd !== 'object') return null
  const totals: EstimateTotals = {}
  let found = false
  for (const key of ESTIMATE_TOTAL_KEYS) {
    const raw = rd[key]
    const n = typeof raw === 'string' ? Number(raw) : raw
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      totals[key] = n
      found = true
    }
  }
  return found ? totals : null
}

/** Task mang dữ liệu form ESTIMATE hoàn thành/duyệt → upsert Budget.planned theo category.
 *  Idempotent (recompute-set) — an toàn khi gọi cả từ hookKeys lẫn auto-detect. Nuốt lỗi để không chặn hoàn thành task. */
export async function maybeSyncEstimateToBudget(
  projectId: string | null,
  userId: string,
  resultData?: Record<string, unknown> | null,
): Promise<void> {
  if (!projectId) return
  const totals = extractEstimateTotals(resultData)
  if (!totals) return
  try {
    await syncEstimateToBudget(projectId, totals, userId)
  } catch (e) {
    console.error('[work-hooks] lỗi syncEstimateToBudget:', e)
  }
}

export async function runHooks(hookKeys: string[] | undefined, ctx: HookCtx): Promise<void> {
  if (!hookKeys?.length) return
  for (const key of hookKeys) {
    const fn = HOOK_REGISTRY[key]
    if (!fn) { console.warn(`[work-hooks] hook không tồn tại: ${key}`); continue }
    try { await fn(ctx) } catch (e) { console.error(`[work-hooks] lỗi hook ${key}:`, e) }
  }
}

export const AVAILABLE_HOOKS = Object.keys(HOOK_REGISTRY)
