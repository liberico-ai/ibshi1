# Deploy prod — Luồng CÔNG ĐOẠN (09/2026)

Làm lần lượt từ trên xuống. Mỗi bước có cách kiểm tra ngay bên dưới.

---

## Đang có chuyện gì

Lần deploy trước đổ giữa chừng nên prod đang kẹt: Prisma báo `Error: P3009` và không chịu
chạy thêm migration nào.

Nguyên nhân là **tên thư mục migration đặt sai thứ tự**. Prisma chạy migration theo thứ tự
chữ cái của tên thư mục, mà chữ số sắp trước chữ cái — nên đợt mới (`20260901...`) chạy
TRƯỚC `add_apl_import`, tạo khoá ngoại trỏ vào bảng `apl_imports` chưa tồn tại.

Sau đó dùng `prisma migrate resolve --applied` để gỡ kẹt, nhưng **lệnh đó chỉ ghi "đã xong"
vào sổ chứ không chạy SQL** — nên bảng vẫn không được tạo, và migration sau lại đổ tiếp.

Đã sửa trong repo: 9 migration đổi tên sang `z2026...` để chạy **sau** toàn bộ migration cũ.
Việc còn lại là dọn sổ trên prod rồi chạy lại.

Toàn bộ 9 migration chỉ **thêm** bảng/cột, không xoá và không sửa dữ liệu đang có. Câu lệnh
nào cũng có `IF NOT EXISTS`, nên chạy lại trên phần đã tạo cũng không hỏng gì.

---

## Bước 1 · Sao lưu database

Bước này bắt buộc — các bước sau có động vào bảng `_prisma_migrations`.

```bash
pg_dump -Fc -d "<DATABASE_URL của prod>" -f backup-truoc-cong-doan-$(date +%F).dump
```

---

## Bước 2 · Dọn sổ migration trên prod

Lần chạy hụt để lại 9 dòng mang **tên cũ**. Một số đang bị đánh dấu "đã xong" trong khi SQL
chưa hề chạy — dạng này nguy hơn dòng báo hỏng, vì Prisma bỏ qua vĩnh viễn mà không báo gì.

Tên cũ không còn trong repo nên `prisma migrate resolve` không nhận, phải xoá thẳng.

```sql
-- 2a. Xem trước cho chắc
SELECT migration_name, started_at, finished_at
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260901000000_add_apl_item_workshop_price',
  '20260902000000_add_wo_unit',
  '20260903000000_add_work_order_stage',
  '20260904000000_add_stage_category',
  '20260905000000_add_jobcard_stage',
  '20260905010000_add_itp_stage',
  '20260905020000_add_stage_qc_invite',
  '20260905030000_add_checkpoint_stage',
  '20260907000000_add_stage_price')
ORDER BY started_at;

-- 2b. Xoá sạch 9 dòng tên cũ
DELETE FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260901000000_add_apl_item_workshop_price',
  '20260902000000_add_wo_unit',
  '20260903000000_add_work_order_stage',
  '20260904000000_add_stage_category',
  '20260905000000_add_jobcard_stage',
  '20260905010000_add_itp_stage',
  '20260905020000_add_stage_qc_invite',
  '20260905030000_add_checkpoint_stage',
  '20260907000000_add_stage_price');
```

**Kiểm tra:** chạy lại 2a, phải trả về **0 dòng**.

---

## Bước 3 · Lấy code mới và xem prod còn thiếu gì

```bash
git pull
npm ci
npx prisma migrate status
```

Lệnh cuối liệt kê những migration prod chưa chạy.

> **Gửi lại kết quả `migrate status` này trước khi sang bước 4.** Prod thiếu tới cả
> `add_apl_import` là dấu hiệu nó tụt lại khá xa; cần biết thiếu bao nhiêu trước khi chạy
> một loạt migration lên môi trường thật.

---

## Bước 4 · Chạy migration

```bash
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart ibs-erp        # hoặc lệnh restart đang dùng
```

> **Không được bỏ `npx prisma generate`.** Prisma Client sinh sẵn từ schema; không sinh lại
> thì server vẫn chạy code cũ và báo *"Tính năng này cần bảng dữ liệu mới chưa có trong CSDL"*
> dù SQL đã chạy xong.

> **Không dùng `prisma migrate resolve --applied`** để gỡ nếu có lỗi. Lệnh đó chỉ ghi sổ chứ
> không chạy SQL — chính nó gây ra lỗi lần trước. Có lỗi thì gửi nguyên văn lỗi.

---

## Bước 5 · Kiểm tra sau khi chạy

### Trên database — cả 3 câu phải đúng

```sql
-- 1) Hai bảng mới — phải trả về 2 dòng
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('work_order_stages', 'apl_item_workshop_prices');

-- 2) Cột mới — phải trả về 6 dòng
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'work_orders'              AND column_name = 'unit')
   OR (table_name = 'job_cards'                AND column_name = 'stage_id')
   OR (table_name = 'inspection_test_plans'    AND column_name = 'stage_id')
   OR (table_name = 'itp_checkpoints'          AND column_name = 'stage_id')
   OR (table_name = 'itp_checkpoints'          AND column_name = 'accepted_qty')
   OR (table_name = 'apl_item_workshop_prices' AND column_name = 'stage_code');

-- 3) Cột mời nghiệm thu — phải trả về 3 dòng
SELECT column_name FROM information_schema.columns
WHERE table_name = 'work_order_stages'
  AND column_name IN ('qc_invited_qty', 'qc_invited_at', 'qc_invited_by');
```

### Trên giao diện

1. **Sản xuất → Tạo WO từ APL** — chọn dự án, chọn ITEM, thêm được dòng "+ Công đoạn"
   (không còn báo *"Tính năng này cần bảng dữ liệu mới chưa có trong CSDL"*)
2. **Phiếu Công Việc → + Nhập KL** — chọn lệnh có công đoạn thì hiện bảng nhập theo từng công đoạn
3. **Sản xuất → mở một lệnh** — bảng "Công đoạn" có nút *Mời nghiệm thu* ở cuối mỗi dòng
4. **Kế hoạch KT → + Tạo ITP** — chọn lệnh, thấy dòng *"ITP này sẽ có N dòng — mỗi công đoạn một dòng"*
5. **Lương khoán APL** — xổ hạng mục ra, ô đơn giá nằm ở dòng công đoạn

---

## Sau khi deploy xong · việc của KTKH

**Đơn giá khoán phải nhập lại theo công đoạn.**

Đơn giá cũ vẫn còn nguyên nhưng mang nghĩa "giá cho cả lệnh" (`stage_code = ''`). Lệnh nào
được chia công đoạn thì ô đơn giá hiện trống.

Không chuyển đổi tự động được: chia đơn giá cũ cho các công đoạn là bịa số, còn gán nguyên
đơn giá cũ cho mọi công đoạn thì tiền bị nhân lên theo số công đoạn.

Xem đơn giá cũ còn lại:

```sql
SELECT "item", "team_code", "stage_code", "unit_price"
FROM "apl_item_workshop_prices"
WHERE "stage_code" = ''
ORDER BY "item", "team_code";
```

### Dữ liệu cũ không cần đụng vào

| Dữ liệu cũ | Sau khi deploy |
|---|---|
| Lệnh chưa chia công đoạn | Chạy y như cũ, mọi con số giữ nguyên |
| Phiếu công việc cũ (`stage_id` NULL) | Tính cho MỌI công đoạn nếu lệnh được chia sau này — không tụt về 0 |
| ITP cũ (điểm kiểm không có `stage_id`) | Vẫn tính theo cách cũ: đủ chữ ký ở mọi điểm kiểm thì ghi nhận |
| Đơn giá xưởng cũ | Thành giá cho cả lệnh, vẫn dùng được với lệnh nguyên khối |

---

## Nếu phải quay lại bản cũ

Code cũ **không đọc** các cột mới, nên chỉ cần deploy lại bản build cũ — không phải gỡ cột nào.
Bảng `work_order_stages` và các cột `stage_id` cứ để nguyên.

Chỉ một chỗ cần biết: đơn giá nhập theo công đoạn sẽ không hiện trên bản cũ (bản cũ chỉ đọc
dòng `stage_code = ''`). Dữ liệu vẫn còn nguyên, deploy lại bản mới là thấy.

---

# Phụ lục · SQL riêng của đợt này

**Chỉ dùng khi không chạy được `prisma migrate deploy`.** Bình thường làm theo bước 4 là đủ.

Khối này là phần RIÊNG của 9 migration đợt công đoạn, **không bao gồm** các migration cũ.
Prod còn thiếu migration cũ thì nó đổ ngay ở khoá ngoại.

Kiểm trước — **cả 5 ô phải khác `NULL`**, có ô `NULL` thì dừng, quay về bước 3:

```sql
SELECT to_regclass('public.apl_imports')           AS apl_imports,
       to_regclass('public.work_orders')           AS work_orders,
       to_regclass('public.job_cards')             AS job_cards,
       to_regclass('public.inspection_test_plans') AS itp,
       to_regclass('public.itp_checkpoints')       AS itp_checkpoints;
```

Đủ 5 ô rồi thì chạy khối dưới đây một lần:

```sql
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1/9 · Đơn giá khoán theo từng XƯỞNG trong một ITEM của APL
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "apl_item_workshop_prices" (
  "id"         TEXT NOT NULL,
  "import_id"  TEXT NOT NULL,
  "item"       TEXT NOT NULL,
  "team_code"  TEXT NOT NULL,
  "unit_price" DECIMAL(65,30) NOT NULL,
  "note"       TEXT,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "apl_item_workshop_prices_pkey" PRIMARY KEY ("id")
);

-- Khoá duy nhất của bảng này được tạo ở bước 9/9 (đã kèm stage_code) — không tạo bản cũ
-- ở đây, để cả khối SQL chạy lại lần hai vẫn không lỗi.

DO $$ BEGIN
  ALTER TABLE "apl_item_workshop_prices"
    ADD CONSTRAINT "apl_item_workshop_prices_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "apl_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2/9 · Đơn vị đo của lệnh sản xuất
-- Pha cắt/hàn tính kg, sơn tính m², lắp đặt tính mét. Dữ liệu cũ đều là kg.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'kg';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3/9 · Bảng CÔNG ĐOẠN bên trong lệnh sản xuất
-- Mỗi công đoạn chạy qua TRỌN khối lượng của lệnh (không chia nhỏ để cộng lại).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "work_order_stages" (
  "id"            TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "qty"           DECIMAL(65,30) NOT NULL,
  "unit"          TEXT NOT NULL DEFAULT 'kg',
  "sort_order"    INTEGER NOT NULL DEFAULT 0,
  "note"          TEXT,
  "created_by"    TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "work_order_stages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_stages_work_order_id_idx"
  ON "work_order_stages" ("work_order_id");

DO $$ BEGIN
  ALTER TABLE "work_order_stages"
    ADD CONSTRAINT "work_order_stages_work_order_id_fkey"
    FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4/9 · Mã công đoạn + chủng loại (lấy từ danh mục công việc)
-- Lưu cả mã lẫn nhãn: mã để đối chiếu chứng từ, nhãn để báo cáo cũ vẫn đọc được.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "stage_code"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "category_code" TEXT;
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "category"      TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5/9 · Phiếu công việc gắn với MỘT công đoạn
-- NULL = phiếu cũ, hoặc lệnh chạy nguyên khối. Phiếu cũ vẫn chạy bình thường.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "stage_id" TEXT;

CREATE INDEX IF NOT EXISTS "job_cards_stage_id_idx" ON "job_cards"("stage_id");

DO $$ BEGIN
  ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "work_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6/9 · ITP gắn công đoạn (giữ cho tương thích; số thật nằm ở từng điểm kiểm — xem 8/9)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "inspection_test_plans" ADD COLUMN IF NOT EXISTS "stage_id" TEXT;

CREATE INDEX IF NOT EXISTS "inspection_test_plans_stage_id_idx" ON "inspection_test_plans"("stage_id");

DO $$ BEGIN
  ALTER TABLE "inspection_test_plans" ADD CONSTRAINT "inspection_test_plans_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "work_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7/9 · Mời nghiệm thu theo TỪNG công đoạn (trước đây mời ở cấp lệnh)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qc_invited_qty" DECIMAL(65,30);
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qc_invited_at"  TIMESTAMP(3);
ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qc_invited_by"  TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8/9 · Một ITP cho cả lệnh, bên trong MỖI công đoạn một dòng
-- Mỗi dòng mang khối lượng riêng và cặp chữ ký riêng (QAQC + PM ký từng dòng).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "itp_checkpoints" ADD COLUMN IF NOT EXISTS "stage_id"     TEXT;
ALTER TABLE "itp_checkpoints" ADD COLUMN IF NOT EXISTS "accepted_qty" DECIMAL(65,30);

CREATE INDEX IF NOT EXISTS "itp_checkpoints_stage_id_idx" ON "itp_checkpoints"("stage_id");

DO $$ BEGIN
  ALTER TABLE "itp_checkpoints" ADD CONSTRAINT "itp_checkpoints_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "work_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9/9 · Đơn giá khoán đặt theo CÔNG ĐOẠN (thay cho đặt theo cả hạng mục)
-- Đây là bước DUY NHẤT có đổi ràng buộc: khoá duy nhất thêm stage_code.
-- Đơn giá cũ được gán stage_code = '' (giá cho cả lệnh) nên không mất dữ liệu.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "apl_item_workshop_prices" ADD COLUMN IF NOT EXISTS "stage_code" TEXT NOT NULL DEFAULT '';

ALTER TABLE "apl_item_workshop_prices" DROP CONSTRAINT IF EXISTS "apl_item_workshop_prices_import_id_item_team_code_key";
DROP INDEX IF EXISTS "apl_item_workshop_prices_import_id_item_team_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "apl_item_workshop_prices_import_id_item_team_code_stage_code_key"
  ON "apl_item_workshop_prices"("import_id", "item", "team_code", "stage_code");

COMMIT;
```

Chạy xong, ghi vào sổ để lần sau Prisma không chạy lại — **chỉ chạy khi khối SQL trên đã xong
và không lỗi**:

```bash
npx prisma migrate resolve --applied z20260901_add_apl_item_workshop_price
npx prisma migrate resolve --applied z20260902_add_wo_unit
npx prisma migrate resolve --applied z20260903_add_work_order_stage
npx prisma migrate resolve --applied z20260904_add_stage_category
npx prisma migrate resolve --applied z20260905a_add_jobcard_stage
npx prisma migrate resolve --applied z20260905b_add_itp_stage
npx prisma migrate resolve --applied z20260905c_add_stage_qc_invite
npx prisma migrate resolve --applied z20260905d_add_checkpoint_stage
npx prisma migrate resolve --applied z20260907_add_stage_price
```

Rồi vẫn phải `npx prisma generate` + `npm run build` + restart như bước 4.

---

# Phụ lục · 9 migration gồm những gì

| # | Migration | Nội dung |
|---|---|---|
| 1 | `z20260901_add_apl_item_workshop_price` | Bảng đơn giá khoán theo xưởng trong một ITEM |
| 2 | `z20260902_add_wo_unit` | Đơn vị đo của lệnh (kg, m², mét) |
| 3 | `z20260903_add_work_order_stage` | Bảng CÔNG ĐOẠN bên trong lệnh |
| 4 | `z20260904_add_stage_category` | Mã công đoạn + chủng loại theo danh mục công việc |
| 5 | `z20260905a_add_jobcard_stage` | Phiếu công việc gắn với một công đoạn |
| 6 | `z20260905b_add_itp_stage` | ITP gắn công đoạn (giữ cho tương thích) |
| 7 | `z20260905c_add_stage_qc_invite` | Mời nghiệm thu theo từng công đoạn |
| 8 | `z20260905d_add_checkpoint_stage` | Mỗi công đoạn là một dòng trong ITP, ký riêng |
| 9 | `z20260907_add_stage_price` | Đơn giá khoán đặt theo công đoạn |

Tên bắt đầu bằng `z` là **cố ý**: Prisma chạy theo thứ tự chữ cái, repo có sẵn nhiều migration
tên `add_*` / `fix_*`. Đặt tên bắt đầu bằng chữ số thì đợt này chạy trước migration cũ và đổ
ở khoá ngoại — đã dính lỗi này một lần.
