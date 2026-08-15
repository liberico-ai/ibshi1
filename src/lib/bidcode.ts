// PORT Thương Mại — sinh & parse mã BID (bám lib/bidcode.js của Commerce).
// Format: BID[!]-<PROJ>-<YYMM>-<MAT>-<NNN>[<VAR>]
//   BID!  = khẩn (optional) · PROJ = mã ngắn dự án (VPI095) · YYMM = năm+tháng (2606)
//   MAT   = nhóm VT (VTC/VPK/VDK/VBP/VTH/VTS/VTP/MIX) · NNN = seq 3 số (reset theo tháng+proj)
//   VAR   = A/B/C khi re-issue
import type { PrismaClient } from '@prisma/client'

const BIDCODE_REGEX = /^BID(!?)-([A-Z0-9]{3,8})-(\d{4})-([A-Z]{3})-(\d{3})([A-Z])?$/

export const MAT_LABELS: Record<string, string> = {
  VTC: 'Thép chính', VPK: 'Phụ kiện, bu lông', VDK: 'Đóng kiện', VBP: 'Biện pháp',
  VTH: 'Tiêu hao', VTS: 'Sơn & xử lý bề mặt', VTP: 'Dự phòng', MIX: 'Nhiều nhóm', ALL: 'Tất cả',
}

export interface ParsedBidCode {
  raw: string; urgent: boolean; proj: string; yymm: string; year: number; month: number
  matGroup: string; seq: number; variant: string | null
}

export function parseBidCode(code?: string | null): ParsedBidCode | null {
  if (!code || typeof code !== 'string') return null
  const m = code.match(BIDCODE_REGEX)
  if (!m) return null
  const [, urgent, proj, yymm, mat, seq, variant] = m
  return {
    raw: code, urgent: Boolean(urgent), proj, yymm,
    year: 2000 + parseInt(yymm.slice(0, 2), 10), month: parseInt(yymm.slice(2, 4), 10),
    matGroup: mat, seq: parseInt(seq, 10), variant: variant || null,
  }
}

/** '25-VPI-I-095' → 'VPI095'. Fallback: bỏ ký tự lạ, hoa, cắt 8. */
export function projShort(projectCode?: string | null): string {
  if (!projectCode) return 'ALL'
  const m = projectCode.match(/^\d{2}-([A-Z]{3})-[A-Z]-?(\d+)$/)
  if (m) return `${m[1]}${m[2].padStart(3, '0')}`
  return projectCode.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)
}

/** Suy nhóm VT: 1 nhóm→nhóm đó; đa nhóm >60% ưu thế→nhóm đó; còn lại→MIX; rỗng→ALL. */
export function deriveMatGroup(items: Array<{ materialGroupCode?: string | null }>): string {
  if (!items || items.length === 0) return 'ALL'
  const counts: Record<string, number> = {}
  for (const it of items) {
    const m = it.materialGroupCode || 'ALL'
    counts[m] = (counts[m] || 0) + 1
  }
  const codes = Object.keys(counts)
  if (codes.length === 1) return codes[0]
  const total = items.length
  const top = codes.sort((a, b) => counts[b] - counts[a])[0]
  return counts[top] / total > 0.6 ? top : 'MIX'
}

export function yymmOf(date = new Date()): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${yy}${mm}`
}

/** Sinh mã BID kế tiếp cho (proj, yymm) — seq = max hiện có + 1 (variant giữ nguyên seq). */
export async function generateNextBidCode(
  prisma: PrismaClient,
  opts: { projShort: string; yymm: string; mat: string; urgent?: boolean; variant?: string | null },
): Promise<{ code: string; seq: number }> {
  const { projShort: proj, yymm, mat, urgent = false, variant = null } = opts
  const rows = await prisma.bidAnalysis.findMany({
    where: { bidCodeProj: proj, bidCodeYymm: yymm },
    select: { bidCodeSeq: true },
  })
  const maxSeq = rows.reduce((m, r) => Math.max(m, r.bidCodeSeq || 0), 0)
  const nextSeq = variant ? maxSeq : maxSeq + 1
  const prefix = urgent ? 'BID!' : 'BID'
  return { code: `${prefix}-${proj}-${yymm}-${mat}-${String(nextSeq).padStart(3, '0')}${variant || ''}`, seq: nextSeq }
}

/** Gợi ý chủ đề: "Mua <1-3 tên VT> cho DA <code>" (≤100 ký tự). */
export function suggestSubject(items: Array<{ itemName?: string | null }>, projectCode?: string | null): string {
  if (!items || items.length === 0) return ''
  const names = [...new Set(items.map(i => i.itemName).filter(Boolean))] as string[]
  const head = names.slice(0, 3).join(', ')
  const more = names.length > 3 ? ` và ${names.length - 3} mã khác` : ''
  const proj = projectCode ? ` cho DA ${projectCode}` : ''
  const subj = `Mua ${head}${more}${proj}`
  return subj.length > 100 ? subj.slice(0, 97) + '...' : subj
}
