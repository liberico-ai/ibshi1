// ══════════════════════════════════════════════════════════════
// PR Materialize (bước 3/5) — Task.resultData → bản ghi PurchaseRequest thật
//
// SAU FEATURE FLAG `FF_PR_MATERIALIZE`, MẶC ĐỊNH TẮT.
// Flag tắt ⟹ hàm trả về ngay, không đọc DB, không ghi gì.
//
// ── Vì sao ALLOWLIST theo bước (không phải denylist) ──────────
// Nhu cầu mua PHÁT SINH ở: P2.1 (VT chính) · P2.2 (hàn/sơn) · P2.3 (tiêu hao)
//   + task FREE (không có bước, vd "PR dây hàn" của R07).
// P3.5 "Thương mại tìm NCC" / P3.6 "BGĐ duyệt báo giá" chỉ MANG BẢN SAO (đã trừ tồn)
//   để đi mua — materialize luôn cả 2 nhánh = ĐẾM ĐÔI cùng một nhu cầu.
//   (Số liệu prod: I-111 P2.1 Σ58036 vs P3.5 Σ26096 — cùng 1 nhu cầu, 2 góc nhìn.)
// Chính route result-data cũng đã coi P2.1/P2.2/P2.3 là nguồn và P3.5 là bên tiêu thụ.
// Bước lạ (P3.3…) → BỎ QUA nhưng GHI LOG, không im lặng.
//
// 1 task → tối đa 1 PR (sourceTaskId UNIQUE ⟹ upsert, chạy lại không nhân bản).
// 1 dự án CÓ THỂ nhiều PR (thép / hàn-sơn / tiêu hao / phát sinh) — đúng bản chất.
// ══════════════════════════════════════════════════════════════

import prisma from '@/lib/db'
import { normalizePrLines, type PrLine } from '@/lib/pr-normalizer'

/** Bước PHÁT SINH nhu cầu mua → được materialize */
export const PR_DEMAND_STEPS = ['P2.1', 'P2.2', 'P2.3'] as const
/** Bước ĐI MUA / duyệt giá — chỉ mang bản sao → TUYỆT ĐỐI KHÔNG materialize */
export const PR_EXCLUDED_STEPS = ['P3.5', 'P3.6'] as const
/** Task tự do (không thuộc quy trình 36 bước) — vẫn là nhu cầu mua thật */
const FREE_TASK = 'FREE'

// Cờ bật/tắt: env FF_PR_MATERIALIZE thắng tuyệt đối (dùng cho script backfill / CI);
// nếu env không đặt → đọc SystemConfig 'ff_pr_materialize' (bật/tắt runtime, không restart).
// Cache 30s để không đọc DB mỗi lần lưu task. Mặc định TẮT.
let ffCache: { val: boolean; at: number } | null = null
const FF_TTL_MS = 30_000

export async function isPrMaterializeEnabled(): Promise<boolean> {
  if (process.env.FF_PR_MATERIALIZE === 'true') return true
  if (process.env.FF_PR_MATERIALIZE === 'false') return false

  const now = Date.now()
  if (ffCache && now - ffCache.at < FF_TTL_MS) return ffCache.val
  let val = false
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'ff_pr_materialize' } })
    val = row?.value === 'true'
  } catch { val = false } // DB lỗi → coi như TẮT (an toàn)
  ffCache = { val, at: now }
  return val
}

/** Xoá cache cờ (gọi sau khi đổi SystemConfig để có hiệu lực ngay). */
export function invalidatePrFlagCache(): void { ffCache = null }

export type MaterializeResult =
  | { materialized: false; reason: string }
  | { materialized: true; created: boolean; prId: string; prCode: string; lineCount: number }

/** Task thuộc diện materialize PR? (nguồn nhu cầu P2.1/2.2/2.3 hoặc task FREE) */
export function isTaskTypeAllowedForPr(taskType: string): boolean {
  return (PR_DEMAND_STEPS as readonly string[]).includes(taskType) || taskType === FREE_TASK
}
const isAllowed = isTaskTypeAllowedForPr

function isExcluded(taskType: string): boolean {
  return (PR_EXCLUDED_STEPS as readonly string[]).includes(taskType)
}

/** PrLine → dữ liệu PurchaseRequestItem (materialId có thể null → dùng snapshot field) */
function toItemData(l: PrLine) {
  return {
    materialId: l.materialId ?? null,
    itemCode: l.itemCode ?? null,
    description: l.description ?? null,
    profile: l.profile ?? null,
    grade: l.grade ?? null,
    unit: l.unit ?? null,
    quantity: l.quantity,
    requiredDate: l.requiredDate ?? null,
    notes: l.notes ?? null,
  }
}

/** Sinh prCode theo đúng quy ước sẵn có: PR-{YY}-{seq:3} */
async function nextPrCode(): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2)
  const last = await prisma.purchaseRequest.findFirst({
    where: { prCode: { startsWith: `PR-${year}-` } },
    orderBy: { prCode: 'desc' },
  })
  const seq = last ? parseInt(last.prCode.split('-')[2]) + 1 : 1
  return `PR-${year}-${String(seq).padStart(3, '0')}`
}

/**
 * Sinh/cập nhật PurchaseRequest từ resultData của task. Idempotent theo sourceTaskId.
 * PR luôn ở trạng thái DRAFT — KHÔNG tự duyệt, KHÔNG tự tạo PO. Người vẫn duyệt.
 */
export async function maybeMaterializePr(taskId: string, actorUserId: string): Promise<MaterializeResult> {
  if (!(await isPrMaterializeEnabled())) return { materialized: false, reason: 'flag-off' }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, taskType: true, projectId: true, resultData: true, createdBy: true },
  })
  if (!task) return { materialized: false, reason: 'task-not-found' }

  const lines = normalizePrLines(task.resultData)
  if (lines.length === 0) return { materialized: false, reason: 'no-pr-lines' }

  // P3.5/P3.6 có dòng PR là CHUYỆN BÌNH THƯỜNG (bản sao đi mua) → bỏ qua, không cảnh báo.
  if (isExcluded(task.taskType)) return { materialized: false, reason: 'excluded-step' }

  if (!isAllowed(task.taskType)) {
    console.warn(
      `[pr-materialize] Task ${taskId} bước "${task.taskType}" có ${lines.length} dòng PR ` +
      `nhưng KHÔNG nằm trong allowlist → bỏ qua. Rà lại xem có phải nguồn nhu cầu mới không.`
    )
    return { materialized: false, reason: 'step-not-in-allowlist' }
  }

  if (!task.projectId) return { materialized: false, reason: 'no-project' }

  const existing = await prisma.purchaseRequest.findUnique({
    where: { sourceTaskId: taskId },
    select: { id: true, prCode: true, status: true },
  })

  // KHÔNG ghi đè PR đã rời khỏi nháp (đã duyệt/đã ra PO) — sửa task không được phá PR đã duyệt.
  if (existing && existing.status !== 'DRAFT') {
    console.warn(`[pr-materialize] PR ${existing.prCode} đang ở trạng thái ${existing.status} → không ghi đè.`)
    return { materialized: false, reason: 'pr-not-draft' }
  }

  const itemsData = lines.map(toItemData)

  if (existing) {
    // Upsert: thay toàn bộ dòng (task sửa rồi lưu lại → PR cập nhật, không nhân bản)
    await prisma.$transaction([
      prisma.purchaseRequestItem.deleteMany({ where: { prId: existing.id } }),
      prisma.purchaseRequest.update({
        where: { id: existing.id },
        data: { items: { create: itemsData } },
      }),
    ])
    return { materialized: true, created: false, prId: existing.id, prCode: existing.prCode, lineCount: itemsData.length }
  }

  const prCode = await nextPrCode()
  const pr = await prisma.purchaseRequest.create({
    data: {
      prCode,
      projectId: task.projectId,
      requestedBy: actorUserId || task.createdBy,
      status: 'DRAFT', // KHÔNG tự duyệt
      sourceTaskId: taskId,
      items: { create: itemsData },
    },
    select: { id: true, prCode: true },
  })
  return { materialized: true, created: true, prId: pr.id, prCode: pr.prCode, lineCount: itemsData.length }
}

/**
 * Bọc an toàn cho các route: KHÔNG BAO GIỜ throw.
 * Materialize PR là việc phụ — hỏng thì ghi log, tuyệt đối không làm hỏng việc lưu task.
 */
export async function materializePrSafe(taskId: string, actorUserId: string): Promise<void> {
  try {
    const r = await maybeMaterializePr(taskId, actorUserId)
    if (r.materialized) {
      console.log(`[pr-materialize] ${r.created ? 'Tạo' : 'Cập nhật'} ${r.prCode} từ task ${taskId} — ${r.lineCount} dòng`)
    }
  } catch (err) {
    console.error(`[pr-materialize] Lỗi khi materialize task ${taskId}:`, err)
  }
}
