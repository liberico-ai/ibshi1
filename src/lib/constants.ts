// ── Role Codes ──
export const ROLES = {
  R01: { code: 'R01', name: 'Ban Giám đốc', nameEn: 'Board of Directors' },
  R02: { code: 'R02', name: 'Quản lý Dự án', nameEn: 'Project Manager' },
  R02a: { code: 'R02a', name: 'Phó Quản lý DA', nameEn: 'Deputy PM' },
  R03: { code: 'R03', name: 'Kinh tế Kế hoạch', nameEn: 'Planning & Economics' },
  R03a: { code: 'R03a', name: 'Phó Kinh tế KH', nameEn: 'Deputy Planning' },
  R04: { code: 'R04', name: 'Thiết kế', nameEn: 'Engineering' },
  R04a: { code: 'R04a', name: 'Phó Thiết kế', nameEn: 'Deputy Engineering' },
  R05: { code: 'R05', name: 'Kho', nameEn: 'Warehouse' },
  R05a: { code: 'R05a', name: 'Phó Kho', nameEn: 'Deputy Warehouse' },
  R06: { code: 'R06', name: 'Quản lý Sản xuất', nameEn: 'Production Manager' },
  R06a: { code: 'R06a', name: 'Phó Sản xuất', nameEn: 'Deputy Production' },
  R06b: { code: 'R06b', name: 'Tổ trưởng sản xuất', nameEn: 'Team Leader' },
  R07: { code: 'R07', name: 'Thương mại', nameEn: 'Commercial' },
  R07a: { code: 'R07a', name: 'Phó Thương mại', nameEn: 'Deputy Commercial' },
  R08: { code: 'R08', name: 'Kế toán', nameEn: 'Accounting' },
  R08a: { code: 'R08a', name: 'Phó Kế toán', nameEn: 'Deputy Accounting' },
  R09: { code: 'R09', name: 'Chất lượng (QC)', nameEn: 'Quality Control' },
  R09a: { code: 'R09a', name: 'Kiểm tra viên', nameEn: 'Inspector' },
  R10: { code: 'R10', name: 'Quản trị Hệ thống', nameEn: 'System Admin' },
} as const

export type RoleCode = keyof typeof ROLES

// ── Departments ──
export const DEPARTMENTS = [
  { code: 'BGD', name: 'Ban Giám đốc', nameEn: 'Board of Directors' },
  { code: 'QLDA', name: 'Quản lý Dự án', nameEn: 'Project Management' },
  { code: 'KTKH', name: 'Kinh tế Kế hoạch', nameEn: 'Planning & Economics' },
  { code: 'TK', name: 'Thiết kế', nameEn: 'Engineering' },
  { code: 'KHO', name: 'Kho vận', nameEn: 'Warehouse & Logistics' },
  { code: 'SX', name: 'Sản xuất', nameEn: 'Production' },
  { code: 'TM', name: 'Thương mại', nameEn: 'Commercial' },
  { code: 'KT', name: 'Kế toán', nameEn: 'Accounting' },
  { code: 'QC', name: 'Chất lượng', nameEn: 'Quality Control' },
  { code: 'HCNS', name: 'Hành chính Nhân sự', nameEn: 'HR & Admin' },
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
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED',
  REJECTED: 'REJECTED',
} as const

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

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
  { key: 'project', label: 'Dự án', labelEn: 'Projects', icon: '📁', priority: 1 },
  { key: 'design', label: 'Thiết kế', labelEn: 'Design', icon: '✏️', priority: 2 },
  { key: 'warehouse', label: 'Kho & Mua hàng', labelEn: 'Warehouse', icon: '📦', priority: 3 },
  { key: 'production', label: 'Sản xuất', labelEn: 'Production', icon: '🏭', priority: 4 },
  { key: 'qc', label: 'Chất lượng', labelEn: 'Quality', icon: '✅', priority: 5 },
  { key: 'hr', label: 'Nhân sự', labelEn: 'HR', icon: '👤', priority: 6 },
  { key: 'finance', label: 'Tài chính', labelEn: 'Finance', icon: '💰', priority: 7 },
  { key: 'reports', label: 'Báo cáo', labelEn: 'Reports', icon: '📊', priority: 8 },
  { key: 'system', label: 'Hệ thống', labelEn: 'System', icon: '⚙️', priority: 9 },
] as const

// Role-specific group priority: first group = expanded by default
export const ROLE_GROUP_PRIORITY: Record<string, string[]> = {
  R01:  ['overview', 'project', 'design', 'warehouse', 'production', 'qc', 'hr', 'finance', 'reports', 'system'],
  R02:  ['overview', 'project', 'design', 'warehouse', 'hr', 'finance', 'reports'],
  R02a: ['overview', 'project', 'design', 'warehouse', 'hr', 'finance', 'reports'],
  R03:  ['overview', 'project', 'finance', 'warehouse', 'production', 'qc', 'reports'],
  R03a: ['overview', 'project', 'finance', 'warehouse', 'production', 'qc', 'reports'],
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
  R10:  ['overview', 'project', 'design', 'warehouse', 'production', 'qc', 'hr', 'finance', 'reports', 'system'],
}

// ── Menu Items with Group ──

export const MENU_ITEMS = [
  // ── Overview ──
  { key: 'dashboard', label: 'Bảng điều khiển', labelEn: 'Dashboard', icon: 'LayoutDashboard', href: '/dashboard', roles: 'all', group: 'overview' },
  { key: 'tasks', label: 'Công việc', labelEn: 'Tasks', icon: 'ClipboardList', href: '/dashboard/tasks', roles: 'all', group: 'overview' },
  { key: 'notifications', label: 'Thông báo', labelEn: 'Notifications', icon: 'Bell', href: '/dashboard/notifications', roles: 'all', group: 'overview' },

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
  { key: 'procurement', label: 'Mua hàng', labelEn: 'Procurement', icon: 'ShoppingCart', href: '/dashboard/warehouse/procurement', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'], group: 'warehouse' },
  { key: 'purchase-requests', label: 'Đề nghị mua hàng', labelEn: 'PR', icon: 'FileInput', href: '/dashboard/warehouse/purchase-requests', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a'], group: 'warehouse' },
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
  { key: 'reports', label: 'Báo cáo', labelEn: 'Reports', icon: 'BarChart3', href: '/dashboard/reports', roles: ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R06', 'R06a', 'R08', 'R08a', 'R09', 'R09a'], group: 'reports' },
  { key: 'audit-log', label: 'Nhật ký', labelEn: 'Audit Log', icon: 'ScrollText', href: '/dashboard/audit-log', roles: ['R01', 'R10'], group: 'reports' },
  { key: 'error-logs', label: 'Error Logs', labelEn: 'Error Logs', icon: 'AlertTriangle', href: '/dashboard/admin/error-logs', roles: ['R01', 'R10'], group: 'reports' },

  // ── System ──
  { key: 'users', label: 'Người dùng', labelEn: 'Users', icon: 'Users', href: '/dashboard/users', roles: ['R01', 'R10'], group: 'system' },
  { key: 'admin', label: 'Quản trị hệ thống', labelEn: 'Admin Dashboard', icon: 'Shield', href: '/dashboard/admin', roles: ['R01', 'R10'], group: 'system' },
  { key: 'settings', label: 'Cài đặt', labelEn: 'Settings', icon: 'Settings', href: '/dashboard/settings', roles: 'all', group: 'system' },
] as const
