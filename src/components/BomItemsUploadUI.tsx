'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { formatNumber } from '@/lib/utils'

interface BomItem {
  code: string
  name: string
  spec: string
  quantity: string
  unit: string
}

interface Props {
  isEditable: boolean
  bomData?: string
  onChange: (val: string) => void
  projectCode?: string
}

export default function BomItemsUploadUI({ isEditable, bomData, onChange, projectCode }: Props) {
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  let items: BomItem[] = []
  try {
    const parsed = bomData ? JSON.parse(bomData) : null
    if (Array.isArray(parsed)) items = parsed
  } catch { /* ignore */ }

  const importBomExcel = () => {
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
            'mã vật tư': 'code', 'mã vt': 'code', 'code': 'code', 'mã': 'code',
            'tên vật tư': 'name', 'tên vt': 'name', 'name': 'name', 'tên': 'name',
            'quy chuẩn': 'spec', 'quy cách': 'spec', 'spec': 'spec', 'specification': 'spec',
            'số lượng': 'quantity', 'khối lượng': 'quantity', 'kl': 'quantity', 'sl': 'quantity', 'qty': 'quantity', 'quantity': 'quantity',
            'đvt': 'unit', 'đv': 'unit', 'unit': 'unit',
          }

          let headerIdx = 0, bestMatch = 0
          for (let r = 0; r < Math.min(15, jsonData.length); r++) {
            const row = jsonData[r] || []
            const matchCount = row.filter(c => keyMap[String(c || '').trim().toLowerCase()]).length
            if (matchCount > bestMatch) { bestMatch = matchCount; headerIdx = r }
          }
          if (bestMatch < 1) { setError('Không tìm thấy header hợp lệ (cần: Mã VT, Tên VT, Số lượng, ĐVT)'); return }

          const headerRow = jsonData[headerIdx].map(h => String(h || '').trim().toLowerCase())
          const colMapping = headerRow.map(h => keyMap[h] || '')
          const imported: BomItem[] = []

          for (let i = headerIdx + 1; i < jsonData.length; i++) {
            const rowData = jsonData[i]
            if (!rowData || rowData.every(c => !c)) continue
            const newRow: BomItem = { name: '', code: '', spec: '', quantity: '', unit: '' }
            colMapping.forEach((key, ci) => {
              if (key && rowData[ci] != null) {
                (newRow as unknown as Record<string, string>)[key] = String(rowData[ci])
              }
            })
            if (newRow.name || newRow.code) imported.push(newRow)
          }

          if (imported.length > 0) {
            const existing = items.filter(r => r.name.trim() || r.code.trim())
            onChange(JSON.stringify([...existing, ...imported]))
            setSuccessMsg(`Đã import ${imported.length} vật tư`)
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

  const exportTemplate = () => {
    const headers = ['STT', 'Mã Vật Tư', 'Tên Vật Tư', 'Quy Chuẩn', 'Số Lượng', 'ĐVT']
    const data = items.length > 0
      ? items.map((m, idx) => [idx + 1, m.code, m.name, m.spec, m.quantity, m.unit])
      : [['1', '', '', '', '', '']]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    ws['!cols'] = [{ wch: 5 }, { wch: 20 }, { wch: 40 }, { wch: 25 }, { wch: 15 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BOM')
    XLSX.writeFile(wb, `BOM_VatTuPhu_${projectCode || 'Project'}.xlsx`)
  }

  const totalQty = items.reduce((s, r) => s + (Number(r.quantity) || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: '0.85rem' }}>{error}</div>}
      {successMsg && <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#16a34a', borderRadius: 8, fontSize: '0.85rem' }}>{successMsg}</div>}

      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #8b5cf6' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: '#7c3aed' }}>BOM — Danh mục vật tư phụ</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
          Upload file Excel danh mục vật tư phụ (BOM). Cần có cột: Mã VT, Tên VT, Quy cách, Số lượng, ĐVT.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={exportTemplate}
            style={{ flex: 1, padding: '8px 14px', fontSize: '0.84rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Tải Template BOM
          </button>
          {isEditable && (
            <button type="button" onClick={importBomExcel}
              style={{ flex: 1, padding: '8px 14px', fontSize: '0.84rem', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              Upload BOM Excel
            </button>
          )}
        </div>

        {items.length > 0 ? (
          <>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 360, fontSize: '0.82rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
                    {['STT', 'Mã VT', 'Tên vật tư', 'Quy cách', 'SL', 'ĐVT'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.code}</td>
                      <td style={{ padding: '4px 8px', fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{r.spec}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.quantity ? formatNumber(r.quantity) : ''}</td>
                      <td style={{ padding: '4px 8px' }}>{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{items.length} vật tư</span>
              {totalQty > 0 && <span>Tổng SL: <strong>{formatNumber(totalQty)}</strong></span>}
            </div>
            {isEditable && (
              <button type="button" onClick={() => { onChange('[]'); setSuccessMsg('Đã xoá danh sách BOM.'); setTimeout(() => setSuccessMsg(''), 2000) }}
                style={{ marginTop: 6, padding: '4px 12px', fontSize: '0.78rem', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                ✕ Xoá tất cả
              </button>
            )}
          </>
        ) : (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chưa có dữ liệu BOM. Upload file Excel để import.</div>
        )}
      </div>
    </div>
  )
}
