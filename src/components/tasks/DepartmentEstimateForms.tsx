'use client'

import EstimateTable, { type EstColumn, type EstRow } from './EstimateTable'

// Department Estimate Forms for P2.1A (TCKT), P2.1B (TM), P2.1C (SX), P2.4 (aggregation)

interface DepartmentEstimateFormsProps {
  stepCode: string
  formData: Record<string, string | number>
  onFieldChange: (key: string, value: string) => void
  isActive: boolean
}

// ── Shared column definitions ──
const colsVTTH: EstColumn[] = [
  { key: 'nhomVT', label: 'Nhóm VT', width: '0.8fr' },
  { key: 'danhMuc', label: 'Danh mục VT', width: '1.5fr' },
  { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
  { key: 'kl', label: 'KL/SL', type: 'number', width: '0.6fr' },
  { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.8fr' },
  { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.8fr' },
]
const colsVTCT: EstColumn[] = [
  { key: 'maVT', label: 'Mã VT', width: '0.7fr' },
  { key: 'tenVT', label: 'Tên VT', width: '1.2fr' },
  { key: 'macVL', label: 'Mác VL', width: '0.6fr' },
  { key: 'quyCach', label: 'Quy cách', width: '0.7fr' },
  { key: 'dvt', label: 'ĐVT', width: '0.4fr' },
  { key: 'kl', label: 'KL/SL', type: 'number', width: '0.5fr' },
  { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
  { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
]
const colsDV: EstColumn[] = [
  { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
  { key: 'noiDung', label: 'Nội dung công việc', width: '1.5fr' },
  { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
  { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
  { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
  { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
]
const colsNC = colsDV
const colsCPChung: EstColumn[] = [
  { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
  { key: 'danhMuc', label: 'Danh mục chi phí', width: '1.5fr' },
  { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
  { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
  { key: 'donGia', label: 'Đơn giá BQ', type: 'number', width: '0.7fr' },
  { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
]

// ── Default row data ──
const DT02_ROWS: EstRow[] = [
  { maCP: 'I', noiDung: 'Chi phí vật tư', giaTri: '', tyLe: '' },
  { maCP: 'I-1', noiDung: 'Vật tư chính', giaTri: '', tyLe: '' },
  { maCP: 'I-2', noiDung: 'Vật tư phụ kiện, bu lông…', giaTri: '', tyLe: '' },
  { maCP: 'I-3', noiDung: 'Vật tư đóng kiện', giaTri: '', tyLe: '' },
  { maCP: 'I-4', noiDung: 'Vật tư làm biện pháp', giaTri: '', tyLe: '' },
  { maCP: 'I-5', noiDung: 'Vật tư tiêu hao', giaTri: '', tyLe: '' },
  { maCP: 'I-6', noiDung: 'Vật tư sơn', giaTri: '', tyLe: '' },
  { maCP: 'I-7', noiDung: 'Vật tư dự phòng', giaTri: '', tyLe: '' },
  { maCP: 'II', noiDung: 'Chi phí nhân công trực tiếp', giaTri: '', tyLe: '' },
  { maCP: 'II-1', noiDung: 'Pha cắt', giaTri: '', tyLe: '' },
  { maCP: 'II-2', noiDung: 'Gia công', giaTri: '', tyLe: '' },
  { maCP: 'II-3', noiDung: 'Chế tạo', giaTri: '', tyLe: '' },
  { maCP: 'II-4', noiDung: 'Khung kiện', giaTri: '', tyLe: '' },
  { maCP: 'II-5', noiDung: 'Tổ hợp sản phẩm', giaTri: '', tyLe: '' },
  { maCP: 'II-6', noiDung: 'Lắp dựng + Nghiệm thu', giaTri: '', tyLe: '' },
  { maCP: 'II-7', noiDung: 'Làm sạch, Sơn', giaTri: '', tyLe: '' },
  { maCP: 'II-8', noiDung: 'Đóng kiện / Giao hàng', giaTri: '', tyLe: '' },
  { maCP: 'II-9', noiDung: 'Nhân công dự phòng', giaTri: '', tyLe: '' },
  { maCP: 'III', noiDung: 'Chi phí dịch vụ thuê ngoài', giaTri: '', tyLe: '' },
  { maCP: 'III-1', noiDung: 'Vận tải', giaTri: '', tyLe: '' },
  { maCP: 'III-2', noiDung: 'NDT, quy trình và thí nghiệm', giaTri: '', tyLe: '' },
  { maCP: 'III-3', noiDung: 'Mạ kẽm', giaTri: '', tyLe: '' },
  { maCP: 'III-4', noiDung: 'Chi phí khác', giaTri: '', tyLe: '' },
  { maCP: 'III-5', noiDung: 'Dự phòng dịch vụ', giaTri: '', tyLe: '' },
  { maCP: 'IV', noiDung: 'Chi phí chung', giaTri: '', tyLe: '' },
  { maCP: 'IV-1', noiDung: 'Chi phí chung phục vụ SX', giaTri: '', tyLe: '' },
  { maCP: 'IV-2', noiDung: 'Chi phí tài chính', giaTri: '', tyLe: '' },
  { maCP: 'IV-3', noiDung: 'Chi phí quản lý', giaTri: '', tyLe: '' },
]

const DT07_ROWS: EstRow[] = [
  { maCP: 'CPC', danhMuc: 'I. Chi phí chung phục vụ sản xuất', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-01', danhMuc: 'Nhân công (ngoài khoán)', dvt: 'Người', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-02', danhMuc: 'Thuê công nhân thời vụ', dvt: 'Người', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-03', danhMuc: 'Khấu hao TSCĐ', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-04', danhMuc: 'Sửa chữa máy móc thiết bị', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-05', danhMuc: 'Điện sản xuất', dvt: 'kWh', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-06', danhMuc: 'Nước sản xuất', dvt: 'm³', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-07', danhMuc: 'Khí nén (Oxy, Acetylen…)', dvt: 'Chai', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-08', danhMuc: 'Nhiên liệu (dầu, xăng)', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-09', danhMuc: 'Chi phí an toàn lao động', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CPC-10', danhMuc: 'Chi phí SX khác', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CTC', danhMuc: 'II. Chi phí tài chính', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CTC-01', danhMuc: 'Phí bảo lãnh thực hiện HĐ', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CTC-02', danhMuc: 'Phí bảo lãnh tạm ứng', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CTC-03', danhMuc: 'Phí bảo lãnh bảo hành', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CTC-04', danhMuc: 'Lãi vay ngân hàng', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CTC-05', danhMuc: 'Bảo hiểm dự án', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CQL', danhMuc: 'III. Chi phí Quản Lý', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CQL-01', danhMuc: 'Lương nhân viên gián tiếp', dvt: 'Người', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CQL-02', danhMuc: 'Văn phòng phẩm', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CQL-03', danhMuc: 'Bảo vệ, an ninh', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CQL-04', danhMuc: 'Chi phí tiếp khách', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'CQL-05', danhMuc: 'Chi phí quản lý khác', dvt: '', kl: '', donGia: '', thanhTien: '' },
]

const DT03_ROWS: EstRow[] = [
  { nhomVT: 'VTC', danhMuc: 'Vật tư chính', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTC-01', danhMuc: 'Thép đen các loại', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTC-02', danhMuc: 'Inox các loại', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTC-03', danhMuc: 'Grating', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTP', danhMuc: 'Vật tư phụ', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTPCK', danhMuc: 'Vật tư phụ kiện, bu lông…', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTDK', danhMuc: 'Vật tư đóng kiện', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTBP', danhMuc: 'Vật tư làm biện pháp', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTBP-01', danhMuc: 'Thép đen các loại (biện pháp)', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTBP-TH', danhMuc: 'Thu hồi lại vật tư biện pháp (75% giá trị)', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTTH', danhMuc: 'Vật tư tiêu hao', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTTH-01', danhMuc: 'Que hàn các loại', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTTH-02', danhMuc: 'Dây hàn', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTTH-03', danhMuc: 'Khí hàn (Argon, CO2…)', dvt: 'Chai', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTTH-04', danhMuc: 'Đá cắt, đá mài', dvt: 'Viên', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTS', danhMuc: 'Vật tư sơn', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTS-01', danhMuc: 'Sơn lót', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTS-02', danhMuc: 'Sơn phủ', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTS-03', danhMuc: 'Dung môi, phụ gia sơn', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
  { nhomVT: 'VTDP', danhMuc: 'Vật tư dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
]

const DT04_ROWS: EstRow[] = [
  { maVT: 'A', tenVT: 'VTC — Vật tư chính', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: 'A2', tenVT: 'Vật tư còn lại (chưa có chi tiết)', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: 'B', tenVT: 'VT04 — Vật tư phụ kiện, bu lông…', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: 'C', tenVT: 'VTDK — Vật tư đóng kiện', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: 'D', tenVT: 'VTBP — Vật tư làm biện pháp', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: 'E', tenVT: 'VTTH — Vật tư tiêu hao', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: 'F', tenVT: 'VTDP — Vật tư dự phòng', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
]

const DT05_ROWS: EstRow[] = [
  { maCP: 'A', noiDung: 'VẬN TẢI', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'A-01', noiDung: 'Vận chuyển nội bộ', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'A-02', noiDung: 'Vận chuyển giao hàng', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B', noiDung: 'NDT, QUY TRÌNH VÀ THÍ NGHIỆM', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-01', noiDung: 'Chụp phim RT', dvt: 'Phim', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-02', noiDung: 'Siêu âm UT', dvt: 'Mối', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-03', noiDung: 'Kiểm tra PT/MT', dvt: 'Mối', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-04', noiDung: 'Thử áp lực (Hydro test)', dvt: 'Lần', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C', noiDung: 'MẠ KẼM', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-01', noiDung: 'Mạ kẽm nhúng nóng', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'D', noiDung: 'CÁC CHI PHÍ KHÁC', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'D-01', noiDung: 'Chi phí dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
]

const DT06_ROWS: EstRow[] = [
  { maCP: 'A', noiDung: 'PC — PHA CẮT', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'A-01', noiDung: 'Pha cắt thép tấm', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'A-02', noiDung: 'Pha cắt thép hình', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'A-03', noiDung: 'Pha cắt ống', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B', noiDung: 'GC — GIA CÔNG', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-01', noiDung: 'Gia công CNC / Plasma', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-02', noiDung: 'Uốn, dập, khoan, tiện', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'B-03', noiDung: 'Vát mép, chuẩn bị mối hàn', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C', noiDung: 'CT — CHẾ TẠO', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-01', noiDung: 'Chế tạo - Roller frame', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-02', noiDung: 'Chế tạo - Slewing frame', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-03', noiDung: 'Chế tạo - Platform / Sàn', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-04', noiDung: 'Chế tạo - Lan can', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-05', noiDung: 'Chế tạo - Giá đỡ', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-06', noiDung: 'Chế tạo - Ống', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-07', noiDung: 'Chế tạo - Hộp', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-08', noiDung: 'Chế tạo - Cầu thang', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'C-09', noiDung: 'Chế tạo - Khác', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'D', noiDung: 'KK — KHUNG KIỆN', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'D-01', noiDung: 'Khung kiện', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'E', noiDung: 'TH — TỔ HỢP SẢN PHẨM', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'E-01', noiDung: 'Tổ hợp sản phẩm', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'F', noiDung: 'LD — LẮP DỰNG + NGHIỆM THU', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'F-01', noiDung: 'Lắp dựng + Nghiệm thu', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'G', noiDung: 'VS — VỆ SINH HỢP KIM', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'G-01', noiDung: 'Vệ sinh VL hợp kim bằng dung dịch', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'H', noiDung: 'SON — LÀM SẠCH, SƠN', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'H-01', noiDung: 'Làm sạch bề mặt (bi, cát)', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'H-02', noiDung: 'Sơn (lót + phủ)', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'I', noiDung: 'BO — BẢO ÔN', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'I-01', noiDung: 'Bảo ôn', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'J', noiDung: 'LTB — LẮP THIẾT BỊ', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'J-01', noiDung: 'Lắp thiết bị phụ kiện trước đóng kiện', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'K', noiDung: 'DK — ĐÓNG KIỆN', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'K-01', noiDung: 'Đóng kiện', dvt: 'Kiện', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'L', noiDung: 'GH — GIAO HÀNG', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'L-01', noiDung: 'Giao hàng', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'M', noiDung: 'DP — NHÂN CÔNG DỰ PHÒNG', dvt: '', kl: '', donGia: '', thanhTien: '' },
  { maCP: 'M-01', noiDung: 'Nhân công dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
]

const DT02_COLS: EstColumn[] = [
  { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
  { key: 'noiDung', label: 'Nội dung chi phí', width: '1.5fr' },
  { key: 'giaTri', label: 'Giá trị', type: 'number', width: '0.8fr' },
  { key: 'tyLe', label: 'Tỷ lệ %', type: 'number', width: '0.5fr' },
]

export default function DepartmentEstimateForms({
  stepCode, formData, onFieldChange, isActive,
}: DepartmentEstimateFormsProps) {
  const props = { formData, onFieldChange, isActive }

  // P2.1A: TCKT (DT02 + DT07)
  if (stepCode === 'P2.1A') return (
    <>
      <EstimateTable title="📊 DT02 — Tổng hợp chi phí dự toán thi công" code="QT30-DT02" dataKey="dt02Items"
        columns={DT02_COLS} defaultRows={DT02_ROWS} {...props} />
      <EstimateTable title="🏢 DT07 — Chi phí chung, chi phí tài chính" code="QT30-DT07" dataKey="dt07Items"
        columns={colsCPChung} defaultRows={DT07_ROWS} {...props} />
    </>
  )

  // P2.1B: TM (DT03 + DT04 + DT05)
  if (stepCode === 'P2.1B') return (
    <>
      <EstimateTable title="📦 DT03 — Dự toán chi phí VT tổng hợp" code="QT30-DT03" dataKey="dt03Items"
        columns={colsVTTH} defaultRows={DT03_ROWS} {...props} />
      <EstimateTable title="📋 DT04 — Dự toán chi tiết VT" code="QT30-DT04" dataKey="dt04Items"
        columns={colsVTCT} defaultRows={DT04_ROWS} {...props} />
      <EstimateTable title="🔧 DT05 — Dự toán chi phí dịch vụ" code="QT30-DT05" dataKey="dt05Items"
        columns={colsDV} defaultRows={DT05_ROWS} {...props} />
    </>
  )

  // P2.1C: SX (DT06)
  if (stepCode === 'P2.1C') return (
    <EstimateTable title="👷 DT06 — Dự toán chi phí nhân công trực tiếp" code="QT30-DT06" dataKey="dt06Items"
      columns={colsNC} defaultRows={DT06_ROWS} {...props} />
  )

  // P2.4: Aggregation view — all DT tables
  if (stepCode === 'P2.4') return (
    <>
      <div className="card" style={{ padding: '1rem', marginTop: '1rem', background: 'var(--bg-secondary)', borderLeft: '4px solid #f59e0b' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: '#f59e0b' }}>📋 Tổng hợp dự toán từ các phòng ban</h3>
        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dữ liệu được tổng hợp từ P2.1A (TCKT), P2.1B (TM), P2.1C (SX). KTKH có thể điều chỉnh trước khi trình duyệt.</p>
      </div>
      <EstimateTable title="📊 DT02 — Tổng hợp chi phí dự toán thi công (TCKT)" code="QT30-DT02" dataKey="dt02Items"
        columns={DT02_COLS} defaultRows={[{ maCP: 'I', noiDung: 'Chi phí vật tư', giaTri: '', tyLe: '' }]} {...props} />
      <EstimateTable title="📦 DT03 — Dự toán chi phí VT tổng hợp (TM)" code="QT30-DT03" dataKey="dt03Items"
        columns={colsVTTH} defaultRows={[{ nhomVT: 'VTC', danhMuc: 'Vật tư chính', dvt: '', kl: '', donGia: '', thanhTien: '' }]} {...props} />
      <EstimateTable title="📋 DT04 — Dự toán chi tiết VT (TM)" code="QT30-DT04" dataKey="dt04Items"
        columns={colsVTCT} defaultRows={[{ maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' }]} {...props} />
      <EstimateTable title="🔧 DT05 — Dự toán chi phí dịch vụ (TM)" code="QT30-DT05" dataKey="dt05Items"
        columns={colsDV} defaultRows={[{ maCP: '', noiDung: '', dvt: '', kl: '', donGia: '', thanhTien: '' }]} {...props} />
      <EstimateTable title="👷 DT06 — Dự toán chi phí nhân công trực tiếp (SX)" code="QT30-DT06" dataKey="dt06Items"
        columns={colsNC} defaultRows={[{ maCP: '', noiDung: '', dvt: '', kl: '', donGia: '', thanhTien: '' }]} {...props} />
      <EstimateTable title="🏢 DT07 — Chi phí chung, chi phí tài chính (TCKT)" code="QT30-DT07" dataKey="dt07Items"
        columns={colsCPChung} defaultRows={[{ maCP: '', danhMuc: '', dvt: '', kl: '', donGia: '', thanhTien: '' }]} {...props} />
    </>
  )

  return null
}
