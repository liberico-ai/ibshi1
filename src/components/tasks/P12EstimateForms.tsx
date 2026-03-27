'use client'

import EstimateTable from './EstimateTable'

// P1.2 Estimate Tables: DT03 (VT tổng hợp), DT04 (VT chi tiết), DT05 (dịch vụ), DT06 (nhân công), DT07 (chi phí chung)

interface P12EstimateFormsProps {
  formData: Record<string, string | number>
  onFieldChange: (key: string, value: string) => void
  isActive: boolean
}

export default function P12EstimateForms({ formData, onFieldChange, isActive }: P12EstimateFormsProps) {
  return (
    <>
      {/* DT03 — Dự toán VT tổng hợp (Thương mại) */}
      <EstimateTable
        title="📦 DT03 — Dự toán chi phí VT (Thương mại)" code="QT30-DT03" dataKey="dt03Items"
        columns={[
          { key: 'nhomVT', label: 'Nhóm VT', width: '0.8fr' },
          { key: 'danhMuc', label: 'Danh mục VT', width: '1.5fr' },
          { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
          { key: 'kl', label: 'KL/SL', type: 'number', width: '0.6fr' },
          { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.8fr' },
          { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.8fr' },
        ]}
        defaultRows={[
          { nhomVT: 'VTC', danhMuc: 'Vật tư chính', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { nhomVT: 'VTP', danhMuc: 'Vật tư phụ kiện, bu lông…', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { nhomVT: 'VTDK', danhMuc: 'Vật tư đóng kiện', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { nhomVT: 'VTBP', danhMuc: 'Vật tư làm biện pháp', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { nhomVT: 'VTTH', danhMuc: 'Vật tư tiêu hao', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { nhomVT: 'VTS', danhMuc: 'Vật tư sơn', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { nhomVT: 'VTDP', danhMuc: 'Vật tư dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
        ]}
        formData={formData} onFieldChange={onFieldChange} isActive={isActive}
      />

      {/* DT04 — Dự toán VT chi tiết (Thương mại) */}
      <EstimateTable
        title="📋 DT04 — Dự toán chi tiết VT (Thương mại)" code="QT30-DT04" dataKey="dt04Items"
        columns={[
          { key: 'maVT', label: 'Mã VT', width: '0.7fr' },
          { key: 'tenVT', label: 'Tên VT', width: '1.2fr' },
          { key: 'macVL', label: 'Mác VL', width: '0.6fr' },
          { key: 'quyCach', label: 'Quy cách', width: '0.7fr' },
          { key: 'dvt', label: 'ĐVT', width: '0.4fr' },
          { key: 'kl', label: 'KL/SL', type: 'number', width: '0.5fr' },
          { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
          { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
        ]}
        defaultRows={[{ maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' }]}
        formData={formData} onFieldChange={onFieldChange} isActive={isActive}
      />

      {/* DT05 — Dự toán dịch vụ (Thương mại) */}
      <EstimateTable
        title="🔧 DT05 — Dự toán chi phí dịch vụ (Thương mại)" code="QT30-DT05" dataKey="dt05Items"
        columns={[
          { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
          { key: 'noiDung', label: 'Nội dung công việc', width: '1.5fr' },
          { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
          { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
          { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
          { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
        ]}
        defaultRows={[
          { maCP: 'VT', noiDung: 'Vận tải', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'NDT', noiDung: 'NDT, quy trình và thí nghiệm', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'MK', noiDung: 'Mạ kẽm', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CPK', noiDung: 'Các chi phí khác', dvt: '', kl: '', donGia: '', thanhTien: '' },
        ]}
        formData={formData} onFieldChange={onFieldChange} isActive={isActive}
      />

      {/* DT06 — Dự toán nhân công (Sản xuất) */}
      <EstimateTable
        title="👷 DT06 — Dự toán chi phí nhân công (Sản xuất)" code="QT30-DT06" dataKey="dt06Items"
        columns={[
          { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
          { key: 'noiDung', label: 'Nội dung công việc', width: '1.5fr' },
          { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
          { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
          { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
          { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
        ]}
        defaultRows={[
          { maCP: 'PC', noiDung: 'Pha cắt', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'GC', noiDung: 'Gia công', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CT', noiDung: 'Chế tạo - Lan can', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CT', noiDung: 'Chế tạo - Giá đỡ', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CT', noiDung: 'Chế tạo - Ống', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CT', noiDung: 'Chế tạo - Hộp', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'KK', noiDung: 'Khung kiện', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'TH', noiDung: 'Tổ hợp sản phẩm', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'LD', noiDung: 'Lắp dựng + Nghiệm thu', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'VS', noiDung: 'Vệ sinh vật liệu hợp kim', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'SON', noiDung: 'Làm sạch, Sơn', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'BO', noiDung: 'Bảo ôn', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'LTB', noiDung: 'Lắp thiết bị phụ kiện trước đóng kiện', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'DK', noiDung: 'Đóng kiện', dvt: 'Kiện', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'GH', noiDung: 'Giao hàng', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'DP', noiDung: 'Nhân công dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
        ]}
        formData={formData} onFieldChange={onFieldChange} isActive={isActive}
      />

      {/* DT07 — Chi phí chung, tài chính (TCKT) */}
      <EstimateTable
        title="🏢 DT07 — Dự toán chi phí chung, tài chính (TCKT)" code="QT30-DT07" dataKey="dt07Items"
        columns={[
          { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
          { key: 'danhMuc', label: 'Danh mục chi phí', width: '1.5fr' },
          { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
          { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
          { key: 'donGia', label: 'Đơn giá BQ', type: 'number', width: '0.7fr' },
          { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
        ]}
        defaultRows={[
          { maCP: 'CPC', danhMuc: 'Chi phí chung phục vụ sản xuất', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CTC', danhMuc: 'Chi phí tài chính', dvt: '', kl: '', donGia: '', thanhTien: '' },
          { maCP: 'CQL', danhMuc: 'Chi phí Quản Lý', dvt: '', kl: '', donGia: '', thanhTien: '' },
        ]}
        formData={formData} onFieldChange={onFieldChange} isActive={isActive}
      />
    </>
  )
}
