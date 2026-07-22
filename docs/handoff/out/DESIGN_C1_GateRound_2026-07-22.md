# DESIGN C1 — Gate với Round (chống pass-nhầm âm thầm)

> Ngày: 2026-07-22 · Phụ lục kỹ thuật cho [SPEC_Revise_Flow36](SPEC_Revise_Flow36_2026-07-22.md) mục C1/C4 · Trạng thái: **CHỜ DUYỆT — chưa code**

Đây là phần rủi ro nhất của model revise. Phải đóng đinh trước khi đụng engine.

---

## 2.1 Vấn đề (kèm code ref)

Gate của flow template chạy qua **work-engine.ts** (KHÔNG phải workflow-engine.ts — đó là engine cũ theo `WORKFLOW_RULES`; template SX-PROD dùng `chainNextTemplateTasks` + `doneCodesForProject`).

`doneCodesForProject` ([work-engine.ts:999-1013](../../../src/lib/work-engine.ts#L999-L1013)):
```ts
const templateTasks = await prisma.task.findMany({
  where: { projectId, NOT: { templateStepId: null } },   // ⚠️ KHÔNG lọc round
  select: { templateStepId: true, status: true },
})
const doneCodes = templateTasks
  .filter((t) => t.status === 'DONE')                     // ⚠️ chỉ 'DONE', round-agnostic
  .map((t) => stepById.get(t.templateStepId!)?.code) ...
```
Gate spawn = `gateCodes.every((g) => done.has(g))` ([:1103](../../../src/lib/work-engine.ts#L1103), [:1122](../../../src/lib/work-engine.ts#L1122), [:1132](../../../src/lib/work-engine.ts#L1132)).

**Hệ quả pass-nhầm:** dự án round-0 đã DONE hết. Revise vào **P2.1** mở **round 1**. Nếu done-set vẫn keyed theo CODE (round-agnostic):
- Gate **P2.4** = [P2.1, P2.2, P2.3, P2.1A]. Cả 4 có task **round-0 DONE** → `done.has(g)` đúng cho cả 4 → **gate P2.4 thoả NGAY** → spawn P2.4 round-1 **TRƯỚC khi P2.1 round-1 được làm**.
- Đây **không phải kẹt gate mà là PASS NHẦM ÂM THẦM** — cả chuỗi round-1 tự chạy tới cuối, người chưa kịp đụng gì. Đúng lớp lỗi "mất âm thầm" đã tốn PR #59/#60 để diệt.

---

## 2.2 Giải pháp (2+1 phần, bám primitive có sẵn)

### (a) Round-scoped done-set
Thêm tham số `round` vào query:
```ts
async function doneCodesForProject(steps, projectId, round = 0): Promise<Set<string>> {
  const templateTasks = await prisma.task.findMany({
    where: { projectId, NOT: { templateStepId: null }, revisionRound: round },  // ← LỌC ROUND
    select: { templateStepId: true, status: true },
  })
  const doneCodes = templateTasks
    .filter((t) => isResolved(t.status))            // ← DONE ∪ SKIPPED_NO_IMPACT (C4)
    .map(...)
  // legacy grace cho root GIỮ NGUYÊN nhưng chỉ áp round 0
  ...
}
```
- Round 0 = flow gốc → giữ 100% hành vi cũ (gọi `round=0`, mặc định).
- Round N = chỉ đếm task round N. Không lẫn round-0.

### (b) Entry-expansion — TÁI DÙNG BFS-incl-gateCodes của `applyTemplate({fromStepCode})`
`applyTemplate` ([work-engine.ts:1041-1078](../../../src/lib/work-engine.ts#L1041-L1078)) đã có **reverse-BFS gộp gateCodes** để tìm tổ tiên (dòng [1052-1064](../../../src/lib/work-engine.ts#L1052-L1064)) — cố tình gộp `gateCodes` vì bước hội tụ (P2.4) không nằm trong `nextCodes` của ai. C1 dùng LẠI đúng primitive này (đảo chiều + thêm gate-feeder):

```
function expandRevisionRound(steps, entryCode, round):
  byCode = index(steps, s => s.code)

  # 1. TỔ TIÊN của entry (reuse y hệt applyTemplate fromStepCode: reverse-BFS gộp gateCodes)
  ancestors = reverseBfsInclGate(entryCode, byCode)   # = logic dòng 1052-1064, tách hàm dùng chung

  # 2. HẠ NGUỒN của entry (forward-BFS qua nextCodes), gồm cả entry
  forward = new Set([entryCode])
  stack = [entryCode]
  while stack:
    cur = stack.pop()
    for nc in byCode[cur].nextCodes or []:
      if nc not in forward: forward.add(nc); stack.push(nc)

  # 3. GATE-FEEDER closure: bước hạ nguồn nào là gate → kéo feeder (song song) vào,
  #    NHƯNG feeder nằm trong ancestors (trước điểm vào) thì BỎ (kế thừa round-0, xem (c)).
  toSpawn = new Set(forward)
  changed = true
  while changed:
    changed = false
    for code in list(toSpawn):
      for g in byCode[code].gateCodes or []:
        if g not in toSpawn and g not in ancestors:    # feeder song song, không phải tổ tiên
          toSpawn.add(g); changed = true
  return toSpawn      # danh sách step spawn round-N (skippable)
```

- **Ví dụ entry=P2.1:** forward = {P2.1, P2.4, P2.5, P3.x, …}. Xét gate P2.4=[P2.1,P2.2,P2.3,P2.1A]: P2.1 đã có; P2.2/P2.3/P2.1A **không** thuộc ancestors(P2.1) (chúng song song, không phải tổ tiên) → **kéo vào toSpawn**. ⟹ round-1 có đủ P2.1/P2.2/P2.3/P2.1A để gate P2.4 kiểm.
- **Feeder là tổ tiên thì loại:** entry=P2.5, gate hạ nguồn cần P2.4 (tổ tiên của P2.5) → P2.4 ∈ ancestors → KHÔNG spawn round-1, gate kế thừa round-0 (xem (c)).
- Mỗi task spawn: `revisionRound=N`, `revisionId`, `originStepCode=entryCode`, status khởi tạo bình thường (OPEN/chưa resolved). Người không đụng → `SKIPPED_NO_IMPACT` + `skipReason`.

### (c) Gate eval round-scoped
```
satisfiedForRound(g, round, roundSubgraph):
  if g in roundSubgraph:                      # bước được spawn ở round này
     return ∃ task(step=g, revisionRound=round) với isResolved(status)
  else:                                        # tổ tiên trước điểm vào — kế thừa
     return ∃ task(step=g) với isResolved(status)   # round mới nhất (thực chất round-0)

gatePass(G, round) = every g in G.gateCodes: satisfiedForRound(g, round, toSpawn)
```
→ P2.4 round-1 **chỉ thoả khi P2.1/P2.2/P2.3/P2.1A round-1 đều resolved** (DONE hoặc người bấm SKIPPED). **Hết pass-nhầm.**

---

## 2.3 C4 — helper `isResolved` + SWEEP ĐẦY ĐỦ (KHÔNG chỉ 8 — phân 3 nhóm)

```ts
// src/lib/utils.ts (hoặc work-status.ts) — 1 nguồn duy nhất
export function isResolved(status: string): boolean {
  return status === 'DONE' || status === 'SKIPPED_NO_IMPACT'
}
```

> ⚠️ **Sweep thực tế ~20+ chỗ check `'DONE'`, KHÔNG phải 8.** Nhưng KHÔNG blanket-replace. Chia 3 nhóm:

### Nhóm A — PHẢI đổi sang `isResolved` NGAY (gate/closure/% ở project view)
| # | File:line | Việc | Mức |
|---|---|---|---|
| A1 | [work-engine.ts:1007](../../../src/lib/work-engine.ts#L1007) | `doneCodesForProject` — gate template (round-scope + isResolved) | **CRITICAL** |
| A2 | [work-engine.ts:1103,1122,1132](../../../src/lib/work-engine.ts#L1103) | gate spawn `gateCodes.every(done.has)` — dùng done-set round-scoped | **CRITICAL** |
| A3 | [api/projects/[id]/route.ts:167,169](../../../src/app/api/projects/[id]/route.ts#L167) | closure gate P6.x `every DONE` | cao (đóng dự án) |
| A4 | [api/projects/[id]/route.ts:77](../../../src/app/api/projects/[id]/route.ts#L77) | % tiến độ (detail) | cao |
| A5 | [api/projects/route.ts:55](../../../src/app/api/projects/route.ts#L55) | % tiến độ (list) | cao |
| A6 | [api/projects/[id]/route.ts:45](../../../src/app/api/projects/[id]/route.ts#L45) | board map — bucket SKIPPED vào "Hoàn thành"/state riêng | UX |

### Nhóm B — CẦN QUYẾT ĐỊNH "đếm round thế nào" (KHÔNG phải chỉ thêm isResolved)
Các chỗ này đếm task DONE **toàn dự án**. Có round-0 + round-N cùng step → mẫu số/tử số đổi. Phải chốt luật: **đếm latest-round-per-step** hay **chỉ round-0** hay **gộp**. Chưa giải ở C1 — cần 1 quyết định riêng (đề xuất: "latest round per templateStep").
| # | File:line | Ngữ cảnh |
|---|---|---|
| B1 | [lib/task-engine.ts:171,207,220](../../../src/lib/task-engine.ts#L171) | dashboard progress |
| B2 | [lib/work-analytics.ts:136,156,165,174,200](../../../src/lib/work-analytics.ts#L136) | analytics done/phase |
| B3 | [lib/telegram-commands.ts:240,244,322,377,422,533](../../../src/lib/telegram-commands.ts#L240) | % qua bot |
| B4 | [api/reports/executive/route.ts:35,39](../../../src/app/api/reports/executive/route.ts#L35) | báo cáo điều hành |
| B5 | [api/work/briefing/*](../../../src/app/api/work/briefing) (agenda/snapshot/review/export) | đếm active/done giao ban |
| B6 | [lib/utils.ts:148](../../../src/lib/utils.ts#L148) | `isTaskOverdue` loại DONE/CANCELLED → nên loại cả SKIPPED |

### Nhóm C — ĐỂ NGUYÊN (an toàn vì round-0 DONE còn nguyên)
Các gate phụ thuộc DỮ LIỆU tìm "có task DONE cho step X" — round-0 DONE vẫn tồn tại → vẫn thoả. **KHÔNG** đổi (SKIPPED không sinh dữ liệu, không được coi là "đã có kết quả").
| # | File:line | Lý do để nguyên |
|---|---|---|
| C1 | [api/work/tasks/[id]/result-data/route.ts:111](../../../src/app/api/work/tasks/[id]/result-data/route.ts#L111) | gate P2.1/P2.2/P2.3 DONE — round-0 còn |
| C2 | [lib/validation-rules.ts:106](../../../src/lib/validation-rules.ts#L106) | P1.2 DONE — round-0 còn |
| C3 | [api/projects/[id]/route.ts:232](../../../src/app/api/projects/[id]/route.ts#L232) | P5.3 (SAT) DONE cho closure — round-0 còn |
| C4 | guards "Công việc đã hoàn thành" ([work-engine.ts:293,469,678,742](../../../src/lib/work-engine.ts#L293)) | check status CHÍNH task đó, không phải gate. *Nhỏ:* nên chặn complete task đang SKIPPED. |
| C5 | ITP/MRB/MDR checkpoints PASSED/DONE (qc/logistics) | model khác (checkpoint), không phải Task workflow |

### workflow-engine.ts (engine cũ) — kiểm tra riêng
- [workflow-engine.ts:810](../../../src/lib/workflow-engine.ts#L810) `checkGate` filter DONE + [:829](../../../src/lib/workflow-engine.ts#L829) `activateTask` reactivation set. **Nếu** revise round KHÔNG route qua engine cũ (đúng thiết kế: dùng work-engine template path) → 2 chỗ này KHÔNG trên đường round → để nguyên. **Cần xác nhận** khi code: task template hoàn thành đi qua `completeTask` của work-engine ([:415-436](../../../src/lib/work-engine.ts#L415-L436)), không phải workflow-engine.

---

## 2.4 Bộ TEST đóng đinh (`revise-round.test.ts` — mô tả case + assertion)

> Skeleton `describe.skip` sẽ thêm khi bắt đầu code (giữ PR này docs-only).

- **T1 — chống pass-nhầm (QUAN TRỌNG NHẤT):**
  Setup: dự án SX-PROD round-0 DONE hết (tới P6.5). Revise vào **P2.1** mở round-1.
  **Assert:** ngay sau khi mở round-1, task **P2.4 round-1 KHÔNG tồn tại** (`count(step=P2.4, round=1) === 0`) cho tới khi **P2.1 round-1 resolved**. → Test này **FAIL trên code hiện tại** (round-agnostic gate spawn P2.4 ngay), **PASS sau round-scope**. Đây là chốt chặn của C1.

- **T2 — no-deadlock khi sibling skip:**
  Từ T1, set P2.2/P2.3/P2.1A round-1 = `SKIPPED_NO_IMPACT`, P2.1 round-1 = DONE.
  **Assert:** gate P2.4 round-1 **thoả** → P2.4 round-1 được spawn (skip tính như resolved).

- **T3 — round isolation:**
  **Assert:** mở/chạy round-1 KHÔNG đổi count hay status của bất kỳ task round-0 nào; `doneCodesForProject(_, _, 0)` không đổi trước/sau.

- **T4 — dedup (step, round):**
  **Assert:** spawn P2.1 round-1 tạo task MỚI (không đụng unique với P2.1 round-0); `findFirst({templateStepId, revisionRound})` phân biệt đúng; gọi lại idempotent trong cùng round.

- **T5 — entry-expansion đủ gate-feeder:**
  **Assert:** `expandRevisionRound(SX-PROD, 'P2.1', 1)` trả tập CHỨA {P2.1, P2.2, P2.3, P2.1A, P2.4, P2.5, …}; KHÔNG chứa tổ tiên (P1.x). Kiểm feeder-song-song vào, feeder-tổ-tiên bị loại.

- **T6 (thêm) — kế thừa round-0 cho tổ tiên:**
  Entry=P2.5 round-1; gate hạ nguồn cần P2.4 (tổ tiên, không spawn round-1).
  **Assert:** gate thoả nhờ P2.4 round-0 DONE (nhánh `else` của `satisfiedForRound`).

---

## 2.5 Migration (nhắc — CHƯA chạy)
Additive, an toàn, không backfill:
```prisma
model Task {
  // ...
  revisionRound  Int     @default(0)
  revisionId     String?
  originStepCode String?
  skipReason     String?
  @@unique([templateStepId, revisionRound, projectId])   // thay dedup 1-task/step (cân nhắc composite)
}
```
- `status` thêm chuỗi `SKIPPED_NO_IMPACT` — **String, 0 enum trong schema → KHÔNG cần migration cho status**.
- ⚠️ Cân nhắc `@@unique`: hiện dedup bằng `findFirst` (application-level), không phải DB unique. Nếu thêm DB unique phải kiểm dữ liệu cũ (task round-0 trùng templateStepId?). **An toàn hơn: giữ dedup application-level `(templateStepId, revisionRound)`**, chưa thêm DB constraint ở MVP.

---

## Chỗ pseudo-code C1 CHƯA CHẮC — cần Claude/Toan rà
1. **Gate-feeder closure với nhánh song song có forward riêng.** Nếu 1 gate-feeder (vd P2.1A) tự có `nextCodes` dẫn tới bước NGOÀI forward(entry) → có kéo luôn forward của feeder không? Hiện pseudo chỉ kéo feeder, không forward-BFS từ feeder. Cần xác nhận SX-PROD có ca này không (khả năng thấp — feeder song song thường hội tụ vào cùng gate).
2. **Nhiều gate lồng nhau nhiều tầng** (gate hạ nguồn của gate) — closure `while changed` có phủ hết không, hay cần forward-BFS lại sau mỗi lần thêm feeder. Cần test trên đồ thị SX-PROD thật.
3. **Nhóm B "đếm round thế nào"** — chưa chốt luật (latest-round-per-step?). Ảnh hưởng % hiển thị khắp nơi. Cần 1 quyết định riêng trước khi đụng nhóm B.
4. **workflow-engine.ts (engine cũ) có nằm trên đường round không** — phải xác nhận bằng trace `completeTask` khi code; nếu có, nhóm A phải thêm 810/829.
5. **`@@unique` DB vs dedup application-level** — chọn cái nào (mục 2.5).
