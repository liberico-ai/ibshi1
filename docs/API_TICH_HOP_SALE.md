# Tài liệu tích hợp API — IBS ERP ↔ Hệ thống Sale

**Phiên bản:** v1 · **Cập nhật:** 2026-06-23
**Đối tượng:** Lập trình viên hệ thống Sale tích hợp với IBS ERP.

Tài liệu mô tả bộ API để hệ Sale có thể: (1) tra cứu thông tin dự án/người nhận, (2) giao việc sang IBS ERP, (3) nhận cập nhật trạng thái sau khi giao (qua webhook hoặc polling).

---

## 1. Thông tin chung

| Mục | Giá trị |
|---|---|
| Base URL (production) | `https://ibshi1.lab.liberico.com.vn/api/external/v1` |
| Định dạng | JSON (UTF-8) |
| Múi giờ | Mọi mốc thời gian trả về dạng **ISO 8601 UTC** (vd `2026-06-22T01:00:00.000Z`) |
| Xác thực | API key (Bearer) — xem mục 2 |
| Giới hạn tần suất | 600 request / 5 phút / mỗi key (vượt → HTTP 429) |

### Cấu trúc response chung

Thành công:
```json
{ "ok": true, "data": { ... } }
```
Lỗi:
```json
{ "ok": false, "error": "Thông báo lỗi", "code": "ERR_CODE" }
```

### Mã HTTP
| Mã | Ý nghĩa |
|---|---|
| 200 | OK |
| 201 | Tạo mới thành công |
| 400 | Dữ liệu gửi sai/thiếu |
| 401 | Thiếu/sai API key |
| 403 | Key không đủ quyền (scope) |
| 404 | Không tìm thấy |
| 409 | Trùng `externalRef` (idempotency) |
| 429 | Vượt giới hạn tần suất |
| 500 | Lỗi hệ thống |

---

## 2. Xác thực (Authentication)

IBS ERP cấp cho hệ Sale một **API key** (chuỗi bí mật, dạng `ibsk_live_xxxxxxxx`) và một **webhook secret** (dùng để xác thực webhook — mục 5).

Mọi request gắn header:
```
Authorization: Bearer ibsk_live_xxxxxxxx
Content-Type: application/json
```

Lưu ý bảo mật:
- API key chỉ lưu ở phía server hệ Sale, **không** đưa lên client/trình duyệt.
- Key có **scope** giới hạn (vd `read:projects`, `read:tasks`, `write:tasks`). Gọi endpoint ngoài scope → 403.
- Khi nghi lộ key, báo IBS để thu hồi & cấp lại.

---

## 3. Tra cứu thông tin (Check)

### 3.1 Danh sách dự án — `GET /projects`

Tham số query (tùy chọn): `status` (`active` mặc định), `q` (tìm theo mã/tên), `page` (mặc định 1), `pageSize` (mặc định 50, tối đa 200).

```
GET /api/external/v1/projects?status=active&q=WNC
```
Response:
```json
{
  "ok": true,
  "data": [
    { "id": "clx...", "projectCode": "26-WNC-I-109", "projectName": "WENDT NOISE CONTROL", "status": "ACTIVE" }
  ],
  "page": 1, "pageSize": 50, "total": 7
}
```

### 3.2 Người/phòng có thể giao việc — `GET /assignees`

Tham số: `q` (tìm theo tên), `projectCode` (tùy chọn).

```
GET /api/external/v1/assignees?q=hung
```
Response:
```json
{
  "ok": true,
  "data": {
    "users": [
      { "userId": "clu...", "fullName": "Đặng Quang Hưng", "roleCode": "R02", "deptName": "Quản lý dự án", "email": "hung@ibs.vn" }
    ],
    "roles": [
      { "roleCode": "R02", "name": "Quản lý dự án" },
      { "roleCode": "R06", "name": "Quản lý sản xuất" }
    ]
  }
}
```
> Dùng `userId` (giao đích danh) hoặc `roleCode` (giao theo phòng) khi tạo task ở mục 4. Có thể giao bằng `email` — ERP tự map sang user.

### 3.3 Trạng thái 1 task — `GET /tasks/{id}`

`{id}` chấp nhận **taskId của ERP** hoặc **externalRef của Sale**.

```
GET /api/external/v1/tasks/SALE-2026-0001
```
Response: xem cấu trúc Task ở mục 6.

---

## 4. Giao việc sang ERP — `POST /tasks`

Tạo một công việc trong ERP từ hệ Sale.

Body:
```json
{
  "externalRef": "SALE-2026-0001",
  "projectCode": "26-WNC-I-109",
  "title": "Khảo sát yêu cầu khách hàng X",
  "description": "Chi tiết yêu cầu...",
  "assignee": { "userId": "clu..." },
  "deadline": "2026-07-01",
  "priority": "HIGH",
  "attachments": [
    {
      "fileName": "Yeu_cau_KH.pdf",
      "contentBase64": "JVBERi0xLjQK..."
    }
  ]
}
```

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `externalRef` | ✓ | ID của task bên Sale. **Duy nhất** — dùng để chống tạo trùng & đối chiếu. |
| `projectCode` | ✓ | Mã dự án (lấy từ mục 3.1). |
| `title` | ✓ | Tiêu đề công việc. |
| `description` | – | Mô tả. |
| `assignee` | ✓ | Một trong: `{userId}` / `{role}` / `{email}`. |
| `deadline` | – | Hạn, ISO date (`YYYY-MM-DD`). |
| `priority` | – | `NORMAL` (mặc định) / `HIGH` / `URGENT`. |
| `attachments` | – | Mảng file đính kèm (xem bảng dưới). |

#### File đính kèm (`attachments[]`)

Mỗi phần tử trong mảng `attachments`:

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `fileName` | ✓ | Tên file gốc (vd `"BanVe_v2.pdf"`). |
| `mimeType` | – | MIME type (tùy chọn — ERP tự suy từ đuôi file). |
| `contentBase64` | ✓ | Nội dung file mã hóa Base64. |

**Giới hạn:**
- Tối đa **10 file** / request.
- Mỗi file ≤ **20 MB** (sau giải mã base64).
- Tổng tất cả file ≤ **50 MB**.
- Đuôi file cho phép: `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.csv`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.dwg`, `.dxf`, `.zip`, `.rar`, `.7z`.
- File đính kèm sẽ hiển thị trong task dưới dạng **"Tài liệu phải đọc" (MUST_READ)** — người nhận việc bắt buộc xem trước khi hoàn thành.

**Lỗi file → 400:** Nếu bất kỳ file nào sai đuôi, quá cỡ, hoặc base64 không hợp lệ → ERP trả 400 và **không tạo task** (validate trước, không tạo nửa vời).

Response 201:
```json
{ "ok": true, "data": { "taskId": "clt...", "externalRef": "SALE-2026-0001", "status": "OPEN", "createdAt": "2026-06-22T01:00:00.000Z" } }
```

**Idempotency:** Nếu gửi lại cùng `externalRef`, ERP **không tạo trùng** mà trả task đã có (HTTP 200) — an toàn khi retry. File đính kèm **không** được tạo lại khi retry.

---

## 5. Nhận cập nhật sau khi giao (Updates)

Có 2 cách, dùng được đồng thời.

### 5.1 Webhook (push — khuyến nghị)

IBS đăng ký sẵn một `callbackUrl` của hệ Sale. Mỗi khi task đổi trạng thái, ERP gửi `POST` tới URL đó.

Header:
```
X-IBS-Event: task.updated
X-IBS-Delivery: <uuid>
X-IBS-Signature: <hex HMAC-SHA256 của raw body, khóa = webhook secret>
Content-Type: application/json
```
Body:
```json
{
  "event": "task.updated",
  "externalRef": "SALE-2026-0001",
  "taskId": "clt...",
  "status": "IN_PROGRESS",
  "previousStatus": "OPEN",
  "blocked": false,
  "assignees": [{ "userId": "clu...", "fullName": "Đặng Quang Hưng", "roleCode": "R02" }],
  "deadline": "2026-07-01",
  "decision": "",
  "updatedAt": "2026-06-22T02:30:00.000Z"
}
```

**Xác thực chữ ký (bắt buộc):** Sale tính HMAC-SHA256 trên **raw body** bằng `webhook secret`, so với header `X-IBS-Signature`. Khớp mới xử lý.

Ví dụ (Node.js):
```js
import crypto from 'crypto'
function verify(rawBody, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

Yêu cầu phía Sale:
- Trả HTTP **2xx** trong vài giây để báo nhận thành công.
- ERP **retry** khi nhận lỗi/không phản hồi (3 lần, giãn cách 1s → 5s → 30s). Nên xử lý **idempotent** theo `X-IBS-Delivery`.

Sự kiện: hiện có `task.updated` (mọi thay đổi trạng thái: OPEN→IN_PROGRESS→AWAITING_REVIEW→DONE, RETURNED, CANCELLED, đổi cờ tắc/quyết định).

### 5.2 Polling (kéo — dự phòng)

`GET /tasks?updatedSince=<ISO>` trả các task thay đổi từ mốc thời gian.

```
GET /api/external/v1/tasks?updatedSince=2026-06-22T00:00:00.000Z&page=1
```
Response:
```json
{ "ok": true, "data": [ { /* Task, mục 6 */ } ], "page": 1, "pageSize": 50, "total": 3 }
```
> Gợi ý: lưu mốc `updatedSince` của lần gọi trước; gọi định kỳ (vd mỗi 5–15 phút).

---

## 6. Cấu trúc Task (response)

```json
{
  "taskId": "clt...",
  "externalRef": "SALE-2026-0001",
  "projectCode": "26-WNC-I-109",
  "projectName": "WENDT NOISE CONTROL",
  "title": "Khảo sát yêu cầu khách hàng X",
  "status": "IN_PROGRESS",
  "blocked": false,
  "priority": "HIGH",
  "assignees": [{ "userId": "clu...", "fullName": "Đặng Quang Hưng", "roleCode": "R02" }],
  "deadline": "2026-07-01",
  "decision": "",
  "createdAt": "2026-06-22T01:00:00.000Z",
  "updatedAt": "2026-06-22T02:30:00.000Z",
  "completedAt": null
}
```

### Giá trị `status`
| Mã | Ý nghĩa |
|---|---|
| `OPEN` | Mới giao, chưa bắt đầu |
| `IN_PROGRESS` | Đang xử lý |
| `AWAITING_REVIEW` | Người nhận đã xong, chờ người giao kết thúc |
| `RETURNED` | Bị trả lại |
| `DONE` | Hoàn thành |
| `CANCELLED` | Hủy |

Cờ phụ: `blocked` = đang tắc (vẫn IN_PROGRESS); `decision` = quyết định của BGĐ (nếu có).

---

## 7. Quy trình tích hợp tối thiểu (gợi ý)

1. IBS cấp **API key** + **webhook secret**; Sale cung cấp **callbackUrl**.
2. Sale gọi `GET /projects` + `GET /assignees` để lấy `projectCode` và `userId`/`role`.
3. Sale `POST /tasks` (kèm `externalRef`) để giao việc.
4. Sale nhận `task.updated` qua webhook (hoặc polling `updatedSince`) → cập nhật trạng thái bên mình theo `externalRef`.

---

## 8. Liên hệ kỹ thuật
Mọi vướng mắc tích hợp, liên hệ đội phát triển IBS ERP (kèm `X-IBS-Delivery` / `externalRef` để tra cứu nhanh).
