# SPEC TỔNG THỂ — Dòng chảy dữ liệu · Đo đếm khối lượng · Quản lý Thay đổi (Cascade)
**Ngày:** 2026-06-29 · **Dự án mẫu:** 26-WNC-I-109 (Dominion) · **Cho:** BLĐ (góc nhìn quản lý) + VS Code (build) + Claude Design (UI).
Hiện thực hóa **Mục 4 blueprint**, đóng lỗ hổng cascade + tiến độ tấn trong `AUDIT_TONG_THE_2026-06-29.md`.

> **Một câu cho BLĐ:** Hệ thống phải luôn trả lời được — *dự án này, KẾ HOẠCH (dự toán gốc) bao nhiêu, KỸ THUẬT hiện hành (sau revise) bao nhiêu, ĐÃ LÀM thực tế bao nhiêu, ĐÃ CHI bao nhiêu — lệch nhau ở đâu, do revise nào, ai chịu.*

---

## 1. GÓC NHÌN TỔNG THỂ — 3 đường đối chiếu

Mọi con số của dự án luôn đặt trên **3 đường song song**, đối chiếu liên tục:

| Đường | Nguồn | Bản chất | Trạng thái |
|---|---|---|---|
| **① KẾ HOẠCH (Baseline)** | Dự toán Rev.0 — KTKH lập, BGĐ duyệt | Khối lượng ước tính + chi phí + KQKD dự kiến | **ĐÔNG CỨNG** |
| **② HIỆN HÀNH (Kỹ thuật)** | BomVersion ACTIVE (sau bóc shop drawing + các revise) | Khối lượng/vật tư THẬT theo cấu kiện | **SỐNG** (đổi theo revise) |
| **③ THỰC HIỆN (Sản xuất + Tài chính)** | Khối lượng hoàn thành (QC đạt) + thực chi (PO/kho/nhân công) | Cái đã làm & đã tiêu | **TÍCH LŨY** |

Chênh lệch giữa 3 đường = bức tranh quản lý: **②−① = biến động kỹ thuật** (revise/đổi thiết kế), **③ vs ②** = tiến độ & hiệu quả thực thi, **③ chi vs ① ngân sách** = lãi/lỗ.

---

## 2. DÒNG CHẢY DỮ LIỆU XUYÊN SUỐT (từ dự toán → đo đếm hoàn thành)

```
HĐ ─► [KTKH] Dự toán Rev.0  ══► ĐÔNG CỨNG (Baseline ①)
            │ (khối lượng ước tính theo hệ số, đ/kg)
            ▼
[Kỹ thuật] Bóc shop drawing ─► BOM vật tư CHÍNH (BomVersion v1, theo piece-mark)  ──► đối chiếu lần 1 vs Baseline
            │
   ┌────────┼─────────────────────────────┐
   ▼        ▼                              ▼
[PM] Hàn/Sơn   [Kho] Tiêu hao/Phụ      (hoàn thiện BomVersion = Hiện hành ②)
   theo định mức   theo tồn kho min
            │
            ▼
[Thương mại] PR theo lớp ─► Báo giá ─► PO ─► GRN ─► Kho   (thực chi vật tư → ③)
            │
            ▼
[Sản xuất] WorkOrder theo piece-mark/tổ (gắn bomVersionId)
            │  ┌─ JobCard từng công đoạn: Cắt→Tổ hợp→Hàn→Sơn  (ghi actualQty kg + giờ công)
            ▼  ▼
[QC] Nghiệm thu piece-mark ─► ĐẠT = "khối lượng hoàn thành thực tế" (③)
            │
            ▼
[Logistics] Đóng kiện (chỉ piece-mark QC đạt) ─► Giao ─► MDR
```

Mỗi mốc đều **ghi nhận về 3 đường** ở §1, nên BLĐ xem bất kỳ lúc nào cũng thấy kế hoạch ↔ hiện hành ↔ thực hiện.

---

## 3. ĐO ĐẾM KHỐI LƯỢNG HOÀN THÀNH THỰC TẾ (định nghĩa rõ — hiện đang = 0, phải build)

Audit cho thấy `WorkOrder.completedQty` **chưa bao giờ được ghi** → tiến độ tấn = 0. Định nghĩa lại cho chuẩn:

**Hai thước đo song song** (như dự toán: đ/kg + DT06 theo piece-mark):
- **TẤN** (khối lượng) — trọng số chính, lấy từ KL piece-mark trong BOM chính.
- **SỐ PIECE-MARK** — đếm cấu kiện hoàn thành (vd 12/24 mark).

**Nguồn ghi:** mỗi **JobCard** (theo công đoạn của một piece-mark/lô) ghi `actualQty` (kg) + giờ công + trạng thái công đoạn. JobCard → roll-up lên `WorkOrder.completedQty`.

**Cách tính % tiến độ** (theo trọng số công đoạn — gợi ý, chốt với SX):

| Công đoạn | Trọng số |
|---|---|
| Cắt (PC) | 10% |
| Tổ hợp/Gia công (GC) | 20% |
| Hàn (CT) | 35% |
| Sơn/Làm sạch (LSS) | 20% |
| Nghiệm thu (QC) | 15% |

→ % piece-mark = Σ trọng số công đoạn đã qua. % dự án = Σ(KL piece-mark × % của nó) / Σ KL.

**Quy tắc "hoàn thành thực tế" (earned):** một piece-mark chỉ tính **HOÀN THÀNH** khi **QC nghiệm thu ĐẠT** — không phải khi báo xong công đoạn. Tấn-đã-nghiệm-thu = tấn earned thực sự.

**Đối chiếu:** Tấn earned (③) vs Tấn BOM hiện hành (②) = tiến độ; vs Tấn dự toán (①) = lệch so kế hoạch. Giờ công thực (JobCard) vs giờ công dự toán (DT06) = hiệu quả nhân công.

---

## 4. MỌI TRƯỜNG HỢP REVISE (phủ hết để BLĐ kiểm soát)

Mọi thay đổi đều quy về **một ECO** (đánh số, duyệt, lưu vết), phân theo **nguồn** + **ai chịu chi phí**:

| # | Trường hợp | Nguồn | Đối tượng đổi | Chi phí do |
|---|---|---|---|---|
| 1 | Kỹ thuật hoàn thiện/sửa lỗi bản vẽ | DESIGN | BOM chính → hàn/sơn | Nội bộ |
| 2 | Khách hàng đổi yêu cầu (change order) | CUSTOMER | BOM + dự toán + tiến độ | Khách trả (claim) |
| 3 | Shop drawing chi tiết khác dự toán ước tính | ENGINEERING | BOM vs Baseline (lần đối chiếu đầu) | Nội bộ (chênh ước tính) |
| 4 | Sản xuất làm sai → NCR → làm lại/bù VT | PRODUCTION_NCR | BOM bổ sung + nhân công + tiến độ | Nội bộ (lỗi SX) |
| 5 | Thay thế vật tư (hết mã đúng, đổi mác/quy cách) | SUBSTITUTION | BOM chính + định mức hàn/sơn | Nội bộ/đàm phán |
| 6 | Phát hiện sai số bóc tách sau | CORRECTION | BOM (số lượng) | Nội bộ |
| 7 | Đổi khi lắp dựng tại site | SITE | BOM + as-built + tiến độ | Tùy nguyên nhân |

→ Mỗi ECO ghi: **nguồn, lý do, ai chịu chi phí, delta khối lượng/chi phí, ảnh hưởng tiến độ**. BLĐ xem danh sách ECO của dự án = thấy toàn bộ lịch sử thay đổi và tác động.

---

## 5. GỐC CASCADE & PHÂN LỚP VẬT TƯ (kết luận đã chốt)

**Gốc cascade = bản vẽ → BOM vật tư CHÍNH.** Dự toán Rev.0 KHÔNG phải gốc cascade — nó là baseline đông cứng để đối chiếu.

`BomVersion` gồm **3 lớp**, mỗi lớp một chủ + một cách suy ra + hành xử khác khi revise:

| Lớp | Loại | Ai lập | Suy ra từ | Khi revise |
|---|---|---|---|---|
| **Cứng** | Vật tư chính | Kỹ thuật (bóc bản vẽ) | Bản vẽ | **GỐC** — kích hoạt cascade |
| **Định mức** | Hàn / Sơn / **Tiêu hao** | PM duyệt (hàn/sơn) · định mức KTKH | Định mức × KL chính / diện tích | Máy tính lại → PM duyệt |
| **Tồn kho** | Phụ kiện / Đóng kiện / Biện pháp | Kho | Mức tồn tối thiểu | Cảnh báo Kho nếu tổng KL đổi nhiều |

> **Lưu ý tiêu hao:** que hàn/khí/đá mài có định mức rõ theo tấn nên thuộc **lớp Định mức** (tính lại khi vật tư chính đổi — đúng cascade). Việc Kho bổ theo tồn tối thiểu là cơ chế MUA/bổ kho riêng, không phải lớp. Chỉ **phụ kiện/đóng kiện/biện pháp** mới thuần lớp Tồn kho.

---

## 6. CASCADE — hình quạt có thứ tự, lan đúng vai

Khi **ECO APPROVED** → BomVersion mới ACTIVE → Diff → Impact → **sinh task điều chỉnh qua Task động** (có người nhận + hạn + lịch sử, không ghi đè mù):

```
ECO duyệt ─► BomVersion mới
   ├─ Vật tư chính đổi ........► Kỹ thuật (R04) bóc lại (nguồn)
   ├─ (Định mức) Hàn/Sơn/Tiêu hao ► PM (R02) duyệt; Kho bổ kho theo tồn min
   ├─ (Ngưỡng KL) Phụ kiện/Đóng kiện ► Kho (R05) rà mức min
   ├─ PR/PO theo trạng thái mua► Thương mại (R07)
   ├─ Tính lại chi phí .........► KTKH (R03) → đối chiếu Baseline
   └─ piece-mark đổi ...........► PM (R02) phân giao lại (WBS) + tiến độ
```

**Quy tắc lan theo trạng thái mua** (không phá đơn đã đặt):

| Vật tư đang ở | Hành động khi BOM đổi |
|---|---|
| Chưa mua | Sửa thẳng PR |
| Đã PR | Cập nhật PR, báo phụ trách |
| Đã PO | KHÔNG tự đổi — cảnh báo TM đàm phán NCC |
| Đã nhập kho | Đánh dấu dư → trả/điều chuyển, giữ lịch sử |

---

## 7. ĐỐI CHIẾU & BẢNG ĐIỀU KHIỂN BLĐ (variance)

Mỗi dự án có **một bảng điều khiển** hiển thị 3 đường + biến động:

- **Khối lượng:** Dự toán (tấn) | BOM hiện hành (tấn) | Đã nghiệm thu (tấn) | % tiến độ.
- **Chi phí:** Ngân sách gốc | Dự toán hiện hành (sau revise) | Cam kết (PO) | Thực chi | Dự báo lãi/lỗ.
- **Thay đổi:** số ECO, phân theo nguồn (thiết kế/khách/SX sai…), tổng delta chi phí, ai chịu.
- **Theo công đoạn/tổ:** tấn qua từng công đoạn, tải mỗi tổ.

→ Đây là "góc nhìn quản lý tổng thể": một dự án nhìn là biết **kế hoạch vs hiện hành vs thực hiện**, lệch ở đâu, do đâu.

---

## 8. MẮT XÍCH DỮ LIỆU & ÁNH XẠ DỰ TOÁN

**Khóa liên kết chung** (lấy từ chính file dự toán): nhóm vật tư `VTC/VTS/VTH/VPK/VDK/VBP/VTP`, công đoạn `PC/GC/CT/LSS/BO/ĐK/GH`, `pieceMark/Item` (1617, MLI 1634…), `bomVersionId`.

- `BomItem` thêm `layer` (HARD/NORM/STOCK), `category`, `pieceMark`, `sourceRevisionId`.
- **PR line** ↔ `bomItemId` + `bomVersionId` (chuẩn hóa từ JSON).
- **Dòng dự toán "sống"** ↔ `bomVersionId`; **Baseline (Rev.0)** tách riêng đông cứng.
- **WBS / khối lượng** ↔ `drawingRevisionId` + `pieceMark`; **JobCard** ↔ `pieceMark` + công đoạn → roll-up `WorkOrder.completedQty`.
- **Bảng định mức (Norm)** = dữ liệu chuẩn riêng (thay hệ số hardcode), KTKH/PM sở hữu.

**Ánh xạ 7 bảng dự toán:**

| Bảng | Map tới |
|---|---|
| DT01 (TTC) | Project header + Baseline P&L |
| DT02 (TH) | Baseline cost summary theo category |
| DT03/DT04 (VT) | BomItem (cứng=VTC; norm=VTH/VTS) + đơn giá baseline |
| DT05 (DV) | Cost dịch vụ (NDT/mạ/vận tải) |
| DT06 (NC) | WBS + chi phí nhân công **theo piece-mark + công đoạn** → khung đo tiến độ |
| DT07 (CPC) | Overhead baseline |

---

## 9. HIỆN TRẠNG vs PHẢI BUILD (tiệm tiến)

**Đã có:** DrawingRevision, ECO, BomVersion (ACTIVE/SUPERSEDED), Diff/Impact engine, computeNormLines (hệ số hardcode), WorkOrder/JobCard/WeldJoint, cờ BOM_REVISION_CASCADE (OFF).

**Phải build, thứ tự:**
1. **Đo đếm hoàn thành**: ghi `WorkOrder.completedQty` + roll-up từ JobCard.actualQty; route cập nhật/duyệt JobCard; % theo trọng số công đoạn; "earned" chốt theo QC đạt. *(đóng P0 audit)*
2. **Bảng Norm thật** (thay hardcode) + `layer` cho BomItem.
3. **Chuẩn hóa mắt xích**: PR↔bomItemId; dự toán↔bomVersionId; tách Baseline Rev.0 đông cứng.
4. **Wire cascade → Task động** (revision-flow.ts đang dead code): ECO APPROVED → diff → impact → sinh task theo vai §6, theo trạng thái mua.
5. **NCR → ECO** + đủ 7 nguồn revise §4 (gắn "ai chịu chi phí").
6. **Bảng điều khiển BLĐ** §7 (3 đường + biến động + ECO log).
7. Bật cờ cascade sau khi **test hồi quy PR→báo giá→PO** xanh.

Ràng buộc: BomVersion = nguồn sự thật; task tham chiếu bomVersionId; baseline đông cứng; KHÔNG hồi sinh legacy; local→verify→deploy theo gotcha migration (prod luôn `resolve`, không reset).

---

*Chốt: 3 đường KẾ HOẠCH (dự toán gốc đông cứng) — HIỆN HÀNH (BomVersion sống) — THỰC HIỆN (tấn nghiệm thu + thực chi); gốc cascade = bản vẽ→vật tư chính, hàn/sơn theo định mức+PM, tiêu hao/phụ theo tồn kho+Kho; mọi revise (7 nguồn) qua ECO ghi ai-chịu-chi-phí; đo hoàn thành theo tấn+piece-mark earned-by-QC; tất cả nối bằng mã nhóm+piece-mark+bomVersionId+bảng định mức và hiện trên 1 bảng điều khiển BLĐ.*
