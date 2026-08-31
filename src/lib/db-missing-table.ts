// Nhận diện lỗi "bảng/cột chưa tồn tại" (chưa chạy migration) để báo cho người dùng biết PHẢI
// LÀM GÌ, thay vì ném "Lỗi hệ thống" chung chung khiến ai nhìn cũng tưởng phần mềm hỏng.
//
// Postgres 42P01 = undefined_table, 42703 = undefined_column.
// Prisma: P2021 = table does not exist, P2022 = column does not exist.

export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: { code?: string } }
  const code = e?.code || e?.meta?.code
  if (code === 'P2021' || code === 'P2022' || code === '42P01' || code === '42703') return true
  const msg = String(e?.message || '')
  return /does not exist in the current database|relation ".*" does not exist|column .* does not exist/i.test(msg)
}

export const MIGRATION_HINT =
  'Tính năng này cần bảng dữ liệu mới chưa có trong CSDL. Chạy "npx prisma migrate deploy" rồi thử lại.'

/**
 * Máy chủ đang chạy Prisma Client CŨ (sinh trước khi thêm bảng) → `prisma.<model>` là undefined
 * → "Cannot read properties of undefined". Code thì đúng, chỉ cần khởi động lại server.
 * Hay gặp ngay sau khi thêm bảng mới, và rất dễ bị hiểu nhầm thành phần mềm hỏng.
 */
export function isStaleClientError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false
  const msg = err.message
  // Bắt HẸP đúng dấu hiệu `prisma.<model>` là undefined: "Cannot read properties of undefined
  // (reading 'create'|'findMany'|…)". Không bắt rộng kiểu "is not a function", nếu không một
  // lỗi lập trình thật cũng bị chẩn đoán nhầm thành "khởi động lại server".
  return /Cannot read properties of undefined \(reading '(create|createMany|find\w+|update\w*|delete\w*|count|aggregate|upsert)'\)/i.test(msg)
    || /undefined is not an object \(evaluating '\w+\.(create|find\w+|update|delete|count)/i.test(msg)
}

export const STALE_CLIENT_HINT =
  'Máy chủ đang chạy bản Prisma Client cũ (chưa biết bảng mới). Khởi động lại server rồi thử lại.'

/**
 * Thông báo lỗi CSDL nói rõ phải làm gì. Dùng ở khối catch của route thay cho "Lỗi hệ thống".
 * Không lộ dữ liệu nhạy cảm: chỉ trả message của lỗi, không kèm stack.
 */
export function describeDbError(err: unknown, fallback: string): string {
  if (isMissingTableError(err)) return MIGRATION_HINT
  if (isStaleClientError(err)) return STALE_CLIENT_HINT
  const msg = err instanceof Error ? err.message : String(err)
  // "Unknown argument `item`" = client đã sinh KHÔNG có cột đó. Hai khả năng: server chạy client
  // cũ, hoặc code gọi sai tên cột. Nêu CẢ HAI — đoán chắc một bên là dễ chỉ sai đường.
  const unknownArg = msg.match(/Unknown argument `(\w+)`/)
  if (unknownArg) {
    return `Prisma không biết cột "${unknownArg[1]}". Nếu vừa thêm cột thì khởi động lại server; nếu không thì tên cột đang sai.`
  }
  return msg ? `${fallback}: ${msg}` : fallback
}
