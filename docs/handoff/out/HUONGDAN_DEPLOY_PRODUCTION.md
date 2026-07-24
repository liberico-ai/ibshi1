# Hướng dẫn Deploy Production — đợt phát triển 14/07 → 22/07/2026

*Cho dev. Gồm code + **database**. Đọc hết mục 2–4 trước khi chạy. Tài liệu này KHÔNG chứa giá trị secret — chỉ tên biến.*

> **Nguyên tắc vàng (CLAUDE.md):** history migration **prod ≠ local/UAT**. Deploy prod: `prisma migrate deploy` (chỉ áp cái chưa áp) + `prisma migrate resolve` khi cần đánh dấu. **TUYỆT ĐỐI KHÔNG `prisma migrate reset`** (xoá sạch dữ liệu). Mọi migration đợt này **ADDITIVE** (chỉ thêm bảng/cột, không sửa/xoá cột cũ) — an toàn với dữ liệu prod.

---

## 1. Tổng quan đợt (PR #48–#67)

| PR | Nội dung | Loại |
|---|---|---|
| #48 | PR bước 4+5: backfill PR + link task↔PO + flag DB-toggle | **DB migration** (`20260714_pr_source…`) + **data-backfill** + **flag** `FF_PR_MATERIALIZE` |
| #49 | Quote — dải "Bước tiếp theo" ở màn Báo giá | code-only |
| #50 | Quote — nhắc tạo PO khi hoàn thành báo giá | code-only |
| #51 | 4 fix luồng chuẩn (E2E I-095) + create-po Decimal | code-only |
| #52 | **T2 MCL** (theo dõi vật tư) + **T5 Sổ tài liệu** | **DB migration** (`20260716_project_documents`) + code |
| #53 | **T1 Hợp đồng mua** (PurchaseContract) | **DB migration** (`add_purchase_contracts` + `PO.contract_id`) |
| #54 | Cột Giá trị PO (totalValue) + coverage per-item + MDR 1 nút | code-only |
| #55 | **P0** sinh mã PO an toàn `nextPoCode()` | code-only |
| #56 | Chuẩn hoá format mã PO → `PO-<năm>-NNN` | code-only |
| #57 | Gap#1 — định giá BOM → Budget MATERIAL (phương án D) | code-only *(bỏ query `quote_group_items` — không phụ thuộc QuoteGroup)* |
| #58 | Gap#3 — R07 ghi bomPr đường chính | code-only |
| #59 | Cascade revision không-ECO không mất âm thầm (B+D) | code-only |
| #60 | re-QC dispatch độc lập feature-flag (F) | code-only *(dùng cột `work_orders.needs_re_qc` — xem migration `add_wo_re_qc`)* |
| #61 | Backlog A/C/E — createRevisionWithEco + BOM null-material + impact ISSUED/FABRICATED | code-only *(Zod optional, KHÔNG đổi schema DB; `MaterialIssue` đã có sẵn)* |
| #62 | Hardening enrich (orphan/junk/FK) | code-only |
| #63 | create-revision race P2002→422 | code-only |
| #64 | Cashflow Mức 1 — hiển thị DTTC + vá lỗ GET plan | code-only *(route mới, không schema)* |
| #65 | Cashflow F1 — tổng/lợi nhuận 1 nguồn Budget | code-only |
| #66 | Cashflow F2 — selector theo dự án | code-only *(route `/api/projects/options`)* |
| #67 | **F3 backfill script** (chưa apply) | **data-backfill** (script, chạy tay sau deploy) |
| — | Mobile webapp `/m` cho QAQC/Xưởng | code-only |
| **#71–75** | **Revise Flow36** — revise đi hết chuỗi 36 bước theo round + human skip (thay cascade phẳng) | **DB migration** (`add_task_revision_fields`) + **flag build-time** `NEXT_PUBLIC_FF_REVISE_FLOW` + code |

**Tóm tắt loại:** DB migration = **4** (`pr_source`, `project_documents`, `purchase_contracts`, **`add_task_revision_fields`**). Data-backfill = 2 (PR materialize #48 đã chạy đợt trước; **F3 Budget #67 chưa chạy**). Flag = **3** (`FF_PR_MATERIALIZE`, `NEXT_PUBLIC_FF_BOM_CASCADE`, **`NEXT_PUBLIC_FF_REVISE_FLOW`**). Còn lại code-only.

> **Revise Flow36 — điều kiện chạy (QUAN TRỌNG).** Sau khi (a) áp migration `add_task_revision_fields` và (b) build image với `NEXT_PUBLIC_FF_REVISE_FLOW=true`, một dự án **chỉ mở được vòng revise nếu đang chạy theo process-template** (có ≥1 task gắn `template_step_id`). Dự án **legacy** (task `template_step_id = null`) sẽ báo lỗi *"không xác định được template của dự án"* khi bấm "Mở vòng revise". Trước/sau deploy chạy `scripts/revise-readiness-check.ts` (read-only) để biết dự án nào đủ điều kiện. FF là **build-time** → bật/tắt = rebuild image (không toggle runtime).

---

## 2. Tiền điều kiện (BẮT BUỘC trước khi deploy)

### 2.1 Backup DB prod
```bash
pg_dump "$DATABASE_URL_PROD" -Fc -f backup_prod_$(date +%Y%m%d_%H%M).dump   # -Fc = custom, nén
# Kiểm dump đọc được:
pg_restore -l backup_prod_*.dump | head
```
> Giữ file backup ở nơi an toàn. Đây là đường lui khi migration/backfill hỏng.

### 2.2 Kiểm trạng thái migration prod (chỉ ĐỌC)
```bash
DATABASE_URL="<prod>" npx prisma migrate status
```
Xem danh sách "have not yet been applied" → đối chiếu mục 4 trước khi chạy `migrate deploy`.

### 2.3 ENV cần có trên prod (chỉ liệt kê TÊN — KHÔNG ghi giá trị)
| Biến | Ghi chú |
|---|---|
| `DATABASE_URL` | Postgres prod (`…/ibshi`). Quyết định DB đích của mọi lệnh prisma |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Auth |
| `DB_POOL_MAX` | Pool Postgres |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME` | URL/tên app (client) |
| `CRON_SECRET` | Bảo vệ `/api/cron/*` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_GROUP_CHAT_ID` | Bot Telegram (nếu bật) |
| **`FF_PR_MATERIALIZE`** | Flag PR materialize — env thắng tuyệt đối. Đặt `true` để bật (mặc định TẮT nếu không set) |
| **`NEXT_PUBLIC_FF_BOM_CASCADE`** | Flag cascade revision — **build-time** (Dockerfile ARG mặc định `true`). Phải set khi BUILD image, không đổi được lúc runtime |
| **`NEXT_PUBLIC_FF_REVISE_FLOW`** | Flag Revise Flow36 — **build-time** (Dockerfile ARG). Set `=true` khi BUILD image để bật fork "Revise" + engine round + nút Bỏ qua. **Chưa bật = giữ luồng cũ y nguyên.** Rollback = rebuild không set (hoặc `=false`). *UAT đang ON; prod set khi muốn bật.* |

---

## 3. Thứ tự deploy an toàn

```
0. pg_dump backup prod (mục 2.1)          ← đường lui
1. git pull (code mới nhất, main @ 67488f9+)
2. npx prisma generate                     ← sinh client khớp schema
3. DATABASE_URL=<prod> npx prisma migrate status   ← xem pending, đối chiếu mục 4
4. DATABASE_URL=<prod> npx prisma migrate deploy    ← ADDITIVE, KHÔNG reset (xem lưu ý QuoteGroup)
5. npm run build  (Docker ARG: NEXT_PUBLIC_FF_BOM_CASCADE=true; thêm NEXT_PUBLIC_FF_REVISE_FLOW=true nếu MUỐN bật Revise Flow36)
6. Deploy container / restart server
7. Đặt/kiểm flag: FF_PR_MATERIALIZE (nếu cần), NEXT_PUBLIC_FF_BOM_CASCADE + NEXT_PUBLIC_FF_REVISE_FLOW (đã baked lúc build)
8. Smoke test (mục 6)
9. (SAU, riêng) F3 backfill Budget (mục 5)
```
> Script sẵn có `scripts/deploy.sh` làm bước 2+4+git push (target `103.141.177.194:15432/ibshi`). Có thể dùng, nhưng **phải backup (bước 0) + migrate status (bước 3) TRƯỚC**.

---

## 4. DATABASE — chi tiết từng migration

### 4.1 Migration của đợt (14/7+) — tất cả ADDITIVE

| Migration | Thêm gì | Idempotent? | Đã áp UAT? | Rủi ro |
|---|---|---|---|---|
| **`20260714_pr_source_task_and_item_snapshot`** (#48) | `purchase_requests.source_task_id`; `purchase_request_items.material_id` **nullable** + cột snapshot (item_code/description/…) | ✅ `ADD COLUMN IF NOT EXISTS` | ✅ (E2E #2 materialize 3 PR chạy được) | Thấp — bảng PR rỗng lúc 14/7 |
| **`20260716_project_documents`** (#52, T5) | Bảng `project_documents` (metadata sổ tài liệu) + index | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ (E2E #2 tạo `BV-DIV-001`) | Thấp — bảng mới, không đụng cũ |
| **`add_purchase_contracts`** (#53, T1) | Bảng `purchase_contracts` + `purchase_orders.contract_id` (nullable) + FK | ✅ `IF NOT EXISTS` + FK bọc `DO $$` | ✅ (E2E #2 tạo `HDMB-2026-BRA-090`) | Thấp — PO cũ vẫn hợp lệ (contract_id null) |

### 4.2 ⚠️ QuoteGroup — DORMANT, cần QUYẾT ĐỊNH
`20260707_quote_groups_tables` → 3 bảng `quote_groups` / `quote_group_items` / `supplier_quote_lines`.
- **CHƯA áp UAT** (Finding B đợt trước: `quote_group_items` không tồn tại trên UAT). Code Gap#1 (#57, phương án D) **đã bỏ query bảng này** → **không phụ thuộc**. Feature QuoteGroup **chưa wire** vào luồng.
- ⚠️ **NON-IDEMPOTENT:** dùng `CREATE TABLE "quote_groups"` (KHÔNG `IF NOT EXISTS`) → chạy khi bảng đã tồn tại sẽ **LỖI**.
- **Đề xuất (dev quyết):**
  - **(a) Áp additive** cho nhất quán schema: nếu prod CHƯA có 3 bảng này (rất có thể, giống UAT) → `migrate deploy` tạo 1 lần, an toàn.
  - **(b) Bỏ qua tạm:** nếu muốn giữ prod tối giản → `prisma migrate resolve --applied 20260707_quote_groups_tables` (đánh dấu đã áp mà KHÔNG tạo bảng). *Nhược: schema DB lệch file — chỉ dùng nếu chắc không cần feature.*
  - Khuyến nghị **(a)** trừ khi có lý do giữ sạch. Trước khi `migrate deploy`, kiểm `SELECT to_regclass('public.quote_groups');` — nếu đã tồn tại (bất thường) thì phải `resolve --applied`, không để nó chạy `CREATE TABLE` lần nữa.

### 4.3b Migration Revise Flow36 (dùng bởi #71–75)
`add_task_revision_fields` → thêm 4 cột vào bảng `tasks`: `revision_round INTEGER NOT NULL DEFAULT 0`, `revision_id TEXT`, `origin_step_code TEXT`, `skip_reason TEXT`.
- **Idempotent** (`ADD COLUMN IF NOT EXISTS`) — an toàn chạy lại. **Additive**, `default 0` → task cũ giữ nguyên hành vi (round 0).
- Trạng thái `SKIPPED_NO_IMPACT` là **giá trị chuỗi** của cột `status` (String) → **KHÔNG cần migration**.
- ⚠️ Thư mục migration **không có tiền tố ngày** (`add_task_revision_fields`) → sắp sau các migration `2026…` khi `migrate deploy`; chỉ thêm cột nên không phụ thuộc thứ tự. Kiểm `migrate status`; nếu cột đã có mà chưa ghi history → `resolve --applied add_task_revision_fields`.
- **Bật feature:** cột có sẵn KHÔNG tự bật gì; phải build image với `NEXT_PUBLIC_FF_REVISE_FLOW=true` (mục 2.3). FF off = cột thừa nằm im, luồng cũ y nguyên.

### 4.3 Migration re-QC (dùng bởi #60)
`add_wo_re_qc` (từ 02/07) → `work_orders.needs_re_qc` (bool default false) + `re_qc_reason`. Additive. **Fix #60 (re-QC dispatch) cần 2 cột này.** Kiểm `migrate status`: nếu prod chưa có → `migrate deploy` áp (an toàn, additive). Nếu đã có mà chưa ghi history → `resolve --applied add_wo_re_qc`.

### 4.4 KHÔNG cần migration
- **Budget category `SERVICE`** (Fix #2 / Gap#1): `Budget.category` là **`String`** trong schema (không phải enum DB). `SERVICE`/`MATERIAL`/`LABOR`/`OVERHEAD` chỉ là giá trị chuỗi → **KHÔNG có migration, không cần làm gì**.
- **#61 BOM null-material:** chỉ nới **Zod** (`materialId` optional ở tầng API) — DB `BomItem.materialId` **vẫn NOT NULL**, không migration. `MaterialIssue` (impact ISSUED/FABRICATED) là bảng **đã có sẵn**.

### 4.5 Lưu ý chung `migrate deploy` (prod≠local)
`migrate deploy` đọc bảng `_prisma_migrations` của prod, chỉ áp cái CHƯA ghi. Nếu một migration đã áp vật lý nhưng chưa ghi history (do prod≠local) → nó thử chạy lại. Với migration **idempotent** (`IF NOT EXISTS`) → an toàn. Với **non-idempotent** (QuoteGroup) → **phải** `resolve --applied` trước. Luôn xem `migrate status` (bước 3) và xử từng cái theo mục 4.2/4.3.

---

## 5. Data-backfill F3 — Budget từ dự toán (BƯỚC RIÊNG, sau deploy)

Script `scripts/backfill-estimate-budget.ts` (PR #67). Vài dự án có dự toán (form ESTIMATE) nhưng Budget 4 nhóm = 0 → kế toán không thấy số. Backfill = chạy lại đường sync (idempotent).

**Quy trình (KHÔNG bỏ bước):**
```bash
# 0) Backup (nếu chưa làm ở mục 2.1)
pg_dump "$DATABASE_URL_PROD" -Fc -f backup_pre_backfill_$(date +%Y%m%d).dump

# 1) DRY-RUN (chỉ đọc, KHÔNG ghi) — script IN RA DATABASE_URL đích ở đầu, kiểm kỹ đúng prod
DATABASE_URL="<prod>" npx tsx scripts/backfill-estimate-budget.ts
#    → in bảng: dự án | totals(VT/NC/DV/CPC) | Budget hiện tại | SẼ GHI
#    → liệt kê riêng dự án ESTIMATE CHƯA COMPLETED (bị LOẠI ra — không đụng)

# 2) DUYỆT danh sách với Toan/KTKH (số có hợp lý không, đúng dự án không)

# 3) APPLY (chỉ sau khi duyệt)
DATABASE_URL="<prod>" npx tsx scripts/backfill-estimate-budget.ts --apply
```
- Diện backfill = task ESTIMATE (P1.2) **COMPLETED** + totals>0 + Budget 4 nhóm=0. **Cổng an toàn: không đụng dự toán chưa chốt.**
- **Idempotent** (recompute-set) → chạy lại không nhân đôi.
- Trên **UAT** làm trước (dry-run → duyệt → apply) rồi mới tới prod (dry-run lại trên prod).
- Ứng viên sơ bộ (qua API UAT, chưa lọc cổng COMPLETED): `25-WNC-I-104`, `26-WNC-I-109`, `26-WNC-I-111`. Xem `f3_backfill_dryrun.md`.

---

## 6. Smoke test sau deploy (đường chính)

| # | Kiểm | Kỳ vọng |
|---|---|---|
| 1 | Đăng nhập R08/R07/R04 OK | Auth + JWT hoạt động |
| 2 | Tạo PO từ báo giá (P3.5) | Mã `PO-26-0xx`, không 500 (#55/#56) |
| 3 | Trang Đơn đặt hàng | Cột "Giá trị" ra totalValue (#54); cột Hợp đồng nguồn (T1) |
| 4 | Hợp đồng mua: tạo HĐ + gắn PO | `HDMB-…`, PO hiện HĐ nguồn (T1) |
| 5 | Sổ tài liệu dự án: tạo tài liệu | `project_documents` ghi được (T5) |
| 6 | **Dòng tiền → tab Kế hoạch → chọn dự án có DTTC** | Section "Dự toán tài chính (KTKH)" hiện 4 nhóm + tổng + lợi nhuận (đỏ nếu lỗ) — Mức1/F1/F2 |
| 7 | GET plan bằng role ngoài bộ 7 (vd R09) | **403** (vá lỗ #64) |
| 8 | Revision BOM có ECO → duyệt → activate | Cascade sinh task cho phòng (R04/R02/R03/R05/R07) — cần `NEXT_PUBLIC_FF_BOM_CASCADE=true` |
| 9 | MCL dự án | Dòng vật tư Cần/Đặt/Về (T2) |
| 10 | **(chỉ nếu bật `NEXT_PUBLIC_FF_REVISE_FLOW`)** Màn tạo việc | Hiện fork **[1] Revise / [2] Việc khác** + dropdown 12 loại revise. **Guard:** chọn dự án **legacy** (không template) → nút "Mở vòng revise" **disable** + cảnh báo thân thiện (không throw lỗi kỹ thuật); chọn dự án **template** → bấm được (hiện tên quy trình). |
| 11 | Chạy `scripts/revise-readiness-check.ts` (read-only) trên prod | Ra danh sách dự án đủ điều kiện revise vs legacy — dùng để biết phạm vi |
| 12 | Mở 1 vòng revise trên 1 dự án template-driven (loại "Bản vẽ" → P2.1) | Sinh P2.1 + orphan P2.1A/P2.2/P2.3, **KHÔNG** sinh sẵn P2.4 (gate); bỏ qua 3 feeder + hoàn thành P2.1 → P2.4 mới mở |

---

## 7. Rollback

**Code:** revert PR/commit trên git → build lại → deploy container cũ. (Container cũ vẫn dùng được vì migration additive không phá cột cũ.)

**Migration (additive không tự rollback):**
- Migration đợt này **chỉ THÊM** bảng/cột → code CŨ vẫn chạy bình thường trên schema MỚI (cột thừa không ảnh hưởng). ⟹ **Rollback code KHÔNG cần rollback DB.**
- Nếu buộc phải gỡ 1 bảng/cột mới (hiếm): viết migration DOWN thủ công (`DROP TABLE IF EXISTS …` / `ALTER TABLE … DROP COLUMN IF EXISTS …`) — **chỉ khi chắc không có dữ liệu cần giữ**. KHÔNG `migrate reset`.
- **Hỏng nặng (mất dữ liệu):** `pg_restore` từ dump ở mục 2.1:
  ```bash
  pg_restore -d "$DATABASE_URL_PROD" --clean --if-exists backup_prod_YYYYMMDD_HHMM.dump
  ```
- **F3 backfill:** ghi vào `Budget.planned` (recompute-set). Muốn lui: `pg_restore` bảng budget từ dump `backup_pre_backfill`, hoặc set lại planned=0 cho dự án đó (chỉ nếu chắc chưa có nguồn khác ghi đè).

---

## 8. Checklist nhanh
- [ ] `pg_dump` backup prod xong, kiểm đọc được
- [ ] `migrate status` prod — đối chiếu mục 4, quyết QuoteGroup (a/b)
- [ ] ENV prod đủ (mục 2.3); `NEXT_PUBLIC_FF_BOM_CASCADE=true` lúc build; `NEXT_PUBLIC_FF_REVISE_FLOW=true` nếu bật Revise Flow36; `FF_PR_MATERIALIZE` theo nhu cầu
- [ ] `migrate deploy` (KHÔNG reset) — xử QuoteGroup/add_wo_re_qc/**add_task_revision_fields** bằng `resolve` nếu cần
- [ ] (nếu bật revise) chạy `scripts/revise-readiness-check.ts` — nắm dự án đủ điều kiện vs legacy
- [ ] build + deploy container
- [ ] smoke test **12 mục** (mục 6) — 9 nền + 3 Revise (#10–12, chỉ khi bật `NEXT_PUBLIC_FF_REVISE_FLOW`)
- [ ] (sau) F3 backfill: UAT dry-run→duyệt→apply, rồi prod dry-run→duyệt→apply
