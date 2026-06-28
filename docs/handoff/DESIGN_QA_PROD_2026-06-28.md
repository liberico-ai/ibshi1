# DESIGN-QA — Production thật vs Design System v3 / Mockup
**Ngày:** 2026-06-28 · **Người soi:** rà trực tiếp trên `https://ibshi1.lab.liberico.com.vn` · **Tài khoản:** Giang (R02/PM) + Phạm Đăng Toàn (R06/Quản lý Sản xuất)
**Mục đích:** Claude Design đối chiếu mô tả prod dưới đây với mockup `.dc.html` của mình → xác nhận khớp / liệt kê fix. Prod phần lớn 0 data nên nhiều màn ở trạng thái empty.

---

## A. KHỚP TỐT — không cần sửa
- **KPI card viền màu trên** (top-border xanh/đỏ/vàng/lục) nhất quán khắp: dashboard, overview, briefing, performance, production, weld-map, job-cards, hse, equipment. Đúng Design System.
- **Sidebar**: nhóm menu theo role, item active nền đỏ + thanh trái, badge số. Gọn, đúng.
- **Login**: redesign trọn vẹn (brand đỏ IBS, thẻ kính, tiêu đề "Quản lý Chuỗi sản xuất thông minh").
- **Bảng dữ liệu** (performance "Hiệu suất theo phòng ban", các bảng module): header rõ, badge điểm màu (100 lục / 73 vàng / 27 đỏ).
- **Thẻ dự án** (overview) + progress bar; **header chi tiết task động** (thẻ kính + badge mã/người tạo/deadline + chọn biểu mẫu) — sạch.
- **Nút primary "Tạo …"** trong module (Tạo WO, Thêm TB, Thêm mối hàn) đúng **đỏ IBS**.

## B. CẦN SỬA — ưu tiên CAO
1. **RBAC: PM (R02) bị chặn Sản xuất + QC** ("Không có quyền truy cập"). Blueprint định R02 *được xem* tiến độ SX/QC dự án mình. → Thêm R02 (quyền VIEW) vào `production` + `qc` trong PAGE_ACCESS + API guard. *(Đây là lỗi quyền, không phải giao diện — giao VS Code.)*
2. **Tab/chip filter đang active hiển thị như khối tô đậm thô** (đen/navy đặc, ôm sát chữ) — thấy ở: Công việc ("Được giao cho tôi"), Giao ban ("Dashboard giao ban"), Production/Weld/Job-cards/Equipment ("Tất cả"). Không giống chip bo tròn nhẹ của Design System. → Claude Design xác nhận style active-chip đúng phải thế nào, VS Code sửa cho đồng nhất.

## C. CẦN SỬA — ưu tiên TRUNG BÌNH
3. **Màn Công việc**: nút **"Tìm" là chữ trơn** (không phải Button component); ô tìm kiếm chỉ gạch chân, không phải `input-field` bo viền. → thay bằng component chuẩn.
4. **Giao ban tuần**: khoảng trắng thừa lớn giữa "Thao tác ký ···" và hàng tab; nút "Thao tác ký" lửng lơ bên phải, phân cấp chưa rõ. → gom lại, đặt đúng vùng action của PageHeader.
5. **Emoji lẫn trong UI** thay vì icon hệ thống: 👋 (dashboard), ✅/📋 (giao ban), 🔥 (weld-map empty), ✂/🔥/🎨 (filter Phiếu công việc), notepad/wrench (empty job-cards/equipment), ∞ (HSE ngày không tai nạn), 🦺 (HSE). → đổi sang icon bộ DS cho nhất quán & chuyên nghiệp.
6. **Màu nút chưa nhất quán ở daily surface (PM)**: badge/nút "Đang xử lý", "Tìm", "Về trang chính" dùng **xanh info** trong khi brand primary là **đỏ IBS**. → soi lại thang màu: primary=đỏ, info=xanh, status theo design-tokens.

## D. CẦN SỬA — ưu tiên THẤP
7. **KPI hiện 0 xấu khi thiếu data**: "Giá trị HĐ 0 tỷ" (overview) — cân nhắc hiển thị "—" khi chưa có. Tương tự nhiều KPI module đang 0 vì prod chưa có data (không phải lỗi).
8. **Empty state** đã có (tốt) nhưng minh hoạ bằng emoji — nâng lên icon/illustration theo DS.
9. Danh sách task (Công việc) hơi **thưa, nhiều khoảng trắng** — cân nhắc mật độ dòng.

## E2. QC (đã QA — role R09 Trần Quang Hải)
- **MRB (Hồ sơ chất lượng) MẤT DẤU TIẾNG VIỆT** ở tiêu đề + phụ đề: "Ho so QC -- MRB", "Tong hop ho so chat luong theo du an" — trong khi mọi màn khác có dấu. → sửa chuỗi tiếng Việt + dùng dấu "—" thay "--". [TB]
- **QC dashboard phụ đề "Enhanced Inspection Form v2"** = nhãn dev, đổi sang tiếng Việt thân thiện. [Thấp-TB]
- **NCR filter trùng nhãn**: có cả "Đang XL" và "Đang xử lý" trong hàng trạng thái → rà gộp. [TB]
- **MRB chọn dự án** dùng `<select>` trơn, chưa phải SelectField bo viền của DS. [Thấp]
- ✓ Ô tìm kiếm QC dashboard ĐÃ dùng input bo tròn đúng → khẳng định #3 (màn Công việc lệch, cần đồng bộ theo mẫu này).
- ✓ KPI card + nút "Tạo biên bản/Tạo NCR/Tạo ITP" đỏ IBS đúng DS. Chip active vẫn lỗi #2 (khối tô đậm).

## E3. Logistics + Thiết kế/BOM/ECO + Mua hàng (đã QA — R01 Ban Giám đốc)
- **Tiêu đề/H1 lẫn TIẾNG ANH kiểu dev** (mẫu lặp nhiều màn) — cần Việt hóa nhất quán:
  BOM "Bill of Materials", ECO "ECO Tracker" + "Engineering Change Orders", QC "Enhanced Inspection Form v2",
  NCR "Non-Conformance Report management", ITP "Inspection & Test Plan management", MDR "Manufacturer Document Record". [TB]
- **Màu nút primary lệch**: `design/drawings` nút "Thêm bản vẽ" **đen/navy**; **modal "Thêm bản vẽ" nút "Lưu" cũng đen/navy** (soi với R04 Thiết kế); còn BOM/ECO/QC/Logistics nút "Tạo…" **đỏ IBS**. → chuẩn hóa primary = đỏ ở cả nút trang LẪN nút modal. [TB]
- ✓ Modal form "Thêm bản vẽ" (R04): bố cục 2 cột, input/select chuẩn, gọn — đúng DS (trừ màu nút Lưu).
- ✓ `warehouse/procurement` "Tổng giá trị" hiển thị **"—"** khi trống — ĐÚNG mẫu; áp lại cho overview "0 tỷ" (mục D7).
- ✓ Logistics (Packing/Chuyến hàng/MDR), BOM, ECO: KPI card + filter chip + empty-state + nút đỏ — bố cục đúng DS; chip active vẫn lỗi #2; empty-state vẫn emoji (📦🚚) lỗi #5.

## E4. Mua hàng/PO/GRN/Giao hàng (đã QA — R07 Thương mại, có DATA thật)
- **PO: trạng thái RAW ENUM chưa Việt hóa** — "PROCESSING_PAYMENT" hiện nguyên enum cạnh "Đã thanh toán". → map đủ nhãn trạng thái sang tiếng Việt. [TB]
- **PO giá trị "—" toàn bộ** (tổng + từng dòng): data PO thiếu số tiền — lỗi DỮ LIỆU, không phải design. (Cần VS Code kiểm nguồn giá trị PO.)
- ✓ **GRN** hiện Heat No/Lot No (truy xuất nguồn) đúng — tốt. Mã provisional "MAT-AUTO-…2219" dài/xấu lộ ra UI (hệ provisional đã biết — cân nhắc rút gọn hiển thị). [Thấp]
- **Giao hàng**: nút Packing List/Shipments/MDR ở góc TRÙNG menu sidebar nhóm Giao hàng → cân nhắc bỏ. [Thấp]

## E. CHƯA QA ĐƯỢC
- **Mobile (12 màn)**: chưa kiểm trên thiết bị thật (cần mở trên điện thoại / chế độ responsive).
- Một số trang con (GRN, PO chi tiết, certificates/mill-cert, workshops) chưa mở từng cái — nhưng cùng bộ component nên nhiều khả năng giống mẫu đã soi.

---
### Phân công fix
- **VS Code**: #1 (RBAC R02), #3 (component nút/ô tìm), #2 (style chip — sau khi Claude Design chốt).
- **Claude Design**: chốt chuẩn cho #2 (active-chip), #5 (bộ icon thay emoji), #8 (empty-state), #6 (thang màu nút) → trả spec, VS Code áp.
