# PROD REVIEW — Hướng dẫn audit phiên bản production

## Xác định SHA đang chạy

```bash
curl -s https://ibshi1.lab.liberico.com.vn/api/version | jq
# → { "commit": "<sha>", "builtAt": "<ISO>", "env": "production" }
```

## Checkout đúng phiên bản prod

```bash
git fetch origin --tags
git checkout production          # tag luôn trỏ commit đang chạy prod
# hoặc:
git checkout <sha-từ-api-version>
```

Tag `production` được CI tự đẩy sau mỗi deploy thành công.

## Kiểm tra migration

```bash
npx prisma migrate status
# Phải hiện "Database schema is up to date" hoặc liệt kê migration đã áp.
```

## Biến môi trường production (TÊN — không có giá trị)

| Biến | Mục đích |
|------|----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis cache |
| `JWT_SECRET` | Signing key cho auth token |
| `NEXT_PUBLIC_APP_URL` | URL public (https://...) |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `TELEGRAM_GROUP_CHAT_ID` | Chat ID nhóm Telegram chính |
| `TELEGRAM_WEBHOOK_SECRET` | Secret xác thực webhook Telegram |
| `CRON_SECRET` | Bearer token cho /api/cron/* |
| `GIT_SHA` | Commit SHA (inject lúc build) |
| `BUILD_TIME` | Thời điểm build (inject lúc build) |
| `LAB_WEBHOOK_SECRET` | Secret webhook deploy server |
| `LAB_WEBHOOK_URL` | URL webhook deploy server |

## Checklist audit

- [ ] `GET /api/version` trả SHA khớp tag `production`
- [ ] `npx prisma migrate status` → up to date
- [ ] Trang `/dashboard` load không lỗi
- [ ] Tạo công việc → giao → hoàn thành OK
- [ ] Tạo họp → giờ VN đúng
- [ ] Telegram digest chạy đúng (kiểm tra /api/cron/daily-digest)
- [ ] File upload/download hoạt động
