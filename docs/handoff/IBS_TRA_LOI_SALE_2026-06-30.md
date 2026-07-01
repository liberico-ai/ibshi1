# IBS — TRẢ LỜI SALE PLATFORM
**Phản hồi cho:** `SALE_TRA_LOI_IBS_2026-06-30.md` (Sale v4, cm `644f1b5`)
**Phía:** IBS-ERP (`ibshi1.lab.liberico.com.vn`)
**Ngày:** 30/06/2026

---

## 1. Tóm tắt

IBS đã đọc phản hồi của Sale. **Chốt:**
- Spec `IBS_INTEGRATION_REQUIREMENT.md` là **final** — IBS build cho khớp.
- Chấp nhận toàn bộ 6 trả lời §F + 2 architectural call + **2 simplification** của Sale (giảm việc cho cả hai — cảm ơn).
- Trả lời **điểm duy nhất Sale còn chờ: §F.2** — bên dưới.
- IBS cam kết endpoint + lộ trình build theo phase.

---

## 2. Trả lời §F.2 — Project code timing → **Option A**

**IBS confirm: cấp `projectCode` NGAY tại thời điểm approve.**

Lý do: mã dự án của IBS (dạng `26-WNC-I-109`) **do người duyệt gán/nhập**, KHÔNG lấy từ registry có độ trễ. IBS thiết kế bước duyệt §B.5 sao cho **người duyệt nhập `projectCode` như một phần của thao tác approve** → approve xong là có mã ngay.

→ **Chỉ dùng 1 webhook** `project.approved { externalRef, projectId, projectCode }`.
→ **KHÔNG cần** webhook thứ hai `project.code_allocated`. Sale khỏi build pattern chờ mã.

---

## 3. Xác nhận các trả lời khác của Sale

| Mục | Sale trả lời | IBS |
|-----|--------------|-----|
| §F.1 Webhook retry | Giữ ack 200 + dedup `X-IBS-Delivery` | ✅ Đồng ý. IBS không build `GET /webhook-events`. |
| §F.3 Attachments | base64 inline ≤50MB/file, ≤10 file | ✅ IBS đã hỗ trợ, giữ nguyên. |
| §F.4 Định danh khách AR | Dùng `sale_customers.id` (UUID) làm khóa; `tax_code` 0% coverage | ✅ IBS lưu thẳng UUID làm khóa khách; **dedup khách cũ theo `name + country`**. Không cần bảng map/MST. |
| §F.5 Bucket-3 status | PATCH mọi state (Option A) | ✅ Đồng ý. IBS nhận PATCH mọi lần đổi trạng thái. |
| §F.6 Signature | hex trần | ✅ IBS ký `X-IBS-Signature: <hex>` (implementation hiện tại). |

**Architectural call 1 (§B.5 luồng duyệt):** ✅ IBS xác nhận đây là feature mới phía IBS — sẽ build: bảng submission + màn reviewer approve/reject + **gán projectCode tại approve** + bắn `project.approved`/`project.rejected`. Sale auto-fire POST /projects khi opp WON — IBS chỉ nhận.

**Architectural call 2 (customer sync):** ✅ IBS **chấp nhận simplification** — chỉ **poll `GET /customers?modified_since=<ISO>&limit=100`** mỗi 15', dùng `next_cursor`. IBS **không dựng webhook receiver** cho customer, không cần secret/direction mới. Cảm ơn Sale đã đơn giản hóa.

---

## 4. Auth & khóa (IBS phụ trách)

- **SALE_API_KEY** (Sale→IBS): IBS cấp qua `ApiClient` với scope `read:projects/assignees/departments/contracts/ar/tasks` + `write:tasks/projects`. Chia sẻ cho Sale **qua kênh an toàn** (không email/repo).
- **IBS_WEBHOOK_SECRET** (ký webhook IBS→Sale): IBS sinh + chia sẻ an toàn. Ký HMAC-SHA256 hex.
- **SALE_INBOUND_API_KEY** (IBS→Sale gọi §G): IBS nhận từ Sale qua kênh an toàn, lưu env.

---

## 5. Lộ trình build IBS (theo phase)

| Phase | Nội dung | Ghi chú |
|-------|----------|---------|
| **1** | Confirm v1 (projects/assignees/tasks/webhook) đúng shape `{ok,data}` + cấp SALE_API_KEY + IBS_WEBHOOK_SECRET + nhận SALE_INBOUND_API_KEY | đang làm |
| **2** | 6 endpoint §B: `GET /departments` → `GET /customers/{id}/ar-summary` → `POST /projects` + `GET /projects/{externalRef}` (kèm luồng duyệt) → `GET /contracts/{id}` → `PATCH /tasks/{id}/status` | build chính |
| **3** | 5 webhook §A: `task.created`, `capacity.changed`, `contract.updated`, `departments.changed`, `project.approved`/`rejected` (tận dụng `webhook.ts` có sẵn, HMAC + `X-IBS-*`, path `/webhooks/ibs/<event>`) | project.approved kèm projectCode |
| **4** | Client poll §G `GET /customers?modified_since=` (Sale đã đơn giản hóa) + lưu mirror + JOIN AR | |

IBS sẽ build tuần tự, deploy lên `ibshi1.lab` từng phase.

---

## 6. IBS cần Sale

- Deploy §B.5 auto-on-WON + webhook handler `project.approved`/`rejected` (Sale đã cam kết ~3h).
- Thêm `modified_since` filter + index `updated_at` cho `GET /customers` (Sale ~30 phút).
- Gửi **SALE_INBOUND_API_KEY** qua kênh an toàn.
- Xác nhận base URL webhook Sale nhận: `https://sale-platform-v4.lab.liberico.com.vn/webhooks/ibs/<event>`.

---

## 7. Điểm mở còn lại

**Không còn.** Mọi câu hỏi §F đã chốt (§F.2 = Option A ở trên). Hai bên build song song theo spec final + các quyết định trong tài liệu này.

*IBS-ERP · 30/06/2026*
