// Tên và khoá của "hạng mục" trong bảng đơn giá khoán và báo cáo khoán.
//
// Để riêng khỏi apl-pricing.ts vì các trang dashboard (chạy ở trình duyệt) cũng cần đọc —
// apl-pricing kéo theo Prisma nên không nhập được vào client.

/**
 * Khoá của "hạng mục" gom mọi lệnh giao cho CẢ DỰ ÁN (Pha cắt).
 *
 * Lệnh loại này cố tình không gắn hạng mục nào — nó chuẩn bị vật tư cho toàn bộ dự án. Nhưng
 * bảng đơn giá và báo cáo khoán đều xếp theo hạng mục, nên phải có một khoá để nó đứng riêng.
 * Không dùng chuỗi rỗng: chuỗi rỗng đã là hạng mục "(không có ITEM)" của các bản APL cũ.
 */
export const ITEM_CA_DU_AN = '::CA_DU_AN::'

/** Tên hiển thị của một khoá hạng mục — khoá cả dự án có tên riêng, không phải mã ITEM. */
export function tenHangMuc(item: string | null | undefined): string {
  if (item === ITEM_CA_DU_AN) return 'Pha cắt — cả dự án'
  return item || '(không có ITEM)'
}
