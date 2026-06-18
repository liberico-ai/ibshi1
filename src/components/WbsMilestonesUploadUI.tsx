'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'

interface Milestone {
  name: string
  startDate: string
  endDate: string
  assigneeId: string
}

interface Props {
  isEditable: boolean
  wbsData?: string
  milestonesData?: string
  onWbsChange: (val: string) => void
  onMilestonesChange: (val: string) => void
  projectCode?: string
}

export default function WbsMilestonesUploadUI({ isEditable, wbsData, milestonesData, onWbsChange, onMilestonesChange, projectCode }: Props) {
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  let wbsRows: Record<string, string>[] = []
  try {
    const parsed = wbsData ? JSON.parse(wbsData) : null
    if (Array.isArray(parsed)) wbsRows = parsed
  } catch { /* ignore */ }

  let milestones: Milestone[] = []
  try {
    const parsed = milestonesData ? JSON.parse(milestonesData) : null
    if (Array.isArray(parsed)) milestones = parsed
  } catch { /* ignore */ }

  const importWbsExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, { type: 'binary' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
          if (jsonData.length < 2) { setError('File không có dữ liệu.'); return }

          const keyMap: Record<string, string> = {
            'stt': 'stt', 'no': 'stt',
            'hạng mục': 'hangMuc', 'item': 'hangMuc', 'mô tả': 'hangMuc', 'description': 'hangMuc',
            'đvt': 'dvt', 'unit': 'dvt',
            'khối lượng': 'khoiLuong', 'kl': 'khoiLuong', 'qty': 'khoiLuong', 'volume': 'khoiLuong',
            'phạm vi': 'phamVi', 'scope': 'phamVi',
            'bắt đầu': 'batDau', 'start': 'batDau',
            'kết thúc': 'ketThuc', 'end': 'ketThuc',
            'khu vực': 'khuVuc', 'area': 'khuVuc',
            'ghi chú': 'ghiChu', 'note': 'ghiChu', 'remark': 'ghiChu',
          }

          let headerIdx = 0, bestMatch = 0
          for (let r = 0; r < Math.min(15, jsonData.length); r++) {
            const row = jsonData[r] || []
            const matchCount = row.filter(c => keyMap[String(c || '').trim().toLowerCase()]).length
            if (matchCount > bestMatch) { bestMatch = matchCount; headerIdx = r }
          }
          if (bestMatch < 1) { setError('Không tìm thấy header hợp lệ (cần: STT, Hạng mục, KL...)'); return }

          const headerRow = jsonData[headerIdx].map(h => String(h || '').trim().toLowerCase())
          const colMapping = headerRow.map(h => keyMap[h] || '')
          const imported: Record<string, string>[] = []

          for (let i = headerIdx + 1; i < jsonData.length; i++) {
            const rowData = jsonData[i]
            if (!rowData || rowData.every(c => !c)) continue
            const newRow: Record<string, string> = { stt: '', hangMuc: '', dvt: 'kg', khoiLuong: '', phamVi: 'IBS', batDau: '', ketThuc: '', khuVuc: '', ghiChu: '' }
            colMapping.forEach((key, ci) => {
              if (key && rowData[ci] != null) newRow[key] = String(rowData[ci])
            })
            if (newRow.hangMuc || newRow.stt) imported.push(newRow)
          }

          if (imported.length > 0) {
            onWbsChange(JSON.stringify(imported))
            setSuccessMsg(`Đã import ${imported.length} hạng mục WBS`)
            setError('')
            setTimeout(() => setSuccessMsg(''), 3000)
          } else {
            setError('Không có dòng dữ liệu hợp lệ.')
          }
        } catch (err) {
          setError(`Lỗi đọc file: ${err instanceof Error ? err.message : 'không rõ'}`)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  const importMilestonesExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, { type: 'binary' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
          if (jsonData.length < 2) { setError('File không có dữ liệu.'); return }

          const keyMap: Record<string, string> = {
            'tên milestone': 'name', 'tên': 'name', 'hạng mục': 'name', 'milestone': 'name',
            'bắt đầu': 'startDate', 'start': 'startDate', 'ngày bắt đầu': 'startDate',
            'kết thúc': 'endDate', 'end': 'endDate', 'ngày kết thúc': 'endDate',
            'người phụ trách': 'assigneeId', 'pic': 'assigneeId', 'assignee': 'assigneeId',
          }

          let headerIdx = 0, bestMatch = 0
          for (let r = 0; r < Math.min(15, jsonData.length); r++) {
            const row = jsonData[r] || []
            const matchCount = row.filter(c => keyMap[String(c || '').trim().toLowerCase()]).length
            if (matchCount > bestMatch) { bestMatch = matchCount; headerIdx = r }
          }
          if (bestMatch < 1) { setError('Không tìm thấy header hợp lệ (cần: Tên, Bắt đầu, Kết thúc)'); return }

          const headerRow = jsonData[headerIdx].map(h => String(h || '').trim().toLowerCase())
          const colMapping = headerRow.map(h => keyMap[h] || '')
          const imported: Milestone[] = []

          for (let i = headerIdx + 1; i < jsonData.length; i++) {
            const rowData = jsonData[i]
            if (!rowData || rowData.every(c => !c)) continue
            const newRow: Milestone = { name: '', startDate: '', endDate: '', assigneeId: '' }
            colMapping.forEach((key, ci) => {
              if (key && rowData[ci] != null) {
                let val = String(rowData[ci])
                if (key === 'startDate' || key === 'endDate') {
                  if (val.includes('/')) {
                    const parts = val.split('/')
                    if (parts.length === 3) val = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
                  }
                  if (!isNaN(Number(val)) && Number(val) > 40000) {
                    const date = new Date(Math.round((Number(val) - 25569) * 86400 * 1000))
                    val = date.toISOString().split('T')[0]
                  }
                }
                (newRow as unknown as Record<string, string>)[key] = val
              }
            })
            if (newRow.name) imported.push(newRow)
          }

          if (imported.length > 0) {
            onMilestonesChange(JSON.stringify(imported))
            setSuccessMsg(`Đã import ${imported.length} milestones`)
            setError('')
            setTimeout(() => setSuccessMsg(''), 3000)
          } else {
            setError('Không có dòng dữ liệu hợp lệ.')
          }
        } catch (err) {
          setError(`Lỗi đọc file: ${err instanceof Error ? err.message : 'không rõ'}`)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  const exportWbsTemplate = () => {
    const headers = ['STT', 'Hạng mục', 'ĐVT', 'Khối lượng', 'Phạm vi', 'Bắt đầu', 'Kết thúc', 'Khu vực', 'Ghi chú']
    const data = wbsRows.length > 0
      ? wbsRows.map(r => [r.stt, r.hangMuc, r.dvt, r.khoiLuong, r.phamVi, r.batDau, r.ketThuc, r.khuVuc, r.ghiChu])
      : [['1', '', 'kg', '', 'IBS', '', '', '', '']]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    ws['!cols'] = [{ wch: 6 }, { wch: 35 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'WBS')

    const msHeaders = ['Tên Milestone', 'Bắt đầu', 'Kết thúc', 'Người phụ trách']
    const msData = milestones.length > 0
      ? milestones.map(m => [m.name, m.startDate, m.endDate, m.assigneeId])
      : [['', '', '', '']]
    const ws2 = XLSX.utils.aoa_to_sheet([msHeaders, ...msData])
    ws2['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Milestones')

    XLSX.writeFile(wb, `WBS_Milestones_${projectCode || 'Project'}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: '0.85rem' }}>{error}</div>}
      {successMsg && <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#16a34a', borderRadius: 8, fontSize: '0.85rem' }}>{successMsg}</div>}

      {/* WBS Section */}
      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #2563eb' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: '#2563eb' }}>WBS — Cơ cấu phân chia công việc</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={exportWbsTemplate}
            style={{ flex: 1, padding: '8px 14px', fontSize: '0.84rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Tải Template WBS + Milestones
          </button>
          {isEditable && (
            <button type="button" onClick={importWbsExcel}
              style={{ flex: 1, padding: '8px 14px', fontSize: '0.84rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              Upload WBS
            </button>
          )}
        </div>
        {wbsRows.length > 0 ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 360, fontSize: '0.82rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
                  {['STT', 'Hạng mục', 'ĐVT', 'KL', 'Phạm vi', 'Bắt đầu', 'Kết thúc'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wbsRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{r.stt || i + 1}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 500 }}>{r.hangMuc}</td>
                    <td style={{ padding: '4px 8px' }}>{r.dvt}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.khoiLuong ? Number(r.khoiLuong).toLocaleString('vi-VN') : ''}</td>
                    <td style={{ padding: '4px 8px' }}>{r.phamVi}</td>
                    <td style={{ padding: '4px 8px' }}>{r.batDau}</td>
                    <td style={{ padding: '4px 8px' }}>{r.ketThuc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chưa có dữ liệu WBS. Upload file Excel để import.</div>
        )}
      </div>

      {/* Milestones Section */}
      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #f59e0b' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#b45309' }}>Milestones — Cột mốc dự án</h3>
          {isEditable && (
            <button type="button" onClick={importMilestonesExcel}
              style={{ padding: '6px 14px', fontSize: '0.8rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              Upload Milestones
            </button>
          )}
        </div>
        {milestones.length > 0 ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: '0.82rem' }}>
            {milestones.map((m, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '6px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{m.startDate}</span>
                <span style={{ color: 'var(--text-muted)' }}>{m.endDate}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{m.assigneeId}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chưa có milestones. Upload file Excel hoặc dùng template WBS + Milestones.</div>
        )}
      </div>
    </div>
  )
}
