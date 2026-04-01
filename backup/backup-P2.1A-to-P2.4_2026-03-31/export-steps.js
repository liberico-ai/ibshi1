const XLSX = require('xlsx')

const steps = [
  // Phase 1
  { phase: 1, phaseName: 'Khởi tạo Dự án', code: 'P1.1', name: 'Tạo dự án', role: 'R02', roleName: 'PM', next: 'P1.1B' },
  { phase: 1, phaseName: 'Khởi tạo Dự án', code: 'P1.1B', name: 'BGĐ phê duyệt triển khai', role: 'R01', roleName: 'BGĐ', next: 'P1.2A, P1.2' },
  { phase: 1, phaseName: 'Khởi tạo Dự án', code: 'P1.2A', name: 'PM lập kế hoạch kickoff, WBS, milestones', role: 'R02', roleName: 'PM', next: 'P1.3' },
  { phase: 1, phaseName: 'Khởi tạo Dự án', code: 'P1.2', name: 'Xây dựng dự toán thi công', role: 'R03', roleName: 'KTKH', next: 'P1.3' },
  { phase: 1, phaseName: 'Khởi tạo Dự án', code: 'P1.3', name: 'Phê duyệt kế hoạch kickoff, WBS, milestones', role: 'R01', roleName: 'BGĐ', next: 'P2.1, P2.2, P2.3, P2.1A, P2.1B, P2.1C' },
  // Phase 2
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.1', name: 'Thiết kế xây dựng bản vẽ và đề xuất VT chính', role: 'R04', roleName: 'Thiết kế', next: '—' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.2', name: 'PM đề xuất vật tư hàn và sơn', role: 'R02', roleName: 'PM', next: '—' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.3', name: 'Kho đề xuất vật tư tiêu hao', role: 'R05', roleName: 'Kho', next: '—' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.1A', name: 'Tập hợp thông tin dự toán của Tài chính kế toán', role: 'R08', roleName: 'TCKT', next: '—' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.1B', name: 'Tập hợp thông tin dự toán của Thương mại', role: 'R07', roleName: 'TM', next: '—' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.1C', name: 'Tập hợp thông tin dự toán của Sản xuất', role: 'R06', roleName: 'QLSX', next: '—' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.4', name: 'KTKH lập kế hoạch SX và điều chỉnh dự toán', role: 'R03', roleName: 'KTKH', next: 'P2.5 (Gate: P2.1~P2.1C)' },
  { phase: 2, phaseName: 'Thiết kế & Kỹ thuật', code: 'P2.5', name: 'BGĐ phê duyệt KH SX và dự toán chính thức', role: 'R01', roleName: 'BGĐ', next: 'P3.1, P3.4' },
  // Phase 3
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.1', name: 'PM điều chỉnh kế hoạch và đẩy tiến độ cấp hàng', role: 'R02', roleName: 'PM', next: 'P3.2' },
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.2', name: 'Kho kiểm tra tồn kho và phê duyệt từng item PR', role: 'R05', roleName: 'Kho', next: 'P3.3, P3.5' },
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.3', name: 'PM lập lệnh SX cho thầu phụ và đề nghị cấp VT', role: 'R02', roleName: 'PM', next: '—' },
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.4', name: 'Quản lý SX lập lệnh sản xuất cho tổ nội bộ', role: 'R06', roleName: 'QLSX', next: '—' },
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.5', name: 'Thương mại tìm nhà cung cấp', role: 'R07', roleName: 'TM', next: 'P3.6' },
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.6', name: 'BGĐ phê duyệt báo giá NCC', role: 'R01', roleName: 'BGĐ', next: 'P3.7' },
  { phase: 3, phaseName: 'Cung ứng Vật tư', code: 'P3.7', name: 'Thương mại chốt hàng, ĐK thanh toán, kế hoạch về', role: 'R07', roleName: 'TM', next: 'P4.1, P4.2' },
  // Phase 4
  { phase: 4, phaseName: 'Mua hàng & Nhập kho', code: 'P4.1', name: 'Kế toán nhận yêu cầu và thực hiện thanh toán', role: 'R08', roleName: 'TCKT', next: '—' },
  { phase: 4, phaseName: 'Mua hàng & Nhập kho', code: 'P4.2', name: 'Thương mại theo dõi hàng về và nghiệm thu', role: 'R07', roleName: 'TM', next: 'P4.3' },
  { phase: 4, phaseName: 'Mua hàng & Nhập kho', code: 'P4.3', name: 'QC nghiệm thu chất lượng nhập kho', role: 'R09', roleName: 'QC', next: 'P4.4' },
  { phase: 4, phaseName: 'Mua hàng & Nhập kho', code: 'P4.4', name: 'Kho nghiệm thu số lượng và nhập kho', role: 'R05', roleName: 'Kho', next: 'P4.5' },
  { phase: 4, phaseName: 'Mua hàng & Nhập kho', code: 'P4.5', name: 'Kho đề nghị cấp vật tư cho PM và QLSX', role: 'R05', roleName: 'Kho', next: 'P5.1' },
  // Phase 5
  { phase: 5, phaseName: 'Sản xuất', code: 'P5.1', name: 'Tổ SX thực hiện sản xuất và theo dõi job card', role: 'R06b', roleName: 'Tổ SX', next: 'P5.2' },
  { phase: 5, phaseName: 'Sản xuất', code: 'P5.2', name: 'Tổ SX báo cáo khối lượng hoàn thành theo tuần', role: 'R06b', roleName: 'Tổ SX', next: 'P5.3' },
  { phase: 5, phaseName: 'Sản xuất', code: 'P5.3', name: 'QC nghiệm thu sản phẩm trong quá trình SX', role: 'R09', roleName: 'QC', next: 'P5.4' },
  { phase: 5, phaseName: 'Sản xuất', code: 'P5.4', name: 'PM nghiệm thu khối lượng thực hiện', role: 'R02', roleName: 'PM', next: 'P5.5' },
  { phase: 5, phaseName: 'Sản xuất', code: 'P5.5', name: 'Tổng hợp và tính lương khoán', role: 'R03', roleName: 'KTKH', next: 'P6.1, P6.2, P6.3, P6.4' },
  // Phase 6
  { phase: 6, phaseName: 'Đóng Dự án', code: 'P6.1', name: 'QC tổng hợp hồ sơ chất lượng (Dossier)', role: 'R09', roleName: 'QC', next: '—' },
  { phase: 6, phaseName: 'Đóng Dự án', code: 'P6.2', name: 'Quyết toán chi phí trực tiếp', role: 'R08', roleName: 'TCKT', next: '—' },
  { phase: 6, phaseName: 'Đóng Dự án', code: 'P6.3', name: 'Quyết toán tổng hợp (P&L)', role: 'R03', roleName: 'KTKH', next: '—' },
  { phase: 6, phaseName: 'Đóng Dự án', code: 'P6.4', name: 'Tổ chức Lesson Learned', role: 'R02', roleName: 'PM', next: '—' },
  { phase: 6, phaseName: 'Đóng Dự án', code: 'P6.5', name: 'BGĐ phê duyệt đóng dự án', role: 'R01', roleName: 'BGĐ', next: 'KẾT THÚC (Gate: P6.1~P6.4)' },
]

const headers = ['Phase', 'Tên Phase', 'Mã bước', 'Tiêu đề', 'Mã vai trò', 'Vai trò', 'Bước tiếp theo']
const data = steps.map(s => [s.phase, s.phaseName, s.code, s.name, s.role, s.roleName, s.next])

const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
ws['!cols'] = [
  { wch: 6 },   // Phase
  { wch: 22 },  // Tên Phase
  { wch: 8 },   // Mã bước
  { wch: 55 },  // Tiêu đề
  { wch: 10 },  // Mã vai trò
  { wch: 12 },  // Vai trò
  { wch: 40 },  // Bước tiếp theo
]

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Workflow Steps')
XLSX.writeFile(wb, 'IBS_ERP_Workflow_Steps.xlsx')
console.log('Done! File: IBS_ERP_Workflow_Steps.xlsx')
