// Danh mục 13 chỉ số báo cáo tháng (Tab "Điều hành").
// source: 'auto' = TH tự sinh từ ERP; 'manual' = nhập tay (chưa có nguồn dữ liệu).

export interface ExecIndicator {
  stt: string
  key: string
  label: string
  unit: string
  owner: string       // phòng phụ trách
  deadline: string    // ngày phải điền trong tháng
  source: 'auto' | 'manual'
  note?: string
}

export const EXEC_INDICATORS: ExecIndicator[] = [
  { stt: '1.1', key: 'contract_new_qty',      label: 'Hợp đồng ký mới — Khối lượng', unit: 'kg',               owner: 'KD (Sales)',       deadline: '26', source: 'manual', note: 'Project chưa lưu khối lượng — nhập tay' },
  { stt: '1.2', key: 'contract_new_value',    label: 'Hợp đồng ký mới — Giá trị',    unit: 'VND',              owner: 'KD (Sales)',       deadline: '26', source: 'auto' },
  { stt: '2',   key: 'revenue',               label: 'Doanh thu',                    unit: 'VND',              owner: 'TCKT',             deadline: '26', source: 'auto', note: 'Σ hóa đơn khách trong kỳ' },
  { stt: '3',   key: 'capital_recovery',      label: 'Thu hồi vốn',                  unit: 'VND',              owner: 'KTKH (Planning)',  deadline: '29', source: 'auto' },
  { stt: '4',   key: 'production_value',      label: 'Giá trị sản lượng',            unit: 'VND',              owner: 'TCKT (Finance)',   deadline: '26', source: 'manual', note: 'Chờ chốt công thức — nhập tay' },
  { stt: '5.1', key: 'volume_factory',        label: 'Khối lượng thực hiện — Nhà máy', unit: 'kg',             owner: 'QLDA (PM)',        deadline: '26', source: 'auto' },
  { stt: '5.2', key: 'volume_subcontractor',  label: 'Khối lượng thực hiện — Thầu phụ', unit: 'kg',            owner: 'QLDA (PM)',        deadline: '26', source: 'manual', note: 'Chờ nguồn khối lượng thầu phụ — nhập tay' },
  { stt: '6',   key: 'productivity',          label: 'Năng suất công nhân bình quân', unit: 'tấn/người/tháng', owner: 'KTKH',             deadline: '26', source: 'auto' },
  { stt: '7',   key: 'salary_cost',           label: 'Chi phí lương (gián tiếp/trực tiếp)', unit: 'VND',       owner: 'HCNS (HR)',        deadline: '26', source: 'auto' },
  { stt: '8',   key: 'avg_salary',            label: 'Tiền lương bình quân 1 người/tháng', unit: 'VND/tháng',  owner: 'HCNS (HR)',        deadline: '26', source: 'auto' },
  { stt: '9',   key: 'cost_per_kg',           label: 'Chi phí sản phẩm bình quân',   unit: 'VND/kg',           owner: 'TCKT',             deadline: '26', source: 'manual', note: 'Chờ chốt công thức — nhập tay' },
  { stt: '10',  key: 'labor_cost_per_kg',     label: 'Chi phí nhân công (nhà máy/thầu phụ)', unit: 'VND/kg',   owner: 'TCKT',             deadline: '26', source: 'manual', note: 'Chờ chốt công thức — nhập tay' },
  { stt: '11',  key: 'defect_rate',           label: 'Tỷ lệ sai hỏng / Defect Rate', unit: '%',                owner: 'QAQC',             deadline: '26', source: 'auto' },
  { stt: '12',  key: 'steel_waste_rate',      label: 'Tỷ lệ tiêu hao vật tư thép',   unit: '%',                owner: 'KT (Engineering)', deadline: '26', source: 'manual', note: 'BOM chưa lưu khối lượng thép — nhập tay' },
]

// KPI Kế hoạch năm (nhập tay, lưu trong exec_plan)
export interface ExecAnnualPlan {
  doanhSoKyMoi_ty?: number
  sanLuong_tan?: number
  lntt_ty?: number
  nangSuat?: number
  tongDoanhThu_ty?: number
}

export const AUTO_KEYS = EXEC_INDICATORS.filter(i => i.source === 'auto').map(i => i.key)
export const MANUAL_KEYS = EXEC_INDICATORS.filter(i => i.source === 'manual').map(i => i.key)
