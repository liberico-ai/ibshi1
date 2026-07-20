// Tự động dọn log quá hạn (Nhật ký + Error Logs).
// Ngưỡng lưu = SystemConfig 'log_retention_days' (mặc định 90). Xóa theo batch để tránh khóa bảng lâu.
import prisma from '@/lib/db'

const KEY = 'log_retention_days'
const DEFAULT_DAYS = 90
const MIN_DAYS = 7
const MAX_DAYS = 3650
const BATCH = 5000

/** Số ngày giữ log. Đọc SystemConfig, kẹp trong [7, 3650], lỗi/không có → 90. */
export async function getRetentionDays(): Promise<number> {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  const n = row ? parseInt(row.value, 10) : NaN
  if (!Number.isFinite(n)) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n))
}

export interface PurgeResult {
  retentionDays: number
  cutoff: string
  auditLogs: number
  errorLogs: number
  dryRun: boolean
}

/** Xóa (hoặc chỉ đếm nếu dryRun) log có createdAt < now - retentionDays. */
export async function purgeOldLogs(opts: { dryRun?: boolean } = {}): Promise<PurgeResult> {
  const dryRun = !!opts.dryRun
  const days = await getRetentionDays()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  if (dryRun) {
    const [auditLogs, errorLogs] = await Promise.all([
      prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } }),
      prisma.errorLog.count({ where: { createdAt: { lt: cutoff } } }),
    ])
    return { retentionDays: days, cutoff: cutoff.toISOString(), auditLogs, errorLogs, dryRun: true }
  }

  const auditLogs = await purgeAuditLogs(cutoff)
  const errorLogs = await purgeErrorLogs(cutoff)
  return { retentionDays: days, cutoff: cutoff.toISOString(), auditLogs, errorLogs, dryRun: false }
}

async function purgeAuditLogs(cutoff: Date): Promise<number> {
  let total = 0
  for (;;) {
    const ids = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: BATCH })
    if (ids.length === 0) break
    const r = await prisma.auditLog.deleteMany({ where: { id: { in: ids.map(x => x.id) } } })
    total += r.count
    if (ids.length < BATCH) break
  }
  return total
}

async function purgeErrorLogs(cutoff: Date): Promise<number> {
  let total = 0
  for (;;) {
    const ids = await prisma.errorLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: BATCH })
    if (ids.length === 0) break
    const r = await prisma.errorLog.deleteMany({ where: { id: { in: ids.map(x => x.id) } } })
    total += r.count
    if (ids.length < BATCH) break
  }
  return total
}
