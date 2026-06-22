import { syncBOMtoBudget, syncPOtoBudget } from './sync-engine'

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
