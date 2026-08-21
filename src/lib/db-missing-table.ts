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
