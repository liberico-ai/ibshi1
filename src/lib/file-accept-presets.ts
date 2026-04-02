// ── File Accept Presets ──
// Centralized MIME/extension groups for all AttachmentSlot configs.
// Add new formats HERE — step-form-configs.ts will inherit automatically.

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

  /** Compressed archives (ZIP + RAR) */
  ARCHIVE:      '.zip,.rar',

  // ── Compound presets ───────────────────────────────────────────────
  /**
   * Documents + archives.
   * Use when: hợp đồng, PO, biên bản — có thể kèm phụ lục nén.
   */
  DOCS_PLUS:      '.pdf,.doc,.docx,.zip,.rar',

  /**
   * Spreadsheets + archives.
   * Use when: bảng tính BOM, dự toán, báo cáo — có thể gửi gói nhiều sheet.
   */
  SHEETS_PLUS:    '.xlsx,.xls,.csv,.zip,.rar',

  /**
   * Technical drawings + archives.
   * Use when: bản vẽ kỹ thuật, drawing package từ Tekla/AutoCAD — thường rất nhiều file.
   */
  DRAWING_PLUS:   '.pdf,.dwg,.dxf,.zip,.rar',

  /**
   * Office docs + spreadsheets + archives.
   * Use when: tài liệu đa dạng (RFQ, PO, spec, hợp đồng).
   */
  OFFICE_ARCHIVE: '.pdf,.doc,.docx,.xlsx,.xls,.zip,.rar',

  /**
   * Full lesson-learned / handover package.
   * Use when: tài liệu bàn giao dự án, lesson learned, kickoff pack.
   */
  LESSON_PACK:    '.pdf,.docx,.xlsx,.pptx,.zip,.rar',
} as const

export type AcceptPreset = typeof ACCEPT[keyof typeof ACCEPT]
