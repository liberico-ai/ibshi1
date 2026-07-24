# SPEC — Revise theo Flow 36 bước (walk full chain + người bỏ qua)

> Ngày: 2026-07-22 · Trạng thái: **ĐỀ XUẤT — chờ duyệt trước khi code** · Env test: UAT (ibshi) → Production

## 0. Nguyên tắc (đã chốt với Toan)
1. **Khởi tạo việc = 1 fork rõ ràng:** `[1] Revise` (theo flow cứng 36 bước) · `[2] Việc khác` (engine động, giao ai cũng được).
2. **Revise = đi HẾT chuỗi hạ nguồn đã thiết kế.** Không auto-skip theo máy. Bước nào không cần làm → **người bấm "bỏ qua"** (có log + lý do).
3. **Impact engine tụt xuống làm GỢI Ý** ("cần làm / có thể bỏ qua"), KHÔNG gate. Miễn nhiễm điểm mù dữ liệu (7 dự án 0 nhập-kho ERP).
4. **Giữ lịch sử:** mỗi lần revise = 1 **vòng (round)** mới, không ghi đè lần hoàn thành gốc.

---

## PHẦN A — THIẾT KẾ

### A1. Fork lúc khởi tạo
```
Khởi tạo việc
├── [1] Revise
│     ├── Chọn loại revise → bản đồ gợi ý BƯỚC VÀO (A4)
│     ├── (nếu có diff dữ liệu) impact PRE-chọn bước + liệt kê phòng ảnh hưởng — người xác nhận/override
│     ├── Mở VÒNG revision mới (round = max+1)
│     └── Walk TOÀN BỘ chuỗi hạ nguồn từ bước vào, theo next/gate 36 bước
│           mỗi bước = 1 checkpoint task cho phòng sở hữu:
│              • impact gợi ý: "cần làm" / "có thể bỏ qua"
│              • người: XỬ LÝ  hoặc  bấm "Bỏ qua — không ảnh hưởng" (log + lý do)
└── [2] Việc khác → createTask động (giữ nguyên hiện tại)
```

### A2. Thay đổi dữ liệu (Prisma — additive, không phá dữ liệu cũ)
| Field | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `Task.revisionRound` | `Int` | `0` | 0 = flow gốc; ≥1 = vòng revise |
| `Task.revisionId` | `String?` | `null` | Link ECO/revision nguồn |
| `Task.originStepCode` | `String?` | `null` | Bước vào của vòng (audit) |
| `Task.status` (thêm giá trị) | **String** | — | **`SKIPPED_NO_IMPACT`** — bỏ qua có chủ đích. `status` là String (không phải enum DB) → thêm giá trị **KHÔNG cần migration**. NHƯNG phải sweep mọi chỗ check `'DONE'` — xem **C4**. |
| `Task.skipReason` | `String?` | `null` | Lý do bỏ qua (bắt buộc khi skip) |

- **Dedup đổi:** hiện `findFirst({projectId, templateStepId})` 1-task/step ([work-engine.ts:970](../../../src/lib/work-engine.ts#L970), :1067) → thành **`(templateStepId, revisionRound)`**. Vòng gốc round=0 giữ nguyên; vòng revise sinh task mới.
- Migration = **thêm 4 cột nullable + default** → an toàn, không cần backfill (task cũ tự có round=0). Status SKIPPED_NO_IMPACT = 0 cột mới.

### A3. Hành vi engine
- **Re-enter:** không reset task cũ; **spawn vòng round=N** từ bước vào, chain xuôi theo `next/gate` (dùng lại `chainNextTemplateTasks` + logic `fromStepCode` của PR #68, đổi ý nghĩa "skip ancestor" → "mở từ đây").
- **Gate:** bước gate chờ các tiền nhiệm (cùng round) DONE/SKIPPED. `SKIPPED_NO_IMPACT` tính như "đã qua" để gate không kẹt.
- **"Bỏ qua" ≠ xoá:** set `SKIPPED_NO_IMPACT` + `skipReason` + người + thời gian → vẫn chain bước kế.
- **Impact = hint:** mỗi checkpoint gọi `computeImpact` (đã có) chỉ để render nhãn gợi ý; KHÔNG chặn.

### A4. Bản đồ loại-revise → bước vào — ✅ CHỐT (Toan duyệt 2026-07-22)
12 loại revise. **Đã verify DB: cả 12 bước-vào tồn tại đúng tên trong template SX-PROD (32 step).**

| Mã loại | Loại revise | Bước vào | Phòng chủ | Mode | Ghi chú |
|---|---|---|---|---|---|
| `REV_DESIGN` | Bản vẽ / VT chính | **P2.1** | R04 | **artifact** | BomVersion+ECO (C3) |
| `REV_WELDPAINT` | VT hàn / sơn | **P2.2** | R02 | process | |
| `REV_CONSUMABLE` | VT tiêu hao | **P2.3** | R05 | process | |
| `REV_ESTIMATE_NEW` | Dự toán — làm lại từ đầu | **P1.2** | R03 | process | walk cả P1.3→Phase 2-6 |
| `REV_ESTIMATE_ADJ` | Dự toán — điều chỉnh | **P2.4** | R03 | process | gọn: P2.5→hạ nguồn |
| `REV_WBS` | Kế hoạch / WBS | **P1.2A** | R02 | process | |
| `REV_CASHFLOW` | Kế hoạch dòng tiền | **P2.1A** | R08 | process | |
| `REV_QUOTE` | Giá / nhà cung cấp | **P3.5** | R07 | process | →P3.6→module PR/PO |
| `REV_PRODPLAN` | Phương án SX (tổng thể) | **P3.4** | R06 | process | lan ngược cả mua sắm |
| `REV_PROD_INPROGRESS` | Điều chỉnh khi đang chế tạo | **P5.1** | R06 | process | cục bộ, không lan ngược mua |
| `REV_QC_MATERIAL` | QC vật tư | **P4.3** | R09 | process | |
| `REV_QC_FAB` | Nghiệm thu chế tạo | **P5.3** | R09 | process | |

> Mã `REV_*` chuẩn hoá theo convention repo. Phòng ban có thể xác nhận lại, nhưng đây là bản CHỐT để vào Phase 0.

### A4.1 Format seed `ReviseTypeMap` (Phase 2 — CHƯA seed thật)
Cấu trúc mỗi entry:
```ts
type ReviseTypeDef = {
  code: string            // 'REV_DESIGN'
  entryStepCode: string   // 'P2.1' — bước vào (đã verify ∈ SX-PROD)
  ownerRole: string       // 'R04' — phòng khởi tạo revise
  label: string           // 'Bản vẽ / VT chính'
  mode: 'artifact' | 'process'
}
```
- **`mode: 'artifact'`** (chỉ `REV_DESIGN`): trigger = `approveRevision`; nối BomVersion/ECO qua `Task.revisionId = ecoId` → `computeImpact(old,new)` feed hint (mục **C3**).
- **`mode: 'process'`** (11 loại còn lại): trigger = fork UI; `revisionId = null`; không diff → hint rỗng, người tự quyết.
- **Nơi lưu — quyết ở Phase 2:**
  | Phương án | Ưu | Nhược |
  |---|---|---|
  | **Config const** (`src/lib/revise-types.ts`) | đơn giản, versioned theo code, không migration | đổi map phải deploy |
  | **Bảng DB `ReviseTypeMap`** | sửa map không cần deploy, phòng ban tự chỉnh qua admin | thêm migration + UI quản lý |
  - Đề xuất MVP: **config const** (map ít đổi, gắn chặt logic engine); chuyển DB sau nếu cần phòng ban tự sửa.

### A5. Cascade cũ → nhập vai "trợ lý gợi ý"
- **Bỏ** việc cascade tự đẻ task `CASCADE` phẳng — chỉ retire **CALL `runCascade`** ([revision-flow.ts:276-299](../../../src/lib/revision-flow.ts#L276-L299)).
- Giữ `computeImpact` + `classifyLine` để **gắn nhãn gợi ý** vào từng checkpoint của vòng revise (phòng nào "có ảnh hưởng").
- Hệ quả: **1 revise = 1 bộ task theo flow** (không còn cascade song song trùng lặp).
- ⚠️ **KHÔNG đụng khối re-QC** ([revision-flow.ts:237-321](../../../src/lib/revision-flow.ts#L237-L321)): cờ `WorkOrder.needsReQc` + task `RE_QC` là safety net Finding F, **độc lập cascade sẵn**. Chi tiết ở **C2**.

### A6. UI (chống mệt vì task rỗng)
- Nút **"Không ảnh hưởng — Bỏ qua"** 1 chạm + ô lý do (điền sẵn từ hint).
- **Bỏ qua hàng loạt** các bước impact gắn "khả năng không ảnh hưởng" (người rà 1 lượt, xác nhận cụm).
- Bước impact gắn "**có** ảnh hưởng" → KHÔNG cho skip nhanh, buộc mở xử lý.

### A7. Ví dụ — Revise Design tại P2.1 (dự án đang ở P5.x)
1. Chọn `[1] Revise` → "Bản vẽ/thiết kế" → bước vào **P2.1** → mở round 1.
2. Walk chain round 1: P2.1(R04 làm) → P2.4 gate → P2.5(R03) → P3.3(R02) → P3.4(R06) → P3.5(R07) → P3.6 → P4.x → P5.x → P6.x.
3. Tại mỗi bước, hint gợi ý; ví dụ điển hình:
   - P2.1, P2.2, P3.5 (mua bù VT đổi) → **có ảnh hưởng → phòng làm.**
   - P3.4, P5.1 (đang chạy) → PM/SX xem, cập nhật lệnh SX nếu cần.
   - P1.x, P6.x không đụng → **bấm "bỏ qua"** (log: "revise bản vẽ, không đổi kế hoạch/bàn giao").
4. Kết thúc: dự án có **round 0** (gốc) + **round 1** (revise) đầy đủ audit ai làm / ai bỏ qua / lý do.

---

## PHẦN B — PHƯƠNG ÁN ÁP LÊN PRODUCTION (dự án đang chạy thật)

### B0. Nguyên tắc rollout
- **Additive & sau feature-flag:** không đổi hành vi dự án đang chạy cho tới khi bật FF.
- **UAT (ibshi) trước, pilot 1–2 dự án, rồi full.** Cascade cũ chỉ tắt khi path mới xác nhận chạy đúng.
- Tuân thủ quy trình repo: `eslint (rules-of-hooks) → tsc → build → vitest → CI → admin-merge → Deploy workflow`.

### B1. Ảnh hưởng lên dự án đang chạy — ĐÁNH GIÁ
- Task hiện tại (mọi dự án, gồm 7 dự án P5.1) mặc định **round=0** sau migration → **không đổi gì**, không mất việc.
- Model mới **chỉ kích hoạt khi có hành động Revise** → dự án đang chạy **không tự phát sinh** task cho tới khi ai đó revise.
- 7 dự án mid-flow **không cần xử lý đặc biệt**: cơ chế round tự xử lý — revise sau này mở round 1 từ bước chọn, round 0 (P1–P4 đã DONE-skip) giữ nguyên.

### B2. Các bước triển khai
**Phase 0 — DB migration (an toàn, không đổi hành vi)**
- `prisma migrate`: thêm `revisionRound`, `revisionId`, `originStepCode`, `skipReason` + giá trị status `SKIPPED_NO_IMPACT`.
- Tất cả nullable/default → **không backfill, không downtime**. Chạy UAT trước, verify `prisma generate` + build.

**Phase 1 — Ship code sau FF (mặc định TẮT)**
- FF mới: `NEXT_PUBLIC_FF_REVISE_FLOW` (giống pattern `FF_BOM_CASCADE`, ARG trong Dockerfile).
- Off = hệ thống chạy y như hiện tại (cascade cũ vẫn hoạt động). **Deploy an toàn, 0 rủi ro hành vi.**

**Phase 2 — Seed bản đồ bước (A4) + Pilot**
- Chốt bản đồ loại-revise→bước với các phòng, seed vào config/DB.
- Bật FF cho **1–2 dự án pilot** (allowlist theo projectId trong config, hoặc FF global + guard danh sách).
- Chạy thử 1 revise thật trên pilot (UAT), rà round 1 sinh đúng chuỗi + skip log đúng.

**Phase 3 — Full rollout + tắt cascade cũ**
- FF on toàn hệ thống. Nhánh Revise mới thay cascade.
- **Drain in-flight cascade:** revision tạo TRƯỚC cutover dùng cascade cũ chạy nốt; revision SAU cutover dùng path mới. Chọn thời điểm cutover khi không có revision đang treo.
- Gỡ/█ vô hiệu `runCascade` tạo task (giữ `computeImpact` làm hint).

### B3. Rollback
- FF off → về cascade cũ ngay. Cột thêm vẫn nằm đó (vô hại). **Không mất dữ liệu.**

### B4. Việc cho DevOps / DB
| Việc | Ai | Khi |
|---|---|---|
| Chạy migration thêm 4 cột + status (UAT→Prod) | DevOps/DB | Phase 0 |
| Set ENV `NEXT_PUBLIC_FF_REVISE_FLOW=false` khi deploy | DevOps | Phase 1 |
| Seed bảng map loại-revise→bước | Dev + phòng ban | Phase 2 |
| Bật FF pilot → full | Toan quyết | Phase 2–3 |

### B5. Test bắt buộc trước mỗi deploy (theo CLAUDE.md)
```bash
npx eslint src 2>&1 | grep "rules-of-hooks" && echo FAIL || echo OK
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
npx vitest run --reporter=verbose 2>&1 | tail -20
```
+ test mới: `revise-round.test.ts` (mở round, walk chain, skip→gate không kẹt, dedup theo (step,round)).

---

## PHẦN C — BỔ SUNG 4 CHỖ HỞ (theo review 2026-07-22, đã verify code)

### C1. Gate với round — chống deadlock (chỗ dễ gãy nhất)
**Vấn đề (đã verify):** `doneCodesForProject` ([work-engine.ts:999-1013](../../../src/lib/work-engine.ts#L999-L1013)) keyed theo **CODE, round-agnostic** (dòng 1007 filter `status==='DONE'`); gate = `gateCodes.every(g => done.has(g))` (dòng 1103/1122/1132); dedup 1-task/step. → Vào lại P2.1 round-1: nếu done-set giữ code-keyed thì gate P2.4 thấy P2.2/P2.3/P2.1A **round-0 DONE → pass NGAY**, spawn P2.4 round-1 **trước khi** P2.1 round-1 kịp làm (sai). Nếu round-scoped mà không spawn anh-em → **kẹt gate** (thiếu round-1 của P2.2/P2.3/P2.1A).

**Giải (chốt — kết hợp auto-spawn + round-scoped):**
1. **Entry expansion:** vào tại S round N → tính **round-N subgraph** = mọi bước forward-reachable từ S (qua `next`) ∪ mọi bước feed (qua `gate`) bất kỳ bước trong tập đó. **Spawn round-N task (skippable) cho TOÀN BỘ subgraph.** VD S=P2.1 → subgraph gồm P2.1 **+ P2.2/P2.3/P2.1A** (feed gate P2.4) + P2.4 + P2.5 + … → cả 4 nhánh song song đều có round-1 task để người xử lý/bỏ qua.
2. **Round-scoped done-set** `doneCodesForProjectRound(steps, projectId, N)`: code `g` "thoả cho round N" nếu:
   - `g` có task **round-N** status ∈ {DONE, SKIPPED_NO_IMPACT}; **HOẶC**
   - `g` **không** thuộc round-N subgraph (nằm trước điểm vào) **VÀ** round mới nhất của `g` là DONE/SKIPPED (kế thừa round-0).
3. Gate round-N = `gateCodes.every(g => satisfiedForRound(g, N))`. **Không lẫn round.**

→ Không kẹt, không pass nhầm; anh-em song song feed gate được auto-spawn skippable → khớp model "người bấm bỏ qua".

### C2. Re-QC phải sống khi bỏ runCascade (an toàn chất lượng)
**Sự thật (đã verify):** khối re-QC — flag `WorkOrder.needsReQc` ([revision-flow.ts:237-271](../../../src/lib/revision-flow.ts#L237-L271)) + tạo task `RE_QC` ([:304-321](../../../src/lib/revision-flow.ts#L304-L321)) — **NẰM NGOÀI `if(cascadeParams)`**. Finding F đã tách nó **độc lập cascade**. → **Bỏ `runCascade` KHÔNG đụng re-QC.**

**Chốt:**
- Phase 3 chỉ retire **CALL `runCascade`** (dòng 276-299). Khối re-QC (237-321) + cờ `needsReQc` + task `RE_QC` → **GIỮ NGUYÊN, KHÔNG đụng.**
- Checkpoint QC trong round (P4.3/P5.3) là **ADDITIVE**, KHÔNG thay cờ `needsReQc`. Task `RE_QC` vẫn dispatch R09 độc lập.
- **Giữ nguyên test Finding F** (re-QC dispatch khi FF cascade off) làm hồi quy.

### C3. Nối "round task-flow" với BomVersion/ECO/diff
**Sự thật (đã verify):** `createRevisionWithEco` ([revision-flow.ts:29](../../../src/lib/revision-flow.ts#L29)) tạo BomVersion(DRAFT)+ECO ở **module design**; `approveRevision` (DRAFT→ACTIVE) mới là chỗ có `(oldVersionId, newVersionId)` để diff.

**Chốt — 2 loại trigger round:**
1. **Artifact-driven** (revise bản vẽ/BOM): `approveRevision` là TRIGGER. Thay vì gọi `runCascade` → **mở round N**, entry = bước BOM (P2.1/P2.2), set `Task.revisionId = ecoId`, lưu `(oldVersionId, newVersionId)`. Mỗi checkpoint gọi `computeImpact(old,new)` (đã có) render hint. **BomVersion KHÔNG tạo lại trong round** — checkpoint P2.x = designer xác nhận artifact đã revise (đã có sẵn).
2. **Process-driven** (không có artifact, vd "làm lại QC"): fork UI mở round N tại bước chọn, `revisionId=null`, không diff → hint rỗng, người tự quyết.

→ `Task.revisionId = ECO id` = sợi dây trace round ↔ artifact. Không trộn lẫn "tạo BOM" với "đi checkpoint".

### C4. Sweep `SKIPPED_NO_IMPACT` — 8 điểm chạm (sót 1 là kẹt gate / sai %)
Status là String → thêm giá trị **khỏi migration**, nhưng mọi chỗ coi `'DONE'` = "đã qua" phải coi `SKIPPED_NO_IMPACT` tương đương:

| # | File:line | Hiện tại | Sửa | Mức |
|---|---|---|---|---|
| 1 | [work-engine.ts:1007](../../../src/lib/work-engine.ts#L1007) | `doneCodesForProject` filter DONE | + SKIPPED | **CRITICAL — gate** |
| 2 | [workflow-engine.ts:829](../../../src/lib/workflow-engine.ts#L829) | `checkGate` status DONE | + SKIPPED | **CRITICAL — gate** |
| 3 | [workflow-engine.ts:833](../../../src/lib/workflow-engine.ts#L833) | `activateTask` reactivation set | cân nhắc + SKIPPED | trung bình |
| 4 | [api/projects/route.ts:55](../../../src/app/api/projects/route.ts#L55) | completed filter DONE (%) | + SKIPPED | % sai |
| 5 | [api/projects/[id]/route.ts:77](../../../src/app/api/projects/[id]/route.ts#L77) | completed filter DONE (%) | + SKIPPED | % sai |
| 6 | [api/projects/[id]/route.ts:167,169](../../../src/app/api/projects/[id]/route.ts#L167) | closure gate `every DONE` | + SKIPPED | đóng dự án kẹt |
| 7 | [work-engine.ts:776,778](../../../src/lib/work-engine.ts#L776) | my-tasks `notIn [DONE,CANCELLED]` | + SKIPPED (ẩn khỏi việc active) | noise |
| 8 | [api/projects/[id]/route.ts:45](../../../src/app/api/projects/[id]/route.ts#L45) | status map board 3 cột | bucket SKIPPED vào "Hoàn thành"/state riêng | UX |

**Đề nghị:** viết 1 helper trung tâm `isResolved(status) = status ∈ {DONE, SKIPPED_NO_IMPACT}` (giống pattern `isTaskOverdue`), thay các chỗ `=== 'DONE'` ở gate/%/closure → không sót về sau.

### C5. Product risk — bulk-skip vào MVP (không để sau)
Walk full downstream = nhiều checkpoint rỗng (revise P2.1 khi dự án ở P5 → ~15-20 bước, phần lớn skip). Nếu skip không thật 1-chạm → người bấm như máy → log thành rác, mất giá trị "người soi". → **A6 bulk-skip nằm trong MVP** (đã chốt ở review).

---

## ĐÃ CHỐT (review Toan 2026-07-22)
1. **Bản đồ A4:** ✅ **CHỐT 12 loại** (mục A4, verify DB 12/12 bước-vào khớp SX-PROD).
2. **Pilot:** ✅ 1 trong 7 dự án P5.1 (lộ ca re-enter giữa chuỗi) + 1 dự án phase sớm — **chưa chọn mã cụ thể**.
3. **Bulk-skip:** ✅ **có trong MVP** (không để sau).
4. **Tắt cascade cũ (Phase 3):** ✅ đồng ý — **NHƯNG chỉ sau khi C2 (re-QC) xác nhận còn nguyên** ở path mới. Không thì là bước lùi an toàn.

## Điều kiện vào code (Phase 0)
- [x] **Bản đồ A4** — ✅ CHỐT (12 loại, verify DB khớp).
- [x] **Thiết kế C1** (entry expansion fixpoint đồ-thị-hợp + round-scoped gate) — ✅ duyệt ([DESIGN_C1](DESIGN_C1_GateRound_2026-07-22.md), Claude rà 2.2b OK).
- [x] **C2** re-QC không đụng (giữ test Finding F) — ✅ xác nhận.
- [x] **C3** luồng artifact↔round (2 trigger) — ✅ vẽ trong C3 + A4.1.
- [x] **C4** sweep DONE (3 nhóm) + helper `isResolved()` — ✅ liệt kê; **Q3 nhóm B** tách sang [DESIGN_RoundCounting](DESIGN_RoundCounting_2026-07-22.md).
- [ ] **Chọn 2 dự án pilot cụ thể** — ⏳ **việc DUY NHẤT còn lại trước Phase 0.**
