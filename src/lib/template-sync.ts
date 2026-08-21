// So lệch giữa bảng `TemplateStep` (DB) và WORKFLOW_RULES + ROLE_TO_DEPT (code).
//
// VÌ SAO CẦN: task quy trình lấy title + roleCode TỪ DB (work-engine.spawnTemplateStep), không lấy
// từ code. Đổi tên bước / đổi role / đổi cơ cấu phòng trong code mà DB chưa cập nhật → task sinh ra
// mang tên cũ và giao nhầm người (vd P3.4 giao R06 trong khi code đã chuyển R02, mà trang Sản xuất
// chỉ cho R01/R02 phát hành WO → người nhận không thao tác được).
//
// Module này CHỈ tính toán (thuần, không I/O) — dùng chung cho API admin
// (api/admin/template-steps/sync) và script CLI (scripts/sync-template-steps.ts).

import { WORKFLOW_RULES } from './workflow-constants'
import { ROLE_TO_DEPT, DEPARTMENTS_V2 } from './org-map'

export interface TemplateStepRow {
  id: string
  code: string
  title: string
  roleCode: string | null
  deptCode: string | null
  deadlineDays: number | null
  nextCodes: string[]
  gateCodes: string[]
}

export type StepField = 'title' | 'roleCode' | 'deptCode' | 'deadlineDays' | 'nextCodes' | 'gateCodes'

export interface FieldDiff {
  field: StepField
  from: string | number | string[] | null
  to: string | number | string[] | null
}

export interface StepDiff {
  id: string
  code: string
  title: string
  diffs: FieldDiff[]        // title/roleCode/deptCode/deadlineDays — an toàn, chỉ áp cho task sinh MỚI
  graphDiffs: FieldDiff[]   // nextCodes/gateCodes — ĐỔI CẤU TRÚC CHUỖI, chỉ ghi khi withGraph
}

export interface TemplateSyncReport {
  total: number
  pending: StepDiff[]                              // bước lệch nội dung
  graphPending: StepDiff[]                         // bước lệch cạnh chuỗi
  retired: { code: string; title: string }[]       // có trong DB, đã bỏ khỏi WORKFLOW_RULES → không đụng
  missing: string[]                                // có trong code, thiếu trong DB → chuỗi không tự sinh
  invalidDept: { code: string; deptCode: string }[] // mã phòng không còn trong DEPARTMENTS_V2
}

/** Giá trị ĐÚNG theo code cho một mã bước. null nếu bước đã bỏ khỏi WORKFLOW_RULES. */
export function expectedForStep(code: string): Omit<TemplateStepRow, 'id' | 'code'> | null {
  const rule = WORKFLOW_RULES[code]
  if (!rule) return null
  return {
    title: rule.name,
    roleCode: rule.role,
    deptCode: ROLE_TO_DEPT[rule.role] || null,
    deadlineDays: rule.deadlineDays ?? null,
    nextCodes: rule.next || [],
    gateCodes: rule.gate || [],
  }
}

const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function buildTemplateSyncReport(rows: TemplateStepRow[]): TemplateSyncReport {
  const validDepts = new Set(DEPARTMENTS_V2.map((d) => d.code))
  const pending: StepDiff[] = []
  const graphPending: StepDiff[] = []
  const retired: { code: string; title: string }[] = []
  const invalidDept: { code: string; deptCode: string }[] = []

  for (const row of rows) {
    if (row.deptCode && !validDepts.has(row.deptCode)) {
      invalidDept.push({ code: row.code, deptCode: row.deptCode })
    }

    const want = expectedForStep(row.code)
    if (!want) { retired.push({ code: row.code, title: row.title }); continue }

    const diffs: FieldDiff[] = []
    if (row.title !== want.title) diffs.push({ field: 'title', from: row.title, to: want.title })
    if (row.roleCode !== want.roleCode) diffs.push({ field: 'roleCode', from: row.roleCode, to: want.roleCode })
    if (row.deptCode !== want.deptCode) diffs.push({ field: 'deptCode', from: row.deptCode, to: want.deptCode })
    if (row.deadlineDays !== want.deadlineDays) diffs.push({ field: 'deadlineDays', from: row.deadlineDays, to: want.deadlineDays })

    const graphDiffs: FieldDiff[] = []
    if (!sameArr(row.nextCodes || [], want.nextCodes)) graphDiffs.push({ field: 'nextCodes', from: row.nextCodes || [], to: want.nextCodes })
    if (!sameArr(row.gateCodes || [], want.gateCodes)) graphDiffs.push({ field: 'gateCodes', from: row.gateCodes || [], to: want.gateCodes })

    const entry: StepDiff = { id: row.id, code: row.code, title: row.title, diffs, graphDiffs }
    if (diffs.length) pending.push(entry)
    if (graphDiffs.length) graphPending.push(entry)
  }

  const dbCodes = new Set(rows.map((r) => r.code))
  const missing = Object.keys(WORKFLOW_RULES).filter((c) => !dbCodes.has(c))

  return { total: rows.length, pending, graphPending, retired, missing, invalidDept }
}
