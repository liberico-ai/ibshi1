import prisma from './db'

// ─────────────────────────────────────────────────────────────────────────────
// Cờ bật/tắt đọc từ SystemConfig — dùng cho các CỔNG quy trình tạm cắt.
//
// Nguyên tắc: không xoá luật, chỉ bọc sau một cờ. Cần siết lại thì đổi một dòng trong
// bảng system_config (PUT /api/admin/config, vai R10) — không sửa code, không deploy.
//
// Ba tầng: biến môi trường đè trước → SystemConfig trong DB → mặc định do chỗ khai quyết.
// DB lỗi thì rơi về mặc định; các cổng này để siết quy trình chứ không phải rào an toàn,
// nên hỏng DB thì ưu tiên cho người dùng làm việc được.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 60_000

export interface ConfigFlag {
  key: string
  /** Đọc giá trị hiện tại (có cache 60 giây). */
  enabled: () => Promise<boolean>
  /**
   * Xoá cache của CHÍNH tiến trình này. Các tiến trình khác (nhiều bản chạy, hoặc Next dev
   * chia gói theo route) vẫn giữ giá trị cũ tối đa 60 giây — đổi cờ xong chờ một phút là chắc.
   */
  invalidate: () => void
}

export function makeConfigFlag(opts: {
  key: string
  /** Tên biến môi trường đè lên DB, vd 'FF_WO_REQUIRE_MATERIAL'. */
  envVar: string
  /** Giá trị khi không khai ở đâu cả. */
  defaultValue: boolean
}): ConfigFlag {
  let cache: { val: boolean; at: number } | null = null

  return {
    key: opts.key,
    async enabled() {
      const env = process.env[opts.envVar]
      if (env === 'true') return true
      if (env === 'false') return false

      const now = Date.now()
      if (cache && now - cache.at < TTL_MS) return cache.val

      let val = opts.defaultValue
      try {
        const row = await prisma.systemConfig.findUnique({ where: { key: opts.key } })
        if (row) val = row.value === 'true'
      } catch {
        val = opts.defaultValue
      }
      cache = { val, at: now }
      return val
    },
    invalidate() { cache = null },
  }
}
