# DESIGN SPEC — Fixes từ QA prod (neo Design System v3)
**Ngày:** 2026-06-28 · **Nguồn:** Claude Design, từ `DESIGN_QA_PROD_2026-06-28.md` · **Cho:** VS Code áp thẳng, không vẽ lại màn.
**Thứ tự áp:** nút + chip trước (token-level, rộng nhất) → icon → empty-state.

## 1 · Chip / tab filter ACTIVE (bỏ khối tô thô)
- **Active**: nền ink `#17191D` + chữ trắng + viền ink.
- **Mặc định**: nền trắng + chữ `#5B6068` + viền `#E2E4E8`.
- **Hover**: nền `#F4F5F7`.
- Bo góc 8px, hit ≥32px. **Không dùng đỏ cho chip** (đỏ chỉ dành CTA).

## 2 · Icon thay Emoji (bộ Lucide duy nhất, stroke 1.5px, `currentColor`, size 16/18/20/44px theo ngữ cảnh)
| Emoji | Lucide | Ghi chú |
|------|--------|---------|
| ✅ | `check-circle-2` | |
| 📋 | `clipboard-list` | |
| 🔥 | `alert-triangle` | màu đỏ |
| ✂ | `scissors` | |
| 🚚 | `truck` | |
| 📦 | `package` | |
| 🦺 | `hard-hat` | màu đỏ |
| ∞ | (giữ ký tự, class `.mono`) | |
| 👋 | bỏ | |

## 3 · Thang nút (5 cấp cố định)
- **Primary** — đỏ IBS (Tạo / Lưu / CTA chính).
- **Secondary** — trắng + viền (Hủy).
- **Success** — xanh (Hoàn thành bước / Duyệt).
- **Danger** — viền đỏ (Xóa / Trả lại / NCR).
- **Ghost / info** — phụ.
- Quy tắc: **một primary mỗi vùng**. Trong modal: **Lưu = primary (phải), Hủy = secondary (trái)**. Đỏ chỉ dùng cho primary/escalate.

## 4 · Empty-state (1 mẫu, gói component `<EmptyState>`)
- Cấu trúc: icon outline xám 44px + tiêu đề + mô tả + CTA (CTA ẩn theo RBAC).
- **Tách 2 loại**: trống thật (CTA tạo mới) vs lọc rỗng (icon `search-x` + nút "Xóa lọc").
- Kèm CSS `.empty`, dùng lại toàn hệ.
