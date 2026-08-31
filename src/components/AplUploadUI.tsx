'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatNumber } from '@/lib/utils'
import { parseAplSheets, scoreAplSheet, guessRevision, type Row } from '@/lib/apl-parser'

// Assembly Part List (APL) — bảng part do Thiết kế lập, cỡ ~25.000 dòng.
// Khác các biểu mẫu khác: dữ liệu KHÔNG nằm trong resultData mà ở bảng apl_lines,
// resultData chỉ giữ id bản nhập. Vì vậy màn này luôn phân trang + lọc ở server.

interface AplColumn { index: number; key: string; label: string; field: string | null; numeric: boolean }

interface AplImport {
  id: string; fileName: string; sheetName: string; title: string | null; revision: string | null
  totalRows: number; assemblyRows: number; partRows: number; distinctAssemblies: number
  scopeUnits: number; totalWeightKg: number; totalAreaM2: number
  byCategory: Record<string, number> | null; warnings: string[] | null
  columns?: AplColumn[]; createdAt: string
}

interface AplLine {
  id: string; rowNo: number; isAssembly: boolean
  seq: string | null; drawingNo: string | null; assembly: string | null; pos: string | null
  part: string | null; markCutting: string | null; description: string | null
  profile: string | null; grade: string | null; typeCutting: string | null
  thicknessMm: number | null; widthMm: number | null; lengthMm: number | null
  qty: number | null; unitWeightKg: number | null; totalWeightKg: number | null; areaM2: number | null
  category: string | null; remark: string | null; extra: Record<string, string | number> | null
}

interface Props {
  isEditable: boolean
  taskId: string
  projectId?: string
  /** resultData.aplImportId — bản APL đang gắn với bước này */
  importId?: string
  fileName?: string
  onFieldChange: (key: string, value: unknown) => void
}

const PAGE_SIZE = 100

const th: React.CSSProperties = { padding: '5px 8px', textAlign: 'left', border: '1px solid #b7c9d4', fontWeight: 600, color: '#1f3a4d', whiteSpace: 'nowrap', background: '#c7e2ef' }
const td: React.CSSProperties = { padding: '3px 8px', border: '1px solid var(--border)', whiteSpace: 'nowrap' }

export default function AplUploadUI({ isEditable, taskId, projectId, importId, fileName, onFieldChange }: Props) {
  const roleCode = useAuthStore(s => s.user?.roleCode || '')
  const [apl, setApl] = useState<AplImport | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<AplLine[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [filteredWeight, setFilteredWeight] = useState(0)
  const [q, setQ] = useState('')
  const [qLive, setQLive] = useState('')
  const [type, setType] = useState<'all' | 'part' | 'assembly'>('part')
  const [linesLoading, setLinesLoading] = useState(false)

  const loadHeader = useCallback(() => {
    if (!importId) { setApl(null); return }
    setLoading(true)
    apiFetch(`/api/design/apl/${importId}`)
      .then(r => { if (r.ok) setApl(r.apl as AplImport) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [importId])

  useEffect(() => { loadHeader() }, [loadHeader])

  // Gõ tìm kiếm thì đợi 400ms mới gọi server — 25k dòng, gọi mỗi phím là quá tải
  useEffect(() => {
    const t = setTimeout(() => { setQ(qLive); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [qLive])

  const loadLines = useCallback(() => {
    if (!importId || !open) return
    setLinesLoading(true)
    const sp = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), type })
    if (q) sp.set('q', q)
    apiFetch(`/api/design/apl/${importId}/lines?${sp}`)
      .then(r => {
        if (r.ok) {
          setLines(r.lines as AplLine[])
          setPages(Number(r.pages) || 1)
          setTotal(Number(r.total) || 0)
          setFilteredWeight(Number(r.filteredWeightKg) || 0)
        }
      })
      .catch(() => {})
      .finally(() => setLinesLoading(false))
  }, [importId, open, page, q, type])

  useEffect(() => { loadLines() }, [loadLines])

  // KHÔNG gửi thẳng file Excel lên server: route handler của Next chặn body > 10MB
  // (đo thực tế 9,9MB qua / 11,1MB chặn), mà file APL thật 12,98MB — tách riêng sheet APL
  // vẫn còn 10,52MB. Nên đọc & parse ngay tại máy người dùng rồi đẩy dòng theo lô.
  // Đọc file cũng CHỈ lấy đúng sheet APL, không đụng 17 sheet phụ.
  const upload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      setUploading(true); setError(''); setSuccessMsg(''); setProgress('Đang đọc file…')
      let createdId = ''
      try {
        const buf = await file.arrayBuffer()

        // Bước 1 — dò tên sheet APL bằng bản xem trước 20 dòng đầu mỗi sheet (rất nhẹ).
        const peek = XLSX.read(buf, { type: 'array', sheetRows: 20 })
        let bestName = ''
        let bestScore = -1
        for (const n of peek.SheetNames) {
          const head = XLSX.utils.sheet_to_json(peek.Sheets[n], { header: 1, defval: '' }) as Row[]
          const sc = scoreAplSheet(n, head)
          if (sc > bestScore) { bestScore = sc; bestName = n }
        }
        if (!bestName || bestScore < 8) {
          setError(`Không nhận ra sheet nào là bảng APL trong file (có: ${peek.SheetNames.slice(0, 6).join(', ')}…). Cần các cột ASSEMBLY / PART / Description / Profile.`)
          return
        }

        // Bước 2 — đọc ĐẦY ĐỦ đúng một sheet đó
        setProgress(`Đang đọc sheet "${bestName}"…`)
        const wb = XLSX.read(buf, { type: 'array', sheets: [bestName] })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[bestName], { header: 1, defval: '' }) as Row[]
        const parsed = parseAplSheets({ [bestName]: rows }, { sheetName: bestName })
        if (!parsed.ok) {
          setError(parsed.reason === 'NO_HEADER'
            ? `Sheet "${bestName}" không thấy dòng tiêu đề (cần ASSEMBLY / PART / Description / Profile…)`
            : `Sheet "${bestName}" không có dòng dữ liệu nào`)
          return
        }

        // Bước 3 — tạo phiếu
        setProgress(`Đã đọc ${parsed.lines.length.toLocaleString('en-US')} dòng. Đang tạo phiếu…`)
        const head = await apiFetch('/api/design/apl', {
          method: 'POST',
          body: JSON.stringify({
            taskId, projectId,
            fileName: file.name, sheetName: parsed.sheetName, title: parsed.title,
            revision: guessRevision(file.name, parsed.title),
            headerRow: parsed.headerRow, columns: parsed.columns,
            summary: parsed.summary, warnings: parsed.warnings,
          }),
        })
        if (!head?.ok) { setError(head?.error || 'Không tạo được phiếu APL'); return }
        createdId = String(head.importId)

        // Bước 4 — đẩy dòng theo lô (~1,5MB/lô, an toàn dưới giới hạn 10MB)
        const BATCH = 2500
        for (let i = 0; i < parsed.lines.length; i += BATCH) {
          const chunk = parsed.lines.slice(i, i + BATCH)
          const r = await apiFetch(`/api/design/apl/${createdId}/lines`, {
            method: 'POST',
            body: JSON.stringify({ lines: chunk }),
          })
          if (!r?.ok) throw new Error(r?.error || 'Nạp dòng thất bại')
          const done = Math.min(i + BATCH, parsed.lines.length)
          setProgress(`Đang nạp ${done.toLocaleString('en-US')}/${parsed.lines.length.toLocaleString('en-US')} dòng…`)
        }

        await onFieldChange('aplImportId', createdId)
        await onFieldChange('aplFileName', file.name)
        createdId = ''
        setSuccessMsg(`Đã nhập ${parsed.lines.length.toLocaleString('en-US')} dòng APL từ sheet "${parsed.sheetName}"`)
        setTimeout(() => setSuccessMsg(''), 8000)
      } catch (err) {
        // Đứt giữa chừng thì dọn phiếu dở, không để lại bản nhập thiếu dòng
        if (createdId) await apiFetch(`/api/design/apl/${createdId}`, { method: 'DELETE' }).catch(() => {})
        setError(`Lỗi nhập APL: ${err instanceof Error ? err.message : 'không rõ'}`)
      } finally {
        setUploading(false); setProgress('')
      }
    }
    input.click()
  }

  const removeApl = async () => {
    if (!importId) return
    setError('')
    const r = await apiFetch(`/api/design/apl/${importId}`, { method: 'DELETE' }).catch(() => null)
    if (!r?.ok) { setError(r?.error || 'Không xoá được'); return }
    onFieldChange('aplImportId', '')
    onFieldChange('aplFileName', '')
    setApl(null); setOpen(false)
    setSuccessMsg('Đã xoá bản APL. Có thể upload lại.')
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  const extraCols = (apl?.columns || []).filter(c => !c.field)
  const cats = Object.entries(apl?.byCategory || {}).sort((a, b) => b[1] - a[1])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: '0.85rem' }}>{error}</div>}
      {successMsg && <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#16a34a', borderRadius: 8, fontSize: '0.85rem' }}>{successMsg}</div>}

      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #4338ca' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: '#4338ca' }}>Assembly Part List (APL)</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
          Upload file APL của Thiết kế. Hệ thống đọc cột theo NHÃN trong file (không cố định vị trí),
          cột riêng của dự án vẫn giữ nguyên. File lớn (vài chục nghìn dòng) được nạp thẳng vào cơ sở
          dữ liệu, xem có tìm kiếm và phân trang.
        </p>
        {isEditable && (
          <button type="button" onClick={upload} disabled={uploading}
            style={{ width: '100%', padding: '10px 16px', fontSize: '0.85rem', background: uploading ? '#a5b4fc' : '#4338ca', color: '#fff', border: 'none', borderRadius: 8, cursor: uploading ? 'wait' : 'pointer', fontWeight: 700 }}>
            {uploading ? (progress || 'Đang xử lý…') : 'Upload file APL'}
          </button>
        )}

        {fileName && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>
              File: <strong>{fileName}</strong>
              {apl?.sheetName ? ` · sheet "${apl.sheetName}"` : ''}
              {apl?.revision ? ` · ${apl.revision}` : ''}
            </span>
            {isEditable && (
              <button type="button" onClick={removeApl}
                style={{ padding: '4px 12px', fontSize: '0.78rem', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                ✕ Xoá
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #0d9488' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#0d9488' }}>Tổng hợp APL</h3>
          {apl && (
            <button type="button" onClick={() => setOpen(true)}
              style={{ padding: '8px 22px', fontSize: '0.85rem', fontWeight: 700, background: 'linear-gradient(135deg, #14b8a6 0%, #4338ca 100%)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', letterSpacing: '0.3px' }}>
              XEM chi tiết
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Đang tải…</div>
        ) : !apl ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Chưa có APL. Upload file Excel để nhập.
          </div>
        ) : (
          <>
            {apl.title && <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>{apl.title}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {([
                ['Tổng số dòng', formatNumber(apl.totalRows)],
                ['Dòng part', formatNumber(apl.partRows)],
                ['Cụm (assembly)', formatNumber(apl.distinctAssemblies)],
                ['Tổng khối lượng', `${formatNumber(Math.round(apl.totalWeightKg))} kg`],
                ['Tổng diện tích', `${formatNumber(Math.round(apl.totalAreaM2))} m²`],
              ] as [string, string][]).map(([label, v]) => (
                <div key={label} style={{ padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>

            {apl.scopeUnits > 1 && (
              <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '6px 10px' }}>
                Số lượng và khối lượng đang lấy theo cột tổng cho <b>{apl.scopeUnits} UNIT</b> — tức toàn bộ phạm vi dự án.
              </div>
            )}

            {cats.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cats.slice(0, 12).map(([name, n]) => (
                  <span key={name} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe' }}>
                    {name.length > 40 ? name.slice(0, 40) + '…' : name}: {formatNumber(n)}
                  </span>
                ))}
              </div>
            )}

            {extraCols.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {extraCols.length} cột riêng của dự án được giữ nguyên
                </summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {extraCols.map(c => (
                    <span key={c.key} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>{c.label}</span>
                  ))}
                </div>
              </details>
            )}

            {(apl.warnings || []).map((w, i) => (
              <div key={i} style={{ marginTop: 6, fontSize: '0.75rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px' }}>{w}</div>
            ))}
          </>
        )}
      </div>

      {/* Bảng tra cứu toàn màn hình — lọc & phân trang ở server */}
      {open && apl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '10px 20px', borderBottom: '2px solid #4338ca', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0, background: '#eef2ff' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.02rem', color: '#312e81' }}>Assembly Part List</h2>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  {formatNumber(total)} dòng khớp lọc · {formatNumber(Math.round(filteredWeight))} kg
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={qLive} onChange={e => setQLive(e.target.value)} placeholder="Tìm mã part / mark cắt / assembly / bản vẽ / mô tả…"
                  className="input" style={{ fontSize: '0.78rem', padding: '5px 10px', minWidth: 300 }} />
                <select value={type} onChange={e => { setType(e.target.value as typeof type); setPage(1) }}
                  className="input" style={{ fontSize: '0.78rem', padding: '5px 8px' }}>
                  <option value="part">Chỉ dòng part</option>
                  <option value="assembly">Chỉ dòng cụm</option>
                  <option value="all">Tất cả</option>
                </select>
                <button type="button" onClick={() => setOpen(false)}
                  style={{ padding: '5px 14px', fontSize: '0.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>✕ Đóng</button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', fontSize: '0.72rem', position: 'relative' }}>
              {linesLoading && (
                <div style={{ position: 'sticky', top: 0, zIndex: 3, padding: '4px 12px', background: '#fef9c3', color: '#854d0e', fontSize: '0.72rem' }}>Đang tải…</div>
              )}
              <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', width: 'max-content' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                    {['Dòng', 'NO', 'Bản vẽ', 'Assembly', 'POS', 'Part', 'Mark cắt', 'Mô tả', 'Profile', 'Vật liệu',
                      'Dày', 'Rộng', 'Dài', 'SL', 'KL/cái', 'KL tổng', 'Diện tích', 'Phân loại', 'Ghi chú'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                    {extraCols.map(c => <th key={c.key} style={{ ...th, background: '#fef3c7', color: '#92400e' }}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} style={{ background: l.isAssembly ? '#eef4f8' : undefined, fontWeight: l.isAssembly ? 600 : 400 }}>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{l.rowNo + 1}</td>
                      <td style={td}>{l.seq || ''}</td>
                      <td style={td}>{l.drawingNo || ''}</td>
                      <td style={td}>{l.assembly || ''}</td>
                      <td style={td}>{l.pos || ''}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{l.part || ''}</td>
                      <td style={td}>{l.markCutting || ''}</td>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 340 }}>{l.description || ''}</td>
                      <td style={td}>{l.profile || ''}</td>
                      <td style={td}>{l.grade || ''}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.thicknessMm ?? ''}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.widthMm ?? ''}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.lengthMm ?? ''}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.qty ?? ''}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.unitWeightKg != null ? l.unitWeightKg.toFixed(2) : ''}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{l.totalWeightKg != null ? formatNumber(Math.round(l.totalWeightKg)) : ''}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.areaM2 != null ? l.areaM2.toFixed(2) : ''}</td>
                      <td style={td}>{l.category || ''}</td>
                      <td style={td}>{l.remark || ''}</td>
                      {extraCols.map(c => <td key={c.key} style={{ ...td, color: '#92400e' }}>{String(l.extra?.[c.key] ?? '')}</td>)}
                    </tr>
                  ))}
                  {lines.length === 0 && !linesLoading && (
                    <tr><td colSpan={19 + extraCols.length} style={{ ...td, textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Không có dòng nào khớp.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, background: 'var(--bg-secondary)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Trang {page}/{pages} · {PAGE_SIZE} dòng/trang
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setPage(1)} disabled={page <= 1} style={pgBtn(page <= 1)}>« Đầu</button>
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={pgBtn(page <= 1)}>‹ Trước</button>
                <button type="button" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} style={pgBtn(page >= pages)}>Sau ›</button>
                <button type="button" onClick={() => setPage(pages)} disabled={page >= pages} style={pgBtn(page >= pages)}>Cuối »</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isEditable && !apl && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Vai {roleCode} không được nhập APL — chỉ Thiết kế, PM và BGĐ.
        </div>
      )}
    </div>
  )
}

function pgBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', fontSize: '0.75rem', borderRadius: 6,
    border: '1px solid var(--border)', background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#94a3b8' : 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600,
  }
}
