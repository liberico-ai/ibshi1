# Kế hoạch triển khai: Self-hosted Error Tracking

**Mục tiêu:** Xây dựng hệ thống trace log production để khi người dùng báo lỗi, admin có thể tra cứu ngay nguyên nhân — bao gồm stack trace, request context, user context.

**Date:** 2026-04-03  
**Ước tính:** 7 bước, tất cả trong 1 PR

---

## Tổng quan kiến trúc hiện tại

- **85 route.ts files** — tất cả dùng pattern `catch (err) { console.error(...); return errorResponse(...) }`
- **Response helpers** từ `src/lib/auth.ts`: `successResponse()`, `errorResponse()`, `unauthorizedResponse()`, `forbiddenResponse()`
- **Admin pages** (`/dashboard/admin`, `/dashboard/audit-log`) — pattern fetch API → stat cards → table + pagination
- **Audit log page** là template tốt nhất cho error log page (same pattern: filter, table, expandable rows)
- **Docker deploy** trên VPS `103.141.177.194` — console logs mất khi container restart

---

## Bước 1: Prisma Schema + Migration

**File:** `prisma/schema.prisma`

Thêm model `ErrorLog`:

```prisma
model ErrorLog {
  id         String   @id @default(cuid())
  level      String   @default("ERROR")    // ERROR | WARN | INFO
  message    String                         // Error message chính
  stack      String?                        // Full stack trace
  code       String?                        // VALIDATION | DATABASE | AUTH | BUSINESS | UNKNOWN

  // Request context
  requestId  String?                        // UUID — trace toàn bộ request
  method     String?                        // GET | POST | PUT | DELETE | PATCH
  path       String?                        // /api/projects/abc123
  statusCode Int?                           // 500, 400, 403...
  duration   Int?                           // Response time (ms)

  // User context
  userId     String?
  userRole   String?                        // R01, R02...
  ipAddress  String?
  userAgent  String?

  // Data
  requestBody Json?                         // Body đã sanitize (loại password, token)
  metadata    Json?                         // Context thêm tuỳ ý

  source     String   @default("server")    // server | client
  resolved   Boolean  @default(false)       // Admin đánh dấu đã xử lý
  createdAt  DateTime @default(now())

  @@index([level, createdAt])
  @@index([path, createdAt])
  @@index([userId, createdAt])
  @@index([requestId])
  @@index([resolved, createdAt])
  @@map("error_logs")
}
```

**Chạy migration:**
```bash
npx prisma migrate dev --name add-error-logs
```

**Tại sao thiết kế như vậy:**
- `requestId` — correlation ID để trace 1 request xuyên suốt hệ thống
- `code` — phân loại lỗi giúp filter nhanh (validation vs database vs auth)
- `resolved` — admin đánh dấu đã xử lý, filter ra lỗi chưa giải quyết
- `requestBody` — lưu body đã sanitize để reproduce lỗi
- `source` — phân biệt lỗi server-side vs client-side (error boundary)
- Indexes trên `level+createdAt`, `path+createdAt` — query phổ biến nhất

---

## Bước 2: Logger Utility

**File mới:** `src/lib/logger.ts`

### Chức năng:
1. `logger.error(message, context)` — ghi error vào DB + console
2. `logger.warn(message, context)` — ghi warning vào DB + console
3. `logger.info(message, context)` — chỉ console (không ghi DB, tránh spam)
4. `generateRequestId()` — tạo UUID cho mỗi request
5. `sanitizeBody(body)` — loại bỏ password, token, secret trước khi lưu

### API của logger:

```typescript
interface LogContext {
  requestId?: string
  method?: string
  path?: string
  statusCode?: number
  duration?: number
  userId?: string
  userRole?: string
  ipAddress?: string
  userAgent?: string
  requestBody?: unknown
  metadata?: Record<string, unknown>
  source?: 'server' | 'client'
  code?: 'VALIDATION' | 'DATABASE' | 'AUTH' | 'BUSINESS' | 'UNKNOWN'
  stack?: string
}

// Usage trong route:
logger.error('Không thể tạo project', {
  requestId: 'abc-123',
  path: '/api/projects',
  method: 'POST',
  userId: 'user-1',
  userRole: 'R02',
  code: 'DATABASE',
  stack: err.stack,
  requestBody: { projectCode: 'P001', ... },  // đã sanitize
})
```

### Sanitize rules:
- Loại bỏ fields: `password`, `token`, `secret`, `authorization`, `cookie`
- Truncate `requestBody` nếu > 10KB
- Truncate `stack` nếu > 5KB

### Ghi DB bất đồng bộ:
- Dùng `prisma.errorLog.create()` trong `try/catch` — nếu DB ghi thất bại, fallback `console.error` (không crash app)
- Không `await` — fire-and-forget để không block response

---

## Bước 3: withErrorHandler Wrapper

**File mới:** `src/lib/with-error-handler.ts`

### Mục đích:
Wrap route handler — tự động catch errors, log vào DB, trả response chuẩn. Thay thế pattern `try/catch + console.error` lặp lại 85 lần.

### API:

```typescript
// Trước (pattern hiện tại — lặp lại 85 files):
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const data = await prisma.project.findMany()
    return successResponse({ projects: data })
  } catch (err) {
    console.error('GET /api/projects error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// Sau (dùng wrapper):
export const GET = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()
  const data = await prisma.project.findMany()
  return successResponse({ projects: data })
})
```

### Wrapper tự động:
1. Tạo `requestId` (UUID) cho mỗi request
2. Ghi timestamp bắt đầu → tính `duration`
3. Extract `method`, `path`, `ipAddress`, `userAgent` từ request
4. Nếu handler throw → catch → phân loại error code → `logger.error()` → trả `errorResponse('Lỗi hệ thống', 500)`
5. Thêm header `X-Request-ID` vào response (để client gửi kèm khi báo lỗi)

### Phân loại error tự động:
```typescript
function classifyError(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return 'DATABASE'
  if (err instanceof Prisma.PrismaClientValidationError) return 'VALIDATION'
  if (err instanceof ZodError) return 'VALIDATION'
  if (err instanceof JsonWebTokenError) return 'AUTH'
  return 'UNKNOWN'
}
```

### Context extraction:
- Nếu handler đã gọi `authenticateRequest()` trước khi throw → userId/userRole có thể extract từ request headers (middleware đã decode JWT và set vào headers)

---

## Bước 4: API Endpoint `/api/admin/error-logs`

**File mới:** `src/app/api/admin/error-logs/route.ts`

### GET — Xem error logs (Admin only: R01, R10)

**Query params:**
- `page` (default: 1)
- `limit` (default: 30)
- `level` — filter: ERROR | WARN | ALL
- `code` — filter: VALIDATION | DATABASE | AUTH | BUSINESS | UNKNOWN
- `path` — filter theo route (e.g., `/api/projects`)
- `source` — filter: server | client
- `resolved` — filter: true | false | all
- `search` — tìm trong `message`
- `from`, `to` — date range
- `userId` — filter theo user cụ thể

**Response:**
```json
{
  "ok": true,
  "logs": [...],
  "pagination": { "page": 1, "limit": 30, "total": 150, "totalPages": 5 },
  "stats": {
    "totalErrors": 150,
    "unresolvedCount": 23,
    "todayCount": 5,
    "topRoutes": [
      { "path": "/api/production", "count": 12 },
      { "path": "/api/warehouse", "count": 8 }
    ]
  }
}
```

### PATCH — Đánh dấu resolved/unresolved

```json
// Request
{ "ids": ["id1", "id2"], "resolved": true }

// Response
{ "ok": true, "updated": 2 }
```

### POST — Client error report (authenticated users)

```json
// Request (từ error boundary)
{
  "message": "Cannot read properties of undefined",
  "stack": "TypeError: Cannot read...",
  "path": "/dashboard/projects/abc",
  "metadata": { "component": "ProjectDetail" }
}

// Response
{ "ok": true, "errorId": "clx..." }
```

---

## Bước 5: Admin Page — Error Log Viewer

**File mới:** `src/app/dashboard/admin/error-logs/page.tsx`

### UI Design (dựa trên pattern audit-log page hiện có):

```
┌──────────────────────────────────────────────────────────┐
│  🔴 Error Logs                                           │
│                                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐│
│  │ Total   │ │Unresolved│ │ Today   │ │ Top error route ││
│  │  150    │ │   23    │ │    5    │ │ /api/production  ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘│
│                                                          │
│  Filters:                                                │
│  [Search message...] [Level ▼] [Code ▼] [Source ▼]      │
│  [Route filter...] [From date] [To date] [Resolved ▼]   │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Level │ Time     │ Route          │ Message    │ User ││
│  │───────│──────────│────────────────│────────────│──────││
│  │ ERROR │ 08:30:15 │ POST /api/prod │ DB timeout │ PM   ││
│  │  ↳ Stack trace (expandable)                          ││
│  │  ↳ Request body (expandable)                         ││
│  │  ↳ [✓ Mark Resolved]                                 ││
│  │───────│──────────│────────────────│────────────│──────││
│  │ ERROR │ 08:25:01 │ GET /api/wh    │ Not found  │ KHO  ││
│  │ WARN  │ 08:20:33 │ Client         │ TypeError  │ PM   ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  [← Prev]  Page 1 of 5  [Next →]                        │
└──────────────────────────────────────────────────────────┘
```

### Tính năng:
- **Stat cards** — tổng errors, unresolved, today, top route
- **Filters** — level, code, source, route, date range, resolved status
- **Table** — sortable by time (mới nhất trước)
- **Expandable rows** — click row → xem stack trace + request body + metadata
- **Mark resolved** — checkbox toggle, batch action
- **Auto-refresh** — poll mỗi 30s khi tab active
- **Color coding** — ERROR=đỏ, WARN=vàng, INFO=xanh
- **Request ID** hiển thị — copy để trace

### Access control:
- Chỉ R01 (BGĐ) và R10 (Admin) truy cập được
- Redirect nếu role khác

---

## Bước 6: Client Error Boundary Integration

**File sửa:** `src/app/global-error.tsx`, `src/app/dashboard/error.tsx`

### Thay đổi:
Khi error boundary bắt lỗi → gửi `POST /api/admin/error-logs` với:
- `message`: error.message
- `stack`: error.stack
- `path`: window.location.pathname
- `source`: "client"
- `metadata`: `{ component, digest }`

```typescript
// Thêm vào error boundary:
useEffect(() => {
  const token = sessionStorage.getItem('ibs_token')
  if (token) {
    fetch('/api/admin/error-logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        path: window.location.pathname,
        metadata: { digest: error.digest }
      })
    }).catch(() => {}) // Silent — don't crash error page
  }
}, [error])
```

### UX cho user:
- Hiển thị thêm `Request ID` (nếu có) → user copy gửi cho admin
- Thêm text: "Mã lỗi: {requestId} — vui lòng gửi mã này cho quản trị viên"

---

## Bước 7: Migrate Routes + Add Menu

### 7a. Migrate 5 routes quan trọng nhất trước

Dùng `withErrorHandler` wrapper cho các routes hay gặp lỗi nhất:
1. `src/app/api/projects/route.ts`
2. `src/app/api/projects/[id]/route.ts`
3. `src/app/api/production/route.ts`
4. `src/app/api/production/[id]/route.ts`
5. `src/app/api/tasks/[id]/route.ts`

**Pattern chuyển đổi:**
```typescript
// Trước:
export async function GET(req: NextRequest) {
  try {
    // ...logic...
  } catch (err) {
    console.error('GET /api/projects error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// Sau:
export const GET = withErrorHandler(async (req: NextRequest) => {
  // ...logic... (bỏ try/catch ngoài cùng)
})
```

Các routes còn lại migrate dần trong các PR sau — không cần làm hết 85 files ngay.

### 7b. Thêm menu item vào sidebar

**File sửa:** `src/lib/constants.ts`

Thêm vào nhóm "system" (menu group cuối):
```typescript
{ label: 'Error Logs', href: '/dashboard/admin/error-logs', icon: '⚠️', roles: ['R01', 'R10'] }
```

---

## Thứ tự thực hiện

```
Bước 1 (Schema)
  └── Bước 2 (Logger) 
        └── Bước 3 (Wrapper)
              ├── Bước 4 (API endpoint)
              │     └── Bước 5 (Admin page)
              ├── Bước 6 (Client error boundary)
              └── Bước 7 (Migrate routes + menu)
```

Tất cả sequential — mỗi bước phụ thuộc bước trước.

---

## Kiểm tra sau khi hoàn thành

```bash
# 1. Migration chạy thành công
npx prisma migrate status

# 2. Unit tests vẫn pass
npx vitest run

# 3. Build thành công
npm run build

# 4. Test thủ công:
#    - Truy cập /dashboard/admin/error-logs → thấy trang
#    - Gây lỗi (gọi API sai) → thấy error xuất hiện trong log
#    - Filter theo level, route → hoạt động
#    - Mark resolved → trạng thái thay đổi
```

---

## Không làm trong phạm vi này

- **Alerting/notification** (email, Slack khi có error nghiêm trọng) — làm sau
- **Log rotation/cleanup** (xoá logs cũ hơn 90 ngày) — làm sau
- **Migrate tất cả 85 routes** — chỉ migrate 5 routes quan trọng, còn lại dần dần
- **Performance monitoring/APM** — scope khác
- **Sentry integration** — không cần nếu self-hosted đáp ứng đủ
