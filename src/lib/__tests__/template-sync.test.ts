import { describe, it, expect } from 'vitest'
import { buildTemplateSyncReport, expectedForStep, type TemplateStepRow } from '@/lib/template-sync'
import { WORKFLOW_RULES } from '@/lib/workflow-constants'
import { ROLE_TO_DEPT } from '@/lib/org-map'

/** Hàng TemplateStep KHỚP code cho một mã bước (dùng làm mốc "không lệch"). */
function rowInSync(code: string, id = `id-${code}`): TemplateStepRow {
  const want = expectedForStep(code)!
  return { id, code, ...want }
}

describe('expectedForStep', () => {
  it('trả về giá trị theo WORKFLOW_RULES + ROLE_TO_DEPT', () => {
    const want = expectedForStep('P3.4')!
    expect(want.title).toBe(WORKFLOW_RULES['P3.4'].name)
    expect(want.roleCode).toBe('R02')
    expect(want.deptCode).toBe(ROLE_TO_DEPT['R02'])
  })

  it('trả null cho bước đã bỏ khỏi quy trình', () => {
    expect(expectedForStep('P4.3')).toBeNull()
  })
})

describe('buildTemplateSyncReport', () => {
  it('không báo lệch khi DB khớp code', () => {
    const r = buildTemplateSyncReport([rowInSync('P3.3'), rowInSync('P3.4'), rowInSync('P4.5')])
    expect(r.pending).toHaveLength(0)
    expect(r.graphPending).toHaveLength(0)
    expect(r.invalidDept).toHaveLength(0)
  })

  it('bắt được lệch tên bước, role và phòng (ca P3.4 ngoài thực tế)', () => {
    const stale: TemplateStepRow = {
      ...rowInSync('P3.4'),
      title: 'Quản lý SX lập lệnh sản xuất cho tổ nội bộ và thầu phụ',
      roleCode: 'R06',
      deptCode: 'PSXDA',
    }
    const r = buildTemplateSyncReport([stale])

    expect(r.pending).toHaveLength(1)
    const fields = r.pending[0].diffs.map((d) => d.field)
    expect(fields).toEqual(expect.arrayContaining(['title', 'roleCode', 'deptCode']))

    const role = r.pending[0].diffs.find((d) => d.field === 'roleCode')!
    expect(role.from).toBe('R06')
    expect(role.to).toBe('R02')

    // PSXDA không còn trong DEPARTMENTS_V2 → phải bị đánh dấu
    expect(r.invalidDept).toEqual([{ code: 'P3.4', deptCode: 'PSXDA' }])
  })

  it('tách lệch CẤU TRÚC CHUỖI ra khỏi nhóm sửa an toàn', () => {
    const row: TemplateStepRow = { ...rowInSync('P3.5'), nextCodes: [], gateCodes: ['P9.9'] }
    const r = buildTemplateSyncReport([row])

    expect(r.pending).toHaveLength(0)                    // title/role/dept vẫn đúng
    expect(r.graphPending).toHaveLength(1)
    expect(r.graphPending[0].graphDiffs.map((d) => d.field)).toEqual(['nextCodes', 'gateCodes'])
  })

  it('bước đã về hưu chỉ được liệt kê, không đưa vào danh sách sửa', () => {
    const retired: TemplateStepRow = {
      id: 'id-P4.3', code: 'P4.3', title: 'QC nghiệm thu nhập kho',
      roleCode: 'R09', deptCode: 'PQAQC', deadlineDays: 3, nextCodes: [], gateCodes: [],
    }
    const r = buildTemplateSyncReport([retired])

    expect(r.pending).toHaveLength(0)
    expect(r.retired).toEqual([{ code: 'P4.3', title: 'QC nghiệm thu nhập kho' }])
  })

  it('báo bước có trong code nhưng thiếu trong DB', () => {
    const r = buildTemplateSyncReport([rowInSync('P1.1')])
    expect(r.missing).toContain('P3.4')
    expect(r.missing).not.toContain('P1.1')
  })

  it('deadlineDays null vs số được coi là lệch', () => {
    const row: TemplateStepRow = { ...rowInSync('P3.4'), deadlineDays: null }
    const r = buildTemplateSyncReport([row])
    expect(r.pending[0].diffs).toEqual([{ field: 'deadlineDays', from: null, to: WORKFLOW_RULES['P3.4'].deadlineDays }])
  })
})
