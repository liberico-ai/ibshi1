'use client'

import * as XLSX from 'xlsx'
import type { MomItem, MomSection, MomAttendant } from '@/lib/types'

export const DEFAULT_SECTIONS: MomSection[] = [
  { key: 'I', title: 'Hợp đồng', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'II', title: 'Thiết kế', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'III', title: 'Vật tư', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'IV', title: 'Phần chế tạo', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'V', title: 'Các việc liên quan', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
]

export default function MomSectionsUI({ isEditable, attendantsData, sectionsData, onAttendantsChange, onSectionsChange, onHeaderImport }: {
  isEditable: boolean
  attendantsData: unknown
  sectionsData: unknown
  onAttendantsChange: (val: string) => void
  onSectionsChange: (val: string) => void
  onHeaderImport?: (h: Record<string, string>) => void
}) {
  let attendants: MomAttendant[] = []
  try { const p = attendantsData ? JSON.parse(String(attendantsData)) : null; if (Array.isArray(p)) attendants = p } catch { /* */ }

  let sections: MomSection[] = []
  try { const p = sectionsData ? JSON.parse(String(sectionsData)) : null; if (Array.isArray(p) && p.length > 0) sections = p } catch { /* */ }
  if (sections.length === 0) sections = DEFAULT_SECTIONS

  const updateAttendants = (next: MomAttendant[]) => onAttendantsChange(JSON.stringify(next))
  const updateSections = (next: MomSection[]) => onSectionsChange(JSON.stringify(next))

  const addAttendant = () => updateAttendants([...attendants, { name: '', role: '' }])
  const removeAttendant = (i: number) => updateAttendants(attendants.filter((_, idx) => idx !== i))
  const editAttendant = (i: number, field: string, val: string) => {
    const next = [...attendants]; next[i] = { ...next[i], [field]: val }; updateAttendants(next)
  }

  const addItem = (secIdx: number) => {
    const next = [...sections]
    const items = next[secIdx].items
    next[secIdx] = { ...next[secIdx], items: [...items, { stt: String(items.length + 1), noiDung: '', actionBy: '', dueDate: '', remark: '' }] }
    updateSections(next)
  }
  const removeItem = (secIdx: number, itemIdx: number) => {
    const next = [...sections]
    next[secIdx] = { ...next[secIdx], items: next[secIdx].items.filter((_, i) => i !== itemIdx) }
    updateSections(next)
  }
  const editItem = (secIdx: number, itemIdx: number, field: string, val: string) => {
    const next = [...sections]
    const items = [...next[secIdx].items]
    items[itemIdx] = { ...items[itemIdx], [field]: val }
    next[secIdx] = { ...next[secIdx], items }
    updateSections(next)
  }
  const editSectionTitle = (secIdx: number, val: string) => {
    const next = [...sections]; next[secIdx] = { ...next[secIdx], title: val }; updateSections(next)
  }
  const addSection = () => {
    const keys = ['I','II','III','IV','V','VI','VII','VIII','IX','X']
    const nextKey = keys[sections.length] || String(sections.length + 1)
    updateSections([...sections, { key: nextKey, title: '', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] }])
  }
  const removeSection = (secIdx: number) => updateSections(sections.filter((_, i) => i !== secIdx))

  const importMomExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.xlsx,.xls'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[wb.SheetNames.length - 1]]
        const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

        const header: Record<string, string> = {}
        const parsedAttendants: MomAttendant[] = []
        let inAttendants = false
        let sectionStartRow = -1

        for (let r = 0; r < Math.min(data.length, 20); r++) {
          const row = data[r]
          if (!row) continue
          const c0 = String(row[0] || '').trim()
          const c2 = String(row[2] || '').trim()

          if (c0.toLowerCase().includes('place') || c0.includes('Địa điểm')) {
            header.momPlace = c2
          }
          if (c0.toLowerCase().includes('date') || c0.includes('Ngày')) {
            const rawDate = row[2]
            if (typeof rawDate === 'number') {
              const d = new Date((rawDate - 25569) * 86400000)
              header.kickoffDate = d.toISOString().split('T')[0]
            } else if (rawDate) {
              header.kickoffDate = String(rawDate)
            }
          }
          if (c0.includes('MOM No') || c0.includes('Số biên bản')) {
            const rawNum = row[row.length - 1]
            if (typeof rawNum === 'number') {
              const d = new Date((rawNum - 25569) * 86400000)
              header.momNumber = d.toLocaleDateString('vi-VN')
            } else {
              header.momNumber = String(rawNum || '')
            }
          }
          if (c0.toLowerCase().includes('prepared') || c0.includes('Chuẩn bị')) {
            header.momPreparedBy = c2 || String(row[row.length - 1] || '')
          }
          if (c0.toLowerCase().includes('attendant') || c0.includes('Thành phần')) {
            inAttendants = true
            if (c2) parsedAttendants.push({ name: c2.split(':')[0]?.trim() || c2, role: c2.split(':')[1]?.trim() || '' })
            continue
          }
          if (inAttendants) {
            if (c0.toLowerCase().includes('subject') || c0.includes('Chủ đề') || c2.includes('Acknowledge')) {
              inAttendants = false
            } else if (c2 && !c2.includes('Acknowledge')) {
              if (c2.endsWith(':') || c2.toUpperCase() === c2) {
                // Group header — skip
              } else {
                const parts = c2.split(':')
                parsedAttendants.push({ name: parts[0]?.trim() || c2, role: parts[1]?.trim() || '' })
              }
            }
          }
          if (c0.toLowerCase().includes('subject') || c0.includes('Chủ đề')) {
            header.kickoffAgenda = c2
          }
          if (c0.toLowerCase().includes('stt') || c0.includes('No.')) {
            sectionStartRow = r + 1
          }
        }

        if (sectionStartRow < 0) sectionStartRow = 15
        const parsedSections: MomSection[] = []
        let currentSection: MomSection | null = null
        const romanPattern = /^(I{1,3}|IV|V|VI{0,3}|IX|X)$/

        for (let r = sectionStartRow; r < data.length; r++) {
          const row = data[r]
          if (!row || row.every(c => !c)) continue
          const stt = String(row[0] || '').trim()
          const content = String(row[1] || '').trim()

          if (romanPattern.test(stt)) {
            if (currentSection) parsedSections.push(currentSection)
            currentSection = { key: stt, title: content.replace(/:$/, ''), items: [] }
          } else if (currentSection && (content || String(row[2] || ''))) {
            const noiDung = content || String(row[2] || '')
            const actionByRaw = row[8] ?? row[7] ?? ''
            const dueDateRaw = row[9] ?? ''
            const remarkRaw = row[10] ?? ''

            let dueDate = ''
            if (typeof dueDateRaw === 'number') {
              const d = new Date((dueDateRaw - 25569) * 86400000)
              dueDate = d.toLocaleDateString('vi-VN')
            } else if (dueDateRaw) {
              dueDate = String(dueDateRaw)
            }

            if (noiDung.includes('Acknowledge') || noiDung.includes('ĐẠI DIỆN')) continue
            currentSection.items.push({
              stt: stt || '-',
              noiDung,
              actionBy: String(actionByRaw || ''),
              dueDate,
              remark: String(remarkRaw || ''),
            })
          }
        }
        if (currentSection && currentSection.items.length > 0) parsedSections.push(currentSection)

        if (parsedAttendants.length > 0) updateAttendants(parsedAttendants)
        if (parsedSections.length > 0) updateSections(parsedSections)
        if (onHeaderImport && Object.keys(header).length > 0) onHeaderImport(header)
        if (parsedAttendants.length === 0 && parsedSections.length === 0 && Object.keys(header).length === 0) {
          alert('Không đọc được dữ liệu từ file BB họp. Kiểm tra lại định dạng file.')
        }
        } catch (err) {
          console.error('Import MOM Excel error:', err)
          alert(`Lỗi đọc file Excel: ${err instanceof Error ? err.message : 'không rõ'}`)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  const exportMomExcel = () => {
    const wb = XLSX.utils.book_new()
    const rows: (string | number | null)[][] = []

    rows.push([null, null, null, 'THE MINUTES OF MEETING\nBiên bản cuộc họp'])
    rows.push([])
    rows.push(['ATTENDANTS\nThành phần tham dự', null, attendants.map(a => `${a.name}${a.role ? ': ' + a.role : ''}`).join('\n')])
    rows.push([])
    rows.push(['No.\nSTT', 'DESCRIPTION OF DISCUSSION\nNội dung cuộc họp', null, null, null, null, null, null, 'ACTION BY\nHành động bởi', 'DUE DATE\nThời hạn', 'REMARK\nGhi chú'])

    sections.forEach(sec => {
      rows.push([sec.key, `${sec.title}:`])
      sec.items.forEach(item => {
        rows.push([item.stt, item.noiDung, null, null, null, null, null, null, item.actionBy, item.dueDate, item.remark])
      })
    })

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 6 }, { wch: 50 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws, 'BB Hop')
    XLSX.writeFile(wb, 'BB_Hop_Trien_Khai.xlsx')
  }

  const cellStyle = { padding: '4px 6px', border: '1px solid var(--border)', fontSize: '0.8rem' }
  const inputStyle = { width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', background: 'var(--bg-secondary)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #7c3aed' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#7c3aed' }}>Nội dung BB họp triển khai dự án</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={exportMomExcel}
              style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              📥 Export
            </button>
            {isEditable && (
              <button type="button" onClick={importMomExcel}
                style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                📤 Import Excel
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Thành phần tham dự (Attendants)</h4>
          {isEditable && (
            <div style={{ display: 'flex', gap: 6 }}>
              {attendants.length > 0 && (
                <button type="button" onClick={() => updateAttendants([])}
                  style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                  ✕ Xoá tất cả
                </button>
              )}
              <button type="button" onClick={addAttendant}
                style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                + Thêm
              </button>
            </div>
          )}
        </div>
        {attendants.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', border: '1px dashed var(--border)', borderRadius: 6 }}>
            Chưa có. Nhấn &quot;Import Excel&quot; hoặc &quot;Thêm&quot; để bắt đầu.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={{ ...cellStyle, width: 30 }}>#</th>
                <th style={cellStyle}>Họ tên</th>
                <th style={cellStyle}>Chức danh / Phòng ban</th>
                {isEditable && <th style={{ ...cellStyle, width: 40 }}></th>}
              </tr>
            </thead>
            <tbody>
              {attendants.map((a, i) => (
                <tr key={i}>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>{i + 1}</td>
                  <td style={cellStyle}>
                    {isEditable ? <input style={inputStyle} value={a.name} onChange={e => editAttendant(i, 'name', e.target.value)} placeholder="VD: Mr Hưng" />
                      : a.name}
                  </td>
                  <td style={cellStyle}>
                    {isEditable ? <input style={inputStyle} value={a.role} onChange={e => editAttendant(i, 'role', e.target.value)} placeholder="VD: PM" />
                      : a.role}
                  </td>
                  {isEditable && (
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <button type="button" onClick={() => removeAttendant(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sections.map((sec, secIdx) => (
        <div key={sec.key} className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent)' }}>{sec.key}.</span>
              {isEditable ? (
                <input style={{ ...inputStyle, fontWeight: 600, fontSize: '0.9rem', minWidth: 200 }} value={sec.title}
                  onChange={e => editSectionTitle(secIdx, e.target.value)} placeholder="Tên mục" />
              ) : (
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{sec.title}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {isEditable && (
                <button type="button" onClick={() => addItem(secIdx)}
                  style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                  + Thêm
                </button>
              )}
              {isEditable && sections.length > 1 && (
                <button type="button" onClick={() => removeSection(secIdx)}
                  style={{ padding: '3px 8px', fontSize: '0.7rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                  Xóa mục
                </button>
              )}
            </div>
          </div>
          {sec.items.length === 0 ? (
            <div style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Không có nội dung</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{ ...cellStyle, width: 40 }}>STT</th>
                  <th style={cellStyle}>Nội dung</th>
                  <th style={{ ...cellStyle, width: 110 }}>Hành động bởi</th>
                  <th style={{ ...cellStyle, width: 100 }}>Thời hạn</th>
                  <th style={{ ...cellStyle, width: 130 }}>Ghi chú</th>
                  {isEditable && <th style={{ ...cellStyle, width: 30 }}></th>}
                </tr>
              </thead>
              <tbody>
                {sec.items.map((item, itemIdx) => (
                  <tr key={itemIdx}>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      {isEditable ? <input style={{ ...inputStyle, width: 30, textAlign: 'center' }} value={item.stt} onChange={e => editItem(secIdx, itemIdx, 'stt', e.target.value)} />
                        : item.stt}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.noiDung} onChange={e => editItem(secIdx, itemIdx, 'noiDung', e.target.value)} placeholder="Nội dung công việc" />
                        : item.noiDung}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.actionBy} onChange={e => editItem(secIdx, itemIdx, 'actionBy', e.target.value)} placeholder="Ai thực hiện" />
                        : item.actionBy}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.dueDate} onChange={e => editItem(secIdx, itemIdx, 'dueDate', e.target.value)} placeholder="dd/mm/yyyy" />
                        : item.dueDate}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.remark} onChange={e => editItem(secIdx, itemIdx, 'remark', e.target.value)} placeholder="Ghi chú" />
                        : item.remark}
                    </td>
                    {isEditable && (
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        <button type="button" onClick={() => removeItem(secIdx, itemIdx)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {isEditable && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={addSection}
            style={{ flex: 1, padding: '8px 16px', fontSize: '0.85rem', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            + Thêm mục mới
          </button>
          {(attendants.length > 0 || sections.some(s => s.items.some(it => it.noiDung))) && (
            <button type="button" onClick={() => { updateAttendants([]); updateSections(DEFAULT_SECTIONS) }}
              style={{ padding: '8px 16px', fontSize: '0.85rem', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              ✕ Xoá toàn bộ
            </button>
          )}
        </div>
      )}
    </div>
  )
}
