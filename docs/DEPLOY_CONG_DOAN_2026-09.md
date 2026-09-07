# Hướng dẫn deploy — Luồng CÔNG ĐOẠN (09/2026)

Đợt này thêm **công đoạn** vào lệnh sản xuất, chạy suốt từ lúc PM giao việc → xưởng báo khối
lượng → mời nghiệm thu → QAQC/PM ký → tính tiền khoán.

**9 migration, tất cả đều chỉ THÊM cột/bảng — không xoá, không sửa dữ liệu đang có.**
Riêng migration cuối có đổi một ràng buộc duy nhất (nêu rõ ở mục 3).

Tên 9 migration đều bắt đầu bằng `z` là **cố ý**: Prisma chạy theo thứ tự chữ cái của tên thư
mục, và repo đang có sẵn nhiều migration tên `add_*` / `fix_*`. Đặt tên bắt đầu bằng chữ số
thì đợt này chạy TRƯỚC các migration cũ và đổ ngay ở khoá ngoại — đã dính lỗi này một lần
(xem mục 0).

---

## 0. Nếu đang kẹt lỗi P3009 (đã chạy hụt một lần)

Bản đẩy lần đầu đặt tên migration sai thứ tự: Prisma chạy theo **thứ tự chữ cái** của tên thư
mục, mà chữ số đứng trước chữ cái — nên `20260901000000_add_apl_item_workshop_price` chạy
TRƯỚC `add_apl_import`, tạo khoá ngoại trỏ vào bảng `apl_imports` chưa tồn tại:

```
ERROR: relation "apl_imports" does not exist
```

Đã sửa: 9 migration đổi tên thành `z2026...` để chạy **sau** toàn bộ migration cũ.

Prisma chạy mỗi migration trong một transaction nên lần hỏng đó **không để lại gì trong CSDL** —
chỉ để lại một dòng đánh dấu "đã hỏng" khiến Prisma không cho chạy tiếp. Gỡ như sau:

```sql
-- 1. Xem cho chắc: dòng này phải có finished_at = NULL (hỏng, chưa xong)
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name = '20260901000000_add_apl_item_workshop_price';

-- 2. Bảng của migration đó phải KHÔNG tồn tại (transaction đã cuốn lại)
--    Nếu có tồn tại cũng không sao: SQL mới dùng IF NOT EXISTS.
SELECT to_regclass('public.apl_item_workshop_prices');

-- 3. Xoá dòng đánh dấu hỏng. Tên cũ này không còn trong repo nữa nên
--    `prisma migrate resolve` sẽ báo không tìm thấy — phải xoá thẳng.
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260901000000_add_apl_item_workshop_price'
  AND finished_at IS NULL;
```

Xong bước 3 thì `git pull` rồi chạy tiếp **mục 1** như bình thường.

---

## 1. Cách chạy — chọn MỘT trong hai

### Cách A (khuyến nghị): để Prisma tự chạy

```bash
git pull
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart ibs-erp      # hoặc lệnh restart đang dùng
```

> **Bắt buộc `npx prisma generate` rồi mới restart.** Prisma Client sinh sẵn từ schema; không
> sinh lại thì server vẫn chạy code cũ và báo *"Tính năng này cần bảng dữ liệu mới chưa có
> trong CSDL"* dù SQL đã chạy xong.

### Cách B: chạy tay SQL

Nếu không chạy `migrate deploy` được thì lấy nguyên khối SQL ở **mục 2**, chạy một lần trên
database `ibshi` của prod. Chạy xong vẫn phải `npx prisma generate` + build + restart.

Sau khi chạy tay, đánh dấu cho Prisma biết là đã xong để lần sau không chạy lại:

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

---

## 2. Toàn bộ SQL

Chạy **đúng thứ tự dưới đây** — các bảng sau tham chiếu bảng trước. Mọi câu đều có
`IF NOT EXISTS` / bẫy trùng nên chạy lại lần hai không hỏng gì.

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

---

## 3. Việc phải làm sau khi deploy

### 3.1 Nhập lại đơn giá khoán theo công đoạn

Đơn giá cũ đang là **giá cho cả lệnh** (`stage_code = ''`). Lệnh nào được chia công đoạn thì
các ô đơn giá sẽ hiện trống — **KTKH phải nhập lại theo từng công đoạn**.

Không có cách chuyển đổi tự động: chia một đơn giá chung cho các công đoạn là bịa số, mà
gán nguyên đơn giá cũ cho mọi công đoạn thì tiền bị nhân lên theo số công đoạn.

Xem đơn giá cũ còn lại:

```sql
SELECT p."item", p."team_code", p."stage_code", p."unit_price"
FROM "apl_item_workshop_prices" p
WHERE p."stage_code" = ''
ORDER BY p."item", p."team_code";
```

### 3.2 Dữ liệu cũ không cần đụng vào

| Dữ liệu cũ | Sau khi deploy |
|---|---|
| Lệnh chưa chia công đoạn | Chạy y như cũ, mọi con số giữ nguyên |
| Phiếu công việc cũ (`stage_id` NULL) | Tính cho MỌI công đoạn nếu lệnh được chia sau này — không tụt về 0 |
| ITP cũ (điểm kiểm không có `stage_id`) | Vẫn tính theo cách cũ: đủ chữ ký ở mọi điểm kiểm thì ghi nhận |
| Đơn giá xưởng cũ | Thành giá cho cả lệnh (`stage_code = ''`), vẫn dùng được với lệnh nguyên khối |

---

## 4. Kiểm tra sau khi chạy

```sql
-- Phải trả về đủ 6 dòng
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'work_orders'            AND column_name = 'unit')
   OR (table_name = 'job_cards'              AND column_name = 'stage_id')
   OR (table_name = 'inspection_test_plans'  AND column_name = 'stage_id')
   OR (table_name = 'itp_checkpoints'        AND column_name = 'stage_id')
   OR (table_name = 'itp_checkpoints'        AND column_name = 'accepted_qty')
   OR (table_name = 'apl_item_workshop_prices' AND column_name = 'stage_code');

-- Phải trả về 2 bảng
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('work_order_stages', 'apl_item_workshop_prices');

-- Cột mời nghiệm thu — phải trả về 3 dòng
SELECT column_name FROM information_schema.columns
WHERE table_name = 'work_order_stages'
  AND column_name IN ('qc_invited_qty', 'qc_invited_at', 'qc_invited_by');
```

Trên giao diện, kiểm nhanh theo thứ tự này:

1. **Sản xuất → Tạo WO từ APL** — chọn dự án, chọn ITEM, thêm được dòng "+ Công đoạn"
   (không còn báo *"Tính năng này cần bảng dữ liệu mới chưa có trong CSDL"*)
2. **Phiếu Công Việc → + Nhập KL** — chọn lệnh có công đoạn thì hiện bảng nhập theo từng công đoạn
3. **Sản xuất → mở lệnh** — bảng "Công đoạn" có nút *Mời nghiệm thu* ở cuối mỗi dòng
4. **Kế hoạch KT → + Tạo ITP** — chọn lệnh, thấy dòng *"ITP này sẽ có N dòng — mỗi công đoạn một dòng"*
5. **Lương khoán APL** — xổ hạng mục ra, ô đơn giá nằm ở dòng công đoạn (không còn ở dòng hạng mục)

---

## 5. Nếu phải quay lại bản cũ

Code cũ **không đọc** các cột mới, nên chỉ cần deploy lại bản build cũ là chạy được — không
phải gỡ cột nào. Bảng `work_order_stages` và các cột `stage_id` cứ để nguyên đó.

Chỉ một chỗ cần biết: đơn giá khoán nhập theo công đoạn sẽ **không hiện** trên bản cũ (bản cũ
chỉ đọc dòng có `stage_code = ''`). Dữ liệu vẫn còn nguyên trong bảng, deploy lại bản mới là thấy.
