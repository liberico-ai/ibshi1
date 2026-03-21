// ── Task Step Form Configuration Registry ──
// Maps each workflow step to its form fields, checklist items, and attachments

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
    { key: 'rfq', label: 'RFQ từ khách hàng', accept: '.pdf,.doc,.docx,.xlsx,.xls' },
    { key: 'po', label: 'PO từ khách hàng', accept: '.pdf,.doc,.docx,.xlsx,.xls' },
    { key: 'spec', label: 'Spec / Bản vẽ kỹ thuật', accept: '.pdf,.dwg,.dxf' },
    { key: 'contract', label: 'Hợp đồng / Phụ lục', accept: '.pdf,.doc,.docx' },
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
    { key: 'rfq', label: 'RFQ từ khách hàng', accept: '.pdf,.doc,.docx,.xlsx,.xls' },
    { key: 'po', label: 'PO từ khách hàng', accept: '.pdf,.doc,.docx,.xlsx,.xls' },
    { key: 'spec', label: 'Spec / Bản vẽ kỹ thuật', accept: '.pdf,.dwg,.dxf' },
    { key: 'contract', label: 'Hợp đồng / Phụ lục', accept: '.pdf,.doc,.docx' },
  ],
}

const P1_2A: StepFormConfig = {
  stepCode: 'P1.2A',
  formType: 'input',
  title: 'Lập kế hoạch kickoff, WBS, milestones',
  description: 'PM tạo WBS, định nghĩa milestone với ngày dự kiến và % billing, lập kế hoạch kickoff meeting',
  fields: [
    { key: 'wbsStructure', label: 'Cấu trúc WBS (4-5 cấp)', labelEn: 'WBS Structure', type: 'textarea', required: true, fullWidth: true },
    { key: 'kickoffDate', label: 'Ngày Kickoff Meeting', labelEn: 'Kickoff Date', type: 'date', required: true },
    { key: 'kickoffAgenda', label: 'Nội dung Kickoff', labelEn: 'Kickoff Agenda', type: 'textarea', fullWidth: true },
    { key: 'budgetAllocation', label: 'Phân bổ ngân sách theo WBS', labelEn: 'Budget Allocation', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'wbs_created', label: 'Đã tạo WBS 4-5 cấp', required: true },
    { key: 'kickoff_planned', label: 'Đã lên kế hoạch kickoff meeting' },
    { key: 'budget_distributed', label: 'Đã phân bổ budget theo WBS node' },
  ],
  attachments: [
    { key: 'wbs_file', label: 'File WBS (Excel/PDF)', accept: '.xlsx,.xls,.pdf' },
    { key: 'kickoff_doc', label: 'Tài liệu Kickoff', accept: '.pdf,.doc,.docx,.pptx' },
  ],
}

const P1_2: StepFormConfig = {
  stepCode: 'P1.2',
  formType: 'input',
  title: 'Xây dựng dự toán thi công',
  description: 'KTKH lập dự toán chi tiết: vật tư, nhân công, dịch vụ thuê ngoài, chi phí chung',
  fields: [
    // ── 1. Chi phí vật tư ──
    { key: 'sec_material', label: '1. Chi phí vật tư', labelEn: 'Material Cost', type: 'section' },
    { key: 'mat_main', label: 'Vật tư chính', labelEn: 'Main Material', type: 'currency' },
    { key: 'mat_accessory', label: 'Vật tư phụ kiện, bu lông…', labelEn: 'Accessories & Bolts', type: 'currency' },
    { key: 'mat_packing', label: 'Vật tư đóng kiện', labelEn: 'Packing Material', type: 'currency' },
    { key: 'mat_method', label: 'Vật tư làm biện pháp', labelEn: 'Method Material', type: 'currency' },
    { key: 'mat_consumable', label: 'Vật tư tiêu hao', labelEn: 'Consumables', type: 'currency' },
    { key: 'mat_paint', label: 'Vật tư sơn', labelEn: 'Paint Material', type: 'currency' },
    { key: 'mat_reserve', label: 'Vật tư dự phòng', labelEn: 'Material Reserve', type: 'currency' },

    // ── 2. Chi phí nhân công trực tiếp ──
    { key: 'sec_labor', label: '2. Chi phí nhân công trực tiếp', labelEn: 'Direct Labor Cost', type: 'section' },
    { key: 'lab_cutting', label: 'Pha cắt', labelEn: 'Cutting', type: 'currency' },
    { key: 'lab_machining', label: 'Gia công', labelEn: 'Machining', type: 'currency' },
    { key: 'lab_fabrication', label: 'Chế tạo', labelEn: 'Fabrication', type: 'currency' },
    { key: 'lab_framing', label: 'Khung kiện', labelEn: 'Framing', type: 'currency' },
    { key: 'lab_assembly_product', label: 'Tổ hợp sản phẩm', labelEn: 'Product Assembly', type: 'currency' },
    { key: 'lab_erection', label: 'Lắp dựng + Nghiệm thu', labelEn: 'Erection & Inspection', type: 'currency' },
    { key: 'lab_cleaning_alloy', label: 'Vệ sinh vật liệu hợp kim bằng dung dịch', labelEn: 'Alloy Cleaning', type: 'currency' },
    { key: 'lab_surface_paint', label: 'Làm sạch, Sơn', labelEn: 'Surface & Painting', type: 'currency' },
    { key: 'lab_insulation', label: 'Bảo ôn', labelEn: 'Insulation', type: 'currency' },
    { key: 'lab_equip_install', label: 'Lắp thiết bị phụ kiện trước khi đóng kiện', labelEn: 'Equipment Install', type: 'currency' },
    { key: 'lab_packing', label: 'Đóng kiện', labelEn: 'Packing', type: 'currency' },
    { key: 'lab_delivery', label: 'Giao hàng', labelEn: 'Delivery', type: 'currency' },
    { key: 'lab_reserve', label: 'Nhân công dự phòng', labelEn: 'Labor Reserve', type: 'currency' },

    // ── 3. Chi phí dịch vụ thuê ngoài ──
    { key: 'sec_outsource', label: '3. Chi phí dịch vụ thuê ngoài', labelEn: 'Outsource Services', type: 'section' },
    { key: 'out_transport', label: 'Vận tải', labelEn: 'Transport', type: 'currency' },
    { key: 'out_ndt', label: 'NDT, quy trình và thí nghiệm', labelEn: 'NDT & Testing', type: 'currency' },
    { key: 'out_galvanize', label: 'Mạ kẽm', labelEn: 'Galvanization', type: 'currency' },
    { key: 'out_other', label: 'Chi phí khác', labelEn: 'Other Costs', type: 'currency' },
    { key: 'out_reserve', label: 'Chi phí dự phòng', labelEn: 'Outsource Reserve', type: 'currency' },

    // ── 4. Chi phí chung ──
    { key: 'sec_overhead', label: '4. Chi phí chung', labelEn: 'Overhead', type: 'section' },
    { key: 'ovh_production', label: 'Chi phí chung phục vụ sản xuất', labelEn: 'Production Overhead', type: 'currency' },
    { key: 'ovh_financial', label: 'Chi phí tài chính', labelEn: 'Financial Cost', type: 'currency' },
    { key: 'ovh_management', label: 'Chi phí Quản Lý', labelEn: 'Management Cost', type: 'currency' },

    // ── Tổng ──
    { key: 'totalEstimate', label: 'TỔNG CHI PHÍ DỰ TOÁN', labelEn: 'Total Estimate', type: 'readonly', fullWidth: true },
  ],
  checklist: [
    { key: 'bom_matched', label: 'Đã đối chiếu BOM với yêu cầu kỹ thuật', required: true },
    { key: 'transport_included', label: 'Đã tính đủ chi phí vận chuyển' },
    { key: 'risk_added', label: 'Đã cộng phí dự phòng rủi ro' },
  ],
  attachments: [
    { key: 'detail_estimate', label: 'Bảng dự toán chi tiết (Excel)', accept: '.xlsx,.xls' },
  ],
  excelTemplate: 'du_toan',
  validationRules: [
    { field: 'totalEstimate', rule: 'lt_contract_90', message: 'Dự toán > 90% giá trị HĐ — rủi ro lỗ' },
  ],
}

const P1_3: StepFormConfig = {
  stepCode: 'P1.3',
  formType: 'approval',
  title: 'Phê duyệt kế hoạch và ngân sách',
  description: 'BGĐ phê duyệt kế hoạch kickoff/WBS/milestones của PM và dự toán thi công của KTKH',
  fields: [],
  checklist: [
    { key: 'plan_reviewed', label: 'Đã review kế hoạch kickoff, WBS, milestones', required: true },
    { key: 'estimate_reviewed', label: 'Đã review dự toán thi công', required: true },
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
    { key: 'drawings', label: 'File bản vẽ (DWG/PDF)', accept: '.pdf,.dwg,.dxf', required: true },
    { key: 'bomFile', label: 'File BOM (Excel)', accept: '.xlsx,.xls,.csv' },
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
    { key: 'weldingPaintFile', label: 'File danh sách VT hàn & sơn', accept: '.xlsx,.xls,.pdf,.csv' },
  ],
  validationRules: [],
}

const P2_3: StepFormConfig = {
  stepCode: 'P2.3',
  formType: 'input',
  title: 'Kho đề xuất vật tư phụ từ tồn kho',
  description: 'Kho review tồn kho hiện có và đề xuất vật tư phụ có thể dùng cho dự án (tận dụng surplus từ dự án trước). Song song bước Thiết kế và PM đề xuất VT.',
  fields: [
    // Inventory table + BOM form for supplementary materials are rendered dynamically in page.tsx
    { key: 'stockNotes', label: 'Ghi chú tồn kho', labelEn: 'Stock Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'stock_reviewed', label: 'Đã review tồn kho hiện có', required: true },
    { key: 'surplus_checked', label: 'Đã kiểm tra surplus từ dự án trước', required: true },
  ],
  attachments: [
    { key: 'stockReportFile', label: 'File báo cáo tồn kho', accept: '.xlsx,.xls,.pdf,.csv' },
  ],
  validationRules: [],
}

const P2_4: StepFormConfig = {
  stepCode: 'P2.4',
  formType: 'input',
  title: 'KTKH lập kế hoạch SX và điều chỉnh dự toán',
  description: 'Sau khi nhận thông tin từ Thiết kế, PM (VT hàn/sơn), và Kho (VT phụ), R03 điều chỉnh dự toán chính thức theo BOM thực tế và lập kế hoạch sản xuất tổng thể.',
  fields: [
    { key: 'productionPlan', label: 'Kế hoạch sản xuất tổng thể', labelEn: 'Production Plan', type: 'textarea', fullWidth: true, required: true },
    { key: 'adjustedBudget', label: 'Dự toán điều chỉnh', labelEn: 'Adjusted Budget', type: 'currency', required: true },
    { key: 'budgetImpact', label: 'Tác động lên WBS budget', labelEn: 'WBS Budget Impact', type: 'textarea', fullWidth: true },
    { key: 'workshopTimeline', label: 'Timeline phân xưởng, tổ', labelEn: 'Workshop Timeline', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'bom_reconciled', label: 'Đã đối chiếu BOM thực tế với dự toán', required: true },
    { key: 'sx_plan_complete', label: 'Kế hoạch SX đã hoàn chỉnh', required: true },
    { key: 'wbs_updated', label: 'WBS budget đã cập nhật', required: true },
  ],
  attachments: [
    { key: 'planFile', label: 'File KH sản xuất', accept: '.xlsx,.xls,.pdf' },
    { key: 'budgetFile', label: 'File dự toán điều chỉnh', accept: '.xlsx,.xls,.pdf' },
  ],
}

const P2_5: StepFormConfig = {
  stepCode: 'P2.5',
  formType: 'approval',
  title: 'BGĐ phê duyệt KH SX và dự toán chính thức',
  description: 'BGĐ review kế hoạch SX và dự toán đã điều chỉnh. Pass → Dự án chính thức khởi động.',
  fields: [],
  checklist: [
    { key: 'sx_plan_reviewed', label: 'Đã review kế hoạch sản xuất', required: true },
    { key: 'budget_reviewed', label: 'Đã review dự toán chính thức', required: true },
    { key: 'timeline_approved', label: 'Timeline khả thi', required: true },
  ],
  attachments: [],
}

// ── Phase 3: Cung ứng Vật tư (BRD#11-17) ──

const P3_1: StepFormConfig = {
  stepCode: 'P3.1',
  formType: 'input',
  title: 'PM điều chỉnh kế hoạch và đẩy tiến độ cấp hàng',
  description: 'PM cập nhật timeline chi tiết, xác định các vật tư long-lead cần đặt gấp, ưu tiên xử lý PR.',
  fields: [
    { key: 'adjustedTimeline', label: 'Timeline điều chỉnh', labelEn: 'Adjusted Timeline', type: 'textarea', fullWidth: true, required: true },
    { key: 'longLeadItems', label: 'Vật tư long-lead cần ưu tiên', labelEn: 'Long-lead Items', type: 'textarea', fullWidth: true },
    { key: 'priorityNotes', label: 'Ghi chú ưu tiên', labelEn: 'Priority Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'timeline_updated', label: 'Đã cập nhật timeline chi tiết', required: true },
    { key: 'long_lead_identified', label: 'Đã xác định VT long-lead', required: true },
  ],
  attachments: [],
}

const P3_2: StepFormConfig = {
  stepCode: 'P3.2',
  formType: 'input',
  title: 'Kho kiểm tra tồn kho và phê duyệt từng item PR',
  description: 'Với mỗi item trong PR: (a) Tồn đủ + chất lượng OK → from_stock; (b) Tồn không đảm bảo → to_purchase; (c) Không đủ → to_purchase. Tạo consolidated PR.',
  fields: [
    { key: 'fromStockItems', label: 'Items xuất từ kho (from_stock)', labelEn: 'From Stock Items', type: 'textarea', fullWidth: true },
    { key: 'toPurchaseItems', label: 'Items cần mua (to_purchase)', labelEn: 'To Purchase Items', type: 'textarea', fullWidth: true },
    { key: 'consolidatedPR', label: 'Tổng hợp PR cần mua', labelEn: 'Consolidated PR', type: 'textarea', fullWidth: true, required: true },
  ],
  checklist: [
    { key: 'stock_checked', label: 'Đã kiểm tra tồn kho từng item', required: true },
    { key: 'quality_verified', label: 'Đã kiểm tra chất lượng tồn kho', required: true },
    { key: 'pr_consolidated', label: 'Đã tạo consolidated PR', required: true },
  ],
  attachments: [
    { key: 'prFile', label: 'File PR tổng hợp', accept: '.xlsx,.xls,.pdf' },
  ],
}

const P3_3: StepFormConfig = {
  stepCode: 'P3.3',
  formType: 'input',
  title: 'PM lập lệnh SX cho thầu phụ và đề nghị cấp VT',
  description: 'PM tạo lệnh SX cho thầu phụ với scope công việc, deadline, WBS node. Đồng thời tạo PR cấp VT cho thầu phụ.',
  fields: [
    { key: 'subconScope', label: 'Scope công việc thầu phụ', labelEn: 'Subcontractor Scope', type: 'textarea', fullWidth: true, required: true },
    { key: 'subconDeadline', label: 'Deadline thầu phụ', labelEn: 'Deadline', type: 'date', required: true },
    { key: 'materialRequest', label: 'Đề nghị cấp VT cho thầu phụ', labelEn: 'Material Request', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'wo_created', label: 'Đã tạo lệnh SX cho thầu phụ', required: true },
    { key: 'subcon_notified', label: 'Đã thông báo thầu phụ' },
  ],
  attachments: [
    { key: 'woFile', label: 'File lệnh SX', accept: '.pdf,.xlsx' },
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
    { key: 'material_status_checked', label: 'Đã kiểm tra trạng thái VT' },
  ],
  attachments: [
    { key: 'woFile', label: 'File lệnh SX', accept: '.pdf,.xlsx' },
  ],
}

const P3_5: StepFormConfig = {
  stepCode: 'P3.5',
  formType: 'input',
  title: 'Thương mại tìm nhà cung cấp',
  description: 'R07 nhận consolidated PR, gửi RFQ đến NCC, so sánh báo giá. Long-lead items có cờ red flag.',
  fields: [
    { key: 'rfqCount', label: 'Số RFQ đã gửi', labelEn: 'RFQ Count', type: 'number' },
    { key: 'supplierComparison', label: 'So sánh báo giá NCC', labelEn: 'Supplier Comparison', type: 'textarea', fullWidth: true, required: true },
    { key: 'recommendedSupplier', label: 'NCC đề xuất', labelEn: 'Recommended Supplier', type: 'text', required: true },
    { key: 'longLeadFlags', label: 'Cảnh báo long-lead items', labelEn: 'Long-lead Flags', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'min_3_quotes', label: 'Đã có tối thiểu 3 báo giá', required: true },
    { key: 'comparison_done', label: 'Đã so sánh báo giá', required: true },
  ],
  attachments: [
    { key: 'quotesFile', label: 'File báo giá NCC', accept: '.pdf,.xlsx' },
  ],
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
  description: 'R07 phát hành PO. Nhập điều kiện thanh toán: trả trước/sau, % mỗi đợt. Ghi ngày giao hàng dự kiến.',
  fields: [
    { key: 'poNumber', label: 'Số PO', labelEn: 'PO Number', type: 'text', required: true },
    { key: 'paymentTerms', label: 'Điều kiện thanh toán', labelEn: 'Payment Terms', type: 'textarea', fullWidth: true, required: true },
    { key: 'deliveryDate', label: 'Ngày giao hàng dự kiến', labelEn: 'Expected Delivery', type: 'date', required: true },
    { key: 'totalAmount', label: 'Tổng giá trị PO', labelEn: 'PO Total', type: 'currency', required: true },
  ],
  checklist: [
    { key: 'po_issued', label: 'Đã phát hành PO', required: true },
    { key: 'payment_confirmed', label: 'Đã xác nhận ĐK thanh toán', required: true },
  ],
  attachments: [
    { key: 'poFile', label: 'File PO', accept: '.pdf' },
  ],
}

// ── Phase 4: Mua hàng & Nhập kho (BRD#18-25) ──

const P4_1: StepFormConfig = {
  stepCode: 'P4.1',
  formType: 'input',
  title: 'Kế toán nhận yêu cầu và thực hiện thanh toán',
  description: 'R08 nhận task từ R07 với đầy đủ thông tin PO, số tiền, tài khoản NCC. Thực hiện thanh toán và ghi nhận vào A/P.',
  fields: [
    { key: 'paymentAmount', label: 'Số tiền thanh toán', labelEn: 'Payment Amount', type: 'currency', required: true },
    { key: 'paymentMethod', label: 'Phương thức thanh toán', labelEn: 'Payment Method', type: 'select', options: [{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }, { value: 'lc', label: 'LC' }], required: true },
    { key: 'transactionRef', label: 'Mã giao dịch', labelEn: 'Transaction Ref', type: 'text', required: true },
    { key: 'paymentNotes', label: 'Ghi chú thanh toán', labelEn: 'Payment Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'payment_done', label: 'Đã thực hiện thanh toán', required: true },
    { key: 'ap_recorded', label: 'Đã ghi nhận vào A/P', required: true },
  ],
  attachments: [
    { key: 'paymentProof', label: 'Chứng từ thanh toán', accept: '.pdf,.jpg,.png' },
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
    { key: 'deliveryNote', label: 'Phiếu giao hàng', accept: '.pdf' },
  ],
}

const P4_3: StepFormConfig = {
  stepCode: 'P4.3',
  formType: 'input',
  title: 'QC nghiệm thu chất lượng nhập kho',
  description: 'R09 kiểm tra theo tiêu chí (visual, dimensional, material cert). Pass → nhập kho. Fail → trả hàng NCC.',
  fields: [
    { key: 'inspectionResult', label: 'Kết quả nghiệm thu', labelEn: 'Inspection Result', type: 'select', options: [{ value: 'PASS', label: 'PASS' }, { value: 'FAIL', label: 'FAIL' }, { value: 'CONDITIONAL', label: 'CONDITIONAL' }], required: true },
    { key: 'failReason', label: 'Lý do từ chối (nếu Fail)', labelEn: 'Fail Reason', type: 'textarea', fullWidth: true },
    { key: 'certVerified', label: 'MTR/Cert đã xác minh', labelEn: 'Cert Verified', type: 'select', options: [{ value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }, { value: 'na', label: 'Không áp dụng' }] },
  ],
  checklist: [
    { key: 'visual_checked', label: 'Đã kiểm tra visual', required: true },
    { key: 'dimensional_checked', label: 'Đã kiểm tra dimensional', required: true },
    { key: 'cert_verified', label: 'Đã xác minh material certificate', required: true },
  ],
  attachments: [
    { key: 'inspectionReport', label: 'Biên bản nghiệm thu', accept: '.pdf' },
  ],
}

const P4_4: StepFormConfig = {
  stepCode: 'P4.4',
  formType: 'input',
  title: 'Kho nghiệm thu số lượng và nhập kho',
  description: 'R05 kiểm tra SL thực nhận so với PO. Nhập hệ thống với heat number, mill certificate, vị trí lưu trữ.',
  fields: [
    { key: 'receivedQty', label: 'Số lượng thực nhận', labelEn: 'Received Qty', type: 'number', required: true },
    { key: 'heatNumber', label: 'Heat Number / Batch No', labelEn: 'Heat Number', type: 'text', required: true },
    { key: 'millCertNo', label: 'Số Mill Certificate', labelEn: 'Mill Cert No', type: 'text' },
    { key: 'storageLocation', label: 'Vị trí lưu trữ', labelEn: 'Storage Location', type: 'text', required: true },
  ],
  checklist: [
    { key: 'qty_verified', label: 'Đã kiểm tra số lượng', required: true },
    { key: 'heat_recorded', label: 'Đã ghi heat number', required: true },
    { key: 'reserved_project', label: 'Đã reserved cho dự án', required: true },
  ],
  attachments: [
    { key: 'grnFile', label: 'Phiếu nhập kho', accept: '.pdf' },
  ],
}

const P4_5: StepFormConfig = {
  stepCode: 'P4.5',
  formType: 'input',
  title: 'Kho đề nghị cấp vật tư cho PM và QLSX',
  description: 'R05 xử lý yêu cầu xuất kho từ Work Order, chuẩn bị VT theo heat number, lập phiếu xuất kho gắn WBS node.',
  fields: [
    { key: 'issuedItems', label: 'Danh sách VT xuất kho', labelEn: 'Issued Items', type: 'textarea', fullWidth: true, required: true },
    { key: 'issueDate', label: 'Ngày xuất kho', labelEn: 'Issue Date', type: 'date', required: true },
    { key: 'wbsNode', label: 'WBS Node', labelEn: 'WBS Node', type: 'text' },
  ],
  checklist: [
    { key: 'vt_prepared', label: 'Đã chuẩn bị VT theo heat number', required: true },
    { key: 'issue_slip', label: 'Đã lập phiếu xuất kho', required: true },
  ],
  attachments: [
    { key: 'issueSlip', label: 'Phiếu xuất kho', accept: '.pdf' },
  ],
}

// ── Phase 5: Sản xuất (BRD#26-31) ──

const P5_1: StepFormConfig = {
  stepCode: 'P5.1',
  formType: 'input',
  title: 'Tổ SX thực hiện SX và theo dõi job card',
  description: 'R06b cập nhật trạng thái job card: bắt đầu, hoàn thành từng công đoạn, vấn đề phát sinh. Scan QR xem bản vẽ mới nhất.',
  fields: [
    { key: 'jobCardStatus', label: 'Trạng thái job card', labelEn: 'Job Card Status', type: 'select', options: [{ value: 'in_progress', label: 'Đang thực hiện' }, { value: 'done', label: 'Hoàn thành' }, { value: 'paused', label: 'Tạm dừng' }, { value: 'issue', label: 'Vấn đề phát sinh' }], required: true },
    { key: 'completedTasks', label: 'Công đoạn đã hoàn thành', labelEn: 'Completed Tasks', type: 'textarea', fullWidth: true },
    { key: 'issues', label: 'Vấn đề phát sinh', labelEn: 'Issues', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'job_card_updated', label: 'Đã cập nhật job card', required: true },
    { key: 'vt_confirmed', label: 'Đã xác nhận VT đã dùng' },
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
    { key: 'completedVolume', label: 'Khối lượng hoàn thành', labelEn: 'Completed Volume', type: 'textarea', fullWidth: true, required: true },
    { key: 'volumeUnit', label: 'Đơn vị', labelEn: 'Unit', type: 'text' },
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
    { key: 'itpResult', label: 'Kết quả ITP', labelEn: 'ITP Result', type: 'select', options: [{ value: 'PASS', label: 'PASS' }, { value: 'FAIL', label: 'FAIL' }, { value: 'HOLD', label: 'HOLD' }], required: true },
    { key: 'ncrNumber', label: 'Số NCR (nếu Fail)', labelEn: 'NCR Number', type: 'text' },
    { key: 'inspectionNotes', label: 'Ghi chú nghiệm thu', labelEn: 'Inspection Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
    { key: 'hold_point_checked', label: 'Đã kiểm tra tại Hold Point', required: true },
    { key: 'witness_point_checked', label: 'Đã kiểm tra tại Witness Point' },
  ],
  attachments: [
    { key: 'itpReport', label: 'Báo cáo ITP', accept: '.pdf' },
  ],
}

const P5_4: StepFormConfig = {
  stepCode: 'P5.4',
  formType: 'input',
  title: 'PM nghiệm thu khối lượng thực hiện',
  description: 'PM xác nhận KL hoàn thành của tổ và thầu phụ. Dữ liệu cập nhật WBS progress%, tính lương khoán, trigger milestone billing.',
  fields: [
    { key: 'verifiedVolume', label: 'KL đã xác nhận', labelEn: 'Verified Volume', type: 'textarea', fullWidth: true, required: true },
    { key: 'wbsProgress', label: '% Tiến độ WBS', labelEn: 'WBS Progress %', type: 'number' },
    { key: 'acceptanceNotes', label: 'Ghi chú nghiệm thu', labelEn: 'Acceptance Notes', type: 'textarea', fullWidth: true },
  ],
  checklist: [
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
    { key: 'salaryFile', label: 'File bảng lương khoán', accept: '.xlsx,.xls' },
  ],
}

// ── Phase 6: Đóng Dự án (BRD#32) ──

const P6_1: StepFormConfig = {
  stepCode: 'P6.1',
  formType: 'input',
  title: 'KTKH tổ chức Lesson Learn và đóng dự án',
  description: 'Điều kiện đóng: 100% KL + MRB phát hành + Thanh toán cuối. Lesson Learn gồm: task quá deadline, rework, variance chi phí.',
  fields: [
    { key: 'overdueTaskSummary', label: 'Tổng hợp task quá deadline', labelEn: 'Overdue Tasks Summary', type: 'textarea', fullWidth: true },
    { key: 'reworkSummary', label: 'Công đoạn rework nhiều nhất', labelEn: 'Rework Summary', type: 'textarea', fullWidth: true },
    { key: 'costVariance', label: 'Variance chi phí từng khoản mục', labelEn: 'Cost Variance', type: 'textarea', fullWidth: true },
    { key: 'lessonsLearned', label: 'Bài học kinh nghiệm', labelEn: 'Lessons Learned', type: 'textarea', fullWidth: true, required: true },
  ],
  checklist: [
    { key: 'kl_100', label: '100% KL hoàn thành', required: true },
    { key: 'mrb_published', label: 'MRB đã phát hành' },
    { key: 'final_payment', label: 'Thanh toán cuối từ client' },
    { key: 'lesson_learn_done', label: 'Đã tổ chức Lesson Learn', required: true },
  ],
  attachments: [
    { key: 'lessonLearnFile', label: 'File Lesson Learn', accept: '.pdf,.docx,.xlsx' },
  ],
}

// ── Registry ──

export const STEP_FORM_CONFIGS: Record<string, StepFormConfig> = {
  'P1.1': P1_1, 'P1.1B': P1_1B, 'P1.2A': P1_2A, 'P1.2': P1_2, 'P1.3': P1_3,
  'P2.1': P2_1, 'P2.2': P2_2, 'P2.3': P2_3, 'P2.4': P2_4, 'P2.5': P2_5,
  'P3.1': P3_1, 'P3.2': P3_2, 'P3.3': P3_3, 'P3.4': P3_4,
  'P3.5': P3_5, 'P3.6': P3_6, 'P3.7': P3_7,
  'P4.1': P4_1, 'P4.2': P4_2, 'P4.3': P4_3, 'P4.4': P4_4, 'P4.5': P4_5,
  'P5.1': P5_1, 'P5.2': P5_2, 'P5.3': P5_3, 'P5.4': P5_4, 'P5.5': P5_5,
  'P6.1': P6_1,
}

export function getStepFormConfig(stepCode: string): StepFormConfig | undefined {
  return STEP_FORM_CONFIGS[stepCode]
}
