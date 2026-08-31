import prisma from './db'

// Sửa dữ liệu cho các bản APL nhập TRƯỚC khi có cột item / block_no / rollup_*.
//
// Không phải nhập lại file: mọi thứ đều suy ra được từ chính các dòng đã lưu —
//   • ITEM      : hồi đó rơi vào cột `extra` (khoá "item") vì chưa là cột riêng
//   • block_no  : đếm dồn số dòng vàng theo thứ tự row_no
//   • rollup_*  : cộng các dòng trắng trong cùng khối
// Làm THẲNG bằng SQL để không phải kéo 25.000 dòng lên Node rồi ghi ngược từng dòng.
// Idempotent: chạy lại nhiều lần cho cùng kết quả.

export interface AplRepairResult {
  lines: number
  heads: number
  itemsFilled: number
  reclassified: number
  blocksNumbered: number
  headsRolled: number
}

/**
 * Bản APL này có cần sửa không. Hai đời dữ liệu cũ đều cần:
 *  - nhập trước khi có phần gộp khối → block_no toàn 0
 *  - nhập khi luật nhận dòng cụm còn sai (chỉ xét PART, chưa xét POS) → dòng hàng mua có POS
 *    nhưng trống PART bị đánh nhầm thành dòng cụm
 */
export async function aplNeedsRepair(importId: string): Promise<boolean> {
  const [lines, numbered, misflagged] = await Promise.all([
    prisma.aplLine.count({ where: { importId } }),
    prisma.aplLine.count({ where: { importId, blockNo: { gt: 0 } } }),
    prisma.aplLine.count({ where: { importId, isAssembly: true, pos: { not: null } } }),
  ])
  return lines > 0 && (numbered === 0 || misflagged > 0)
}

export async function repairAplImport(importId: string): Promise<AplRepairResult> {
  // 1) ITEM: lấy lại từ `extra` (khoá "item"), chỉ điền vào dòng đang trống
  const itemsFilled = await prisma.$executeRaw`
    UPDATE "apl_lines"
    SET "item" = NULLIF(TRIM("extra" ->> 'item'), '')
    WHERE "import_id" = ${importId}
      AND "item" IS NULL
      AND "extra" ? 'item'`

  // 2) Đánh lại cờ DÒNG CỤM theo đúng luật hiện hành: trống CẢ PART lẫn POS.
  //    Bản nhập cũ chỉ xét PART nên dòng hàng mua (ghi mã ở POS) bị coi nhầm là dòng cụm.
  const reclassified = await prisma.$executeRaw`
    UPDATE "apl_lines"
    SET "is_assembly" = ("part" IS NULL AND "pos" IS NULL)
    WHERE "import_id" = ${importId}
      AND "is_assembly" IS DISTINCT FROM ("part" IS NULL AND "pos" IS NULL)`

  // 3) block_no: dòng cụm mở khối mới; dòng chi tiết theo khối gần nhất phía trên
  const blocksNumbered = await prisma.$executeRaw`
    UPDATE "apl_lines" l
    SET "block_no" = b.blk
    FROM (
      SELECT "id",
             SUM(CASE WHEN "is_assembly" THEN 1 ELSE 0 END)
               OVER (ORDER BY "row_no" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS blk
      FROM "apl_lines"
      WHERE "import_id" = ${importId}
    ) b
    WHERE l."id" = b."id" AND l."block_no" IS DISTINCT FROM b.blk`

  // 4) Gộp về dòng cụm — khớp đúng luật của parser:
  //    có dòng trắng  → khối lượng = tổng dòng trắng, vật tư = tên vật liệu của dòng trắng
  //    không có dòng trắng (hàng mua) → lấy chính ô của nó
  // Vật tư giữ ĐÚNG THỨ TỰ GẶP trong file (SS400 rồi A307), không sắp a-b-c: phải giống hệt
  // parser lúc nhập mới, nếu không cùng một dòng lại hiện hai kiểu tuỳ nhập mới hay vá lại.
  const headsRolled = await prisma.$executeRaw`
    WITH mat AS (
      SELECT "block_no", TRIM(CONCAT_WS(' ', NULLIF(TRIM("profile"), ''), NULLIF(TRIM("grade"), ''))) AS label, MIN("row_no") AS first_row
      FROM "apl_lines"
      WHERE "import_id" = ${importId} AND NOT "is_assembly"
        AND COALESCE(NULLIF(TRIM("profile"), ''), NULLIF(TRIM("grade"), '')) IS NOT NULL
      GROUP BY "block_no", 2
    ), mats AS (
      SELECT "block_no", ARRAY_AGG(label ORDER BY first_row) AS arr FROM mat GROUP BY "block_no"
    ), agg AS (
      SELECT "block_no",
             COUNT(*) FILTER (WHERE NOT "is_assembly")               AS n,
             SUM("total_weight_kg") FILTER (WHERE NOT "is_assembly") AS w
      FROM "apl_lines"
      WHERE "import_id" = ${importId}
      GROUP BY "block_no"
    )
    UPDATE "apl_lines" l
    SET "child_count"      = agg.n,
        "rollup_weight_kg" = CASE WHEN agg.n > 0 THEN agg.w ELSE l."total_weight_kg" END,
        "rollup_materials" = CASE
          WHEN agg.n > 0 THEN to_jsonb(COALESCE(mats.arr, ARRAY[]::text[]))
          WHEN COALESCE(NULLIF(TRIM(l."profile"), ''), l."grade") IS NOT NULL
            THEN to_jsonb(ARRAY[TRIM(CONCAT_WS(' ', NULLIF(TRIM(l."profile"), ''), NULLIF(TRIM(l."grade"), '')))])
          ELSE '[]'::jsonb END
    FROM agg LEFT JOIN mats ON mats."block_no" = agg."block_no"
    WHERE l."import_id" = ${importId} AND l."is_assembly" AND l."block_no" = agg."block_no"`

  const [lines, heads] = await Promise.all([
    prisma.aplLine.count({ where: { importId } }),
    prisma.aplLine.count({ where: { importId, isAssembly: true } }),
  ])
  return { lines, heads, itemsFilled, reclassified, blocksNumbered, headsRolled }
}
