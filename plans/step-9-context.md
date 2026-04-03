# Step 9 Context: OpenAPI Documentation

> **Status:** COMPLETED
> **Date:** 2026-04-02
> **Tests:** 185 (no regressions)

---

## Summary

Auto-generated OpenAPI 3.1 spec from Zod schemas covering all major API endpoints. Swagger UI available at `/dashboard/api-docs`.

---

## Files Added

### `src/lib/openapi.ts` — OpenAPI spec generator
- Uses `createSchema()` from `zod-openapi` to convert Zod schemas to JSON Schema
- Covers ~60 endpoints across 14 tags: Auth, Users, Dashboard, Projects, Tasks, Warehouse, Procurement, Production, QC, Design, HR, Finance, Admin, System
- Bearer JWT security scheme
- Request body schemas from `@/lib/schemas`

### `src/app/api/docs/route.ts` — OpenAPI JSON endpoint
- `GET /api/docs` returns the generated OpenAPI JSON spec

### `src/app/dashboard/api-docs/page.tsx` — Swagger UI page
- Client component using `swagger-ui-dist`
- Loads CSS from unpkg CDN
- Accessible at `/dashboard/api-docs`

---

## Dependencies Added

- `zod-openapi` v5.4.6 — Zod to OpenAPI schema conversion
- `swagger-ui-dist` v5.x — Swagger UI static assets
- `@types/swagger-ui-dist` — TypeScript types

---

## CSP Update

Added `https://unpkg.com` to `style-src` in CSP header to allow Swagger UI CSS loading.

---

## Impact on Other Steps

- **Step 10 (Integration tests)**: Can test `GET /api/docs` returns valid OpenAPI JSON
- **Step 12 (CI/CD)**: Could add OpenAPI validation step
