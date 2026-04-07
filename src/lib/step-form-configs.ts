// ── Task Step Form Configuration Registry ──
// Maps each workflow step to its form fields, checklist items, and attachments

import { ACCEPT } from './file-accept-presets'

export interface FormField {
  key: string
  label: string
  labelEn: string
  type: 'text' | 'number' | 'textarea' | 'date' | 'select' | 'radio' | 'file' | 'readonly' | 'currency' | 'section'
  required?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  autoFill?: string     // key of data from previous step
  unit?: string
  min?: number
  max?: number
  fullWidth?: boolean
}

export interface ChecklistItem {
  key: string
  label: string
  required?: boolean
}

export interface AttachmentSlot {
  key: string
  label: string
  accept?: string        // MIME types
  required?: boolean
}

export interface StepFormConfig {
  stepCode: string
  formType: 'input' | 'approval' | 'inspection' | 'readonly'
  title: string
  description: string
  fields: FormField[]
  checklist: ChecklistItem[]
  attachments: AttachmentSlot[]
  excelTemplate?: string  // Template name for import/export
  validationRules?: { field: string; rule: string; message: string }[]
}

// ── Phase 1: Khởi tạo Dự án ──

const P1_1: StepFormConfig = {
  stepCode: 'P1.1',
  formType: 'input',
  title: 'Tiếp nhận yêu cầu khách hàng',
  description: 'Nhập thông tin dự án từ khách hàng: PO, giá trị hợp đồng, phạm vi',
  fields: [
    { key: 'projectCode', label: 'Mã dự án', labelEn: 'Project Code', type: 'text', required: true },
    { key: 'projectName', label: 'Tên dự án', labelEn: 'Project Name', type: 'text', required: true },
    { key: 'clientName', label: 'Khách hàng', labelEn: 'Client', type: 'text', required: true },
    { key: 'productType', label: 'Loại sản phẩm', labelEn: 'Product Type', type: 'select', required: true, options: [
      { value: 'pressure_vessel', label: 'Bình chịu áp & Trao đổi nhiệt' },
      { value: 'hrsg_fgd', label: 'HRSG & FGD Systems' },
      { value: 'steel_structure', label: 'Kết cấu phi tiêu chuẩn & Cầu' },
      { value: 'crane_port', label: 'Cẩu & Thiết bị cảng' },
      { value: 'shipbuilding', label: 'Đóng tàu & Công trình biển' },
      { value: 'petrochemical', label: 'Petrochemical Skid & Module' },
    ]},
    { key: 'contractValue', label: 'Giá trị hợp đồng', labelEn: 'Contract Value', type: 'number' },
    { key: 'currency', label: 'Tiền tệ', labelEn: 'Currency', type: 'select', options: [
      { value: 'VND', label: 'VND' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'JPY', label: 'JPY' },
    ]},
    { key: 'startDate', label: 'Ngày bắt đầu', labelEn: 'Start Date', type: 'date' },
    { key: 'endDate', label: 'Ngày kết thúc (dự kiến)', labelEn: 'End Date', type: 'date' },
    { key: 'description', label: 'Mô tả', labelEn: 'Description', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'received_rfq', label: 'Đã nhận email/fax yêu cầu từ khách hàng', required: true },
    { key: 'confirmed_po', label: 'Đã xác nhận thông tin PO' },
    { key: 'checked_capacity', label: 'Đã kiểm tra năng lực sản xuất ban đầu' },
    { key: 'confirmed_timeline', label: 'Đã xác nhận timeline với khách hàng' },
  ],
  attachments: [
    { key: 'rfq', label: 'RFQ từ khách hàng', accept: ACCEPT.OFFICE_ARCHIVE },
    { key: 'po', label: 'PO từ khách hàng', accept: ACCEPT.OFFICE_ARCHIVE },
    { key: 'spec', label: 'Spec / Bản vẽ kỹ thuật', accept: ACCEPT.DRAWING_PLUS },
    { key: 'contract', label: 'Hợp đồng / Phụ lục', accept: ACCEPT.DOCS_PLUS },
  ],
}

const P1_1B: StepFormConfig = {
  stepCode: 'P1.1B',
  formType: 'approval',
  title: 'BGĐ phê duyệt triển khai',
  description: 'Ban Giám đốc xem xét thông tin dự án do PM tạo và phê duyệt triển khai. Nếu từ chối, dự án sẽ quay về PM để chỉnh sửa.',
  fields: [
    { key: 'projectCode', label: 'Mã dự án', labelEn: 'Project Code', type: 'readonly' },
    { key: 'projectName', label: 'Tên dự án', labelEn: 'Project Name', type: 'readonly', fullWidth: true },
    { key: 'clientName', label: 'Khách hàng', labelEn: 'Client', type: 'readonly' },
    { key: 'productType', label: 'Loại sản phẩm', labelEn: 'Product Type', type: 'readonly' },
    { key: 'contractValue', label: 'Giá trị hợp đồng', labelEn: 'Contract Value', type: 'readonly' },
    { key: 'currency', label: 'Tiền tệ', labelEn: 'Currency', type: 'readonly' },
    { key: 'startDate', label: 'Ngày bắt đầu', labelEn: 'Start Date', type: 'readonly' },
    { key: 'endDate', label: 'Ngày kết thúc (dự kiến)', labelEn: 'End Date', type: 'readonly' },
    { key: 'description', label: 'Mô tả dự án', labelEn: 'Description', type: 'readonly', fullWidth: true },
  ],
  checklist: [
    { key: 'reviewed_rfq', label: 'Đã xem xét RFQ/PO từ khách hàng', required: true },
    { key: 'reviewed_scope', label: 'Đã đánh giá phạm vi công việc' },
    { key: 'reviewed_value', label: 'Đã đánh giá giá trị hợp đồng' },
    { key: 'capacity_ok', label: 'Năng lực sản xuất đáp ứng được' },
  ],
  attachments: [
    { key: 'rfq', label: 'RFQ từ khách hàng', accept: ACCEPT.OFFICE_ARCHIVE },
    { key: 'po', label: 'PO từ khách hàng', accept: ACCEPT.OFFICE_ARCHIVE },
    { key: 'spec', label: 'Spec / Bản vẽ kỹ thuật', accept: ACCEPT.DRAWING_PLUS },
    { key: 'contract', label: 'Hợp đồng / Phụ lục', accept: ACCEPT.DOCS_PLUS },
  ],
}

const P1_2A: StepFormConfig = {
  stepCode: 'P1.2A',
  formType: 'input',
  title: 'Lập kế hoạch kickoff, WBS, milestones',
  description: 'PM lập BB họp triển khai dự án, WBS theo biểu mẫu BCTH-IBSHI-QLDA-095, phân bổ khối lượng, phạm vi, tiến độ.',
  fields: [
    { key: 'sec_mom_header', label: 'BB HỌP TRIỂN KHAI DỰ ÁN (Minutes of Meeting)', labelEn: 'Minutes of Meeting', type: 'section' },
    { key: 'momPlace', label: 'Địa điểm (Place)', labelEn: 'Place', type: 'text' },
    { key: 'kickoffDate', label: 'Ngày họp (Date)', labelEn: 'Meeting Date', type: 'date', required: true },
    { key: 'momNumber', label: 'Số biên bản (MOM No.)', labelEn: 'MOM No.', type: 'text' },
    { key: 'momPreparedBy', label: 'Người lập (Prepared by)', labelEn: 'Prepared by', type: 'text' },
    { key: 'kickoffAgenda', label: 'Chủ đề (Subject)', labelEn: 'Subject', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'kickoff_planned', label: 'Đã lên kế hoạch kickoff meeting' },
    { key: 'budget_distributed', label: 'Đã phân bổ theo WBS node' },
    { key: 'mom_reviewed', label: 'BB họp đã được xem xét và xác nhận' },
  ],
  attachments: [
    { key: 'wbs_file', label: 'File WBS (Excel/PDF)', accept: ACCEPT.SHEETS_PLUS },
    { key: 'kickoff_doc', label: 'Tài liệu Kickoff / BB họp gốc', accept: ACCEPT.LESSON_PACK },
  ],
}

const P1_2: StepFormConfig = {
  stepCode: 'P1.2',
  formType: 'input',
  title: 'Xây dựng dự toán thi công',
  description: 'KTKH lập dự toán chi tiết: vật tư, nhân công, dịch vụ thuê ngoài, chi phí chung',
  fields: [
    // ── DT01: Thông tin bổ sung dự án ──
    { key: 'sec_dt01', label: 'DT01 — Thông tin bổ sung', labelEn: 'Additional Project Info', type: 'section' },
    { key: 'dt01_volume', label: 'Khối lượng thi công / Phạm vi', labelEn: 'Scope & Volume', type: 'textarea' },
    { key: 'dt01_paymentTerms', label: 'Các đợt thanh toán', labelEn: 'Payment Terms', type: 'textarea' },
    { key: 'dt01_penalties', label: 'Điều khoản phạt Hợp đồng', labelEn: 'Contract Penalties', type: 'textarea' },

    // ── Tổng (auto-calculated from tables) ──
    { key: 'totalEstimate', label: 'TỔNG CHI PHÍ DỰ TOÁN', labelEn: 'Total Estimate', type: 'readonly', fullWidth: true },
  ],
  checklist: [
    { key: 'bom_matched', label: 'Đã đối chiếu BOM với yêu cầu kỹ thuật', required: true },
    { key: 'transport_included', label: 'Đã tính đủ chi phí vận chuyển' },
    { key: 'risk_added', label: 'Đã cộng phí dự phòng rủi ro' },
    { key: 'dt02_verified', label: 'Đã kiểm tra tổng hợp DT02 khớp với chi tiết' },
  ],
  attachments: [
    { key: 'detail_estimate', label: 'Bảng dự toán chi tiết (Excel)', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P1_3: StepFormConfig = {
  stepCode: 'P1.3',
  formType: 'approval',
  title: 'Phê duyệt kế hoạch và dự toán thi công',
  description: 'BGĐ phê duyệt kế hoạch kickoff, WBS, milestones của PM và dự toán thi công của KTKH',
  fields: [],
  checklist: [
    { key: 'plan_reviewed', label: 'Đã review kế hoạch kickoff, WBS, milestones', required: true },
    { key: 'estimate_reviewed', label: 'Đã review dự toán thi công (DT01-DT07)', required: true },
  ],
  attachments: [],
}

// ── Phase 2: Thiết kế & Kế hoạch SX (BRD#6-10) ──

const P2_1: StepFormConfig = {
  stepCode: 'P2.1',
  formType: 'input',
  title: 'Thiết kế xây dựng bản vẽ và đề xuất VT chính',
  description: 'R04 phát hành bản vẽ IFR/IFC theo drawing register. Từ bản vẽ Tekla/Ship Constructor, hệ thống import BOM tự động hoặc R04 nhập BOM thủ công.',
  fields: [
    { key: 'drawingCount', label: 'Số lượng bản vẽ', labelEn: 'Drawing Count', type: 'number', min: 1 },
    { key: 'standards', label: 'Tiêu chuẩn áp dụng', labelEn: 'Applied Standards', type: 'text', placeholder: 'ASME, AWS, EN...', fullWidth: true },
    { key: 'bomNotes', label: 'Ghi chú BOM', labelEn: 'BOM Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'bom_matched', label: 'BOM đã match 100% với bản vẽ', required: true },
    { key: 'hao_hut', label: 'Đã bổ sung hao hụt tiêu chuẩn' },
    { key: 'ifc_released', label: 'Bản vẽ đã đạt IFC', required: true },
  ],
  attachments: [
    { key: 'drawings', label: 'File bản vẽ (DWG/PDF)', accept: ACCEPT.DRAWING_PLUS, required: true },
    { key: 'bomFile', label: 'File BOM (Excel)', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P2_2: StepFormConfig = {
  stepCode: 'P2.2',
  formType: 'input',
  title: 'PM đề xuất vật tư hàn và sơn',
  description: 'PM tạo danh sách vật tư hàn, sơn đặc thù cho dự án (que hàn, sơn đặc chủng). Task song song với bước Thiết kế và Kho đề xuất VT phụ.',
  fields: [
    // bomItems (Tên VT, Mã VT, Quy chuẩn, Số lượng, ĐVT) is rendered as a custom dynamic table in page.tsx
    { key: 'specialNotes', label: 'Ghi chú đặc biệt', labelEn: 'Special Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'welding_spec_checked', label: 'Đã kiểm tra quy chuẩn vật tư hàn', required: true },
    { key: 'paint_spec_checked', label: 'Đã kiểm tra quy chuẩn vật tư sơn', required: true },
  ],
  attachments: [
    { key: 'weldingPaintFile', label: 'File danh sách VT hàn & sơn', accept: ACCEPT.OFFICE_ARCHIVE },
  ],
  validationRules: [],
}

const P2_3: StepFormConfig = {
  stepCode: 'P2.3',
  formType: 'input',
  title: 'Kho đề xuất vật tư tiêu hao',
  description: 'Kho review tồn kho hiện có và đề xuất vật tư có thể dùng cho dự án (tận dụng surplus từ dự án trước).',
  fields: [
    // Inventory table + BOM form for supplementary materials are rendered dynamically in page.tsx
    { key: 'stockNotes', label: 'Ghi chú tồn kho', labelEn: 'Stock Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'stock_reviewed', label: 'Đã review tồn kho hiện có', required: true },
    { key: 'surplus_checked', label: 'Đã kiểm tra surplus từ dự án trước', required: true },
  ],
  attachments: [
    { key: 'stockReportFile', label: 'File báo cáo tồn kho', accept: ACCEPT.SHEETS_PLUS },
  ],
  validationRules: [],
}

const P2_1A: StepFormConfig = {
  stepCode: 'P2.1A',
  formType: 'input',
  title: 'TCKT lập dự toán',
  description: 'R08 (Kế toán) lập dự toán chi phí chung, chi phí tài chính, chi phí quản lý cho dự án.',
  fields: [
    { key: 'estimateNotes', label: 'Ghi chú dự toán', labelEn: 'Estimate Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'cost_items_verified', label: 'Đã xác minh các hạng mục chi phí', required: true },
    { key: 'tax_calculated', label: 'Đã tính toán thuế phí' },
  ],
  attachments: [
    { key: 'financeReport', label: 'Báo cáo chi phí tài chính', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P2_4: StepFormConfig = {
  stepCode: 'P2.4',
  formType: 'input',
  title: 'KTKH điều chỉnh dự toán',
  description: 'Tổng hợp dữ liệu dự toán từ TCKT, Thương mại, Sản xuất. KTKH điều chỉnh và lập kế hoạch SX tổng thể.',
  fields: [],
  checklist: [
    { key: 'bom_reconciled', label: 'Đã đối chiếu BOM thực tế với dự toán' },
    { key: 'sx_plan_complete', label: 'Kế hoạch SX đã hoàn chỉnh' },
    { key: 'wbs_updated', label: 'WBS budget đã cập nhật' },
  ],
  attachments: [
    { key: 'planFile', label: 'File KH sản xuất', accept: ACCEPT.SHEETS_PLUS },
    { key: 'budgetFile', label: 'File dự toán điều chỉnh', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P2_5: StepFormConfig = {
  stepCode: 'P2.5',
  formType: 'approval',
  title: 'BGĐ phê duyệt KH SX và dự toán chính thức',
  description: 'BGĐ review kế hoạch SX và dự toán đã điều chỉnh. Pass → Dự án chính thức khởi động.',
  fields: [],
  checklist: [
    { key: 'budget_reviewed', label: 'Đã review dự toán chính thức', required: true },
  ],
  attachments: [],
}

// ── Phase 3: Cung ứng Vật tư (BRD#11-17) ──

const P3_1: StepFormConfig = {
  stepCode: 'P3.1',
  formType: 'input',
  title: 'PM điều chỉnh kế hoạch và đẩy tiến độ cấp hàng',
  description: 'PM xem lại WBS đã duyệt, xác định vật tư long-lead cần ưu tiên, cập nhật timeline cấp hàng.',
  fields: [
    { key: 'timelineNotes', label: 'Ghi chú điều chỉnh timeline', labelEn: 'Timeline Adjustment Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'wbs_reviewed', label: 'Đã xem xét WBS và tiến độ' },
    { key: 'long_lead_identified', label: 'Đã xác định VT long-lead', required: true },
  ],
  attachments: [],
}

const P3_2: StepFormConfig = {
  stepCode: 'P3.2',
  formType: 'input',
  title: 'Kho kiểm tra tồn kho và phê duyệt từng item PR',
  description: 'Hệ thống tự động so sánh danh sách vật tư PR (từ P2.1/P2.2/P2.3) với tồn kho. Vật tư đủ + quy chuẩn OK → Xuất kho. Không đạt → Cần mua.',
  fields: [
    // Stock check tables rendered dynamically in page.tsx from previousStepData
    { key: 'stockCheckNotes', label: 'Ghi chú kiểm tra tồn kho', labelEn: 'Stock Check Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'stock_checked', label: 'Đã kiểm tra tồn kho từng item', required: true },
    { key: 'quality_verified', label: 'Đã kiểm tra chất lượng tồn kho', required: true },
    { key: 'pr_consolidated', label: 'Đã tạo consolidated PR', required: true },
  ],
  attachments: [
    { key: 'prFile', label: 'File PR tổng hợp', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P3_3: StepFormConfig = {
  stepCode: 'P3.3',
  formType: 'input',
  title: 'PM lập lệnh SX cho thầu phụ và đề nghị cấp VT',
  description: 'PM tạo lệnh SX cho tổ thầu phụ với thông tin công việc, khối lượng và tiến độ. Đồng thời lập đề nghị cấp VT.',
  fields: [
    { key: 'subconTeam', label: 'Tên tổ thầu phụ', labelEn: 'Subcontractor Team', type: 'text', required: true },
    { key: 'jobName', label: 'Tên công việc', labelEn: 'Job Name', type: 'text', required: true },
    { key: 'jobCode', label: 'Mã công việc', labelEn: 'Job Code', type: 'text', required: true },
    { key: 'assignedQty', label: 'Khối lượng giao', labelEn: 'Assigned Quantity', type: 'number', required: true },
    { key: 'startDate', label: 'Ngày bắt đầu', labelEn: 'Start Date', type: 'date', required: true },
    { key: 'endDate', label: 'Ngày kết thúc', labelEn: 'End Date', type: 'date', required: true },
    // Subcontractor material request items table rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'wo_created', label: 'Đã tạo lệnh SX cho thầu phụ', required: true },
    { key: 'subcon_notified', label: 'Đã thông báo thầu phụ' },
  ],
  attachments: [
    { key: 'woFile', label: 'File lệnh SX', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P3_4: StepFormConfig = {
  stepCode: 'P3.4',
  formType: 'input',
  title: 'Quản lý SX lập lệnh sản xuất cho tổ nội bộ',
  description: 'R06 lập Lệnh sản xuất cho tổ nội bộ. Sổ lệnh được hệ thống tự động tạo. Nhập danh sách chi tiết nội dung công việc cần phân giao.',
  fields: [
    { key: 'woNumber', label: 'Sổ lệnh', labelEn: 'WO Number', type: 'readonly', fullWidth: false },
    { key: 'estimateRef', label: 'Dự toán', labelEn: 'Estimate Ref', type: 'text', required: true },
    { key: 'woDate', label: 'Ngày lập lệnh', labelEn: 'WO Date', type: 'date', required: true },
    // Production order items table is rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'wo_issued', label: 'Đã phát lệnh SX cho các tổ', required: true },
    { key: 'bom_linked', label: 'Đã liên kết BOM', required: true },
    { key: 'material_status_checked', label: 'Đã kiểm tra trạng thái VT' },
  ],
  attachments: [
    { key: 'woFile', label: 'File lệnh SX', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P3_5: StepFormConfig = {
  stepCode: 'P3.5',
  formType: 'input',
  title: 'Thương mại tìm nhà cung cấp',
  description: 'Nhập thông tin ít nhất 3 NCC với báo giá cho từng vật tư. Hệ thống tự động so sánh giá để xác định NCC tốt nhất.',
  fields: [
    { key: 'rfqCount', label: 'Số RFQ đã gửi', labelEn: 'RFQ Count', type: 'number' },
    { key: 'longLeadFlags', label: 'Cảnh báo long-lead items', labelEn: 'Long-lead Flags', type: 'textarea', fullWidth: true },
    // Supplier entries + comparison table rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'min_3_quotes', label: 'Đã có tối thiểu 3 báo giá', required: true },
    { key: 'comparison_done', label: 'Đã so sánh báo giá', required: true },
  ],
  attachments: [],
}

const P3_6: StepFormConfig = {
  stepCode: 'P3.6',
  formType: 'approval',
  title: 'BGĐ phê duyệt báo giá NCC',
  description: 'BGĐ xem báo giá từ R07, so sánh với dự toán. Pass → tạo PO. Fail → yêu cầu tìm NCC khác.',
  fields: [],
  checklist: [
    { key: 'quotes_reviewed', label: 'Đã review báo giá NCC', required: true },
    { key: 'budget_compared', label: 'Đã so sánh với dự toán', required: true },
  ],
  attachments: [],
}

const P3_7: StepFormConfig = {
  stepCode: 'P3.7',
  formType: 'input',
  title: 'Thương mại chốt hàng, ĐK thanh toán, kế hoạch về',
  description: 'Phát hành PO dựa trên NCC đã duyệt. Chọn điều kiện thanh toán và kế hoạch giao hàng.',
  fields: [
    { key: 'poNumber', label: 'Số PO', labelEn: 'PO Number', type: 'text', required: true },
    { key: 'totalAmount', label: 'Tổng giá trị PO', labelEn: 'PO Total', type: 'currency', required: true },
    // Payment terms dropdown + delivery plan dropdown rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'po_issued', label: 'Đã phát hành PO', required: true },
    { key: 'payment_confirmed', label: 'Đã xác nhận ĐK thanh toán', required: true },
  ],
  attachments: [
    { key: 'poFile', label: 'File PO', accept: ACCEPT.DOCS_PLUS },
  ],
}

// ── Phase 4: Mua hàng & Nhập kho (BRD#18-25) ──

const P4_1: StepFormConfig = {
  stepCode: 'P4.1',
  formType: 'input',
  title: 'Kế toán nhận yêu cầu và thực hiện thanh toán',
  description: 'Xem các đợt thanh toán từ TM, xác nhận và chọn phương thức thanh toán cho từng đợt.',
  fields: [
    { key: 'paymentNotes', label: 'Ghi chú thanh toán', labelEn: 'Payment Notes', type: 'textarea', fullWidth: true },
    // Payment milestones from P3.7 rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'payment_done', label: 'Đã thực hiện thanh toán', required: true },
    { key: 'ap_recorded', label: 'Đã ghi nhận vào A/P', required: true },
  ],
  attachments: [
    { key: 'paymentProof', label: 'Chứng từ thanh toán', accept: ACCEPT.DOCS_IMAGE },
  ],
}

const P4_2: StepFormConfig = {
  stepCode: 'P4.2',
  formType: 'input',
  title: 'Thương mại theo dõi hàng về và nghiệm thu',
  description: 'R07 cập nhật trạng thái PO khi hàng về thực tế, xác nhận lô hàng, bàn giao cho QC.',
  fields: [
    { key: 'actualDeliveryDate', label: 'Ngày hàng về thực tế', labelEn: 'Actual Delivery Date', type: 'date', required: true },
    { key: 'deliveryStatus', label: 'Tình trạng giao hàng', labelEn: 'Delivery Status', type: 'select', options: [{ value: 'on_time', label: 'Đúng hạn' }, { value: 'late', label: 'Trễ' }, { value: 'partial', label: 'Giao từng phần' }], required: true },
    { key: 'lotInfo', label: 'Thông tin lô hàng', labelEn: 'Lot Info', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'delivery_confirmed', label: 'Đã xác nhận hàng về', required: true },
    { key: 'qc_handover', label: 'Đã bàn giao cho QC nghiệm thu', required: true },
  ],
  attachments: [
    { key: 'deliveryNote', label: 'Phiếu giao hàng', accept: ACCEPT.DOCS },
  ],
}

const P4_3: StepFormConfig = {
  stepCode: 'P4.3',
  formType: 'input',
  title: 'QC nghiệm thu chất lượng nhập kho',
  description: 'R09 kiểm tra theo tiêu chí (visual, dimensional, material cert). Pass → nhập kho. Fail → trả hàng NCC.',
  fields: [
    { key: 'inspectionResult', label: 'Kết quả nghiệm thu', labelEn: 'Inspection Result', type: 'select', options: [{ value: 'PASS', label: 'PASS' }, { value: 'FAIL', label: 'FAIL' }, { value: 'CONDITIONAL', label: 'CONDITIONAL' }], required: true },
    { key: 'certVerified', label: 'MTR/Cert đã xác minh', labelEn: 'Cert Verified', type: 'select', options: [{ value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }, { value: 'na', label: 'Không áp dụng' }] },
  ],
  checklist: [
    { key: 'visual_checked', label: 'Đã kiểm tra visual', required: true },
    { key: 'dimensional_checked', label: 'Đã kiểm tra dimensional', required: true },
    { key: 'cert_verified', label: 'Đã xác minh material certificate', required: true },
  ],
  attachments: [
    { key: 'inspectionReport', label: 'Biên bản nghiệm thu', accept: ACCEPT.DOCS },
  ],
}

const P4_4: StepFormConfig = {
  stepCode: 'P4.4',
  formType: 'input',
  title: 'Kho nghiệm thu số lượng và nhập kho',
  description: 'Xem danh sách vật tư QC đã nghiệm thu PASS. Nhập số lượng thực nhận và vị trí lưu trữ cho từng vật tư.',
  fields: [
    { key: 'heatNumber', label: 'Heat Number / Batch No', labelEn: 'Heat Number', type: 'text', required: true },
    { key: 'millCertNo', label: 'Số Mill Certificate', labelEn: 'Mill Cert No', type: 'text' },
    // Per-material receivedQty + storageLocation rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'qty_verified', label: 'Đã kiểm tra số lượng', required: true },
    { key: 'reserved_project', label: 'Đã reserved cho dự án', required: true },
  ],
  attachments: [
    { key: 'grnFile', label: 'Phiếu nhập kho', accept: ACCEPT.DOCS },
  ],
}

const P4_5: StepFormConfig = {
  stepCode: 'P4.5',
  formType: 'input',
  title: 'Kho đề nghị cấp vật tư cho PM và QLSX',
  description: 'R05 xử lý yêu cầu xuất kho từ Work Order, chuẩn bị VT theo heat number, lập phiếu xuất kho gắn WBS node.',
  fields: [
    // All fields rendered dynamically in page.tsx (Vật tư xuất ra table + Ngày xuất + WBS Node)
  ],
  checklist: [
    { key: 'vt_prepared', label: 'Đã chuẩn bị VT theo heat number', required: true },
    { key: 'issue_slip', label: 'Đã lập phiếu xuất kho', required: true },
  ],
  attachments: [
    { key: 'issueSlip', label: 'Phiếu xuất kho', accept: ACCEPT.DOCS },
  ],
}

// ── Phase 5: Sản xuất (BRD#26-31) ──

const P5_1: StepFormConfig = {
  stepCode: 'P5.1',
  formType: 'input',
  title: 'Yêu cầu nghiệm thu LSX',
  description: 'Hiển thị Lệnh sản xuất tương ứng đã được đẩy xuống cho bộ phận và ghi nhận khối lượng hoàn thành.',
  fields: [
    { key: 'completedQuantity', label: 'Số lượng đã hoàn thành', labelEn: 'Completed Quantity', type: 'number', required: true },
  ],
  checklist: [
    { key: 'volume_reported', label: 'Đã báo cáo SL hoàn thành', required: true }
  ],
  attachments: [],
}

const P5_2: StepFormConfig = {
  stepCode: 'P5.2',
  formType: 'input',
  title: 'Tổ SX báo cáo khối lượng hoàn thành theo tuần',
  description: 'Mỗi tuần, R06b nhập KL hoàn thành: hạng mục, số lượng, đơn vị, job card. Dữ liệu là cơ sở tính lương khoán.',
  fields: [
    { key: 'weekNumber', label: 'Tuần báo cáo', labelEn: 'Report Week', type: 'number', required: true },
    // Multi job card form with nested stages rendered dynamically in page.tsx
  ],
  checklist: [
    { key: 'volume_reported', label: 'Đã báo cáo KL hoàn thành tuần', required: true },
    { key: 'within_contract', label: 'KL lũy kế không vượt HĐ khoán' },
  ],
  attachments: [],
}

const P5_3: StepFormConfig = {
  stepCode: 'P5.3',
  formType: 'input',
  title: 'QC nghiệm thu sản phẩm trong quá trình SX',
  description: 'QC kiểm tra theo ITP tại Hold Point và Witness Point. Pass → tiếp, Fail → NCR, gắn WBS và job card.',
  fields: [
    { key: 'itpCode', label: 'Kế hoạch kiểm tra và nghiệm thu (ITP)', labelEn: 'ITP Code', type: 'text', required: true },
    // Multi QC inspection items form rendered dynamically in page.tsx
    { key: 'inspectionNotes', label: 'Ghi chú nghiệm thu', labelEn: 'Inspection Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'hold_point_checked', label: 'Đã kiểm tra tại Hold Point', required: true },
    { key: 'witness_point_checked', label: 'Đã kiểm tra tại Witness Point' },
  ],
  attachments: [
    { key: 'itpReport', label: 'Báo cáo ITP', accept: ACCEPT.DOCS },
  ],
}

const P5_4: StepFormConfig = {
  stepCode: 'P5.4',
  formType: 'input',
  title: 'PM nghiệm thu khối lượng thực hiện',
  description: 'PM xác nhận KL hoàn thành của tổ và thầu phụ. Dữ liệu cập nhật WBS progress%, tính lương khoán, trigger milestone billing.',
  fields: [
    { key: 'pmConfirmedVolume', label: 'Khối lượng xác nhận', labelEn: 'Confirmed Volume', type: 'number', required: true },
  ],
  checklist: [
    { key: 'volume_confirmed', label: 'Xác nhận đã hoàn thành đủ khối lượng', required: true },
    { key: 'volume_verified', label: 'Đã xác nhận KL hoàn thành', required: true },
    { key: 'wbs_updated', label: 'Đã cập nhật WBS progress' },
  ],
  attachments: [],
}

const P5_5: StepFormConfig = {
  stepCode: 'P5.5',
  formType: 'input',
  title: 'Tổng hợp và tính lương khoán',
  description: 'Hàng tháng: tổng hợp KL, R03 verify và approve. Salary Engine tính lương khoán cá nhân.',
  fields: [
    { key: 'totalPieceRateValue', label: 'Tổng giá trị khoán tổ', labelEn: 'Total Piece-rate Value', type: 'currency', required: true },
    { key: 'totalTimeSalary', label: 'Tổng lương thời gian tổ', labelEn: 'Total Time Salary', type: 'currency', required: true },
    { key: 'pieceRateSupplement', label: 'Phần tăng theo khoán', labelEn: 'Piece-rate Supplement', type: 'currency' },
    { key: 'salaryNotes', label: 'Ghi chú lương khoán', labelEn: 'Salary Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'volume_summarized', label: 'Đã tổng hợp KL tháng', required: true },
    { key: 'salary_calculated', label: 'Đã tính lương khoán', required: true },
    { key: 'r03_approved', label: 'R03 đã phê duyệt', required: true },
  ],
  attachments: [
    { key: 'salaryFile', label: 'File bảng lương khoán', accept: ACCEPT.SHEETS_PLUS },
  ],
}

// ── Phase 6: Đóng Dự án (BRD P6.1-P6.5) ──

const P6_1: StepFormConfig = {
  stepCode: 'P6.1',
  formType: 'input',
  title: 'QC tổng hợp hồ sơ chất lượng (Dossier)',
  description: 'QC tổng hợp toàn bộ hồ sơ chất lượng: ITP, biên bản inspection, NDT report, mill certificates, NCR/MRB closure, welding log.',
  fields: [
    { key: 'itpStatus', label: 'ITP trạng thái', labelEn: 'ITP Status', type: 'select', required: true, options: [
      { value: 'all_passed', label: 'Tất cả checkpoint đã PASS' },
      { value: 'partial', label: 'Một số conditional/waived' },
    ]},
    { key: 'ncrSummary', label: 'Tổng hợp NCR', labelEn: 'NCR Summary', type: 'textarea', fullWidth: true },
    { key: 'totalInspections', label: 'Tổng số biên bản nghiệm thu', labelEn: 'Total Inspections', type: 'number' },
    { key: 'qcNotes', label: 'Ghi chú QC', labelEn: 'QC Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'itp_complete', label: 'ITP đã hoàn thành tất cả checkpoint', required: true },
    { key: 'ncr_closed', label: 'Tất cả NCR đã đóng', required: true },
    { key: 'mill_certs_filed', label: 'Mill certificates đã lưu đầy đủ' },
    { key: 'welding_log_complete', label: 'Welding log đầy đủ' },
    { key: 'ndt_reports_filed', label: 'NDT reports đã lưu' },
    { key: 'pressure_test_passed', label: 'Pressure test đã pass (nếu có)' },
  ],
  attachments: [
    { key: 'qcDossier', label: 'File QC Dossier tổng hợp', accept: ACCEPT.DOCS_PLUS, required: true },
  ],
}

const P6_2: StepFormConfig = {
  stepCode: 'P6.2',
  formType: 'input',
  title: 'Quyết toán chi phí trực tiếp',
  description: 'Kế toán quyết toán chi phí trực tiếp: vật tư thực tế, nhân công, dịch vụ thuê ngoài. So sánh với dự toán ban đầu.',
  fields: [
    { key: 'actualMaterialCost', label: 'Chi phí vật tư thực tế', labelEn: 'Actual Material Cost', type: 'currency', required: true },
    { key: 'actualLaborCost', label: 'Chi phí nhân công thực tế', labelEn: 'Actual Labor Cost', type: 'currency', required: true },
    { key: 'actualOutsourceCost', label: 'Chi phí thuê ngoài thực tế', labelEn: 'Actual Outsource Cost', type: 'currency', required: true },
    { key: 'actualOverhead', label: 'Chi phí chung thực tế', labelEn: 'Actual Overhead', type: 'currency', required: true },
    { key: 'totalActualCost', label: 'TỔNG CHI PHÍ THỰC TẾ', labelEn: 'Total Actual Cost', type: 'readonly', fullWidth: true },
    { key: 'costVariance', label: 'Chênh lệch so với dự toán (%)', labelEn: 'Cost Variance %', type: 'number' },
    { key: 'settlementNotes', label: 'Ghi chú quyết toán', labelEn: 'Settlement Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'all_po_settled', label: 'Tất cả PO đã thanh toán xong', required: true },
    { key: 'payroll_final', label: 'Lương khoán đã quyết toán tháng cuối', required: true },
    { key: 'subcon_settled', label: 'Thầu phụ đã quyết toán' },
  ],
  attachments: [
    { key: 'costReport', label: 'Báo cáo quyết toán chi phí (Excel)', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P6_3: StepFormConfig = {
  stepCode: 'P6.3',
  formType: 'input',
  title: 'Quyết toán tổng hợp (P&L)',
  description: 'KTKH tổng hợp báo cáo lãi/lỗ dự án: doanh thu, chi phí, biên lợi nhuận. So sánh với KPI ban đầu.',
  fields: [
    { key: 'totalRevenue', label: 'Tổng doanh thu', labelEn: 'Total Revenue', type: 'currency', required: true },
    { key: 'totalCost', label: 'Tổng chi phí', labelEn: 'Total Cost', type: 'currency', required: true },
    { key: 'grossProfit', label: 'Lợi nhuận gộp', labelEn: 'Gross Profit', type: 'readonly' },
    { key: 'profitMargin', label: 'Biên lợi nhuận (%)', labelEn: 'Profit Margin %', type: 'number' },
    { key: 'kpiComparison', label: 'So sánh KPI (dự kiến vs thực tế)', labelEn: 'KPI Comparison', type: 'textarea', fullWidth: true },
    { key: 'plNotes', label: 'Ghi chú P&L', labelEn: 'P&L Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'revenue_confirmed', label: 'Doanh thu đã đối chiếu với HĐ', required: true },
    { key: 'cost_p62_matched', label: 'Chi phí khớp với P6.2', required: true },
    { key: 'variance_analyzed', label: 'Đã phân tích chênh lệch' },
  ],
  attachments: [
    { key: 'plReport', label: 'Báo cáo P&L tổng hợp', accept: ACCEPT.SHEETS_PLUS },
  ],
}

const P6_4: StepFormConfig = {
  stepCode: 'P6.4',
  formType: 'input',
  title: 'Tổ chức Lesson Learned',
  description: 'PM tổ chức meeting rút kinh nghiệm: task trễ deadline, công đoạn rework nhiều, variance chi phí, cải tiến cho dự án sau.',
  fields: [
    { key: 'overdueTaskSummary', label: 'Tổng hợp task quá deadline', labelEn: 'Overdue Tasks Summary', type: 'textarea', fullWidth: true },
    { key: 'reworkSummary', label: 'Công đoạn rework nhiều nhất', labelEn: 'Rework Summary', type: 'textarea', fullWidth: true },
    { key: 'costVarianceLL', label: 'Variance chi phí từng khoản mục', labelEn: 'Cost Variance by Category', type: 'textarea', fullWidth: true },
    { key: 'improvementActions', label: 'Hành động cải tiến cho DA sau', labelEn: 'Improvement Actions', type: 'textarea', fullWidth: true, required: true },
    { key: 'lessonsLearned', label: 'Bài học kinh nghiệm', labelEn: 'Lessons Learned', type: 'textarea', fullWidth: true, required: true },
  ],
  checklist: [
    { key: 'meeting_held', label: 'Đã tổ chức meeting Lesson Learned', required: true },
    { key: 'all_depts_attended', label: 'Các phòng ban đã tham gia' },
    { key: 'actions_assigned', label: 'Đã giao hành động cải tiến' },
  ],
  attachments: [
    { key: 'lessonLearnFile', label: 'File Lesson Learned', accept: ACCEPT.LESSON_PACK },
    { key: 'meetingMinutes', label: 'Biên bản họp', accept: ACCEPT.DOCS_PLUS },
  ],
}

const P6_5: StepFormConfig = {
  stepCode: 'P6.5',
  formType: 'approval',
  title: 'BGĐ phê duyệt đóng dự án',
  description: 'Ban Giám đốc xem xét toàn bộ hồ sơ đóng DA: QC Dossier, Quyết toán, P&L, Lesson Learned. Phê duyệt → Dự án FINISHED.',
  fields: [
    { key: 'qcDossierStatus', label: 'QC Dossier (P6.1)', labelEn: 'QC Dossier Status', type: 'readonly' },
    { key: 'costSettlement', label: 'Quyết toán chi phí (P6.2)', labelEn: 'Cost Settlement', type: 'readonly' },
    { key: 'plSummary', label: 'P&L tổng hợp (P6.3)', labelEn: 'P&L Summary', type: 'readonly' },
    { key: 'lessonLearnStatus', label: 'Lesson Learned (P6.4)', labelEn: 'Lesson Learned', type: 'readonly' },
    { key: 'finalApprovalNotes', label: 'Ghi chú phê duyệt', labelEn: 'Approval Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'p61_reviewed', label: 'Đã xem xét QC Dossier', required: true },
    { key: 'p62_reviewed', label: 'Đã xem xét quyết toán chi phí', required: true },
    { key: 'p63_reviewed', label: 'Đã xem xét P&L', required: true },
    { key: 'p64_reviewed', label: 'Đã xem xét Lesson Learned', required: true },
    { key: 'closure_approved', label: 'Phê duyệt đóng dự án', required: true },
  ],
  attachments: [],
}

// ── Registry ──

export const STEP_FORM_CONFIGS: Record<string, StepFormConfig> = {
  'P1.1': P1_1, 'P1.1B': P1_1B, 'P1.2A': P1_2A, 'P1.2': P1_2, 'P1.3': P1_3,
  'P2.1': P2_1, 'P2.2': P2_2, 'P2.3': P2_3, 'P2.1A': P2_1A, 'P2.4': P2_4, 'P2.5': P2_5,
  'P3.1': P3_1, 'P3.2': P3_2, 'P3.3': P3_3, 'P3.4': P3_4,
  'P3.5': P3_5, 'P3.6': P3_6, 'P3.7': P3_7,
  'P4.1': P4_1, 'P4.2': P4_2, 'P4.3': P4_3, 'P4.4': P4_4, 'P4.5': P4_5,
  'P5.1': P5_1, 'P5.2': P5_2, 'P5.3': P5_3, 'P5.4': P5_4, 'P5.5': P5_5,
  'P6.1': P6_1, 'P6.2': P6_2, 'P6.3': P6_3, 'P6.4': P6_4, 'P6.5': P6_5,
}

export function getStepFormConfig(stepCode: string): StepFormConfig | undefined {
  return STEP_FORM_CONFIGS[stepCode]
}
