export const RBAC = {
  // Sản xuất: Giám đốc (R01), QLSX (R06), Xưởng SX (R06a), Tổ SX (R06b), Admin (R00)
  PRODUCTION_ACTION: ['R01', 'R06', 'R06a', 'R06b', 'R00'],
  
  // QC: Giám đốc (R01), Tp QC (R09a), QC (R09), Admin (R00)
  QC_ACTION: ['R01', 'R09', 'R09a', 'R00'],
  
  // Kho: Giám đốc (R01), Thủ kho (R05), Admin (R00)
  STORE_ACTION: ['R01', 'R05', 'R00'],
  
  // Mua hàng (Duyệt PR): Giám đốc (R01), PM (R02), Admin (R00)
  PR_APPROVAL: ['R01', 'R02', 'R00'],
  
  // Thầu phụ: Giám đốc (R01), Thương mại (R07), TCKT (R08)
  SUBCONTRACT_ACTION: ['R01', 'R07', 'R08', 'R00'],

  // Quản lý danh mục mã vật tư (tạo/sửa/duyệt mã, alias): BGĐ, KTKH, Kho, Admin
  MATERIAL_CODE_ADMIN: ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R10', 'R00'],

  // Promote mã tạm → mã chuẩn: BGĐ, KTKH, Kho, Admin
  MATERIAL_CODE_PROMOTE: ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R10', 'R00'],

  // Gộp mã trùng — thao tác rủi ro cao, chỉ BGĐ + Admin
  MATERIAL_CODE_MERGE: ['R01', 'R10', 'R00'],

  // Định mức tiêu hao: BGĐ, KTKH (trưởng + NV)
  NORM_ACTION: ['R01', 'R03', 'R03a'],
}
