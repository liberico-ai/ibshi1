'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { parseEstimateSheets, type EstimateParseResult, type SheetMap, type Row } from '@/lib/estimate-parser'

interface ProjectInfo {
  projectCode?: string
  projectName?: string
  clientName?: string
  contractValue?: number | string
  productType?: string
  startDate?: string | Date
  endDate?: string | Date
}

interface Props {
  isEditable: boolean
  project?: ProjectInfo | null
  estimateData?: {
    totalMaterial?: number
    totalLabor?: number
    totalService?: number
    totalOverhead?: number
    totalEstimate?: number
    dt02Detail?: string
    estimateFileName?: string
  }
  onFieldChange: (key: string, value: unknown) => void
}

export default function EstimateUploadUI({ isEditable, project, estimateData, onFieldChange }: Props) {
  const [successMsg, setSuccessMsg] = useState('')
  const [error, setError] = useState('')
  // Xem trước kết quả đọc file trước khi ghi số vào form
  const [preview, setPreview] = useState<EstimateParseResult | null>(null)
  const [sheets, setSheets] = useState<SheetMap | null>(null)
  const [fileName, setFileName] = useState('')

  const totalMat = Number(estimateData?.totalMaterial) || 0
  const totalLab = Number(estimateData?.totalLabor) || 0
  const totalSvc = Number(estimateData?.totalService) || 0
  const totalOvh = Number(estimateData?.totalOverhead) || 0
  const totalEst = Number(estimateData?.totalEstimate) || 0
  const contractVal = Number(project?.contractValue) || 0
  const profit = contractVal - totalEst
  const hasData = totalEst > 0

  const fmt = (v: number) => v > 0 ? formatCurrency(v) : '—'
  const pct = (v: number) => totalEst > 0 ? ((v / totalEst) * 100).toFixed(1) + '%' : '—'

  let dt02Rows: { maCP: string; noiDung: string; giaTri: number }[] = []
  try {
    const parsed = estimateData?.dt02Detail ? JSON.parse(String(estimateData.dt02Detail)) : null
    if (Array.isArray(parsed)) dt02Rows = parsed
  } catch { /* ignore */ }

  // Chọn file → PHÂN TÍCH rồi hiện xem trước; chỉ ghi vào form khi người dùng bấm xác nhận.
  // (Trước đây ghi thẳng, đọc sai sheet là số 0 lọt vào form mà không ai biết.)
  const importEstimateExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, { type: 'binary' })
          const map: SheetMap = {}
          for (const n of wb.SheetNames) {
            map[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }) as Row[]
          }
          setSheets(map)
          setFileName(file.name)
          setPreview(parseEstimateSheets(map))
          setError('')
        } catch (err) {
          console.error('Import dự toán Excel error:', err)
          setError(`Lỗi đọc file Excel: ${err instanceof Error ? err.message : 'không rõ'}`)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  /** Đọc lại theo sheet người dùng tự chọn (khi máy đoán sai). */
  const reparse = (sheetName: string) => {
    if (!sheets) return
    setPreview(parseEstimateSheets(sheets, { sheetName }))
  }

  /** Chốt: ghi các số đã xem trước vào form. */
  const applyPreview = () => {
    if (!preview?.ok) return
    const t = preview.totals
    onFieldChange('totalMaterial', t.material)
    onFieldChange('totalLabor', t.labor)
    onFieldChange('totalService', t.service)
    onFieldChange('totalOverhead', t.overhead)
    onFieldChange('totalEstimate', t.grand)
    onFieldChange('dt02Detail', JSON.stringify(preview.detailRows))
    onFieldChange('estimateFileName', fileName)
    setSuccessMsg(`Đã nhận dự toán ${fmt(t.grand)} từ sheet "${preview.sheetName}"`)
    setPreview(null); setSheets(null)
    setTimeout(() => setSuccessMsg(''), 5000)
  }

  const exportTemplate = () => {
    const wb = XLSX.utils.book_new()
    const projectCode = project?.projectCode || 'PROJECT'

    const coverData = [
      ['CÔNG TY CỔ PHẦN KẾT CẤU THÉP IBS'], [], [],
      ['DỰ TOÁN THI CÔNG'], [],
      ['Mã dự án', projectCode],
      ['Khách hàng', project?.clientName || ''],
      ['Tên dự án', project?.projectName || ''],
    ]
    const wsCover = XLSX.utils.aoa_to_sheet(coverData)
    wsCover['!cols'] = [{ wch: 20 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, wsCover, '+Cover')

    const dt01Data = [
      ['DT01 — THÔNG TIN CHUNG DỰ ÁN'], [],
      ['STT', 'Dữ liệu', 'Thông tin', 'Ghi chú'],
      ['A', 'THÔNG TIN CHUNG'],
      [1, 'Khách hàng', project?.clientName || ''],
      [2, 'Tên dự án', project?.projectName || ''],
      [3, 'Mã dự án', projectCode],
      [4, 'Giá trị HĐ', contractVal],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dt01Data), 'DT01 (TTC)')

    const dt02Data = [
      ['TỔNG HỢP DỰ TOÁN CHI PHÍ THI CÔNG'], [],
      ['STT', 'Mã CP', 'Nội dung chi phí', 'Giá trị', 'Tỷ lệ'],
      ['I', '', 'Chi phí vật tư', '', ''],
      ['II', '', 'Chi phí nhân công trực tiếp', '', ''],
      ['III', '', 'Chi phí dịch vụ thuê ngoài', '', ''],
      ['IV', '', 'Chi phí chung', '', ''],
      [], ['', '', 'TỔNG HỢP CHI PHÍ', '=SUM(D4:D7)', ''],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dt02Data), 'DT02 (TH)')

    const sheets: [string, string, string[]][] = [
      ['DT03 (VT)', 'DỰ TOÁN CHI PHÍ VẬT TƯ', ['STT', 'Nhóm vật tư', 'Danh mục vật tư', 'Đơn vị tính', 'Khối lượng/ Số lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
      ['DT04 (VT)', 'BẢNG DỰ TOÁN CHI TIẾT VẬT TƯ', ['STT', 'Nhóm vật tư', 'Mã vật tư', 'Danh mục vật tư', 'Đơn vị tính', 'Mác vật liệu', 'Quy cách', '', '', 'Khối lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
      ['DT05 (DV)', 'DỰ TOÁN CHI PHÍ DỊCH VỤ', ['STT', 'Mã CP', 'NỘI DUNG CÔNG VIỆC', 'Đơn vị tính', 'Khối lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
      ['DT06 (NC)', 'DỰ TOÁN CHI PHÍ NHÂN CÔNG TRỰC TIẾP', ['STT', 'Mã CP', 'NỘI DUNG CÔNG VIỆC', 'Đơn vị tính', 'Khối lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
      ['DT07 (CPC)', 'DỰ TOÁN CHI PHÍ CHUNG, CHI PHÍ TÀI CHÍNH', ['STT', 'Mã CP', 'Danh mục chi phí', 'Đơn vị tính', 'Khối lượng', 'Đơn giá bình quân', 'Thành tiền']],
    ]
    sheets.forEach(([name, title, headers]) => {
      const data = [[title], [], headers]
      const ws = XLSX.utils.aoa_to_sheet(data)
      ws['!cols'] = headers.map(h => ({ wch: Math.max(String(h).length + 4, 14) }))
      XLSX.utils.book_append_sheet(wb, ws, name)
    })

    XLSX.writeFile(wb, `DuToan_Template_${projectCode}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: '0.85rem' }}>{error}</div>}
      {successMsg && <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#16a34a', borderRadius: 8, fontSize: '0.85rem' }}>{successMsg}</div>}

      {project && (
        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #3b82f6' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#3b82f6' }}>DT01 — Thông tin chung dự án</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: '0.85rem' }}>
            {project.projectCode && <div><span style={{ color: 'var(--text-muted)' }}>Mã dự án:</span> <strong>{project.projectCode}</strong></div>}
            {project.clientName && <div><span style={{ color: 'var(--text-muted)' }}>Khách hàng:</span> <strong>{project.clientName}</strong></div>}
            {project.projectName && <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--text-muted)' }}>Tên dự án:</span> <strong>{project.projectName}</strong></div>}
            {contractVal > 0 && <div><span style={{ color: 'var(--text-muted)' }}>Giá trị HĐ:</span> <strong style={{ color: '#059669' }}>{formatCurrency(contractVal)}</strong></div>}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #7c3aed' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: '#7c3aed' }}>Excel Dự toán thi công</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
          Upload file Excel dự toán. Hệ thống tự tìm bảng tổng hợp theo nội dung (không phụ thuộc tên sheet), hiện số để bạn xem trước rồi mới ghi vào form.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={exportTemplate}
            style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
            Tải Template Dự Toán
          </button>
          {isEditable && (
            <button type="button" onClick={importEstimateExcel}
              style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
              Upload Excel Dự Toán
            </button>
          )}
        </div>
        {/* XEM TRƯỚC kết quả đọc file — chỉ ghi vào form khi người dùng xác nhận.
            Máy đoán sai sheet thì chọn tay ngay tại đây, không phải sửa file Excel. */}
        {preview && (
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${preview.ok ? '#a7f3d0' : '#fecaca'}`, background: preview.ok ? '#ecfdf5' : '#fef2f2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.85rem', color: preview.ok ? '#047857' : '#991b1b' }}>
                {preview.ok ? `Đọc được từ sheet "${preview.sheetName}"` : preview.reason === 'NO_NUMBERS'
                  ? `Sheet "${preview.sheetName}" chưa có số — mở bằng Excel nhập rồi lưu lại, hoặc chọn sheet khác`
                  : 'Chưa nhận ra bảng tổng hợp — chọn sheet bên dưới'}
              </strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fileName}</span>
            </div>

            {preview.ok && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, margin: '10px 0' }}>
                {([['Vật tư', preview.totals.material], ['Nhân công', preview.totals.labor], ['Dịch vụ', preview.totals.service], ['Chi phí chung', preview.totals.overhead], ['TỔNG', preview.totals.grand]] as const).map(([label, v]) => (
                  <div key={label} style={{ padding: '6px 10px', background: '#fff', borderRadius: 6, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{label}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: label === 'TỔNG' ? '#047857' : 'var(--text-primary)' }}>{fmt(v)}</div>
                  </div>
                ))}
              </div>
            )}

            {preview.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: '0.75rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px', marginBottom: 6 }}>{w}</div>
            ))}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <select value={preview.sheetName || ''} onChange={e => reparse(e.target.value)} className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', maxWidth: 260 }}>
                <option value="">— Chọn sheet tổng hợp —</option>
                {preview.candidates.map(c => <option key={c.name} value={c.name}>{c.name}{c.score > 0 ? ` (điểm ${c.score})` : ''}</option>)}
              </select>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => { setPreview(null); setSheets(null) }}
                style={{ padding: '6px 14px', fontSize: '0.78rem', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Hủy</button>
              <button type="button" onClick={applyPreview} disabled={!preview.ok}
                style={{ padding: '6px 14px', fontSize: '0.78rem', border: 'none', borderRadius: 6, background: preview.ok ? '#059669' : '#e2e8f0', color: preview.ok ? '#fff' : '#94a3b8', cursor: preview.ok ? 'pointer' : 'not-allowed', fontWeight: 700 }}>
                Dùng số này
              </button>
            </div>
          </div>
        )}

        {estimateData?.estimateFileName && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>File đã upload: <strong>{String(estimateData.estimateFileName)}</strong></span>
            {isEditable && (
              <button type="button" onClick={() => {
                onFieldChange('totalMaterial', 0)
                onFieldChange('totalLabor', 0)
                onFieldChange('totalService', 0)
                onFieldChange('totalOverhead', 0)
                onFieldChange('totalEstimate', 0)
                onFieldChange('dt02Detail', '')
                onFieldChange('estimateFileName', '')
                setSuccessMsg('Đã xoá dự toán. Bạn có thể upload lại.')
                setTimeout(() => setSuccessMsg(''), 3000)
              }} style={{ padding: '4px 12px', fontSize: '0.78rem', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                ✕ Xoá
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #059669' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#059669' }}>DT02 — Tổng hợp dự toán chi phí</h3>
        {!hasData ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Chưa có dữ liệu. Vui lòng upload file Excel dự toán.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: '0.85rem' }}>
            {[
              { label: 'I. Chi phí vật tư', value: totalMat, color: '#E1251B' },
              { label: 'II. Chi phí nhân công', value: totalLab, color: '#f59e0b' },
              { label: 'III. Chi phí dịch vụ', value: totalSvc, color: '#3b82f6' },
              { label: 'IV. Chi phí chung', value: totalOvh, color: '#8b5cf6' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{item.label}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: item.color }}>{fmt(item.value)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{pct(item.value)}</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '10px 12px', background: 'var(--bg-secondary)', fontWeight: 700, fontSize: '0.95rem' }}>
              <span>TỔNG CHI PHÍ</span>
              <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{fmt(totalEst)}</span>
              <span style={{ textAlign: 'right' }}>100%</span>
            </div>
            {contractVal > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderTop: '2px solid var(--border)' }}>
                <span style={{ fontWeight: 600 }}>Lợi nhuận dự kiến</span>
                <span style={{ textAlign: 'right', fontWeight: 700, color: profit >= 0 ? '#059669' : '#dc2626' }}>{fmt(Math.abs(profit))}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{contractVal > 0 ? ((profit / contractVal) * 100).toFixed(1) + '%' : '—'}</span>
              </div>
            )}
          </div>
        )}

        {dt02Rows.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Chi tiết DT02 ({dt02Rows.length} dòng)
            </summary>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: 6, fontSize: '0.8rem' }}>
              {dt02Rows.map((row, i) => {
                const isHeader = ['I', 'II', 'III', 'IV'].includes(row.maCP)
                return (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '60px 1fr 120px',
                    padding: '4px 10px', borderBottom: '1px solid var(--border)',
                    background: isHeader ? 'var(--bg-secondary)' : 'transparent',
                    fontWeight: isHeader ? 700 : 400,
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>{row.maCP}</span>
                    <span>{row.noiDung}</span>
                    <span style={{ textAlign: 'right' }}>{row.giaTri > 0 ? formatNumber(row.giaTri) : ''}</span>
                  </div>
                )
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
