import * as XLSX from 'xlsx'
import { createHash } from 'crypto'

export interface BriefingRow {
  rowIndex: number
  stt: string
  systemId: string
  projectCode: string
  projectNameNew: string
  title: string
  deptText: string
  assigneeName: string
  openDate: string
  deadline: string
  deadlineISO: string
  status: string
  criteria: string
  proposal: string
  decision: string
  notes: string
}

export type BriefingAction =
  | { type: 'update'; row: BriefingRow; taskId: string }
  | { type: 'create'; row: BriefingRow }
  | { type: 'error'; row: BriefingRow; reason: string }

const STATUS_MAP: Record<string, { status: string; blocked?: boolean }> = {
  'mới': { status: 'OPEN' },
  'đang xử lý': { status: 'IN_PROGRESS' },
  'chờ kết thúc': { status: 'AWAITING_REVIEW' },
  'bị trả lại': { status: 'RETURNED' },
  'tắc': { status: 'IN_PROGRESS', blocked: true },
  'xong': { status: 'DONE' },
  'hủy': { status: 'CANCELLED' },
}

export function mapStatusLabel(label: string): { status: string; blocked: boolean } | null {
  const key = label.trim().toLowerCase()
  const m = STATUS_MAP[key]
  if (!m) return null
  return { status: m.status, blocked: !!m.blocked }
}

const DEPT_MAP: Record<string, string> = {
  'dự án': 'R02',
  'pm': 'R02',
  'thương mại': 'R07',
  'kinh doanh': 'R07',
  'sản xuất': 'R06',
  'kế hoạch': 'R03',
  'kế toán': 'R08',
  'qc': 'R09',
  'thiết kế': 'R04',
  'hcns': 'R10',
  'kho': 'R05',
  'ban gđ': 'R01',
}

export function mapDept(deptText: string): string | null {
  const key = deptText.trim().toLowerCase()
  return DEPT_MAP[key] || null
}

function serialToDateStr(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000)
  const d = new Date(ms)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

function cell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return (v > 25569 && v < 80000) ? serialToDateStr(v) : String(v)
  if (v instanceof Date) return serialToDateStr(Math.round(v.getTime() / 86400000) + 25569)
  return String(v).replace(/\s+/g, ' ').trim()
}

export function parseDateDMY(s: string): string {
  const m = /(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/.exec(s)
  if (!m) return ''
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10)
  let y = parseInt(m[3], 10)
  if (y < 100) y += 2000
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const EXPECTED_HEADERS = [
  'STT', 'ID hệ thống', 'Dự án', 'Tên dự án', 'Nội dung công việc',
  'Phòng xử lý', 'Người thực hiện', 'Ngày mở', 'Hạn',
  'Số ngày quá hạn', 'Trạng thái', 'Tiêu chí hoàn thành',
  'Đề xuất/hướng xử lý', 'Quyết định BGĐ', 'Ghi chú',
]

export function parseBriefingXlsx(buffer: Buffer | ArrayBuffer): BriefingRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false })
  if (raw.length < 2) return []

  const hdr = raw[0].map((c) => cell(c))
  const colIdx: Record<string, number> = {}
  for (const expected of EXPECTED_HEADERS) {
    const idx = hdr.findIndex((h) => h === expected)
    if (idx >= 0) colIdx[expected] = idx
  }

  if (colIdx['Nội dung công việc'] == null) {
    const fuzzy = hdr.findIndex((h) => /nội dung/i.test(h))
    if (fuzzy >= 0) colIdx['Nội dung công việc'] = fuzzy
  }

  const col = (row: unknown[], name: string): string => {
    const idx = colIdx[name]
    return idx != null ? cell(row[idx]) : ''
  }

  const rows: BriefingRow[] = []
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i]
    const title = col(r, 'Nội dung công việc')
    const systemId = col(r, 'ID hệ thống')
    if (!title && !systemId) continue

    const deadlineRaw = col(r, 'Hạn')
    const deadlineISO = parseDateDMY(deadlineRaw)

    rows.push({
      rowIndex: i + 1,
      stt: col(r, 'STT'),
      systemId,
      projectCode: col(r, 'Dự án'),
      projectNameNew: col(r, 'Tên dự án'),
      title,
      deptText: col(r, 'Phòng xử lý'),
      assigneeName: col(r, 'Người thực hiện'),
      openDate: col(r, 'Ngày mở'),
      deadline: deadlineRaw,
      deadlineISO,
      status: col(r, 'Trạng thái'),
      criteria: col(r, 'Tiêu chí hoàn thành'),
      proposal: col(r, 'Đề xuất/hướng xử lý'),
      decision: col(r, 'Quyết định BGĐ'),
      notes: col(r, 'Ghi chú'),
    })
  }
  return rows
}

// ── Vietnamese name matching ──────────────────────────────

export function removeDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, c => c === 'đ' ? 'd' : 'D')
}

export function splitAssigneeNames(raw: string): string[] {
  return raw.split(/[,+&/]/).map(s => s.trim()).filter(Boolean)
}

export interface MatchableUser {
  id: string
  fullName: string
  username: string
  roleCode: string
}

export interface UserMatchResult {
  inputName: string
  userId: string | null
  match: 'ok' | 'ambiguous' | 'none'
  matchMethod: string
  candidates: { id: string; fullName: string; roleCode: string }[]
}

export function matchUserName(inputName: string, users: MatchableUser[]): UserMatchResult {
  const norm = removeDiacritics(inputName.trim().toLowerCase())
  if (!norm) return { inputName, userId: null, match: 'none', matchMethod: '', candidates: [] }

  const toCand = (u: MatchableUser) => ({ id: u.id, fullName: u.fullName, roleCode: u.roleCode })

  // (a) exact fullName
  const byFull = users.filter(u => removeDiacritics(u.fullName.toLowerCase()) === norm)
  if (byFull.length === 1) return { inputName, userId: byFull[0].id, match: 'ok', matchMethod: 'fullName', candidates: [] }
  if (byFull.length > 1) return { inputName, userId: null, match: 'ambiguous', matchMethod: 'fullName', candidates: byFull.map(toCand) }

  // (b) username
  const byUser = users.filter(u => u.username && removeDiacritics(u.username.toLowerCase()) === norm)
  if (byUser.length === 1) return { inputName, userId: byUser[0].id, match: 'ok', matchMethod: 'username', candidates: [] }

  // (c) given name = last token of fullName
  const byGiven = users.filter(u => {
    const parts = removeDiacritics(u.fullName.toLowerCase()).split(/\s+/)
    return parts.length > 0 && parts[parts.length - 1] === norm
  })
  if (byGiven.length === 1) return { inputName, userId: byGiven[0].id, match: 'ok', matchMethod: 'givenName', candidates: [] }
  if (byGiven.length > 1) return { inputName, userId: null, match: 'ambiguous', matchMethod: 'givenName', candidates: byGiven.map(toCand) }

  // (d) fullName contains token
  const byContains = users.filter(u => removeDiacritics(u.fullName.toLowerCase()).includes(norm))
  if (byContains.length === 1) return { inputName, userId: byContains[0].id, match: 'ok', matchMethod: 'contains', candidates: [] }
  if (byContains.length > 1) return { inputName, userId: null, match: 'ambiguous', matchMethod: 'contains', candidates: byContains.map(toCand) }

  return { inputName, userId: null, match: 'none', matchMethod: '', candidates: [] }
}

export function computeImportKey(title: string, projectId: string | null, deadlineISO: string, userId: string): string {
  const raw = [title, projectId || '', deadlineISO, userId].join('|')
  return createHash('sha1').update(raw).digest('hex')
}

export function classifyRows(rows: BriefingRow[]): BriefingAction[] {
  return rows.map((row) => {
    if (row.systemId.trim()) {
      return { type: 'update' as const, row, taskId: row.systemId.trim() }
    }
    if (!row.title.trim()) {
      return { type: 'error' as const, row, reason: 'Việc mới thiếu "Nội dung công việc"' }
    }
    if (!row.assigneeName.trim() && !row.deptText.trim()) {
      return { type: 'error' as const, row, reason: 'Việc mới thiếu cả "Người thực hiện" lẫn "Phòng xử lý"' }
    }
    return { type: 'create' as const, row }
  })
}
