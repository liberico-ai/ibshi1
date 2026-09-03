// ─────────────────────────────────────────────────────────────────────────────
// Sinh mã chứng từ dạng PREFIX-0001.
//
// Cách cũ `count() + 1` sai hai đường:
//   • Xoá/huỷ một bản ghi là số đếm tụt xuống → mã kế tiếp trùng mã đã có.
//   • Hai người tạo cùng lúc thì cùng đọc một số đếm → cũng trùng.
// Cả hai đều nổ ở tầng DB dưới dạng "Unique constraint failed", người dùng chỉ thấy
// lỗi hệ thống. Từ khi một ITEM giao được cho nhiều xưởng, ba xưởng báo khối lượng
// cùng ngày là chuyện thường, nên chỗ này phải chắc.
//
// Cách này lấy số LỚN NHẤT đang có rồi +1, và thử lại khi vẫn đụng.
// ─────────────────────────────────────────────────────────────────────────────

export interface NextCodeOptions {
  /** Phần đầu cố định, vd 'JC-26-' — mã sinh ra là prefix + số đã đệm 0. */
  prefix: string
  /** Số chữ số của phần đuôi (mặc định 3). */
  pad?: number
  /** Trả về mã lớn nhất hiện có bắt đầu bằng prefix, hoặc null nếu chưa có. */
  findLatest: (prefix: string) => Promise<string | null>
}

/** Mã kế tiếp = (số lớn nhất đang dùng) + 1. */
export async function nextCode(opts: NextCodeOptions): Promise<string> {
  const pad = opts.pad ?? 3
  const latest = await opts.findLatest(opts.prefix)
  const n = latest ? Number(latest.slice(opts.prefix.length).replace(/\D/g, '')) : 0
  return `${opts.prefix}${String((Number.isFinite(n) ? n : 0) + 1).padStart(pad, '0')}`
}

/** Lỗi trùng khoá của Prisma. */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002'
}

/**
 * Sinh mã rồi tạo bản ghi; đụng mã thì lấy mã kế tiếp và thử lại.
 * Bọc được cả trường hợp hai người bấm cùng lúc — người sau nhận mã tiếp theo.
 */
export async function createWithCode<T>(
  opts: NextCodeOptions & { attempts?: number },
  create: (code: string) => Promise<T>,
): Promise<T> {
  const attempts = opts.attempts ?? 5
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    const code = await nextCode(opts)
    try {
      return await create(code)
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}
