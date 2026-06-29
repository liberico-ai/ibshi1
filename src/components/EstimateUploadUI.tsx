'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { formatCurrency, formatNumber } from '@/lib/utils'

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
          const sheetNames = wb.SheetNames
          const dt02Name = sheetNames.find(s => s.toLowerCase().includes('dt02'))
          if (!dt02Name) {
            setError('Không tìm thấy sheet DT02 trong file Excel.')
            return
          }
          const ws = wb.Sheets[dt02Name]
          const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

          let matTotal = 0, labTotal = 0, svcTotal = 0, ovhTotal = 0, grandTotal = 0
          const detailRows: { maCP: string; noiDung: string; giaTri: number }[] = []

          for (const row of data) {
            if (!row || row.length < 4) continue
            const stt = String(row[0] || '').trim()
            const content = String(row[2] || '').trim()
            const value = Number(row[3]) || 0

            if (stt === 'I') { matTotal = value; detailRows.push({ maCP: 'I', noiDung: content || 'Chi phí vật tư', giaTri: value }) }
            else if (stt === 'II') { labTotal = value; detailRows.push({ maCP: 'II', noiDung: content || 'Chi phí nhân công', giaTri: value }) }
            else if (stt === 'III') { svcTotal = value; detailRows.push({ maCP: 'III', noiDung: content || 'Chi phí dịch vụ', giaTri: value }) }
            else if (stt === 'IV') { ovhTotal = value; detailRows.push({ maCP: 'IV', noiDung: content || 'Chi phí chung', giaTri: value }) }
            if (/^\d+$/.test(stt) && value > 0) {
              detailRows.push({ maCP: String(row[1] || stt), noiDung: content, giaTri: value })
            }
          }

          for (const row of data) {
            if (!row) continue
            const content = String(row[2] || '').toLowerCase()
            if (content.includes('tổng hợp') || content.includes('tổng chi phí')) {
              grandTotal = Number(row[3]) || 0
            }
          }
          if (!grandTotal) grandTotal = matTotal + labTotal + svcTotal + ovhTotal

          if (grandTotal > 0) {
            onFieldChange('totalMaterial', matTotal)
            onFieldChange('totalLabor', labTotal)
            onFieldChange('totalService', svcTotal)
            onFieldChange('totalOverhead', ovhTotal)
            onFieldChange('totalEstimate', grandTotal)
            onFieldChange('dt02Detail', JSON.stringify(detailRows))
            onFieldChange('estimateFileName', file.name)
            setSuccessMsg(`Đã import dự toán: ${fmt(grandTotal)} từ ${sheetNames.length} sheets`)
            setError('')
            setTimeout(() => setSuccessMsg(''), 4000)
          } else {
            setError('Không đọc được dữ liệu DT02. Kiểm tra file Excel có đúng định dạng.')
          }
        } catch (err) {
          console.error('Import DT02 Excel error:', err)
          setError(`Lỗi đọc file Excel: ${err instanceof Error ? err.message : 'không rõ'}`)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
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
          Upload file Excel dự toán (8 sheets: Cover, DT01-DT07). Hệ thống tự động đọc DT02 để hiển thị tổng hợp chi phí.
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
