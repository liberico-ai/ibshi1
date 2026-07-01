# TÍCH HỢP IBS ↔ SALE — BẢN CHỐT (AGREED)
**Amend cho:** `IBS_INTEGRATION_REQUIREMENT.md` (Sale v4) — spec gốc GIỮ NGUYÊN, tài liệu này chốt các quyết định + inventory + kế hoạch build.
**Trạng thái:** Final · **Ngày:** 30/06/2026 · Sale cm `644f1b5` · IBS `ibshi1.lab`

---

## A. NHẬT KÝ QUYẾT ĐỊNH (đã chốt 2 bên)

| # | Vấn đề | Quyết định | Ai làm |
|---|--------|-----------|--------|
| §F.1 | Webhook retry | Sale ack 200 + dedup `X-IBS-Delivery`; KHÔNG build `GET /webhook-events` | — |
| §F.2 | Project code timing | **Option A** — cấp `projectCode` tại approve (mã người duyệt nhập, không lag). **1 webhook** `project.approved{externalRef,projectId,projectCode}`, KHÔNG có `project.code_allocated` | IBS |
| §F.3 | Attachments | base64 inline ≤50MB/file, ≤10 file/request | IBS (đã có) |
| §F.4 | Khóa khách AR | Dùng `sale_customers.id` (UUID) — KHÔNG dùng tax_code (0% coverage). IBS dedup khách cũ theo `name+country` | IBS |
| §F.5 | Bucket-3 status | PATCH **mọi** state transition (Option A) | Sale bắn, IBS nhận |
| §F.6 | Signature | hex trần `X-IBS-Signature:<hex>` | IBS |
| Arch 1 | §B.5 luồng duyệt | Feature mới IBS: submission table + reviewer approve/reject + gán code tại approve + webhook. Sale **auto-fire POST /projects khi opp WON** | cả hai |
| Arch 2 | Customer sync | **SIMPLIFIED**: IBS poll `GET /customers?modified_since=&limit=100` + `next_cursor` mỗi 15'. KHÔNG webhook customer, không secret mới | Sale thêm filter+index; IBS build client |

---

## B. INVENTORY ENDPOINT (nguồn sự thật cho build)

### B1. Sale → IBS (IBS mở, §B)
| Endpoint | Trạng thái IBS | Phase |
|----------|----------------|-------|
| `GET /external/v1/projects` | ✅ v1 live (rà shape `{ok,data}`) | 1 |
| `GET /external/v1/assignees` | ✅ v1 live | 1 |
| `GET /external/v1/tasks/{id}` · `GET /tasks?updatedSince=` | ✅ v1 live | 1 |
| `POST /external/v1/tasks` (Stage-4-out) | ✅ v1 live (tạo task FREE) | 1 |
| `GET /external/v1/departments` | ❌ build | 2 |
| `GET /external/v1/customers/{id}/ar-summary` | ❌ build (404-tolerant) | 2 |
| `POST /external/v1/projects` + `GET /projects/{externalRef}` | ❌ build (+ luồng duyệt) | 2 |
| `GET /external/v1/contracts/{id}` | ❌ build | 2 |
| `PATCH /external/v1/tasks/{id}/status` | ❌ build | 2 |

### B2. IBS → Sale (webhook, §A) — POST `…/webhooks/ibs/<event>`, HMAC hex
| Event | Trạng thái | Phase |
|-------|-----------|-------|
| `task.updated` | ✅ có (`webhook.ts`) — rà payload thêm `completedAt` | 1/3 |
| `task.created` | ❌ build | 3 |
| `capacity.changed` | ❌ build (schema lỏng) | 3 |
| `contract.updated` | ❌ build | 3 |
| `departments.changed` | ❌ build | 3 |
| `project.approved` (kèm projectCode) / `project.rejected` | ❌ build | 3 |

### B3. IBS → Sale (IBS gọi, §G) — `X-API-Key: SALE_INBOUND_API_KEY`
| Endpoint | Trạng thái IBS |
|----------|----------------|
| `GET /customers?modified_since=&limit=100` (polling 15') | ❌ build client (Phase 4) |
| `GET /customers/{id}` · `/customers/{id}/contacts` · `/customers?q=` | gọi khi cần (màn tra cứu khách) |

---

## C. AUTH (3 khóa)
- **SALE_API_KEY** (Sale→IBS): IBS cấp qua `ApiClient` + scopes (§D spec). Kênh an toàn.
- **IBS_WEBHOOK_SECRET** (ký webhook): IBS sinh, chia sẻ an toàn. HMAC-SHA256 hex.
- **SALE_INBOUND_API_KEY** (IBS→Sale §G): Sale cấp, IBS lưu env.
> Quy tắc: **không để giá trị key/secret trong chat/PR/git**; trao đổi qua kênh an toàn.

---

## D. QUY ƯỚC CHUNG (giữ từ spec)
- Idempotency: mọi ghi Sale→IBS mang `externalRef` → IBS no-op nếu trùng (200 + resource cũ).
- Webhook: header `X-IBS-Event`, `X-IBS-Delivery` (uuid), `X-IBS-Signature` (hex). Sale ack `{ok,received,matched,duplicate}`.
- Envelope response mới: `{ok:true,data}` / `{ok:false,error,code}`.
- Time: UTC ISO-8601 `Z`.
- Rate: reference 4/15', outbound tasks ≤25/2', AR ≤50/h.

---

## E. KẾ HOẠCH BUILD IBS (series #S)
- **#S1 Phase 1**: confirm v1 shape + cấp SALE_API_KEY/IBS_WEBHOOK_SECRET + nhận SALE_INBOUND_API_KEY. *(đang làm)*
- **#S2 Phase 2**: 6 endpoint §B — thứ tự departments → ar-summary → projects(+duyệt) → contracts → PATCH task. Additive, `{ok,data}`, idempotent externalRef.
- **#S3 Phase 3**: 5 webhook §A trên `webhook.ts` (append path `/<event>`), `project.approved` kèm projectCode.
- **#S4 Phase 4**: client poll §G customer `modified_since` + mirror + dedup name+country + JOIN AR.

Mỗi phase: local → verify (eslint/tsc/build/vitest) → soi migration nếu có → deploy `ibshi1.lab`.

---

## F. LƯU Ý PHỤ THUỘC (từ audit IBS)
- `ar-summary` lấy công nợ từ tài chính IBS — vừa khép vòng ở #F4 (Invoice↔PO, actual theo giá PO). Số AR chỉ đúng khi có Invoice/Payment thật; hiện prod chưa có → trả 0/404-tolerant hợp lệ.
- `POST /tasks` tạo task FREE (đúng spec Stage-4-out, không kickoff workflow 36 bước — spec không yêu cầu).

*Bản chốt · IBS-ERP × Sale v4 · 30/06/2026*
