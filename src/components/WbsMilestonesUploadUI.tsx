'use client'

import { useState, Fragment, type CSSProperties } from 'react'
import * as XLSX from 'xlsx'
import { formatNumber } from '@/lib/utils'
import { parseWbsExcel, stripWbsNotes } from '@/lib/wbs-parser'

// 17 công đoạn theo Form BCTH-IBSHI-QLDA-01 (đúng thứ tự file)
const WBS_STAGES = [
  { key: 'cutting', label: 'Cắt' }, { key: 'machining', label: 'GCCK' }, { key: 'fitup', label: 'Gá' },
  { key: 'welding', label: 'Hàn' }, { key: 'tryAssembly', label: 'Tổ hợp thử' }, { key: 'dismantle', label: 'Tháo dỡ' },
  { key: 'blasting', label: 'Làm sạch' }, { key: 'galvanize', label: 'Mạ' }, { key: 'repairAfterGalv', label: 'Sửa sau mạ' },
  { key: 'painting', label: 'Sơn' }, { key: 'commissioning', label: 'Chạy thử' }, { key: 'insulation', label: 'Bảo ôn' },
  { key: 'linerPainting', label: 'Sơn liner' }, { key: 'shippingAssembly', label: 'Lắp giao hàng' },
  { key: 'khungKien', label: 'Khung kiện' }, { key: 'packing', label: 'Đóng kiện' }, { key: 'delivery', label: 'Giao hàng' },
]
const thP: CSSProperties = { padding: '4px 6px', textAlign: 'center', border: '1px solid #b7c9d4', fontWeight: 600, color: '#1f3a4d' }
const tdP: CSSProperties = { padding: '3px 6px', border: '1px solid var(--border)', verticalAlign: 'top' }

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
  const [wbsModalOpen, setWbsModalOpen] = useState(false)

  let wbsRows: Record<string, string>[] = []
  try {
    const parsed = wbsData ? JSON.parse(wbsData) : null
    if (Array.isArray(parsed)) wbsRows = parsed
  } catch { /* ignore */ }
  // Dọn GHI CHÚ/chú giải/chữ ký khỏi bảng — kể cả dữ liệu CŨ đã lưu kèm ghi chú.
  wbsRows = stripWbsNotes(wbsRows)

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
          // raw:true (mặc định) → ngày giữ dạng SERIAL để parser tự chuẩn hoá (không nhập nhằng dd/mm-mm/dd)
          const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
          if (jsonData.length < 2) { setError('File không có dữ liệu.'); return }

          // Parser mới: nhận Form BCTH-IBSHI-QLDA-01 (header đa tầng + 16 công đoạn) VÀ form cũ 9 cột.
          const imported = parseWbsExcel(jsonData)
          if (imported.length > 0) {
            onWbsChange(JSON.stringify(imported))
            setSuccessMsg(`Đã import ${imported.length} hạng mục WBS`)
            setError('')
            setTimeout(() => setSuccessMsg(''), 3000)
          } else {
            setError('Không tìm thấy dữ liệu WBS hợp lệ (cần cột STT + Hạng mục).')
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
    // Header 2 tầng theo Form BCTH-IBSHI-QLDA-01: cột cơ bản + 17 công đoạn (Đơn vị/Start/Finish)
    const BASE: [string, string][] = [
      ['STT', 'stt'], ['Tên hạng mục', 'hangMuc'], ['ĐVT', 'dvt'], ['Khối lượng (kg)', 'khoiLuong'],
      ['Diện tích (m²)', 'dienTich'], ['Bảo ôn (m²)', 'baoOn'], ['Phạm vi (IBS HI)', 'phamVi'],
      ['Thầu phụ', 'thauPhu'], ['Bắt đầu', 'batDau'], ['Kết thúc', 'ketThuc'],
    ]
    const TAIL: [string, string][] = [['Khu vực', 'khuVuc'], ['Ghi chú', 'ghiChu']]
    const row1 = [...BASE.map(b => b[0]), ...WBS_STAGES.flatMap(s => [s.label, '', '']), ...TAIL.map(t => t[0])]
    const row2 = [...BASE.map(b => b[0]), ...WBS_STAGES.flatMap(() => ['Đơn vị', 'Start', 'Finish']), ...TAIL.map(t => t[0])]
    const src = wbsRows.length > 0 ? wbsRows : [{ stt: '1', dvt: 'kg', phamVi: 'IBS' } as Record<string, string>]
    const body = src.map((r, i) => [
      ...BASE.map(b => b[1] === 'stt' ? (r.stt || String(i + 1)) : (r[b[1]] || '')),
      ...WBS_STAGES.flatMap(s => [r[s.key] || '', r[`${s.key}Start`] || '', r[`${s.key}Finish`] || '']),
      ...TAIL.map(t => r[t[1]] || ''),
    ])
    const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...body])
    const merges: XLSX.Range[] = []
    BASE.forEach((_, c) => merges.push({ s: { r: 0, c }, e: { r: 1, c } }))
    const stageStart = BASE.length
    WBS_STAGES.forEach((_, i) => { const c = stageStart + i * 3; merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 2 } }) })
    const tailStart = stageStart + WBS_STAGES.length * 3
    TAIL.forEach((_, i) => merges.push({ s: { r: 0, c: tailStart + i }, e: { r: 1, c: tailStart + i } }))
    ws['!merges'] = merges
    ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 11 },
    ...WBS_STAGES.flatMap(() => [{ wch: 7 }, { wch: 11 }, { wch: 11 }]), { wch: 12 }, { wch: 16 }]
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Đã có <b>{wbsRows.length}</b> hạng mục WBS · {WBS_STAGES.length} công đoạn</span>
            <button type="button" onClick={() => setWbsModalOpen(true)} style={{ padding: '8px 22px', fontSize: '0.85rem', fontWeight: 700, background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', letterSpacing: '0.3px' }}>XEM chi tiết</button>
          </div>
        ) : (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chưa có dữ liệu WBS. Upload file Excel để import.</div>
        )}

        {/* Modal XEM toàn màn hình — rộng, dễ nhìn (giống WbsTableUI) */}
        {wbsModalOpen && wbsRows.length > 0 && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setWbsModalOpen(false) }}>
            <div style={{ flex: 1, background: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '12px 20px', borderBottom: '2px solid #0ea5e9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#f0f9ff' }}>
                <div><h2 style={{ margin: 0, fontSize: '1.05rem', color: '#0c4a6e' }}>WBS — Cơ cấu phân chia công việc</h2><span style={{ fontSize: '0.72rem', color: '#64748b' }}>{wbsRows.length} hạng mục</span></div>
                <button type="button" onClick={() => setWbsModalOpen(false)} style={{ padding: '5px 14px', fontSize: '0.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>✕ Đóng</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', fontSize: '0.72rem' }}>
                <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', width: 'max-content' }}>
                  <thead>
                <tr style={{ background: '#c7e2ef', position: 'sticky', top: 0, zIndex: 2 }}>
                  {[['STT', 34], ['Hạng mục', 170], ['ĐVT', 40], ['KL', 70], ['DT (m²)', 60], ['Bảo ôn', 60], ['IBS HI', 46], ['Thầu phụ', 80], ['Bắt đầu', 78], ['Kết thúc', 78]].map(([h, w]) => (
                    <th key={h as string} rowSpan={2} style={{ ...thP, width: w as number }}>{h}</th>
                  ))}
                  {WBS_STAGES.map(s => <th key={s.key} colSpan={3} style={{ ...thP, background: '#fde7e7', borderLeft: '2px solid #999' }}>{s.label}</th>)}
                  <th rowSpan={2} style={{ ...thP, width: 90 }}>Khu vực</th>
                  <th rowSpan={2} style={{ ...thP, width: 110 }}>Ghi chú</th>
                </tr>
                <tr style={{ background: '#dcecf5', position: 'sticky', top: 22, zIndex: 2 }}>
                  {WBS_STAGES.map(s => (
                    <Fragment key={s.key}>
                      <th style={{ ...thP, borderLeft: '2px solid #999', fontWeight: 500, width: 58 }}>Đơn vị</th>
                      <th style={{ ...thP, fontWeight: 500, width: 74 }}>Start</th>
                      <th style={{ ...thP, fontWeight: 500, width: 74 }}>Finish</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wbsRows.map((r, i) => {
                  // dòng tiêu đề nhóm (UNIT/công trình): không có KL, không ngày, không công đoạn
                  const isGroup = !r.khoiLuong && !r.batDau && !r.dienTich && !r.cutting && !r.welding
                  return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isGroup ? '#eef4f8' : undefined, fontWeight: isGroup ? 700 : 400 }}>
                    <td style={{ ...tdP, color: 'var(--text-muted)' }}>{r.stt || i + 1}</td>
                    <td style={{ ...tdP, fontWeight: 500 }}>{r.hangMuc}</td>
                    <td style={tdP}>{r.dvt}</td>
                    <td style={{ ...tdP, textAlign: 'right' }}>{r.khoiLuong ? formatNumber(r.khoiLuong) : ''}</td>
                    <td style={{ ...tdP, textAlign: 'right' }}>{r.dienTich ? formatNumber(r.dienTich) : ''}</td>
                    <td style={{ ...tdP, textAlign: 'right' }}>{r.baoOn ? formatNumber(r.baoOn) : ''}</td>
                    <td style={tdP}>{r.phamVi || ''}</td>
                    <td style={tdP}>{r.thauPhu || ''}</td>
                    <td style={tdP}>{r.batDau || ''}</td>
                    <td style={tdP}>{r.ketThuc || ''}</td>
                    {WBS_STAGES.map(s => (
                      <Fragment key={s.key}>
                        <td style={{ ...tdP, borderLeft: '2px solid #ddd', textAlign: 'center', background: r[s.key] ? '#fff7f7' : undefined }}>{r[s.key] || ''}</td>
                        <td style={{ ...tdP, color: 'var(--text-muted)' }}>{r[`${s.key}Start`] || ''}</td>
                        <td style={{ ...tdP, color: 'var(--text-muted)' }}>{r[`${s.key}Finish`] || ''}</td>
                      </Fragment>
                    ))}
                    <td style={tdP}>{r.khuVuc || ''}</td>
                    <td style={tdP}>{r.ghiChu || ''}</td>
                  </tr>
                )})}
              </tbody>
                </table>
              </div>
            </div>
          </div>
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
