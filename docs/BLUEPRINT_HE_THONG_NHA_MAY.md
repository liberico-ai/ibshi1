# IBS-ERP — Blueprint Hệ thống Quản lý Tổng thể Nhà máy Công nghiệp Nặng

> Tài liệu CHUẨN dùng chung cho **VS Code** (triển khai backend/flow/logic) và **Claude Design** (UI/UX).
> Mục tiêu: một hệ thống quản lý toàn nhà máy chế tạo kết cấu thép, đồng bộ hai bên, bám đúng cái đang chạy thật.
> Phiên bản 1.0 · 2026-06.

---

## 0. Cách dùng tài liệu này

- **VS Code**: xây backend (entity, status, flow, logic propagation) + API + RBAC theo Mục 3–8. Bám **commit production** (tag `production` / `/api/version`), qua gate `eslint → tsc → build → vitest`, deploy từng phần.
- **Claude Design**: thiết kế UI/UX theo **Design System** (Mục 9) + danh sách màn (Mục 6). Bám `org-map.ts`, `constants.ts`, `workflow-constants.ts`, `HIDDEN_MENU_KEYS`.
- **Nguyên tắc xuyên suốt** (cả hai bên): (1) **Hệ động** (Task + Giao ban) là xương sống — không hồi sinh 36 bước legacy; (2) bám production, không thiết kế cho phần đã ẩn/đang gỡ; (3) nhất quán Design System; (4) role-aware, dùng không cần đào tạo.

---

## 1. Nguyên tắc kiến trúc

1. **Xương sống = Hệ động**: mọi giao/nhận/xử lý việc qua trang **Công việc** (Task động) + **Giao ban tuần**. Biểu mẫu (PR, BOM, dự toán, báo giá, BBH…) gắn vào Task qua `resultData`, chảy theo việc xuống bước sau.
2. **Một nguồn sự thật cho mã/role/phòng**: `org-map.ts` (10 phòng), `constants.ts` (role, FORM_EDIT_ROLES), `workflow-constants.ts` (status/bước).
3. **Truy vết & tài liệu tập trung**: file lưu bền, phục vụ qua `/api/upload/[id]` (auth), gom theo dự án/luồng.
4. **An toàn dữ liệu production**: mọi đổi DB có pg_dump + `prisma migrate deploy` (không reset); thao tác ghi enforce ở server, không chỉ ẩn UI.

---

## 2. Mô hình tổ chức (10 phòng / role)

| Phòng | Code | Role | Vai trò chính trong nhà máy |
|---|---|---|---|
| Ban Giám đốc | BGD | R01 | Phê duyệt, quyết định, ngân sách |
| CNTT & Dữ liệu | CNTT | R10 | Quản trị hệ thống |
| Phòng Kỹ thuật (Thiết kế) | TK | R04/R04a | Bản vẽ shop, BOM, PR, **revision** |
| Kinh tế Kế hoạch | KTKH | R03/R03a | Dự toán, bóc tách, định mức, chi phí |
| Thương mại | TM | R07/R07a | Tìm NCC, báo giá, PO, hợp đồng mua |
| Quản lý Dự án | QLDA | R02/R02a | Điều hành dự án, tiến độ, giao ban |
| Sản xuất | SX | R06/R06a/R06b + tổ TO-* | Lệnh SX, cắt/lắp/hàn/sơn, tiến độ chế tạo |
| Tài chính Kế toán & Kho | TCKT | R08/R08a/R05/R05a | Kho (GRN/tồn/cấp phát), thanh toán, quyết toán |
| QA/QC | QC | R09/R09a | Nghiệm thu, NDT, sơn/DFT, NCR, hồ sơ chất lượng |
| Thiết bị & Cơ giới | TBCG | R13 | Máy móc, bảo trì, cấp phát thiết bị |

---

## 3. Vòng đời dự án chế tạo (flow tổng thể + bàn giao dữ liệu)

```
HĐ/Dự án (BGĐ,PM)
  → THIẾT KẾ (R04): Bản vẽ + BOM theo piece-mark + PR        ──┐ (revision lặp nhiều lần — Mục 4)
  → KTKH (R03): Dự toán / bóc tách KL / định mức / chi phí     │
  → THƯƠNG MẠI (R07): PR → khớp tồn → Báo giá NCC → PO          │
  → KHO (R05/TCKT): GRN + Heat/Lot cert → Tồn → Cấp phát       │
  → SẢN XUẤT (R06/tổ): Lệnh SX → cắt/lắp/hàn → sơn/mạ          │
  → QA/QC (R09): nghiệm thu đầu vào → trong quá trình → cuối   │
  → GIAO HÀNG (R02/Kho): đóng gói → vận chuyển → lắp → nghiệm thu KH
  → TÀI CHÍNH (R08): thanh toán → dòng tiền → quyết toán
Xuyên suốt: Kiểm soát tài liệu (rev bản vẽ) · NCR (lỗi) · HSE (an toàn) · TBCG (thiết bị)
```

**Logic bàn giao (mỗi bước sinh dữ liệu cho bước sau):**
BOM (Thiết kế) → PR → đối chiếu tồn (Cần mua = Cần − Tồn khả dụng) → Báo giá NCC (mẫu chuẩn, 2 mã Item+Vật tư) → PO (snapshot) → GRN (Heat/Lot) → tồn → cấp phát theo Lệnh SX → bản ghi QC theo piece-mark → hồ sơ chất lượng giao khách. Mỗi mắt xích có **status gate** và **truy vết ngược** về dự án/bản vẽ/rev.

---

## 4. ⭐ QUẢN LÝ REVISION BẢN VẼ & CASCADE VẬT TƯ (TRỌNG TÂM)

Thực tế: thiết kế **revise nhiều lần** (Rev 0 → A → B …). Mỗi rev thay đổi khối lượng/chủng loại của **5 nhóm vật tư**: **chính** (thép hình/tấm/ống), **hàn**, **sơn/mạ**, **phụ** (bu-lông/phụ kiện), **tiêu hao**. Hệ thống phải quản lý version + lan truyền thay đổi đúng cách, không làm vỡ dữ liệu đã mua/đã chế tạo.

### 4.1 Mô hình dữ liệu (entity cần có)
- **Drawing** (bản vẽ): `dwgNo`, `title`, `projectId`, `discipline`, `currentRev`.
- **DrawingRevision**: `drawingId`, `revCode` (0/A/B…), `status` (DRAFT | ISSUED | SUPERSEDED), `issuedAt`, `reason` (lý do revise), `approvedBy`, `fileId` (bản vẽ PDF/DWG), `source` (nội bộ / yêu cầu KH).
- **BomVersion**: `projectId`, `revCode` (gắn với DrawingRevision), `status`, `createdBy`. Mỗi rev = **một version BOM** (giữ lịch sử, không ghi đè).
- **BomLine**: `bomVersionId`, `category` (MAIN | WELD | PAINT | AUX | CONSUMABLE), `pieceMark` (mã hiệu cấu kiện), `itemCode`, `canonicalCode` (mã vật tư), `profile`, `grade`, `unit`, `qty`. (Vật tư hàn/sơn/tiêu hao có thể tính theo công thức từ khối lượng/diện tích — xem 4.5.)

### 4.2 Quy trình revise (đầu–cuối)
1. **Thiết kế tạo Rev mới** (DrawingRevision DRAFT) + BomVersion mới (copy từ rev trước rồi sửa).
2. **DIFF tự động** giữa rev mới vs rev đang hiệu lực → delta theo từng nhóm vật tư (Mục 4.3).
3. **PHÂN TÍCH TÁC ĐỘNG** (Impact) theo trạng thái mua/sản xuất của từng dòng đổi (Mục 4.4).
4. **DUYỆT** (PM/BGĐ) — vì có tác động chi phí/tiến độ. Rev cũ → SUPERSEDED.
5. **LAN TRUYỀN** (Propagate): sinh PR điều chỉnh, cập nhật dự toán/ngân sách, thông báo các phòng (Mục 4.6).
6. **TRUY VẾT**: mỗi cấu kiện chế tạo gắn rev đã dùng; nếu chế tạo theo rev cũ → mở **NCR**.

### 4.3 Diff engine (so version BOM)
So `BomVersion(rev cũ)` vs `(rev mới)` theo khóa `pieceMark + canonicalCode + category`:
- **Thêm mới** (rev mới có, cũ không) · **Bỏ** (cũ có, mới không) · **Đổi số lượng** (Δqty) · **Đổi quy cách** (đổi profile/grade = bỏ cũ + thêm mới).
- Gom kết quả **theo 5 nhóm** (chính/hàn/sơn/phụ/tiêu hao) + tổng Δ khối lượng, Δ chi phí dự kiến.

### 4.4 Phân tích tác động theo TRẠNG THÁI (cốt lõi để không vỡ dữ liệu)
Với mỗi dòng đổi, kiểm trạng thái hiện tại → quyết hành động:

| Trạng thái dòng vật tư | Tăng / Thêm | Giảm / Bỏ |
|---|---|---|
| Chưa mua (chỉ ở PR) | Cập nhật PR (tăng SL cần mua) | Giảm/bỏ khỏi PR |
| Đã có PO (đang mua) | PR bổ sung phần thiếu | Đề nghị giảm/huỷ PO (cảnh báo Thương mại) |
| Đã nhập kho (tồn) | Dùng tồn, mua phần thiếu | **Dư → trả về kho chung** (reusable) |
| Đã cấp phát/đang chế tạo | Mua bổ sung | Cấu kiện đã làm: đánh giá **rework/scrap** + mở NCR |
| Đã chế tạo xong (theo rev cũ) | — | **NCR**: built-to-superseded → quyết định (dùng tiếp/sửa/loại) |

### 4.5 Vật tư hàn / sơn / tiêu hao — tính lan truyền
- **Hàn**: thay đổi khối lượng mối hàn (theo weld map / khối lượng kết cấu) → tính lại que/dây hàn theo **định mức** (kg consumable / m mối hàn hoặc % khối lượng).
- **Sơn**: thay đổi **diện tích bề mặt** → tính lại sơn theo định mức (lít/m² × số lớp) + DFT.
- **Tiêu hao** (đá mài, khí, …): theo định mức tỉ lệ khối lượng/giờ công.
→ Khi BOM chính đổi, **tự tính lại** hàn/sơn/tiêu hao qua bảng **định mức (norm)** do KTKH quản lý.

### 4.6 Lan truyền & thông báo
- **Sinh PR điều chỉnh** (chỉ phần delta cần mua thêm) → Thương mại; **đánh dấu dư** cho Kho (nhập kho chung).
- **Cập nhật dự toán/ngân sách** theo Δ chi phí (KTKH/Tài chính).
- **Thông báo** các phòng liên quan (Telegram + in-app): Thương mại (mua thêm/huỷ), Kho (dư/thiếu), SX (rework), QC (NCR), PM/BGĐ (chi phí/tiến độ).
- **Change order**: nếu revise do **khách hàng**, ghi nhận thay đổi để **claim chi phí/tiến độ** với KH.

### 4.8 ⚠ TƯƠNG THÍCH VỚI HỆ ĐỘNG (KHÔNG phá luồng Task đang chạy)
- Phần lớn blueprint là **additive** (entity/module mới song song) → KHÔNG sửa lõi Task động (`createTask/completeTask/forward/reassign/status`), giao ban, hộp việc, quyền, file, báo giá NCC.
- **Cascade dùng task động**: PR điều chỉnh sinh ra qua `createTask` (ép có người nhận) — xài luồng có sẵn, không thay đổi nó.
- **BOM versioning là điểm GIAO THOA duy nhất**: hiện BOM/PR lưu JSON trong `resultData.bomPr` của MỘT task. Nguyên tắc để không tạo 2 nguồn sự thật:
  1. **BomVersion (entity) = nguồn sự thật chính** (cấp dự án/bản vẽ); **task = nơi người thao tác**, chỉ lưu `bomVersionId` (tham chiếu), không nhúng lại toàn bộ JSON.
  2. **Làm tiệm tiến**: giai đoạn đầu giữ JSON hiện tại + bọc lớp version qua adapter (đọc/ghi), KHÔNG big-bang. Luồng động (upload PR trong task → enrich → báo giá → PO → giao ban → forward) giữ nguyên 100%.
  3. **Test hồi quy** luồng PR→khớp tồn→báo giá→PO sau khi thêm version, đảm bảo không lệch.
- **Legacy 36 bước**: KHÔNG hồi sinh; tiếp tục gỡ dần; không tạo phụ thuộc mới vào legacy.

### 4.7 Yêu cầu UI (cho Claude Design)
- **Sổ revision** mỗi dự án/bản vẽ: danh sách rev, status, ngày, lý do, người duyệt, file.
- **Màn so sánh rev (Diff)**: bảng delta theo 5 nhóm vật tư + tổng Δ KL/chi phí; lọc theo nhóm.
- **Màn Impact**: mỗi dòng đổi + trạng thái + hành động đề xuất (mua thêm/huỷ/dư-trả-kho/rework/NCR) + nút thực thi (theo RBAC).
- Hiển thị **rev hiệu lực** rõ ràng ở mọi nơi dùng BOM/PR/PO/SX; cảnh báo khi đang xem rev cũ.

---

## 5. Chức năng theo role — CÓ / GAP (ưu tiên bổ sung cho thép nặng)

- **Thiết kế (R04)** — *Có*: BOM/PR. *Gap*: **revision register + diff/impact (Mục 4)**, **piece-mark/tonnage**, kiểm soát **transmittal** (phát hành/thu hồi bản vẽ).
- **KTKH (R03)** — *Có*: dự toán, ngân sách. *Gap*: **bảng định mức (norm)** cho hàn/sơn/tiêu hao, liên kết khối lượng↔định mức↔chi phí thực (earned value).
- **Thương mại (R07)** — *Có*: PR→báo giá→PO. *Gap*: theo dõi **committed vs thực nhận**, hợp đồng NCC + tiến độ giao, xử lý **PR điều chỉnh từ revision**.
- **Kho (R05/TCKT)** — *Có*: GRN/PO. *Gap*: **truy xuất Heat/Lot + mill cert**, **cấp phát theo Lệnh SX**, **dư-trả-kho-chung** từ revision.
- **Sản xuất (R06/R06b)** — *Gap LỚN*: **Lệnh sản xuất (work order) theo tổ**, **tiến độ chế tạo theo tấn/piece-mark (%)**, **weld map + lý lịch thợ hàn (WPS/PQR/WPQ)**, năng suất/định mức công.
- **QA/QC (R09)** — *Gap LỚN*: **ITP (hold/witness points)**, **NDT (UT/RT/MT/PT)**, **nghiệm thu sơn + đo DFT**, **NCR (raise→xử lý→đóng) + CAR**, **hồ sơ chất lượng/MDR** giao khách.
- **Giao hàng/QLDA (R02)** — *Gap*: **packing list + shipping mark + loading**, theo dõi vận chuyển/lắp đặt, nghiệm thu KH.
- **Tài chính (R08)** — *Có*: ngân sách/drawdown một phần. *Gap*: gắn committed cost + quyết toán theo dự án.
- **TBCG (R13)** — *Gap*: **quản lý máy/thiết bị + lịch bảo trì + sự cố + cấp phát thiết bị thi công** (gần như chưa có).
- **Xuyên suốt** — *Gap*: **HSE/An toàn** (sự cố, permit-to-work, toolbox), **NCR loop dùng chung**, **kiểm soát tài liệu/rev**.

---

## 6. Module / màn (UI surface) + status

- **Giữ & chuẩn hoá** (đang chạy): Công việc (Task động), Giao ban tuần, Hiệu suất & KPI, Lịch họp, Kho & Mua hàng (Tồn/PO/Báo giá→PO/GRN/Xuất/NCC), Tổng quan dự án, Báo cáo, Cài đặt.
- **Bổ sung** (theo Mục 5): Revision & BOM version (Thiết kế); Định mức (KTKH); Lệnh sản xuất + Tiến độ chế tạo + Weld map (SX); ITP/NDT/Coating-DFT/NCR/MDR (QC); Giao hàng/Logistics; Thiết bị & Bảo trì (TBCG); HSE.
- **Status chuẩn**: Task (OPEN→IN_PROGRESS→AWAITING_REVIEW→DONE; RETURNED/CANCELLED; cờ blocked/escalated). PO (Nháp→Chờ duyệt→Đã duyệt→Đã gửi→Thanh toán→Nhận 1 phần→Đã nhận→Hoàn thành). Revision (DRAFT→ISSUED→SUPERSEDED). NCR (Mở→Xử lý→Đóng).

---

## 7. Backend gap — entity/field cần thêm (cho VS Code)

- **Drawing / DrawingRevision / BomVersion / BomLine** (Mục 4.1) + **Norm** (định mức hàn/sơn/tiêu hao).
- **Material**: thêm **HeatLot** (heat/lot, mill cert, NCC, GRN nguồn, dự án dùng, còn lại).
- **WorkOrder** (lệnh SX): tổ, piece-mark, khối lượng, % tiến độ, theo rev.
- **WeldMap / WelderQualification** (WPS/PQR/WPQ); **NDTReport**; **CoatingInspection (DFT)**.
- **NCR** (non-conformance) + **CAR**; **ITP** (hold/witness points).
- **Shipment / PackingList**; **Equipment / Maintenance** (TBCG); **HSE incident / permit**.
- **ChangeOrder** (revise do KH → claim).
> Mỗi entity: thêm migration (`prisma migrate deploy`), RBAC theo role, API theo chuẩn `successResponse/errorResponse`.

---

## 8. Roadmap ưu tiên (đợt triển khai)

1. **Revision & Cascade vật tư** (Mục 4) — nền tảng, ảnh hưởng toàn bộ mua/sản xuất. **Làm trước.**
2. **Truy xuất Heat/Lot** (Kho) + **kiểm soát rev/transmittal** (Thiết kế).
3. **QC/Quality**: ITP + NDT + Coating/DFT + NCR + MDR (lõi chất lượng).
4. **Sản xuất**: Work order theo tổ + tiến độ theo tấn/piece-mark + weld map/welder qual.
5. **Định mức (KTKH)** + earned value (chi phí thực vs dự toán).
6. **TBCG** (bảo trì thiết bị) + **HSE** (an toàn) + **Logistics/giao hàng**.
> Mỗi đợt: backend (entity/flow) → UI (Design System) → gate → deploy → đối chiếu mockup.

---

## 9. Design System (cho Claude Design — 1 nguồn chuẩn)

- **Brand**: đỏ IBS + đen + trắng + xám; tối giản; **mono cho mã/số/tiền**.
- **Tokens**: bảng màu (+hex), spacing scale, typography, **bản đồ màu trạng thái** (Task/PO/Revision/NCR).
- **Component dùng chung**: Bảng dữ liệu · Badge trạng thái · KPI card · Thanh lọc/tìm · **Header chi tiết** · **Timeline lịch sử** · **Diff table** (so rev) · Modal/Form · Button (primary/secondary/nguy hiểm) · Empty state · Phân trang.
- **Pattern**: List → Chi tiết (header + lịch sử + truy vết) → Hành động theo RBAC. Dùng lại cho mọi thực thể.
- **Role-aware**: ẩn/hiện theo role; thao tác chặn ở server, ẩn ở UI. **Mobile**: ưu tiên màn công nhân tại xưởng (nhận việc/báo SX/đính kèm ảnh).

---

*Hết. Cập nhật tài liệu này khi chốt thêm quyết định; cả VS Code và Claude Design bám cùng một bản.*
