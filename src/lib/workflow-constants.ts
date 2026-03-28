import { TASK_STATUS } from './constants'

// ── Workflow Step Definition ──

export interface WorkflowStep {
  code: string
  name: string
  nameEn: string
  role: string
  next: string[]
  gate?: string[]       // Required completed steps before activation
  deadlineDays?: number // Auto-deadline in days
  phase: number         // Phase group (1-6)
  rejectTo?: string           // Step to return to on rejection
  syncOnComplete?: string[]   // Forward sync hooks to run
  syncOnReject?: string[]     // Reverse hooks to run
}

// ── 36-Step Workflow Rules (BRD Specification) ──

export const WORKFLOW_RULES: Record<string, WorkflowStep> = {
  // ── Phase 1: Khởi tạo Dự án ──
  'P1.1': {
    code: 'P1.1', name: 'Tạo dự án', nameEn: 'Create Project',
    role: 'R02', next: ['P1.1B'], deadlineDays: 2, phase: 1,
  },
  'P1.1B': {
    code: 'P1.1B', name: 'BGĐ phê duyệt triển khai', nameEn: 'Director Project Approval',
    role: 'R01', next: ['P1.2A', 'P1.2'], deadlineDays: 3, phase: 1,
    rejectTo: 'P1.1',
  },
  'P1.2A': {
    code: 'P1.2A', name: 'PM lập kế hoạch kickoff, WBS, milestones', nameEn: 'PM Kickoff Plan & WBS',
    role: 'R02', next: ['P1.3'], deadlineDays: 5, phase: 1,
  },
  'P1.2': {
    code: 'P1.2', name: 'Xây dựng dự toán thi công', nameEn: 'Prepare Construction Estimate',
    role: 'R03', next: ['P1.3'], deadlineDays: 5, phase: 1,
  },
  'P1.3': {
    code: 'P1.3', name: 'Phê duyệt kế hoạch kickoff, WBS, milestones', nameEn: 'Plan Approval',
    role: 'R01', gate: ['P1.2A'], next: ['P1.2', 'P2.1', 'P2.2', 'P2.3', 'P2.1A', 'P2.1B', 'P2.1C'], deadlineDays: 3, phase: 1,
    rejectTo: 'P1.2A',
  },

  // ── Phase 2: Thiết kế & Kế hoạch SX (BRD#6-10) ──
  // P2.1, P2.2, P2.3, P2.1A, P2.1B, P2.1C run in PARALLEL after P1.3
  'P2.1': {
    code: 'P2.1', name: 'Thiết kế xây dựng bản vẽ và đề xuất VT chính', nameEn: 'Design Drawing & Main Material BOM',
    role: 'R04', next: [], deadlineDays: 15, phase: 2,
  },
  'P2.2': {
    code: 'P2.2', name: 'PM đề xuất vật tư hàn và sơn', nameEn: 'PM Welding & Paint Material Request',
    role: 'R02', next: [], deadlineDays: 5, phase: 2,
  },
  'P2.3': {
    code: 'P2.3', name: 'Kho đề xuất vật tư', nameEn: 'Warehouse Material Proposal',
    role: 'R05', next: [], deadlineDays: 5, phase: 2,
  },
  'P2.1A': {
    code: 'P2.1A', name: 'Tập hợp thông tin dự toán của Tài chính kế toán', nameEn: 'Finance Estimate Info Compilation',
    role: 'R08', next: [], deadlineDays: 7, phase: 2,
  },
  'P2.1B': {
    code: 'P2.1B', name: 'Tập hợp thông tin dự toán của Thương mại', nameEn: 'Commercial Estimate Info Compilation',
    role: 'R07', next: [], deadlineDays: 7, phase: 2,
  },
  'P2.1C': {
    code: 'P2.1C', name: 'Tập hợp thông tin dự toán của Sản xuất', nameEn: 'Production Estimate Info Compilation',
    role: 'R06', next: [], deadlineDays: 7, phase: 2,
  },
  'P2.4': {
    code: 'P2.4', name: 'KTKH lập kế hoạch SX và điều chỉnh dự toán', nameEn: 'Production Plan & Budget Adjustment',
    role: 'R03', gate: ['P2.1', 'P2.2', 'P2.3', 'P2.1A', 'P2.1B', 'P2.1C'], next: ['P2.5'], deadlineDays: 7, phase: 2,
  },
  'P2.5': {
    code: 'P2.5', name: 'BGĐ phê duyệt KH SX và dự toán chính thức', nameEn: 'Approve Production Plan & Final Budget',
    role: 'R01', next: ['P3.1', 'P3.4'], deadlineDays: 3, phase: 2,
    rejectTo: 'P2.4',
  },

  // ── Phase 3: Cung ứng Vật tư (BRD#11-17) ──
  'P3.1': {
    code: 'P3.1', name: 'PM điều chỉnh kế hoạch và đẩy tiến độ cấp hàng', nameEn: 'PM Adjust Plan & Push Material Schedule',
    role: 'R02', next: ['P3.2'], deadlineDays: 3, phase: 3,
  },
  'P3.2': {
    code: 'P3.2', name: 'Kho kiểm tra tồn kho và phê duyệt từng item PR', nameEn: 'Stock Check & PR Item Approval',
    role: 'R05', next: ['P3.3', 'P3.5'], deadlineDays: 3, phase: 3,
  },
  'P3.3': {
    code: 'P3.3', name: 'PM lập lệnh SX cho thầu phụ và đề nghị cấp VT', nameEn: 'PM Subcontractor WO & Material Request',
    role: 'R02', next: [], deadlineDays: 5, phase: 3,
  },
  'P3.4': {
    code: 'P3.4', name: 'Quản lý SX lập lệnh sản xuất cho tổ nội bộ', nameEn: 'Production Manager Internal WO',
    role: 'R06', next: [], deadlineDays: 5, phase: 3,
  },
  'P3.5': {
    code: 'P3.5', name: 'Thương mại tìm nhà cung cấp', nameEn: 'Commercial Find Suppliers',
    role: 'R07', next: ['P3.6'], deadlineDays: 7, phase: 3,
  },
  'P3.6': {
    code: 'P3.6', name: 'BGĐ phê duyệt báo giá NCC', nameEn: 'Approve Supplier Quotation',
    role: 'R01', next: ['P3.7'], deadlineDays: 3, phase: 3,
    rejectTo: 'P3.5',
  },
  'P3.7': {
    code: 'P3.7', name: 'Thương mại chốt hàng, ĐK thanh toán, kế hoạch về', nameEn: 'Finalize PO, Payment Terms & Delivery Plan',
    role: 'R07', next: ['P4.1', 'P4.2'], deadlineDays: 5, phase: 3,
  },

  // ── Phase 4: Mua hàng & Nhập kho (BRD#18-25) ──
  // BRD#18,19,24 are automated — handled via syncOnComplete hooks
  'P4.1': {
    code: 'P4.1', name: 'Kế toán nhận yêu cầu và thực hiện thanh toán', nameEn: 'Finance Process Payment',
    role: 'R08', next: [], deadlineDays: 5, phase: 4,
  },
  'P4.2': {
    code: 'P4.2', name: 'Thương mại theo dõi hàng về và nghiệm thu', nameEn: 'Commercial Track Delivery & Receipt',
    role: 'R07', next: ['P4.3'], deadlineDays: 10, phase: 4,
  },
  'P4.3': {
    code: 'P4.3', name: 'QC nghiệm thu chất lượng nhập kho', nameEn: 'QC Incoming Quality Inspection',
    role: 'R09', next: ['P4.4'], deadlineDays: 3, phase: 4,
    rejectTo: 'P3.7', // QC fail → return to commercial
  },
  'P4.4': {
    code: 'P4.4', name: 'Kho nghiệm thu số lượng và nhập kho', nameEn: 'Warehouse Quantity Check & Stock In',
    role: 'R05', next: ['P4.5'], deadlineDays: 3, phase: 4,
  },
  'P4.5': {
    code: 'P4.5', name: 'Kho đề nghị cấp vật tư cho PM và QLSX', nameEn: 'Warehouse Issue Material to PM & Production',
    role: 'R05', next: ['P5.1'], deadlineDays: 3, phase: 4,
  },

  // ── Phase 5: Sản xuất (BRD#26-31) ──
  'P5.1': {
    code: 'P5.1', name: 'Tổ SX thực hiện sản xuất và theo dõi job card', nameEn: 'Production Team Execute & Track Job Cards',
    role: 'R06b', next: ['P5.2'], phase: 5,
  },
  'P5.2': {
    code: 'P5.2', name: 'Tổ SX báo cáo khối lượng hoàn thành theo tuần', nameEn: 'Weekly Production Volume Report',
    role: 'R06b', next: ['P5.3'], phase: 5,
  },
  'P5.3': {
    code: 'P5.3', name: 'QC nghiệm thu sản phẩm trong quá trình SX', nameEn: 'QC In-Process Inspection',
    role: 'R09', next: ['P5.4'], phase: 5,
    rejectTo: 'P5.1', // QC fail → rework
  },
  'P5.4': {
    code: 'P5.4', name: 'PM nghiệm thu khối lượng thực hiện', nameEn: 'PM Volume Acceptance',
    role: 'R02', next: ['P5.5'], phase: 5,
    rejectTo: 'P5.2', // PM fail → tổ SX báo cáo lại
  },
  'P5.5': {
    code: 'P5.5', name: 'Tổng hợp và tính lương khoán', nameEn: 'Piece-rate Salary Calculation',
    role: 'R03', next: ['P6.1', 'P6.2', 'P6.3', 'P6.4'], phase: 5,
  },

  // ── Phase 6: Đóng Dự án (BRD P6.1-P6.5) ──
  'P6.1': {
    code: 'P6.1', name: 'QC tổng hợp hồ sơ chất lượng (Dossier)', nameEn: 'QC Dossier Compilation',
    role: 'R09', next: [], deadlineDays: 10, phase: 6,
  },
  'P6.2': {
    code: 'P6.2', name: 'Quyết toán chi phí trực tiếp', nameEn: 'Direct Cost Settlement',
    role: 'R08', next: [], deadlineDays: 7, phase: 6,
  },
  'P6.3': {
    code: 'P6.3', name: 'Quyết toán tổng hợp (P&L)', nameEn: 'Consolidated P&L Settlement',
    role: 'R03', next: [], deadlineDays: 7, phase: 6,
  },
  'P6.4': {
    code: 'P6.4', name: 'Tổ chức Lesson Learned', nameEn: 'Lessons Learned Review',
    role: 'R02', next: [], deadlineDays: 5, phase: 6,
  },
  'P6.5': {
    code: 'P6.5', name: 'BGĐ phê duyệt đóng dự án', nameEn: 'Board Project Closure Approval',
    role: 'R01', gate: ['P6.1', 'P6.2', 'P6.3', 'P6.4'], next: [], deadlineDays: 3, phase: 6,
  },
}

// ── Phase Labels ──
export const PHASE_LABELS: Record<number, { name: string; nameEn: string }> = {
  1: { name: 'Khởi tạo Dự án', nameEn: 'Project Initiation' },
  2: { name: 'Thiết kế & Kỹ thuật', nameEn: 'Engineering & Design' },
  3: { name: 'Cung ứng Vật tư', nameEn: 'Material Procurement' },
  4: { name: 'Sản xuất', nameEn: 'Production' },
  5: { name: 'Giao hàng & Nghiệm thu', nameEn: 'Delivery & Acceptance' },
  6: { name: 'Đóng Dự án', nameEn: 'Project Closure' },
}

// ── Client-safe progress calculator ──
export function getWorkflowProgress(tasks: { stepCode: string; status: string }[]): {
  total: number
  completed: number
  inProgress: number
  rejected: number
  percentage: number
  currentPhase: number
} {
  const total = tasks.length
  const completed = tasks.filter((t) => t.status === TASK_STATUS.DONE).length
  const inProgress = tasks.filter((t) => t.status === TASK_STATUS.IN_PROGRESS).length
  const rejected = tasks.filter((t) => t.status === TASK_STATUS.REJECTED).length
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  let currentPhase = 1
  const activeStep = tasks.find((t) => t.status === TASK_STATUS.IN_PROGRESS)
  if (activeStep) {
    const rule = WORKFLOW_RULES[activeStep.stepCode]
    if (rule) currentPhase = rule.phase
  }

  return { total, completed, inProgress, rejected, percentage, currentPhase }
}
