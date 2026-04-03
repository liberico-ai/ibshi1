// ── File Accept Presets ──
// Centralized MIME/extension groups for all AttachmentSlot configs.
// Add new formats HERE — step-form-configs.ts will inherit automatically.

// ⚠️ ROOT CAUSE FIX:
// macOS file picker (Safari/Chrome on Mac) grays out files when only
// dot-extensions (.zip) are given. It needs MIME types to identify files.
// Always include both: extension + MIME type for non-standard formats.

const ARCH_EXT  = '.zip,.rar'
const ARCH_MIME = 'application/zip,application/x-zip-compressed,application/vnd.rar,application/x-rar-compressed,application/octet-stream'

export const ACCEPT = {
  // ── Atomic groups ──────────────────────────────────────────────────
  /** PDF + Word documents */
  DOCS:         '.pdf,.doc,.docx',

  /** Excel + CSV spreadsheets */
  SHEETS:       '.xlsx,.xls,.csv',

  /** Technical drawings: PDF, AutoCAD, DXF */
  DRAWING:      '.pdf,.dwg,.dxf',

  /** Raster images */
  IMAGE:        '.jpg,.jpeg,.png',

  /** Presentation files */
  PRESENTATION: '.pptx,.ppt',

  /**
   * Compressed archives — ZIP + RAR.
   * Includes MIME types so macOS file picker does NOT gray out archives.
   * ZIP MIME: application/zip, application/x-zip-compressed
   * RAR MIME: application/vnd.rar, application/x-rar-compressed
   */
  ARCHIVE: `${ARCH_EXT},${ARCH_MIME}`,

  // ── Compound presets ───────────────────────────────────────────────
  /**
   * Documents + archives (ZIP/RAR).
   * Use when: hợp đồng, PO, biên bản — có thể kèm phụ lục nén.
   */
  DOCS_PLUS: `.pdf,.doc,.docx,${ARCH_EXT},${ARCH_MIME}`,

  /**
   * Spreadsheets + archives (ZIP/RAR).
   * Use when: bảng tính BOM, dự toán, báo cáo — có thể gửi gói nhiều sheet.
   */
  SHEETS_PLUS: `.xlsx,.xls,.csv,${ARCH_EXT},${ARCH_MIME}`,

  /**
   * Technical drawings + archives (ZIP/RAR).
   * Use when: bản vẽ kỹ thuật, drawing package từ Tekla/AutoCAD — thường rất nhiều file.
   */
  DRAWING_PLUS: `.pdf,.dwg,.dxf,${ARCH_EXT},${ARCH_MIME}`,

  /**
   * Office docs + spreadsheets + archives (ZIP/RAR).
   * Use when: tài liệu đa dạng (RFQ, PO, spec, hợp đồng).
   */
  OFFICE_ARCHIVE: `.pdf,.doc,.docx,.xlsx,.xls,${ARCH_EXT},${ARCH_MIME}`,

  /**
   * Documents + images (PDF, Word, JPG, PNG).
   * Use when: chứng từ thanh toán, biên bản — có thể là ảnh chụp hoặc scan.
   */
  DOCS_IMAGE: '.pdf,.doc,.docx,.jpg,.jpeg,.png',

  /**
   * Full lesson-learned / handover package.
   * Use when: tài liệu bàn giao dự án, lesson learned, kickoff pack.
   */
  LESSON_PACK: `.pdf,.docx,.xlsx,.pptx,${ARCH_EXT},${ARCH_MIME}`,
} as const

export type AcceptPreset = typeof ACCEPT[keyof typeof ACCEPT]
