# DESIGN — Round Counting (nhóm B: % tiến độ & các đếm qua revise round)

> Ngày: 2026-07-22 · Giải **Q3** của [DESIGN_C1_GateRound](DESIGN_C1_GateRound_2026-07-22.md) · Phụ lục [SPEC_Revise_Flow36](SPEC_Revise_Flow36_2026-07-22.md) nhóm B
> **Quyết định TÁCH khỏi C1** — làm ở **đợt nhóm-B (SAU C1)**, không chặn Phase 0/1.

## Vấn đề
Khi có revise round, 1 templateStep có NHIỀU task: round-0 (DONE) + round-N (OPEN/SKIPPED/DONE). Mọi chỗ đếm `status === 'DONE'` toàn dự án ([nhóm B trong DESIGN_C1](DESIGN_C1_GateRound_2026-07-22.md)) sẽ **đếm trùng / sai mẫu số** → % tiến độ, KPI, báo cáo lệch.

## Luật chốt: **LATEST-ROUND-PER-STEP**
> Trạng thái hiệu lực của 1 templateStep = trạng thái của **task có `revisionRound` cao nhất** của step đó trong dự án.

- % và các đếm nhóm B tính theo **trạng thái hiệu lực** này, KHÔNG cộng dồn mọi round.
- **Lý do:** mở revise = có rework đang mở → % **phải tụt** (chưa "xong" lại). VD dự án 100% (round-0), revise P2.1 mở round-1 OPEN → P2.1 hiệu lực = OPEN → % xuống < 100%. Đúng kỳ vọng quản trị.
- Task **không có `templateStepId`** (FREE/động) không thuộc step nào → tính như chính nó (round vô nghĩa).

### Helper chung (đề xuất đặt ở `src/lib/round.ts` hoặc `work-status.ts`)
```ts
// Gom danh sách task → 1 task/1 templateStep (round cao nhất); task không templateStep giữ nguyên.
function latestPerStep(tasks: Task[]): Task[] {
  const byStep = new Map<string, Task>()       // templateStepId -> task round cao nhất
  const loose: Task[] = []
  for (const t of tasks) {
    if (!t.templateStepId) { loose.push(t); continue }
    const cur = byStep.get(t.templateStepId)
    if (!cur || (t.revisionRound ?? 0) > (cur.revisionRound ?? 0)) byStep.set(t.templateStepId, t)
  }
  return [...byStep.values(), ...loose]
}
// Rồi: completed = latestPerStep(tasks).filter(t => isResolved(t.status)).length
```
- `isResolved` = `{DONE, SKIPPED_NO_IMPACT}` (dùng chung với C4 của DESIGN_C1).
- Áp thống nhất: **`latestPerStep(...)` TRƯỚC, rồi mới count/filter theo status.**

## Áp cho từng chỗ nhóm B
| # | File | Sửa |
|---|---|---|
| B1 | [lib/task-engine.ts:171,207,220](../../../src/lib/task-engine.ts#L171) | dashboard progress — `latestPerStep` trước khi đếm DONE/phase |
| B2 | [lib/work-analytics.ts:136,156,165,174,200](../../../src/lib/work-analytics.ts#L136) | analytics done/phase/dept — collapse latest-round rồi mới agg |
| B3 | [lib/telegram-commands.ts:240,244,322,377,422,533](../../../src/lib/telegram-commands.ts#L240) | % qua bot — collapse trước khi tính `done/total` |
| B4 | [api/reports/executive/route.ts:35,39](../../../src/app/api/reports/executive/route.ts#L35) | % điều hành — collapse trước |
| B5 | [api/work/briefing/*](../../../src/app/api/work/briefing) (agenda/snapshot/review/export) | đếm active/done: `t.status !== 'DONE'` → dùng trạng-thái-hiệu-lực; SKIPPED không tính "active" |
| B6 | [lib/utils.ts:148](../../../src/lib/utils.ts#L148) | `isTaskOverdue`: loại **cả `SKIPPED_NO_IMPACT`** (như DONE/CANCELLED) — task đã bỏ qua không quá hạn |

### Lưu ý riêng B5 (briefing) & B6 (overdue)
- **B6 `isTaskOverdue`** là **PER-TASK** (không phải đếm toàn dự án) → chỉ cần thêm `SKIPPED_NO_IMPACT` vào nhánh loại trừ, KHÔNG cần `latestPerStep`:
  ```ts
  if (t.status === 'DONE' || t.status === 'CANCELLED' || t.status === 'SKIPPED_NO_IMPACT') return false
  ```
- **B5 briefing** đếm "việc đang mở/quá hạn": task round cũ đã DONE nhưng round mới OPEN → nên hiện việc round MỚI (đang mở). Dùng `latestPerStep` để không đếm trùng round-0.

## Ranh giới (KHÔNG áp latest-round ở đây)
- **Gate/spawn (nhóm A)**: dùng **round-scoped done-set** của C1 (theo đúng round đang chạy), KHÔNG phải latest-round. 2 khái niệm khác nhau — đừng trộn.
- **Data-gate (nhóm C)**: giữ nguyên "có task DONE cho step X" (round-0 còn) — KHÔNG đổi.

## Thứ tự triển khai
1. C1 (gate-round) + C4 nhóm A + migration additive — Phase 0/1.
2. **Đợt nhóm-B (doc này)** — SAU khi C1 chạy đúng: thêm helper `latestPerStep`, sweep 6 vùng B, test % tụt khi mở round + về lại khi round resolved.

## Chưa chắc / cần rà khi code nhóm B
1. **Phase/dept aggregation** (work-analytics B2, telegram B3 theo phase): sau `latestPerStep`, map step→phase vẫn đúng (step không đổi phase giữa round). Cần test phase % khi 1 phase có step đang revise.
2. **Task round-N SKIPPED có nên hiện trong "đã hoàn thành"** ở báo cáo không, hay gộp nhóm "bỏ qua" riêng — quyết UX ở đợt nhóm-B (không ảnh hưởng con số %).
