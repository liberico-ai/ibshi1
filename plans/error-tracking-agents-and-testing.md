# Error Tracking — Phân bổ Agents & Kế hoạch Testing

**Date:** 2026-04-03  
**Status:** Chờ triển khai  
**Plan gốc:** [error-tracking-implementation.md](error-tracking-implementation.md)

---

## Phân bổ Agents

Dựa trên dependency chain, chia thành **3 agents**, trong đó 2 agent chạy song song:

```
Agent 1 (sequential - chạy trước)
├── Bước 1: Schema + migration
├── Bước 2: Logger utility
└── Bước 3: withErrorHandler wrapper

        ↓ hoàn thành ↓

Agent 2 (parallel)              Agent 3 (parallel)
├── Bước 4: API endpoint        ├── Bước 6: Error boundary
└── Bước 5: Admin page          ├── Bước 7a: Migrate 5 routes
                                └── Bước 7b: Menu sidebar
```

| Agent | Scope | Lý do gộp |
|-------|-------|-----------|
| **Agent 1** | Schema + Logger + Wrapper | 3 bước này phụ thuộc nhau chặt, cùng 1 context |
| **Agent 2** | API endpoint + Admin page | Page gọi API, cần cùng context để match response format |
| **Agent 3** | Error boundary + migrate routes + menu | Đều là sửa files hiện có, không phụ thuộc Agent 2 |

---

## Testing sau khi hoàn thành

### Test tự động

```bash
# 1. Migration OK
npx prisma migrate status

# 2. Unit tests hiện tại không bị break
npx vitest run

# 3. Build thành công
npm run build

# 4. Lint pass
npm run lint
```

### Test thủ công trên production (checklist)

| # | Test case | Cách thực hiện | Kết quả mong đợi |
|---|-----------|---------------|-------------------|
| 1 | **Error tự động bắt** | Gọi `POST /api/projects` với body rỗng (thiếu required fields) | Error log xuất hiện trong DB với `code: VALIDATION` |
| 2 | **Error log page render** | Login BGD (R01) → vào `/dashboard/admin/error-logs` | Trang hiển thị, stat cards có số liệu |
| 3 | **Filter hoạt động** | Filter theo level=ERROR, route=/api/projects | Chỉ hiển thị logs matching |
| 4 | **Expandable row** | Click vào 1 error row | Thấy stack trace + request body + metadata |
| 5 | **Mark resolved** | Click "Mark Resolved" trên 1 error | Trạng thái chuyển sang resolved, unresolved count giảm |
| 6 | **X-Request-ID** | Gọi bất kỳ API nào | Response header có `X-Request-ID` (UUID) |
| 7 | **Client error** | Gây lỗi trên UI (ví dụ navigate tới URL không hợp lệ) | Error boundary hiển thị + error log ghi nhận với `source: client` |
| 8 | **Permission** | Login PM (R02) → vào `/dashboard/admin/error-logs` | Không thấy menu item / không truy cập được |
| 9 | **Sanitize** | Gọi `POST /api/auth/login` với sai password | Error log KHÔNG chứa password trong requestBody |
| 10 | **Non-blocking** | Gọi API bình thường khi DB error_logs bị đầy/lỗi | API vẫn trả response bình thường, không crash |
