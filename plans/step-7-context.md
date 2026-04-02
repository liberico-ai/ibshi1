# Step 7 Context: Security Hardening

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Tests:** 165 total (added 25: rate-limiter 8, sanitize 17)

---

## Summary

Security hardening across middleware, cron routes, HTML sanitization, rate limiting, and CSP headers.

---

## Files Modified

### `src/middleware.ts` — Major overhaul
- **CRON_SECRET validation**: `/api/cron/*` routes now require `Authorization: Bearer <CRON_SECRET>` header. Removed old blanket bypass that skipped all auth for cron paths.
- **CORS support**: Added `ALLOWED_ORIGIN` env var. All API responses get CORS headers. `OPTIONS` preflight returns 204 with proper headers.
- **Rate limiting**: Applied after JWT auth. Uses user ID as rate limit key. Two presets: API_GENERAL (100/min), API_UPLOAD (10/min for `/api/upload`).
- **`decodeJWTPayload()`**: Extracts user ID from JWT for rate limit keying without full verification (auth already done).
- **`addCorsHeaders()`**: Helper to attach CORS headers to responses.

### `src/lib/rate-limiter.ts` — NEW
- In-memory Map-based rate limiter with sliding window cleanup.
- `checkRateLimit(key, maxRequests, windowMs)`: returns `true` if allowed, `false` if exceeded.
- `resetRateLimitStore()`: testing helper.
- `RATE_PRESETS`: `API_GENERAL` and `API_UPLOAD`.

### `src/lib/sanitize.ts` — NEW
- `sanitizeString(input)`: strips HTML tags via regex, trims whitespace.
- `sanitizeObject<T>(obj)`: recursively sanitizes all string values in an object.

### `public/polyfills.js` — NEW
- `crypto.randomUUID` polyfill for insecure HTTP contexts (previously was inline `dangerouslySetInnerHTML`).

### `src/app/layout.tsx`
- Replaced `dangerouslySetInnerHTML` polyfill injection with `<Script src="/polyfills.js" strategy="beforeInteractive" />`.

### `src/app/api/cron/deadline-check/route.ts`
- Removed hardcoded fallback `|| 'ibs-cron-2026'` for CRON_SECRET.
- Removed redundant per-route secret check (middleware now handles it).

### `src/app/api/health/route.ts`
- Changed `$queryRawUnsafe('SELECT 1')` to `$queryRaw\`SELECT 1\`` (tagged template — prevents SQL injection vector).

### `next.config.ts`
- Added Content-Security-Policy header: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'`.
- Added HSTS header for production.

---

## Test Files Added

| File | Tests | Coverage |
|------|-------|----------|
| `src/lib/__tests__/rate-limiter.test.ts` | 8 | rate limiter logic |
| `src/lib/__tests__/sanitize.test.ts` | 17 | sanitize string/object |

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CRON_SECRET` | Auth token for `/api/cron/*` routes | **Required** (no fallback) |
| `ALLOWED_ORIGIN` | CORS allowed origin | `*` (all origins) |

---

## Impact on Other Steps

- **Step 8 (Cache)**: Middleware changes are compatible. Rate limiting runs after JWT auth, before route handlers. Cache operations happen inside route handlers.
- **Step 6 (Zod)**: Sanitize functions can be composed with Zod schemas (e.g., `.transform(sanitizeString)`) but are independent.
- **API routes**: All existing API routes work unchanged — middleware changes are transparent.
