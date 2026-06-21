import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseBriefingXlsx, classifyRows, mapStatusLabel, mapDept, parseDateDMY, computeImportKey } from '../briefing-import-parser'

function makeSheet(rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Giao ban tuần')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const HEADER = [
  'STT', 'ID hệ thống', 'Dự án', 'Tên dự án', 'Nội dung công việc',
  'Phòng xử lý', 'Người thực hiện', 'Ngày mở', 'Hạn',
  'Số ngày quá hạn', 'Trạng thái', 'Tiêu chí hoàn thành',
  'Đề xuất/hướng xử lý', 'Quyết định BGĐ', 'Ghi chú',
]

describe('parseDateDMY', () => {
  it('parses dd/mm/yyyy', () => {
    expect(parseDateDMY('15/06/2026')).toBe('2026-06-15')
  })
  it('parses d-m-yy', () => {
    expect(parseDateDMY('1-3-26')).toBe('2026-03-01')
  })
  it('returns empty for invalid', () => {
    expect(parseDateDMY('abc')).toBe('')
    expect(parseDateDMY('32/13/2026')).toBe('')
  })
})

describe('mapStatusLabel', () => {
  it('maps all 6 Vietnamese labels', () => {
    expect(mapStatusLabel('Mới')).toEqual({ status: 'OPEN', blocked: false })
    expect(mapStatusLabel('Đang xử lý')).toEqual({ status: 'IN_PROGRESS', blocked: false })
    expect(mapStatusLabel('Tắc')).toEqual({ status: 'IN_PROGRESS', blocked: true })
    expect(mapStatusLabel('Bị trả lại')).toEqual({ status: 'RETURNED', blocked: false })
    expect(mapStatusLabel('Xong')).toEqual({ status: 'DONE', blocked: false })
    expect(mapStatusLabel('Hủy')).toEqual({ status: 'CANCELLED', blocked: false })
  })
  it('returns null for unknown', () => {
    expect(mapStatusLabel('random')).toBeNull()
  })
})

describe('mapDept', () => {
  it('maps Vietnamese department names to role codes', () => {
    expect(mapDept('Dự án')).toBe('R02')
    expect(mapDept('PM')).toBe('R02')
    expect(mapDept('Thương mại')).toBe('R07')
    expect(mapDept('Kinh doanh')).toBe('R07')
    expect(mapDept('Sản xuất')).toBe('R06')
    expect(mapDept('Kế hoạch')).toBe('R03')
    expect(mapDept('Kế toán')).toBe('R08')
    expect(mapDept('QC')).toBe('R09')
    expect(mapDept('Thiết kế')).toBe('R04')
    expect(mapDept('HCNS')).toBe('R10')
  })
  it('is case-insensitive', () => {
    expect(mapDept('dự án')).toBe('R02')
    expect(mapDept('qc')).toBe('R09')
  })
  it('returns null for empty or unknown', () => {
    expect(mapDept('')).toBeNull()
    expect(mapDept('Random')).toBeNull()
  })
})

describe('parseBriefingXlsx — 15 columns', () => {
  it('parses update row (has system ID)', () => {
    const buf = makeSheet([
      HEADER,
      // STT, ID, Dự án, Tên DA, Nội dung, Phòng, Người, Ngày mở, Hạn, QH, TT, Tiêu chí, Đề xuất, QĐ, Ghi chú
      [1, 'task_abc123', '26-WNC-I-109', '', 'PR thiết kế', 'Dự án', 'Lưu Đức Toàn', '01/06/2026', '10/06/2026', 9, 'Đang xử lý', 'PR được duyệt', 'Đẩy nhanh', '', 'Cần review'],
    ])
    const rows = parseBriefingXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].systemId).toBe('task_abc123')
    expect(rows[0].projectCode).toBe('26-WNC-I-109')
    expect(rows[0].projectNameNew).toBe('')
    expect(rows[0].title).toBe('PR thiết kế')
    expect(rows[0].deptText).toBe('Dự án')
    expect(rows[0].assigneeName).toBe('Lưu Đức Toàn')
    expect(rows[0].deadlineISO).toBe('2026-06-10')
    expect(rows[0].status).toBe('Đang xử lý')
    expect(rows[0].criteria).toBe('PR được duyệt')
    expect(rows[0].notes).toBe('Cần review')
  })

  it('parses create row (no system ID)', () => {
    const buf = makeSheet([
      HEADER,
      [2, '', '25-WNC-I-104', 'Nhà xưởng mới', 'Gửi báo giá NCC', 'Thương mại', 'Nguyễn Văn A', '', '20/06/2026', '', 'Mới', 'Có 3 báo giá', 'Liên hệ NCC', '', ''],
    ])
    const rows = parseBriefingXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].systemId).toBe('')
    expect(rows[0].projectNameNew).toBe('Nhà xưởng mới')
    expect(rows[0].title).toBe('Gửi báo giá NCC')
    expect(rows[0].deptText).toBe('Thương mại')
    expect(rows[0].assigneeName).toBe('Nguyễn Văn A')
    expect(rows[0].deadlineISO).toBe('2026-06-20')
  })

  it('parses row with dept only (no assignee name)', () => {
    const buf = makeSheet([
      HEADER,
      [3, '', '', '', 'Họp review', 'QC', '', '', '25/06/2026', '', '', 'Hoàn thành review', '', '', ''],
    ])
    const rows = parseBriefingXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].assigneeName).toBe('')
    expect(rows[0].deptText).toBe('QC')
  })

  it('skips empty rows', () => {
    const buf = makeSheet([
      HEADER,
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      [1, '', '', '', 'Việc thật', 'Sản xuất', 'Ai đó', '', '30/06/2026', '', '', 'Tiêu chí', '', '', ''],
    ])
    const rows = parseBriefingXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Việc thật')
  })
})

describe('classifyRows', () => {
  it('classifies update row with systemId', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, 'existing_task_id', '26-WNC', '', 'Task cũ', 'Dự án', 'Toàn', '', '10/06/2026', '', 'Đang xử lý', '', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('update')
    if (actions[0].type === 'update') expect(actions[0].taskId).toBe('existing_task_id')
  })

  it('classifies create row with assignee', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', '', 'Việc mới', '', 'Ai Đó', '', '25/06/2026', '', '', 'Phải xong', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('create')
  })

  it('classifies create row with dept only (no assignee)', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', '', 'Việc phòng QC', 'QC', '', '', '25/06/2026', '', '', 'Tiêu chí', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('create')
  })

  it('errors when create row missing both assignee and dept', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', '', 'Việc mới', '', '', '', '25/06/2026', '', '', 'Phải xong', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions[0].type).toBe('error')
    if (actions[0].type === 'error') {
      expect(actions[0].reason).toContain('Người thực hiện')
      expect(actions[0].reason).toContain('Phòng xử lý')
    }
  })

  it('allows create row without deadline (no error)', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', '', 'Việc mới', '', 'Ai đó', '', '', '', '', 'Tiêu chí', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions[0].type).toBe('create')
    expect(rows[0].deadlineISO).toBe('')
  })

  it('create row with deadline still works', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', '', 'Việc có hạn', 'Dự án', 'Ai đó', '', '30/06/2026', '', '', 'Tiêu chí', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions[0].type).toBe('create')
    expect(rows[0].deadlineISO).toBe('2026-06-30')
  })

  it('computeImportKey handles empty deadline stably', () => {
    const k1 = computeImportKey('Task', 'proj-1', '', 'user-1')
    const k2 = computeImportKey('Task', 'proj-1', '', 'user-1')
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('computeImportKey', () => {
  it('produces stable sha1 hex from inputs', () => {
    const k1 = computeImportKey('Gửi báo giá', 'proj-123', '2026-06-20', 'user-abc')
    const k2 = computeImportKey('Gửi báo giá', 'proj-123', '2026-06-20', 'user-abc')
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{40}$/)
  })

  it('differs when any input changes', () => {
    const base = computeImportKey('Task A', 'proj-1', '2026-06-20', 'user-1')
    expect(computeImportKey('Task B', 'proj-1', '2026-06-20', 'user-1')).not.toBe(base)
    expect(computeImportKey('Task A', 'proj-2', '2026-06-20', 'user-1')).not.toBe(base)
    expect(computeImportKey('Task A', 'proj-1', '2026-06-21', 'user-1')).not.toBe(base)
    expect(computeImportKey('Task A', 'proj-1', '2026-06-20', 'user-2')).not.toBe(base)
  })

  it('handles null projectId as empty string', () => {
    const k1 = computeImportKey('Task', null, '2026-06-20', 'user-1')
    const k2 = computeImportKey('Task', null, '2026-06-20', 'user-1')
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{40}$/)
  })

  it('same file imported twice yields same keys (idempotent)', () => {
    const buf = makeSheet([
      HEADER,
      [1, '', '25-WNC-I-104', '', 'Gửi báo giá NCC', 'Thương mại', 'Nguyễn Văn A', '', '20/06/2026', '', 'Mới', 'Gửi báo giá', '', '', ''],
      [2, '', '', '', 'Họp review', 'QC', 'Trần B', '', '22/06/2026', '', '', 'Review xong', '', '', ''],
    ])
    const rows1 = parseBriefingXlsx(buf)
    const rows2 = parseBriefingXlsx(buf)
    const userId = 'fixed-user-id'
    const projId = 'fixed-proj-id'
    for (let i = 0; i < rows1.length; i++) {
      const k1 = computeImportKey(rows1[i].title, projId, rows1[i].deadlineISO, userId)
      const k2 = computeImportKey(rows2[i].title, projId, rows2[i].deadlineISO, userId)
      expect(k1).toBe(k2)
    }
  })
})
