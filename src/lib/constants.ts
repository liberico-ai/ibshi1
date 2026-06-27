// ── Role Codes ──
export const ROLES = {
  R01: { code: 'R01', name: 'Ban Giám đốc', nameEn: 'Board of Directors' },
  R02: { code: 'R02', name: 'Quản lý Dự án', nameEn: 'Project Manager' },
  R02a: { code: 'R02a', name: 'Nhân viên Quản lý Dự án', nameEn: 'Project Staff' },
  R03: { code: 'R03', name: 'Kinh tế Kế hoạch', nameEn: 'Planning & Economics' },
  R03a: { code: 'R03a', name: 'Nhân viên Kinh tế Kế hoạch', nameEn: 'Planning Staff' },
  R04: { code: 'R04', name: 'Thiết kế', nameEn: 'Engineering' },
  R04a: { code: 'R04a', name: 'Nhân viên Thiết kế', nameEn: 'Engineering Staff' },
  R05: { code: 'R05', name: 'Kho', nameEn: 'Warehouse' },
  R05a: { code: 'R05a', name: 'Nhân viên Kho', nameEn: 'Warehouse Staff' },
  R06: { code: 'R06', name: 'Quản lý Sản xuất', nameEn: 'Production Manager' },
  R06a: { code: 'R06a', name: 'Nhân viên Sản xuất', nameEn: 'Production Staff' },
  R06b: { code: 'R06b', name: 'Tổ trưởng sản xuất', nameEn: 'Team Leader' },
  R07: { code: 'R07', name: 'Thương mại', nameEn: 'Commercial' },
  R07a: { code: 'R07a', name: 'Nhân viên Thương mại', nameEn: 'Commercial Staff' },
  R08: { code: 'R08', name: 'Kế toán', nameEn: 'Accounting' },
  R08a: { code: 'R08a', name: 'Nhân viên Kế toán', nameEn: 'Accounting Staff' },
  R09: { code: 'R09', name: 'Chất lượng (QC)', nameEn: 'Quality Control' },
  R09a: { code: 'R09a', name: 'Kiểm tra viên', nameEn: 'Inspector' },
  R10: { code: 'R10', name: 'Quản trị Hệ thống', nameEn: 'System Admin' },
  R11: { code: 'R11', name: 'Nhân viên HCNS', nameEn: 'HR & Admin Staff' },
  R13: { code: 'R13', name: 'Trưởng phòng Thiết bị & Cơ giới', nameEn: 'Equipment & Mechanical Head' },
} as const

export type RoleCode = keyof typeof ROLES

// ── Departments ──
export const DEPARTMENTS = [
  { code: 'BGD', name: 'Ban Giám đốc', nameEn: 'Board of Directors' },
  { code: 'QLDA', name: 'Quản lý Dự án', nameEn: 'Project Management' },
  { code: 'KTKH', name: 'Kinh tế Kế hoạch', nameEn: 'Planning & Economics' },
  { code: 'TK', name: 'Thiết kế', nameEn: 'Engineering' },
  { code: 'SX', name: 'Sản xuất', nameEn: 'Production' },
  { code: 'TM', name: 'Thương mại', nameEn: 'Commercial' },
  { code: 'TCKT', name: 'Tài chính Kế toán & Kho', nameEn: 'Finance & Warehouse' },
  { code: 'QC', name: 'QA/QC', nameEn: 'Quality Control' },
  { code: 'TBCG', name: 'Thiết bị & Cơ giới', nameEn: 'Equipment & Mechanical' },
  { code: 'CNTT', name: 'CNTT & Dữ liệu', nameEn: 'IT & Data' },
] as const

// ── Project Types (loại dự án — quyết định luồng) ──
export const PROJECT_TYPES = [
  { value: 'EXTERNAL_PROD', label: 'Dự án sản xuất cho khách hàng ngoài' },
  { value: 'INTERNAL_PROD', label: 'Dự án sản xuất nội bộ' },
  { value: 'OTHER', label: 'Dự án khác (không sản xuất)' },
] as const

// ── Product Types ──
export const PRODUCT_TYPES = [
  { value: 'pressure_vessel', label: 'Bình chịu áp & Trao đổi nhiệt', labelEn: 'Pressure Vessel & Heat Exchanger' },
  { value: 'hrsg_fgd', label: 'Hệ thống HRSG & FGD', labelEn: 'HRSG & FGD Systems' },
  { value: 'steel_structure', label: 'Kết cấu phi tiêu chuẩn & Cầu', labelEn: 'Non-standard Steel Structures & Bridges' },
  { value: 'crane_port', label: 'Cẩu & Thiết bị cảng', labelEn: 'Crane & Port Equipment' },
  { value: 'shipbuilding', label: 'Đóng tàu & Công trình biển', labelEn: 'Shipbuilding & Offshore' },
  { value: 'petrochemical', label: 'Thiết bị hoá dầu', labelEn: 'Petrochemical Skid & Module' },
] as const

// ── Task Statuses ──
export const TASK_STATUS = {
  OPEN: 'OPEN',
  PENDING: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  DONE: 'DONE',
  RETURNED: 'RETURNED',
  REJECTED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_REVIEW' | 'DONE' | 'RETURNED' | 'CANCELLED'

// ── Project Statuses ──
export const PROJECT_STATUS = {
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const

// ── Notification Types ──
export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'task_assigned',
  TASK_REVIEW: 'task_review',
  TASK_PROGRESS: 'task_progress',
  TASK_RETURNED: 'task_returned',
  DEADLINE_WARNING: 'deadline_warning',
  DEADLINE_OVERDUE: 'deadline_overdue',
  APPROVAL_NEEDED: 'approval_needed',
  TASK_COMPLETED: 'task_completed',
  PROJECT_CREATED: 'project_created',
} as const

// ── Menu Items by Role (Deputies inherit parent) ──
// ── Sidebar Group Definitions ──

export const MENU_GROUPS = [
  { key: 'overview', label: 'Tổng quan', labelEn: 'Overview', icon: '📊', priority: 0 },
  { key: 'management', label: 'Điều hành', labelEn: 'Management', icon: '📈', priority: 1 },
  { key: 'project', label: 'Dự án', labelEn: 'Projects', icon: '📁', priority: 2 },
  { key: 'design', label: 'Thiết kế', labelEn: 'Design', icon: '✏️', priority: 3 },
  { key: 'warehouse', label: 'Kho & Mua hàng', labelEn: 'Warehouse', icon: '📦', priority: 4 },
  { key: 'production', label: 'Sản xuất', labelEn: 'Production', icon: '🏭', priority: 5 },
  { key: 'qc', label: 'Chất lượng', labelEn: 'Quality', icon: '✅', priority: 6 },
  { key: 'hr', label: 'Nhân sự', labelEn: 'HR', icon: '👤', priority: 7 },
  { key: 'finance', label: 'Tài chính', labelEn: 'Finance', icon: '💰', priority: 8 },
  { key: 'reports', label: 'Báo cáo', labelEn: 'Reports', icon: '📊', priority: 9 },
  { key: 'system', label: 'Hệ thống', labelEn: 'System', icon: '⚙️', priority: 10 },
] as const

// Roles allowed to create/edit PR (đề xuất vật tư)
export const PR_EDIT_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R04', 'R04a'] as const

// Roles allowed to create/edit supplier quotes
export const QUOTE_EDIT_ROLES = ['R07', 'R07a', 'R01'] as const

// Roles allowed to set requiredDate on PR items (field-level carve-out)
export const REQUIRED_DATE_EDIT_ROLES = ['R01', 'R02', 'R02a'] as const

// Roles allowed to create/edit finance entries (payments, cashflow, budgets)
export const FINANCE_WRITE_ROLES = ['R01', 'R03', 'R03a', 'R08', 'R08a'] as const

// Briefing: XEM = mọi user đã đăng nhập; GHI = PM + NV QLDA + IT
export const BRIEFING_WRITE_ROLES = ['R02', 'R02a', 'R10'] as const

// ── Form-level edit permissions (server + client) ──
export const FORM_EDIT_ROLES = {
  ESTIMATE: ['R01', 'R03', 'R03a'],
  PR: PR_EDIT_ROLES as unknown as string[],
  BBH: ['R01', 'R02', 'R02a'],
  WBS: ['R01', 'R02', 'R02a'],
  WELD_PAINT: ['R01', 'R02', 'R02a', 'R04', 'R04a'],
  BOM: ['R01', 'R04', 'R04a'],
  SUPPLIER_QUOTE: QUOTE_EDIT_ROLES as unknown as string[],
} as const

export type FormKey = keyof typeof FORM_EDIT_ROLES

export const KEY_TO_FORM: Record<string, FormKey> = {
  totalMaterial: 'ESTIMATE', totalLabor: 'ESTIMATE', totalService: 'ESTIMATE',
  totalOverhead: 'ESTIMATE', totalEstimate: 'ESTIMATE', dt02Detail: 'ESTIMATE', estimateFileName: 'ESTIMATE',
  bomPr: 'PR',
  momAttendants: 'BBH', momSections: 'BBH', momHeader: 'BBH',
  wbsItems: 'WBS', milestones: 'WBS',
  weldData: 'WELD_PAINT', paintData: 'WELD_PAINT',
  bomItemsList: 'BOM',
  supplierQuotes: 'SUPPLIER_QUOTE', chosenVendorId: 'SUPPLIER_QUOTE',
}

export function canEditForm(form: FormKey, roleCode: string): boolean {
  return (FORM_EDIT_ROLES[form] as readonly string[]).includes(roleCode)
}

// Role-specific group priority: first group = expanded by default
export const ROLE_GROUP_PRIORITY: Record<string, string[]> = {
  R01:  ['overview', 'management', 'project', 'design', 'warehouse', 'production', 'qc', 'hr', 'finance', 'reports', 'system'],
  R02:  ['overview', 'management', 'project', 'design', 'warehouse', 'hr', 'finance', 'reports'],
  R02a: ['overview', 'management', 'project', 'design', 'warehouse', 'hr', 'finance', 'reports'],
  R03:  ['overview', 'management', 'project', 'finance', 'warehouse', 'production', 'qc', 'reports'],
  R03a: ['overview', 'management', 'project', 'finance', 'warehouse', 'production', 'qc', 'reports'],
  R04:  ['overview', 'design', 'project'],
  R04a: ['overview', 'design', 'project'],
  R05:  ['overview', 'warehouse'],
  R05a: ['overview', 'warehouse'],
  R06:  ['overview', 'production', 'warehouse', 'hr', 'qc', 'reports'],
  R06a: ['overview', 'production', 'warehouse', 'hr', 'reports'],
  R06b: ['overview', 'production', 'hr'],
  R07:  ['overview', 'warehouse', 'finance', 'production'],
  R07a: ['overview', 'warehouse', 'finance', 'production'],
  R08:  ['overview', 'finance', 'reports'],
  R08a: ['overview', 'finance', 'reports'],
  R09:  ['overview', 'qc', 'reports'],
  R09a: ['overview', 'qc', 'reports'],
  R10:  ['overview', 'management', 'project', 'design', 'warehouse', 'production', 'qc', 'hr', 'finance', 'reports', 'system'],
  R13:  ['overview', 'production', 'reports'],
}

// ── Menu Items with Group ──

export const MENU_ITEMS = [
  // ── Overview (việc cá nhân / thao tác hàng ngày) ──
  { key: 'dashboard', label: 'Bảng điều khiển', labelEn: 'Dashboard', icon: 'LayoutDashboard', href: '/dashboard', roles: 'all', group: 'overview' },
  // [ẨN: luồng 36 bước cũ — đang test hệ động. Bật lại bằng cách bỏ comment dòng dưới]
  // { key: 'tasks', label: 'Công việc (cũ)', labelEn: 'Tasks (legacy)', icon: 'ClipboardList', href: '/dashboard/tasks', roles: 'all', group: 'overview' },
  { key: 'work', label: 'Công việc', labelEn: 'Work Inbox', icon: 'Inbox', href: '/dashboard/work', roles: 'all', group: 'overview' },
  { key: 'work-team', label: 'Phòng của tôi', labelEn: 'My Department', icon: 'Users', href: '/dashboard/work/team', roles: ['R01', 'R02', 'R03', 'R04', 'R06', 'R08', 'R09', 'R10', 'R13'], group: 'overview' },
  { key: 'work-meetings', label: 'Lịch họp', labelEn: 'Meetings', icon: 'CalendarCheck', href: '/dashboard/work/meetings', roles: 'all', group: 'overview' },
  { key: 'notifications', label: 'Thông báo', labelEn: 'Notifications', icon: 'Bell', href: '/dashboard/notifications', roles: 'all', group: 'overview' },

  // ── Management (điều hành / dashboard cấp quản lý) ──
  { key: 'work-overview', label: 'Tổng quan dự án', labelEn: 'Project Overview', icon: 'PieChart', href: '/dashboard/work/overview', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a'], group: 'management' },
  { key: 'work-briefing', label: 'Giao ban tuần', labelEn: 'Weekly Briefing', icon: 'FileBarChart', href: '/dashboard/work/briefing', roles: 'all', group: 'management' },
  { key: 'work-perf', label: 'Hiệu suất & KPI', labelEn: 'Performance', icon: 'BarChart3', href: '/dashboard/work/performance', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R10'], group: 'management' },

  // ── Project ──
  { key: 'projects', label: 'Dự án', labelEn: 'Projects', icon: 'FolderKanban', href: '/dashboard/projects', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R04', 'R04a', 'R06', 'R06a'], group: 'project' },
  { key: 'milestones', label: 'Cột mốc', labelEn: 'Milestones', icon: 'Target', href: '/dashboard/milestones', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a'], group: 'project' },
  { key: 'subcontracts', label: 'Thầu phụ', labelEn: 'Subcontracts', icon: 'Handshake', href: '/dashboard/subcontracts', roles: ['R01', 'R02', 'R02a', 'R07', 'R07a'], group: 'project' },
  { key: 'lessons', label: 'Bài học kinh nghiệm', labelEn: 'Lessons', icon: 'BookOpen', href: '/dashboard/lessons', roles: ['R01', 'R02', 'R02a'], group: 'project' },
  { key: 'safety', label: 'An toàn', labelEn: 'Safety', icon: 'HardHat', href: '/dashboard/safety', roles: ['R01', 'R02', 'R02a', 'R06', 'R06a', 'R09', 'R09a'], group: 'project' },

  // ── Design ──
  { key: 'design', label: 'Thiết kế', labelEn: 'Design', icon: 'Pencil', href: '/dashboard/design', roles: ['R01', 'R04', 'R04a', 'R02', 'R02a'], group: 'design' },
  { key: 'bom', label: 'Định mức vật tư', labelEn: 'BOM', icon: 'Layers', href: '/dashboard/design/bom', roles: ['R01', 'R04', 'R04a', 'R02', 'R02a'], group: 'design' },
  { key: 'drawings', label: 'Bản vẽ', labelEn: 'Drawings', icon: 'Ruler', href: '/dashboard/design/drawings', roles: ['R01', 'R04', 'R04a', 'R02', 'R02a'], group: 'design' },
  { key: 'eco', label: 'Thay đổi TK', labelEn: 'ECO', icon: 'RefreshCw', href: '/dashboard/design/eco', roles: ['R01', 'R04', 'R04a', 'R02', 'R02a', 'R06'], group: 'design' },

  // ── Warehouse ──
  { key: 'warehouse', label: 'Kho', labelEn: 'Warehouse', icon: 'Package', href: '/dashboard/warehouse', roles: ['R01', 'R03', 'R03a', 'R05', 'R05a'], group: 'warehouse' },
  { key: 'material-codes', label: 'Quản lý mã vật tư', labelEn: 'Material Codes', icon: 'Barcode', href: '/dashboard/warehouse/material-codes', roles: ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R10'], group: 'warehouse' },
  { key: 'procurement', label: 'Mua hàng', labelEn: 'Procurement', icon: 'ShoppingCart', href: '/dashboard/warehouse/procurement', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'], group: 'warehouse' },
  { key: 'purchase-requests', label: 'Đề nghị mua hàng', labelEn: 'PR', icon: 'FileInput', href: '/dashboard/warehouse/purchase-requests', roles: ['R01', 'R07', 'R07a'], group: 'warehouse' },
  { key: 'purchase-orders', label: 'Đơn đặt hàng', labelEn: 'PO', icon: 'FileOutput', href: '/dashboard/warehouse/purchase-orders', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'], group: 'warehouse' },
  { key: 'movements', label: 'Xuất Nhập', labelEn: 'Movements', icon: 'ArrowLeftRight', href: '/dashboard/warehouse/movements', roles: ['R01', 'R05', 'R05a'], group: 'warehouse' },
  { key: 'grn', label: 'Nhận hàng', labelEn: 'GRN', icon: 'PackageCheck', href: '/dashboard/warehouse/grn', roles: ['R01', 'R05', 'R05a', 'R07', 'R07a'], group: 'warehouse' },
  { key: 'material-issue', label: 'Cấp phát vật tư', labelEn: 'Mat Issue', icon: 'PackageMinus', href: '/dashboard/warehouse/material-issue', roles: ['R01', 'R05', 'R05a', 'R06', 'R06a'], group: 'warehouse' },
  { key: 'vendors', label: 'Nhà cung cấp', labelEn: 'Vendors', icon: 'Building', href: '/dashboard/vendors', roles: ['R01', 'R02', 'R02a', 'R07', 'R07a'], group: 'warehouse' },

  // ── Production ──
  { key: 'production', label: 'Sản xuất', labelEn: 'Production', icon: 'Factory', href: '/dashboard/production', roles: ['R01', 'R03', 'R03a', 'R06', 'R06a', 'R06b'], group: 'production' },
  { key: 'jobcards', label: 'Phiếu công việc', labelEn: 'Job Cards', icon: 'Clipboard', href: '/dashboard/production/job-cards', roles: ['R01', 'R06', 'R06a', 'R06b'], group: 'production' },
  { key: 'workshops', label: 'Phân xưởng', labelEn: 'Workshops', icon: 'Wrench', href: '/dashboard/production/workshops', roles: ['R01', 'R06', 'R06a'], group: 'production' },
  { key: 'delivery', label: 'Giao hàng', labelEn: 'Delivery', icon: 'Truck', href: '/dashboard/delivery', roles: ['R01', 'R06', 'R06a', 'R07', 'R07a'], group: 'production' },

  // ── QC ──
  { key: 'qc', label: 'Chất lượng', labelEn: 'QC', icon: 'ShieldCheck', href: '/dashboard/qc', roles: ['R01', 'R03', 'R03a', 'R09', 'R09a'], group: 'qc' },
  { key: 'inspections', label: 'Kiểm tra', labelEn: 'Inspections', icon: 'SearchCheck', href: '/dashboard/qc/inspections', roles: ['R01', 'R09', 'R09a'], group: 'qc' },
  { key: 'itp', label: 'Kế hoạch KT', labelEn: 'ITP', icon: 'FileCheck', href: '/dashboard/qc/itp', roles: ['R01', 'R09', 'R09a'], group: 'qc' },
  { key: 'ncr', label: 'Báo cáo KPH', labelEn: 'NCR', icon: 'AlertTriangle', href: '/dashboard/qc/ncr', roles: ['R01', 'R09', 'R09a', 'R06', 'R06a'], group: 'qc' },
  { key: 'certificates', label: 'Chứng chỉ', labelEn: 'Certificates', icon: 'Award', href: '/dashboard/qc/certificates', roles: ['R01', 'R09', 'R09a'], group: 'qc' },
  { key: 'mill-certs', label: 'Chứng chỉ VL', labelEn: 'Mill Certs', icon: 'FileText', href: '/dashboard/qc/mill-certificates', roles: ['R01', 'R09', 'R09a'], group: 'qc' },
  { key: 'fat-sat', label: 'Nghiệm thu NM/HT', labelEn: 'FAT/SAT', icon: 'TestTube', href: '/dashboard/qc/fat-sat', roles: ['R01', 'R09', 'R09a'], group: 'qc' },
  { key: 'mrb', label: 'Hồ sơ chất lượng', labelEn: 'MRB Dossier', icon: 'FolderCheck', href: '/dashboard/qc/mrb', roles: ['R01', 'R09', 'R09a'], group: 'qc' },

  // ── HR ──
  { key: 'hr', label: 'Nhân sự', labelEn: 'HR', icon: 'UserCheck', href: '/dashboard/hr', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'employees', label: 'Nhân viên', labelEn: 'Employees', icon: 'Contact', href: '/dashboard/hr/employees', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'salary', label: 'Bảng lương', labelEn: 'Salary', icon: 'DollarSign', href: '/dashboard/hr/salary', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'timesheets', label: 'Chấm công', labelEn: 'Timesheets', icon: 'Clock', href: '/dashboard/hr/timesheets', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'attendance', label: 'Điểm danh', labelEn: 'Attendance', icon: 'CalendarCheck', href: '/dashboard/hr/attendance', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'departments', label: 'Phòng ban', labelEn: 'Departments', icon: 'Building2', href: '/dashboard/hr/departments', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'contracts', label: 'Hợp đồng lao động', labelEn: 'Contracts', icon: 'FileSignature', href: '/dashboard/hr/contracts', roles: ['R01', 'R02', 'R02a'], group: 'hr' },
  { key: 'piece-rate', label: 'Hợp đồng khoán', labelEn: 'Piece Rate', icon: 'Hammer', href: '/dashboard/hr/piece-rate', roles: ['R01', 'R02', 'R02a', 'R06', 'R06a'], group: 'hr' },
  { key: 'piece-rate-output', label: 'Khối lượng khoán', labelEn: 'Output', icon: 'BarChart', href: '/dashboard/hr/piece-rate-output', roles: ['R01', 'R02', 'R02a', 'R06', 'R06a', 'R06b'], group: 'hr' },

  // ── Finance ──
  { key: 'finance', label: 'Tài chính', labelEn: 'Finance', icon: 'Receipt', href: '/dashboard/finance', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R07', 'R07a', 'R08', 'R08a'], group: 'finance' },
  { key: 'invoices', label: 'Hóa đơn', labelEn: 'Invoices', icon: 'FileSpreadsheet', href: '/dashboard/finance/invoices', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R07', 'R07a', 'R08', 'R08a'], group: 'finance' },
  { key: 'cashflow', label: 'Dòng tiền', labelEn: 'Cashflow', icon: 'TrendingUp', href: '/dashboard/finance/cashflow', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'], group: 'finance' },
  { key: 'cashflow-entries', label: 'Bút toán', labelEn: 'Entries', icon: 'Receipt', href: '/dashboard/finance/cashflow-entries', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'], group: 'finance' },
  { key: 'payments', label: 'Thanh toán', labelEn: 'Payments', icon: 'CreditCard', href: '/dashboard/finance/payments', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'], group: 'finance' },
  { key: 'budgets', label: 'Ngân sách', labelEn: 'Budgets', icon: 'PieChart', href: '/dashboard/finance/budgets', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'], group: 'finance' },
  { key: 'settlement', label: 'Quyết toán', labelEn: 'Settlement', icon: 'Calculator', href: '/dashboard/finance/settlement', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a'], group: 'finance' },

  // ── Reports ──
  { key: 'reports', label: 'Báo cáo', labelEn: 'Reports', icon: 'BarChart3', href: '/dashboard/reports', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R06', 'R06a', 'R08', 'R08a', 'R09', 'R09a', 'R13'], group: 'reports' },
  { key: 'audit-log', label: 'Nhật ký', labelEn: 'Audit Log', icon: 'ScrollText', href: '/dashboard/audit-log', roles: ['R01', 'R10'], group: 'reports' },
  { key: 'error-logs', label: 'Error Logs', labelEn: 'Error Logs', icon: 'AlertTriangle', href: '/dashboard/admin/error-logs', roles: ['R01', 'R10'], group: 'reports' },

  // ── System ──
  { key: 'users', label: 'Người dùng', labelEn: 'Users', icon: 'Users', href: '/dashboard/users', roles: ['R01', 'R10'], group: 'system' },
  { key: 'admin', label: 'Quản trị hệ thống', labelEn: 'Admin Dashboard', icon: 'Shield', href: '/dashboard/admin', roles: ['R01', 'R10'], group: 'system' },
  { key: 'work-templates', label: 'Quy trình & Template', labelEn: 'Templates', icon: 'Settings', href: '/dashboard/work/templates', roles: ['R01', 'R02', 'R10'], group: 'system' },
  { key: 'settings', label: 'Cài đặt', labelEn: 'Settings', icon: 'Settings', href: '/dashboard/settings', roles: 'all', group: 'system' },
  { key: 'style-guide', label: 'Design System', labelEn: 'Style Guide', icon: 'Ruler', href: '/dashboard/style-guide', roles: ['R10'], group: 'system' },
] as const

// [ẨN tạm các module chưa ổn — P1 đã hé lộ 14 trang hoạt động tốt]
export const HIDDEN_MENU_KEYS = new Set<string>([
  'design', 'purchase-requests',
  'material-issue', 'movements', 'workshops', 'delivery', 'fat-sat',
])

export const PAGE_ACCESS: Record<string, readonly string[] | 'all'> = Object.fromEntries(
  MENU_ITEMS.map(item => [item.href, item.roles])
)
