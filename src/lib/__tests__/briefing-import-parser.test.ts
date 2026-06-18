import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseBriefingXlsx, classifyRows, mapStatusLabel, parseDateDMY, computeImportKey } from '../briefing-import-parser'

function makeSheet(rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Giao ban tuần')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const HEADER = ['STT', 'Mã việc', 'Dự án', 'Nội dung', 'Người thực hiện', 'Ngày mở', 'Hạn',
  'Số ngày quá hạn', 'Trạng thái', 'Tiêu chí xong', 'Đề xuất', 'Quyết định BGĐ', 'Ghi chú', 'ID hệ thống']

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
  it('maps Vietnamese labels', () => {
    expect(mapStatusLabel('Mới')).toEqual({ status: 'OPEN', blocked: false })
    expect(mapStatusLabel('Đang xử lý')).toEqual({ status: 'IN_PROGRESS', blocked: false })
    expect(mapStatusLabel('Bị trả lại')).toEqual({ status: 'RETURNED', blocked: false })
    expect(mapStatusLabel('Tắc')).toEqual({ status: 'IN_PROGRESS', blocked: true })
    expect(mapStatusLabel('Xong')).toEqual({ status: 'DONE', blocked: false })
    expect(mapStatusLabel('Hủy')).toEqual({ status: 'CANCELLED', blocked: false })
  })
  it('returns null for unknown', () => {
    expect(mapStatusLabel('random')).toBeNull()
  })
})

describe('parseBriefingXlsx', () => {
  it('parses rows with system ID (update)', () => {
    const buf = makeSheet([
      HEADER,
      [1, 'P2.1', '26-WNC-I-109', 'PR thiết kế', 'Lưu Đức Toàn', '01/06/2026', '10/06/2026', 8, 'Đang xử lý', 'Xong PR', 'Đẩy nhanh', '', 'Cần review', 'cmni9ct_abc123'],
    ])
    const rows = parseBriefingXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].systemId).toBe('cmni9ct_abc123')
    expect(rows[0].title).toBe('PR thiết kế')
    expect(rows[0].projectCode).toBe('26-WNC-I-109')
    expect(rows[0].deadlineISO).toBe('2026-06-10')
    expect(rows[0].criteria).toBe('Xong PR')
    expect(rows[0].notes).toBe('Cần review')
  })

  it('parses rows without system ID (create)', () => {
    const buf = makeSheet([
      HEADER,
      [2, '', '25-WNC-I-104', 'Gửi báo giá NCC', 'Nguyễn Văn A', '', '20/06/2026', '', 'Mới', 'Gửi báo giá', 'Liên hệ ngay', '', '', ''],
    ])
    const rows = parseBriefingXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].systemId).toBe('')
    expect(rows[0].title).toBe('Gửi báo giá NCC')
    expect(rows[0].assigneeName).toBe('Nguyễn Văn A')
    expect(rows[0].deadlineISO).toBe('2026-06-20')
  })

  it('skips empty rows', () => {
    const buf = makeSheet([
      HEADER,
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      [1, '', '', 'Việc thật', 'Ai đó', '', '30/06/2026', '', '', 'Tiêu chí', '', '', '', ''],
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
      [1, 'P2.1', '26-WNC', 'Task cũ', 'Toàn', '', '10/06/2026', '', 'Đang xử lý', '', '', '', '', 'existing_task_id'],
    ]))
    const actions = classifyRows(rows)
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('update')
    if (actions[0].type === 'update') expect(actions[0].taskId).toBe('existing_task_id')
  })

  it('classifies create row without systemId', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', 'Việc mới', 'Ai Đó', '', '25/06/2026', '', '', 'Phải xong', '', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('create')
  })

  it('errors when create row missing assignee', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', 'Việc mới', '', '', '25/06/2026', '', '', 'Phải xong', '', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions[0].type).toBe('error')
    if (actions[0].type === 'error') expect(actions[0].reason).toContain('Người thực hiện')
  })

  it('errors when create row missing deadline', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', 'Việc mới', 'Ai đó', '', '', '', '', 'Phải xong', '', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions[0].type).toBe('error')
    if (actions[0].type === 'error') expect(actions[0].reason).toContain('Hạn')
  })

  it('errors when create row missing criteria', () => {
    const rows = parseBriefingXlsx(makeSheet([
      HEADER,
      [1, '', '', 'Việc mới', 'Ai đó', '', '25/06/2026', '', '', '', '', '', '', ''],
    ]))
    const actions = classifyRows(rows)
    expect(actions[0].type).toBe('error')
    if (actions[0].type === 'error') expect(actions[0].reason).toContain('Tiêu chí xong')
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
      [1, '', '25-WNC-I-104', 'Gửi báo giá NCC', 'Nguyễn Văn A', '', '20/06/2026', '', 'Mới', 'Gửi báo giá', '', '', '', ''],
      [2, '', '', 'Họp review', 'Trần B', '', '22/06/2026', '', '', 'Review xong', '', '', '', ''],
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
