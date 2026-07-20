// ── Token liên kết Telegram tự phục vụ (zero-schema) ──
// Lưu trong SystemConfig (JSON map), tự hết hạn 10 phút, dùng MỘT lần.
// Không phụ thuộc Redis (DB luôn sẵn) và không thêm bảng/cột.

import { randomBytes } from 'crypto'
import prisma from './db'

const KEY = 'telegram_link_tokens'
const TTL_MS = 10 * 60 * 1000

type TokenMap = Record<string, { userId: string; exp: number }>

async function readTokens(): Promise<TokenMap> {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  if (!row?.value) return {}
  try { return JSON.parse(row.value) as TokenMap } catch { return {} }
}
async function writeTokens(m: TokenMap): Promise<void> {
  const value = JSON.stringify(m)
  await prisma.systemConfig.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } })
}
function prune(m: TokenMap): TokenMap {
  const now = Date.now()
  const out: TokenMap = {}
  for (const [t, v] of Object.entries(m)) if (v.exp > now) out[t] = v
  return out
}

/** Sinh token liên kết cho user (10 phút, dùng 1 lần). */
export async function createLinkToken(userId: string): Promise<string> {
  const token = randomBytes(16).toString('hex')
  const m = prune(await readTokens())
  m[token] = { userId, exp: Date.now() + TTL_MS }
  await writeTokens(m)
  return token
}

/** Đổi token lấy userId + xóa token (một lần). Trả null nếu hết hạn/không hợp lệ. */
export async function consumeLinkToken(token: string): Promise<string | null> {
  const m = prune(await readTokens())
  const entry = m[token]
  delete m[token]
  await writeTokens(m) // lưu bản đã prune + đã xóa token vừa dùng
  return entry ? entry.userId : null
}
