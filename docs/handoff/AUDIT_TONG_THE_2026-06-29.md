# AUDIT TỔNG THỂ HỆ THỐNG IBS-ERP
### Logic · Chức năng · Liên kết dữ liệu — so chuẩn vận hành nhà máy kết cấu thép / công nghiệp nặng
**Ngày:** 2026-06-29 · **Phạm vi:** đọc code thật toàn repo (4 luồng rà song song + verify chéo bằng grep) · **Phương pháp:** không suy đoán — mọi kết luận chính có dẫn `file:dòng`.

**Thang mức độ:** 🔴 P0 = sai số liệu / mất dữ liệu / hở bảo mật · 🟠 P1 = đứt gãy chức năng / quy trình · 🟡 P2 = thiếu, chưa khép vòng.

---

## 0. KẾT LUẬN CHO BAN LÃNH ĐẠO (1 trang)

Hệ thống IBS-ERP đã phủ **rộng** toàn bộ chuỗi nhà máy (Bán hàng → Thiết kế/Revision → Vật tư → Sản xuất → QC → Giao hàng → Tài chính + hỗ trợ TBCG/HSE/HR), với **lược đồ dữ liệu thiết kế đúng hướng chuẩn thép**: versioning bản vẽ/BOM, ECO, weld map theo mối hàn, ITP/NCR, truy xuất heat/lot tới tận GRN, MRB, chứng chỉ. Đây là nền tốt.

Tuy nhiên, **độ sâu chưa theo kịp độ rộng**. Hệ thống hiện ở mức **điều phối công việc + nhập liệu + báo cáo**, **chưa đạt mức "hệ thống bản ghi" (system of record)** đủ tin cậy để vận hành một nhà máy nặng, vì 3 nhóm vấn đề gốc:

1. **Dữ liệu nghiệp vụ lõi nằm trong JSON (`Task.resultData`), không chuẩn hóa quan hệ.** BOM/dự toán/PR/PO sống dưới dạng chuỗi JSON snapshot → không đối soát, không ràng buộc toàn vẹn, dễ lệch khi bản vẽ thay đổi.
2. **Vài "vòng" then chốt bị đứt ở tầng thực thi** dù khung đã có: tiến độ sản xuất theo tấn **luôn = 0**; hàng nhập kho (GRN) **không vào sổ kho per-kho**; cascade "thiết kế đổi → vật tư đổi" **đang tắt + là code rỗng**; tài chính **không nối hóa đơn/công nợ với đơn mua**.
3. **Lớp kiểm soát còn lỏng:** ~70% API không kiểm quyền theo vai trò; nhiều "cổng chất lượng" (QC→giao hàng, phát hành hồ sơ MDR) chỉ **hiển thị cảnh báo, không khóa được hành động**.

**Khuyến nghị tổng:** trước khi mở rộng tính năng mới, nên dành một đợt **"củng cố lõi"** — chuẩn hóa BOM/PO/Kho thành quan hệ + khép 4 vòng đứt gãy + siết phân quyền API. Chi tiết & ưu tiên ở Mục 3.

**Bảng phủ theo khâu (nhanh):**

| Khâu nhà máy | Mức hiện tại | Vấn đề cốt lõi |
|---|---|---|
| Bán hàng → khởi tạo sản xuất | 🟠 Khung | API ngoài chỉ tạo task lẻ, không châm dây chuyền |
| Thiết kế / Revision / ECO / BOM | 🟠 Khung tốt, chưa khép | Cascade tắt + dead code; versioning thật bỏ kiểm ECO |
| Mua hàng (PR→báo giá→PO→GRN) | 🟠 Chạy nhưng đứt kho | Tồn kho split-brain; GRN không vào MaterialStock |
| Sản xuất (WO/JobCard/weld/tiến độ) | 🔴 Đứt | Tiến độ tấn = 0; JobCard không roll-up; tách Task động |
| QC (ITP/NCR/cert/heat/MRB) | 🟢/🟠 Khá | Heat-trace tốt; cổng QC→WO/MRB lỏng/thủ công |
| Giao hàng (kiện/chuyến/MDR) | 🟠 Khung | MDR không phát hành được; 2 hệ giao hàng song song |
| Tài chính (ngân sách/HĐ/công nợ) | 🔴 Rời | Không nối Invoice/Payment↔PO; 3 định nghĩa "actual" |
| TBCG / Thiết bị & bảo trì | 🟡 Khung CRUD | Không sinh việc, taskId field chết |
| HSE / An toàn | 🟡 Khung CRUD | 2 hệ trùng (/hse vs /safety); thiếu chỉ số chuẩn |
| Nền tảng (task/RBAC/sync/audit) | 🟠 Đủ điều phối | Dữ liệu JSON; RBAC API hở; sync nuốt lỗi |

---

## 1. NỀN TẢNG & XƯƠNG SỐNG

**Kiến trúc task — thực tế có 3 lớp, không phải 2:**
- (a) Legacy gốc `WorkflowTask` (bảng `workflow_tasks`) — **gần như chết**, chỉ còn vài chỗ chạm.
- (b) "36 bước" hiện hành: model `Task` với `taskType='P1.1'…`, chạy bằng `workflow-engine.ts` — **xương sống quy trình sản xuất**.
- (c) Dynamic/inbox: cùng bảng `Task` (`taskType='FREE'` hoặc `templateStepId`), chạy bằng `work-engine.ts` — **giao việc động /dashboard/work**.

→ (b) và (c) **dùng chung một bảng `tasks` nhưng hai engine khác nhau** (cộng `task-engine.ts` cho getById/assign). Hai hàm `completeTask` cùng tên, logic "allDone" lệch nhau (`work-engine.ts:388` đếm toàn bộ rows vs `workflow-engine.ts:59` dùng `alreadyDone+1`). Rủi ro bảo trì & regression.

**Liên kết dữ liệu lõi — "single source of truth" chỉ đúng ở mức KIỂU, không ở mức DỮ LIỆU:**
- Dữ liệu nghiệp vụ (BOM, dự toán, PR, PO, báo giá) lưu trong **`Task.resultData` (JSON)**, không chuẩn hóa thành bảng quan hệ. FK thật rất ít (`parentId`, `templateStepId`, `projectId`, `bomVersionId`).
- Truyền giữa bước qua `previousStepData` (rebuild on-the-fly, query `resultData` theo `taskType`) — `src/lib/data-fetchers.ts`, `src/app/api/tasks/[id]/route.ts:125-559`. Lúc **FORWARD copy nguyên khối resultData** (`work-engine.ts:378-381`) → snapshot, sửa bản gốc không lan.
- Parse JSON rải rác có `try/catch` nuốt lỗi → `[]`; P4.4 khớp vật tư **bằng TÊN fuzzy** (`workflow-engine.ts:590-599`) thay vì mã.
- *Điểm tốt:* ghi `resultData` bằng **jsonb merge nguyên tử** (không mất sibling key); audit 3 lớp `TaskHistory`/`AuditLog`/`ChangeEvent`.

**Sync-engine (`src/lib/sync-engine.ts`):**
- Budget: `syncBOMtoBudget`/`syncPOtoBudget`/`recalcBudgetActual` — **recompute từ đầu → idempotent (tốt)**. Nhưng chỉ category **MATERIAL**; `actual` chỉ recompute **khi REJECT**, không có hook lúc GRN → dễ stale.
- Kho & module: nằm trong `runWorkflowHooks` (imperative, **không idempotent**), mỗi item 1 transaction → **không atomic cả lô**; **reject KHÔNG đảo ngược StockMovement** (`runReverseHooks` chỉ recalc budget) → tồn kho có thể lệch vĩnh viễn. Mọi hook bọc try/catch "không chặn hoàn thành" → **sync lỗi âm thầm, task vẫn DONE**.

**RBAC — 3 tầng không nhất quán (🔴 P0 hở API):**
- Trang `PAGE_ACCESS` (sinh từ `MENU_ITEMS`) chỉ ẩn/hiện menu — **frontend-only**.
- API: chỉ **~55/183 route** dùng `requireRoles`; ~70% chỉ check đăng nhập. Row-level security `getUserProjectIds` chỉ gọi ở **3 route** → đa số API không lọc theo dự án được phép.
- Biểu mẫu `FORM_EDIT_ROLES` + `canEditForm` — **tầng làm tốt nhất** (nhất quán FE+BE).

🔴 **Bug an toàn quy trình đã xác nhận:** `src/lib/validation-rules.ts:105,251` query `prisma.workflowTask` (**bảng chết**) trong khi engine ghi `tasks` → các luật cảnh báo vượt ngân sách / chặn đính kèm **luôn no-op** (không tìm ra task).

---

## 2. CHI TIẾT THEO KHÂU

### 2.1 Bán hàng → khởi tạo sản xuất (External API) — 🟠
- API ngoài (`/api/external/v1`) **auth/scope chặt**: key `ibsk_live_*`, lưu SHA-256, `timingSafeEqual`, scope `read/write:tasks…`, webhook HMAC. Idempotent qua `externalRef`.
- 🟠 **Khe hở tích hợp lớn:** `POST /tasks` chỉ tạo `taskType:'FREE'` (task lẻ), **không kickoff workflow 36 bước**. Sale giao được việc cho 1 người/phòng nhưng **không châm dây chuyền** Thiết kế→Vật tư→SX→QC→Giao. Cấp key chỉ qua CLI, chưa có admin UI.

### 2.2 Thiết kế / Revision / ECO / BOM — 🟠 (khung tốt, chưa khép vòng)
- Model đúng hướng: `Drawing → DrawingRevision → BomVersion(DRAFT/ACTIVE/SUPERSEDED) → BomItem(category MAIN/WELD/PAINT/AUX/CONSUMABLE)`, `EngineeringChangeOrder`, `Norm`.
- 🟠 **Logic "đúng" là DEAD CODE:** `src/lib/revision-flow.ts` (`createRevisionWithEco`/`approveRevision`: remap parentId, chặn duyệt nếu ECO chưa APPROVED) **không file nào import** (verify: grep `revision-flow` = 0). API thật `design/bom/versions/route.ts:79-96` copy line giữ **parentId cũ** (sai cây BOM khi có cấp) và `versions/[id]` PUT activate **không kiểm ECO=APPROVED**.
- 🔴 **Cascade vật tư = placeholder + TẮT:** `feature-flags.ts:5` OFF mặc định; `revision-flow.ts:208-213` là `// TODO` chưa nối work-engine, lại nằm trong hàm không được gọi → **đổi thiết kế KHÔNG tự sinh hành động mua**.
- 🟡 Diff engine đúng (key `pieceMark::materialCode::category`) nhưng đổi mã = REMOVED+ADDED (không nhận "thay thế"). Impact engine phân trạng thái mua hợp lý **nhưng chỉ read-only/tư vấn** — không tạo PR/PO/NCR. Định mức hàn/sơn dùng **hệ số thô hardcode** (`bom-diff-engine.ts:369-370`: m²=KL×0.15, m hàn=KL×0.02) trên tổng khối lượng MAIN — không đủ chính xác.

### 2.3 Mua hàng (PR → báo giá → PO → GRN → kho) — 🟠 (chạy nhưng đứt ở kho)
- Chuỗi chạy thật: enrich PR khớp kho (`bompr-enrich.ts`, 5 chiến lược matching, availableQty/needToBuyQty) → báo giá NCC (`quote-parser.ts`: matching, coverage %, so số lượng) → PO (`create-po`, idempotent qua `resultData.poId`, snapshot itemCode/profile/grade, cho `materialId=null`) → GRN (tăng `Material.currentStock`, tạo `StockMovement IN`).
- 🔴 **Tồn kho SPLIT-BRAIN (verify đã xác nhận):** enrichment đọc tồn từ **`MaterialStock` (per-kho)**, nhưng GRN + P4.4 chỉ tăng **`Material.currentStock` (scalar)**. **Không nơi nào ghi `MaterialStock`** (grep: chỉ `aggregate` đọc). → Hàng nhận về **không hiện trong availableQty của PR kế tiếp**; impact engine và enrichment đo tồn theo **2 nguồn khác nhau**. Vòng "nhận hàng → giảm mua lần sau" bị đứt.
- 🟠 **GRN bỏ qua `materialId=null`** (`if(poItem.materialId)`) → mua mã tạm (provisional) nhận hàng là **rơi khỏi sổ kho**. Mã provisional (`isProvisional/PENDING`) **không có flow promote → chuẩn**, và `loadInventory` lọc `status='ACTIVE'` nên mã PENDING **không bao giờ match làm tồn**.
- 🟡 Không truy ngược `BomItem ↔ PoItem ↔ kho` (chỉ qua `materialId`) → revise BOM không tự biết PO/lô nào bị ảnh hưởng.

### 2.4 Sản xuất (WO / JobCard / Weld map / tiến độ) — 🔴 (đứt ở thực thi)
- Model đủ: `WorkOrder(pieceMark, bomVersionId, plannedWeight, departmentId/tổ TO-*)`, `JobCard`, `Workshop`, `WeldJoint`.
- 🔴 **Tiến độ theo TẤN = 0 vĩnh viễn (verify đã xác nhận):** `WorkOrder.completedQty` **không được ghi ở bất kỳ đâu** (grep: chỉ đọc). Thanh "x/y kg" luôn `0/plannedWeight`. Tiến độ 5 công đoạn chỉ **đếm số JobCard COMPLETED**, không theo khối lượng.
- 🔴 **JobCard không roll-up + không có route cập nhật:** không có `job-cards/[id]` (PUT/PATCH) → tạo xong không sửa/duyệt/đóng, `approvedBy` chết, `actualQty` không cộng dồn về WO.
- 🟠 **Toàn chuỗi SX-QC-Logistics KHÔNG đi qua Task động** (grep `createTask|prisma.task` trong api/production, api/qc = 0) → module standalone, không có việc/SLA/overdue/thông báo cho sản xuất & xử lý NCR.
- 🟢 Weld map: NDT FAILED → **auto-NCR hoạt động đúng** (nối `weld_joints.ncr_id`, idempotent). 🟡 nhưng `welderCertId`/`wpsNo` là **text tự do**, không FK `CertificateRegistry`, không kiểm chứng chỉ thợ còn hạn; mã NCR `count()+1` dễ trùng (race).

### 2.5 QC (ITP / NCR / Cert / Heat-lot / MRB) — 🟢-🟠 (mạnh nhất, cổng còn lỏng)
- 🟢 **Truy xuất heat/lot thông suốt:** heat → GRN/StockMovement → MaterialIssue (kèm WO) → piece-mark (`mill-certificates/[id]/trace`). Điểm sáng nhất hệ thống.
- 🟢 **NCR vòng đời chuẩn:** OPEN→INVESTIGATING→ACTION_TAKEN→CLOSED, **chặn đóng khi còn action mở + bắt buộc disposition** (`qc/ncr/[id]/route.ts:50-58`). Cert renew có chuỗi `renewedFromId`. ITP checkpoint FAILED → auto-NCR.
- 🟠 **Cổng QC còn lỏng/thủ công:** (a) transition `WorkOrder → QC_PASSED` **chỉ role-gate R09, không kiểm NCR mở / NDT FAILED / ITP chưa xong**; (b) auto-NCR ITP chỉ chạy khi client gửi cờ `createNcr=true` (không bắt buộc); (c) Hold point không thực sự "chặn SX".
- 🔴 **MRB chỉ là báo cáo GET, KHÔNG có phát hành/cổng khóa; KHÔNG có entity FAT** trong toàn schema. `overallStatus='READY'` chỉ là chuỗi hiển thị, không khóa hành động giao hồ sơ.

### 2.6 Giao hàng (Packing / Shipment / MDR) — 🟠
- 🟢 **Cổng đóng kiện có thật (server):** chặn gom piece-mark nếu WO còn NCR mở / NDT FAILED chưa có NCR (`logistics/packing-lists/route.ts:62-101`, HTTP 422). 🟠 **nhưng lỏng:** chỉ xét **weld joint**, không xét ITP/Inspection/`status=QC_PASSED`; piece-mark **không có mối hàn** (hàng bắt bu-lông/chỉ sơn) **lọt vô điều kiện**; `qcStatus` **hard-code 'PASSED'** khi tạo item.
- 🟠 Shipment có máy trạng thái PENDING→IN_TRANSIT→ARRIVED→RECEIVED (chặn nhảy bậc). MDR gate logic đúng nhưng **read-only, nút "Phát hành" không có onClick**, không lưu hồ sơ.
- 🟠 **% giao hàng lệch nguồn:** tử số = `Σ PackingListItem.weight` **nhập tay**, còn Sản xuất đo bằng `completedQty`. 🟡 **Hai hệ giao hàng song song:** `DeliveryRecord.packingList` (JSON tự do, /api/delivery legacy) vs `Shipment` (FK, /api/logistics) — chưa hợp nhất.

### 2.7 Tài chính (Ngân sách / Hợp đồng / Công nợ) — 🔴 (rời rạc)
- Model + API đủ ở mức vận hành: `Budget`, `Invoice`, `Payment` (trừ `paidAmount`, chặn vượt), `CashflowEntry`, `LoanDrawdown/ProjectFinancePlan`.
- 🔴 **Không khép vòng Mua hàng ↔ Công nợ:** `Invoice/Payment` **không có FK tới `PurchaseOrder`** → tiền thực trả NCC không quay về cập nhật committed/actual của Budget/PO.
- 🔴 **PO từ convert PR lưu `totalValue=0`** ("Will be updated…") và **không bao giờ cập nhật lại** (`purchase-orders/convert/route.ts:40,47`) → committed budget thiếu hụt.
- 🔴 **Ba định nghĩa "actual" mâu thuẫn:** StockMovement (`sync-engine.ts:114`) vs CashflowEntry (`budgets/route.ts:41`) vs Invoice (`variance/route.ts:26`). Sync chỉ category MATERIAL; actual chỉ recompute khi reject.

### 2.8 Hỗ trợ: TBCG / HSE / HR / Báo cáo — 🟡
- **TBCG:** Equipment/Maintenance/Assignment CRUD độc lập. 🟡 **Không đi qua Task động** (`MaintenanceRecord.taskId` là **field chết**); breakdown không sinh việc sửa chữa; preventive không có lịch tự sinh. Gán thiết bị↔WO thủ công, không check trùng/capacity, không gate SX theo thiết bị.
- **HSE:** 🟠 **Nợ trùng lặp:** hai hệ song song `/api/hse/*` (mã INC-, OPEN→…→CLOSED) và `/api/safety/*` (mã HSE-, …→RESOLVED) — hai state machine + hai mã. WorkPermit/ToolboxTalk đủ khung. 🟡 Dashboard an toàn chỉ đếm thô, **thiếu chỉ số chuẩn ngành (TRIR/LTIFR)** vì không có man-hours; `SafetyIncident.taskId` chết.
- **HR:** đủ cốt lõi (Employee/Contract/Attendance/Timesheet/Salary + `salary-engine` tính BHXH/TNCN). Thiếu nghỉ phép/approval, KPI, tích hợp máy chấm công.
- **Báo cáo:** ~15 loại + executive + project-profitability. 🟡 nhiều report `findMany` toàn bảng rồi filter JS (chậm khi scale), chưa export PDF/Excel.

---

## 3. DANH SÁCH LỖ HỔNG ƯU TIÊN (ĐỂ LÊN KẾ HOẠCH)

### 🔴 P0 — Sửa trước (sai số liệu / mất dữ liệu / bảo mật)
1. **Tồn kho split-brain:** thống nhất một nguồn tồn (chuẩn hóa `MaterialStock` per-kho, GRN/issue ghi vào đó; hoặc bỏ `MaterialStock`, mọi nơi đọc `currentStock`). Bắt buộc GRN xử lý `materialId=null`. *(2.3)*
2. **Tiến độ sản xuất theo tấn:** ghi `WorkOrder.completedQty` + roll-up từ `JobCard.actualQty`; thêm route cập nhật/duyệt JobCard. *(2.4)*
3. **Tài chính khép vòng:** thêm FK `Invoice/Payment ↔ PurchaseOrder`; sửa PO convert tính `totalValue` thật; thống nhất 1 định nghĩa "actual" + hook cập nhật lúc GRN. *(2.7)*
4. **Siết phân quyền API:** thêm `requireRoles` + row-level project filter cho các route ghi/nhạy cảm (đang ~70% chỉ check đăng nhập). *(1)*
5. **Sửa `validation-rules.ts`** trỏ đúng bảng `tasks` (đang query `workflowTask` chết → luật cảnh báo vô hiệu). *(1)*
6. **Reject phải đảo ngược StockMovement** (hiện chỉ recalc budget) để tồn kho không trôi vĩnh viễn. *(1)*

### 🟠 P1 — Khép các vòng chức năng
7. **Cascade "thiết kế đổi → vật tư đổi":** dùng logic `revision-flow.ts` (đang dead) hoặc nối Impact engine vào work-engine để **tự sinh Task PR điều chỉnh**; bật cờ sau khi test. Activate BomVersion phải kiểm ECO=APPROVED + remap parentId. *(2.2)*
8. **Cổng QC thật:** transition `WO→QC_PASSED` và **đóng kiện** phải kiểm NCR mở / NDT / ITP / Inspection (không chỉ weld joint); bỏ hard-code `qcStatus='PASSED'`; auto-NCR ITP bắt buộc khi FAILED. *(2.4, 2.5, 2.6)*
9. **MRB/FAT phát hành có cổng khóa:** thêm entity lưu hồ sơ + endpoint phát hành chặn khi `canRelease=false`; bổ sung khái niệm FAT. *(2.5, 2.6)*
10. **Nối SX-QC-TBCG-HSE vào Task động:** phát sinh (sản xuất, NCR, bảo trì, sự cố) sinh Task để có SLA/overdue/thông báo; kích hoạt các field `taskId` đang chết. *(2.4, 2.8)*
11. **Sale → dây chuyền:** External API cho phép kickoff workflow (seed bước đầu), không chỉ task FREE. *(2.1)*
12. **Hợp nhất 2 hệ trùng:** giao hàng (DeliveryRecord vs Shipment) và HSE (/hse vs /safety) — giữ 1, migrate cái kia. *(2.6, 2.8)*

### 🟡 P2 — Chính xác & dọn nợ
13. Định mức hàn/sơn theo diện tích/chiều dài đường hàn thực thay vì hệ số thô. *(2.2)*
14. Nối `welderCertId`/`wpsNo` ↔ `CertificateRegistry` + kiểm hạn chứng chỉ thợ. *(2.4)*
15. Flow promote mã provisional → chuẩn; truy ngược `BomItem↔PoItem`. *(2.3)*
16. Chỉ số an toàn chuẩn (TRIR/LTIFR) + man-hours; export báo cáo PDF/Excel; tối ưu query report. *(2.8)*
17. Chuẩn hóa dần dữ liệu nghiệp vụ JSON (`resultData`) sang bảng quan hệ (BOM/PR/PO) để đối soát & ràng buộc toàn vẹn. *(1)* — việc lớn, làm tiệm tiến.

---

## 4. ĐIỂM MẠNH CẦN GIỮ
- Lược đồ dữ liệu hướng chuẩn thép: heat/lot trace, weld map theo mối, ITP/NCR vòng đời chuẩn, cert + renew, BOM versioning.
- Budget sync **recompute idempotent** đúng cách; audit 3 lớp; lưu `resultData` jsonb merge nguyên tử.
- Báo giá NCC: matching đa chiến lược + coverage + so số lượng — nghiệp vụ tốt.
- External API & Telegram: auth chặt, có thông báo workflow.
- Design System v3 đã nhất quán toàn hệ (đợt trước).

---

*Ghi chú phương pháp: báo cáo tổng hợp từ 4 luồng rà code song song; các claim mức P0 (tiến độ tấn=0, MaterialStock không ghi, revision-flow dead code, validation-rules trỏ bảng chết) đã được verify lại trực tiếp bằng grep trên mã nguồn ngày 2026-06-29.*
