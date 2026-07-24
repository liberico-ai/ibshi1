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

### (b) Entry-expansion — FIXPOINT trên ĐỒ-THỊ-HỢP (đã sửa: forward-BFS-nextCodes SAI)

> ⚠️ **Sửa lỗi (verified DB SX-PROD):** bước feed gate có `next=[] gate=[]`, chỉ nối tới bước hội tụ **qua `gate:` của bước đó**. Topology thật:
> ```
> P2.1  next=[]                     gate=[]            P2.4  next=["P2.5"]  gate=["P2.1","P2.2","P2.3","P2.1A"]
> P2.2  next=[]                     gate=[]            P2.5  next=["P3.1","P3.3","P3.4"]  gate=[]
> P2.3  next=[]                     gate=[]            P3.1  next=["P3.5"]  gate=[]
> P2.1A next=[]                     gate=[]            P3.3/P3.4  next=[]   gate=[]
> ```
> ⟹ forward-BFS chỉ theo `nextCodes` từ P2.1 = **{P2.1}** (dead-end) — KHÔNG tới P2.4. Phải đi trên **đồ-thị-hợp**: cạnh `nextCodes` ∪ cạnh **feeder→gate** (F→G nếu G có gate chứa F). `applyTemplate` cũng né bằng "gate-driven spawn" ([work-engine.ts:1124-1133](../../../src/lib/work-engine.ts#L1124-L1133)) — C1 gộp cả 2 loại cạnh trong 1 fixpoint.

```
function expandRevisionRound(steps, entryCode, round):
  byCode = index(steps, s => s.code)

  # Tổ tiên của entry (reuse reverse-BFS-gộp-gateCodes của applyTemplate fromStepCode, dòng 1052-1064)
  ancestors = reverseBfsInclGate(entryCode, byCode)

  # Chỉ mục CẠNH-GATE XUÔI: code F → các bước G có F trong gateCodes(G)
  gateSucc = {}                        # F -> [G, ...]
  for G in steps:
    for f in (G.gateCodes or []): gateSucc[f].push(G.code)

  # FIXPOINT trên đồ-thị-hợp: mỗi vòng chạy CẢ (a) next, (b) feeder→gate, (c) kéo gate-feeder
  reached = new Set([entryCode])
  changed = true
  while changed:
    changed = false
    for cur in list(reached):
      s = byCode[cur]
      # (a) cạnh next
      for nc in (s.nextCodes or []):
        if nc not in reached: reached.add(nc); changed = true
      # (b) cạnh feeder→gate: cur là feeder ⇒ mọi gate-step G nhận cur trở nên reachable
      for G in (gateSucc[cur] or []):
        if G not in reached: reached.add(G); changed = true
      # (c) kéo gate-feeder song song của gate-step cur (bỏ feeder là tổ tiên → kế thừa round-0)
      for f in (s.gateCodes or []):
        if f not in reached and f not in ancestors: reached.add(f); changed = true
  return reached      # danh sách step spawn round-N (skippable)
```

- **Ví dụ entry=P2.1 (đã sửa):** `reached` lớn dần: {P2.1} → **(b)** P2.1∈gate(P2.4) ⇒ +P2.4 → **(a)** P2.4.next ⇒ +P2.5; **(c)** P2.4.gate ⇒ +P2.2/P2.3/P2.1A (không phải tổ tiên) → **(a)** P2.5.next ⇒ +P3.1/P3.3/P3.4 → +P3.5 … ⟹ `reached ⊇ {P2.1,P2.2,P2.3,P2.1A,P2.4,P2.5,P3.1,P3.3,P3.4,P3.5,…}`, **∌ P1.x**.
- **Feeder là tổ tiên thì loại:** entry=P2.5, nếu gate hạ nguồn cần P2.4 (tổ tiên của P2.5) → P2.4 ∈ ancestors → (c) bỏ → KHÔNG spawn round-N, gate kế thừa round-0 (xem (c) mục dưới).
- **Q1 (feeder có nhánh `next` riêng dẫn ra ngoài):** fixpoint tự phủ — (a) chạy lại cho feeder vừa add ở vòng sau. **Q2 (gate lồng nhiều tầng):** cùng fixpoint phủ — (b)/(c) áp cho gate-step mới add ở vòng kế. Cả 2 **giải trong 1 fixpoint** nhờ `while changed` chạy cả (a)(b)(c).
- Mỗi task spawn: `revisionRound=N`, `revisionId`, `originStepCode=entryCode`, status khởi tạo bình thường (OPEN/chưa resolved). Người không đụng → `SKIPPED_NO_IMPACT` + `skipReason`.

> **Phương án tối ưu (chống mệt — cân nhắc khi code):** thay vì pre-spawn TOÀN BỘ `reached` thành task thật, có thể chỉ pre-spawn **entry + các orphan-feeder song song của entry** (những feeder không tự spawn được qua chain), rồi để **chain gate-driven round-scoped** (mục (c)) tự sinh phần còn lại KHI gate thoả — giống engine hiện tại. Khi đó `expandRevisionRound` (full `reached`) chỉ dùng để **UI hiển thị + bulk-skip**, không tạo task trước. Giảm số task "chờ" cùng lúc. Quyết định pre-spawn-full vs lazy-chain để lại lúc code Phase 1.

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

### workflow-engine.ts (engine cũ) — ĐÃ XÁC NHẬN không đụng (Q4)
- **Verified:** task template hoàn thành đi qua `completeTask` của **work-engine** → nhánh `if (templateStepId)` gọi `chainNextTemplateTasks` ([work-engine.ts:421-436](../../../src/lib/work-engine.ts#L421-L436)). **KHÔNG** gọi `completeTask`/`checkGate` của workflow-engine.
- ⟹ [workflow-engine.ts:810](../../../src/lib/workflow-engine.ts#L810) (`checkGate`) + [:829](../../../src/lib/workflow-engine.ts#L829) (`activateTask` reactivation) **KHÔNG nằm trên đường revise-round** → **nhóm A KHÔNG gồm 810/829**. (Đính chính: prompt gốc ghi "CRITICAL workflow-engine:829" — thực ra :829 là reactivation, checkGate là :810; và cả 2 đều off-path.)

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

- **T5 — entry-expansion đủ (fixpoint đồ-thị-hợp):**
  **Assert:** `expandRevisionRound(SX-PROD, 'P2.1', 1)` trả tập:
  - **⊇ {P2.1, P2.2, P2.3, P2.1A, P2.4, P2.5, P3.1, P3.3, P3.4, P3.5}** — chứng minh đủ 3 loại cạnh: **(b)** feeder→gate (P2.1→P2.4), **(c)** kéo feeder song song (P2.2/P2.3/P2.1A), **(a)** next chain (P2.4→P2.5→P3.1→P3.5).
  - **∌ P1.x** (tổ tiên bị loại qua `ancestors`).
  - **T5b (Q1):** template giả có feeder P2.1A.next=[Pz] (Pz ngoài) → assert Pz ∈ reached (fixpoint chạy lại (a) cho feeder).
  - **T5c (Q2):** template giả gate lồng (G2.gate=[X], X là gate-step G1.gate=[Y]) → assert cả X, Y ∈ reached.

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
  // Q5 — MVP: KHÔNG thêm @@unique DB. Dedup ở application-level (spawnTemplateStep)
  //          bằng findFirst({templateStepId, revisionRound}). Lý do: hiện chưa có DB unique,
  //          thêm mới phải kiểm dữ liệu cũ (task round-0 trùng templateStepId trong data thật?).
}
```
- `status` thêm chuỗi `SKIPPED_NO_IMPACT` — **String, 0 enum trong schema → KHÔNG cần migration cho status**.
- **Q5 chốt:** dedup **application-level `(templateStepId, revisionRound)`** ở MVP; `@@unique` DB để lại sau khi rà dữ liệu.

---

## Trạng thái 5 điểm rà (cập nhật 2026-07-22 fix-2b)
| # | Nội dung | Trạng thái |
|---|---|---|
| Q1 | Feeder có nhánh `next` riêng dẫn ra ngoài | ✅ **GIẢI trong fixpoint** — (a) chạy lại cho feeder vừa add. Test T5b. |
| Q2 | Gate lồng nhiều tầng | ✅ **GIẢI trong fixpoint** — (b)/(c) áp cho gate-step mới add. Test T5c. |
| Q3 | Nhóm B "đếm round thế nào" | ✅ **CHỐT: latest-round-per-step** → tách sang [DESIGN_RoundCounting](DESIGN_RoundCounting_2026-07-22.md), làm ở đợt nhóm-B (sau C1). |
| Q4 | workflow-engine cũ có trên đường round | ✅ **XÁC NHẬN không** (completeTask work-engine:436 → chainNextTemplateTasks). Nhóm A **không** gồm 810/829. |
| Q5 | `@@unique` DB vs app-level | ✅ **CHỐT app-level** `(templateStepId, revisionRound)` ở MVP (mục 2.5). |

### Còn 1 điểm cần rà khi code (không chặn duyệt)
- **Pre-spawn-full vs lazy-chain** (xem "Phương án tối ưu" mục 2.2(b)): tạo task thật cho toàn bộ `reached` ngay, hay chỉ entry+orphan-feeder rồi để gate-driven round-scoped tự chain. Ảnh hưởng số task "chờ" cùng lúc + trải nghiệm bulk-skip. Quyết ở Phase 1 khi code.
