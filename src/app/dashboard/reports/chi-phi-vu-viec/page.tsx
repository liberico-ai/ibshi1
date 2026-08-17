'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatNumber } from '@/lib/utils'
import { Button, Modal, TextareaField } from '@/components/ui'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { Upload, Trash2, FileSpreadsheet } from 'lucide-react'

interface Batch { id: string; fileName: string; note: string | null; rowCount: number; matchedRows: number; totalDebit: number; totalCredit: number; importedByName: string; createdAt: string }
interface ProjRow { projectId: string | null; projectCode: string; projectName: string; groups: Record<string, number>; total: number }
interface LedgerData { batches: Batch[]; projects: ProjRow[]; groupCols: string[]; groupLabels: Record<string, string>; hasData: boolean; canEdit: boolean }

export default function LedgerCostReport() {
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [batchId, setBatchId] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/reports/ledger${batchId ? `?batchId=${batchId}` : ''}`)
    if (res.ok) setData(res as LedgerData)
    setLoading(false)
  }, [batchId])
  useEffect(() => { load() }, [load])

  const delBatch = async (b: Batch) => {
    if (!(await confirmDialog(`Xóa lô "${b.fileName}" (${b.rowCount} dòng)?`))) return
    const res = await apiFetch(`/api/reports/ledger?batchId=${b.id}`, { method: 'DELETE' })
    if (res.ok) { notify('Đã xóa lô', 'success'); if (batchId === b.id) setBatchId(''); else load() } else notify(res.error || 'Lỗi xóa', 'error')
  }

  const fmt = (n: number) => n === 0 ? '—' : formatNumber(n)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Chi phí theo Vụ việc (Kế toán)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nhập bảng kê MISA · gom chi phí theo dự án qua cột « Vụ việc » (net = Nợ − Có)</p>
        </div>
        {data?.canEdit && (
          <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4" /> Nhập bảng kê (MISA)</Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>
      ) : !data ? <p style={{ color: 'var(--danger)' }}>Không tải được dữ liệu</p> : (
        <>
          {/* Lô đã nhập */}
          <div className="card overflow-hidden">
            <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Các lô bảng kê đã nhập ({data.batches.length})</h3>
              {data.batches.length > 0 && (
                <select value={batchId} onChange={e => setBatchId(e.target.value)} className="input" style={{ maxWidth: 260, fontSize: '0.8rem', padding: '4px 8px' }}>
                  <option value="">Tất cả các lô</option>
                  {data.batches.map(b => <option key={b.id} value={b.id}>{b.fileName}</option>)}
                </select>
              )}
            </div>
            {data.batches.length === 0 ? (
              <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 opacity-50" />
                Chưa nhập bảng kê nào. {data.canEdit ? 'Bấm « Nhập bảng kê (MISA) » để bắt đầu.' : ''}
              </div>
            ) : (
              <table className="data-table">
                <thead><tr><th>File</th><th>Người nhập</th><th style={{ textAlign: 'right' }}>Số dòng</th><th style={{ textAlign: 'right' }}>Khớp DA</th><th style={{ textAlign: 'right' }}>Σ Nợ</th><th style={{ textAlign: 'right' }}>Σ Có</th>{data.canEdit && <th style={{ width: 50 }}></th>}</tr></thead>
                <tbody>
                  {data.batches.map(b => (
                    <tr key={b.id}>
                      <td className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{b.fileName}{b.note ? <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>{b.note}</span> : null}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.importedByName}</td>
                      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{b.rowCount}</td>
                      <td className="text-xs" style={{ textAlign: 'right' }}>
                        <span style={{ color: b.matchedRows === b.rowCount ? 'var(--success)' : b.matchedRows === 0 ? 'var(--danger)' : 'var(--warning)' }}>{b.matchedRows}/{b.rowCount}</span>
                      </td>
                      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{formatNumber(b.totalDebit)}</td>
                      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{formatNumber(b.totalCredit)}</td>
                      {data.canEdit && <td style={{ textAlign: 'center' }}><button onClick={() => delBatch(b)} title="Xóa lô" className="p-1.5 rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--danger)' }}><Trash2 className="w-3.5 h-3.5" /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Chi phí theo dự án × nhóm TK */}
          {data.hasData && (
            <div className="card overflow-hidden">
              <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Chi phí thực hiện theo dự án (từ sổ kế toán)</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Net theo nhóm tài khoản = Phát sinh Nợ − Phát sinh Có · đã loại bút toán kết chuyển (TK/đối ứng 154)</p>
              </div>
              <div className="dt-wrapper" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Dự án (Vụ việc)</th>
                      {data.groupCols.map(c => <th key={c} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{data.groupLabels[c]}</th>)}
                      <th style={{ textAlign: 'right' }}>Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map(p => (
                      <tr key={p.projectId || 'none'} style={p.projectId ? {} : { background: 'var(--danger)08' }}>
                        <td className="text-xs">
                          {p.projectId
                            ? <><span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{p.projectCode}</span> <span style={{ color: 'var(--text-muted)' }}>{p.projectName}</span></>
                            : <span style={{ color: 'var(--danger)' }} title="Vụ việc không khớp mã dự án nào">⚠ Chưa khớp vụ việc</span>}
                        </td>
                        {data.groupCols.map(c => <td key={c} className="text-xs font-mono" style={{ textAlign: 'right', color: (p.groups[c] || 0) < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{fmt(p.groups[c] || 0)}</td>)}
                        <td className="text-xs font-mono font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{fmt(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>TỔNG CỘNG</td>
                      {data.groupCols.map(c => <td key={c} className="text-xs font-mono font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{fmt(data.projects.reduce((s, p) => s + (p.groups[c] || 0), 0))}</td>)}
                      <td className="text-xs font-mono font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{fmt(data.projects.reduce((s, p) => s + p.total, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); setBatchId(''); load() }} />}
    </div>
  )
}

// ── Modal nhập bảng kê ──
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ rowCount: number; matchedRows: number; unmatchedCount: number; unmatchedVuViec: string[]; sheet: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!file) return notify('Chọn file bảng kê (.xlsx)', 'error')
    setBusy(true)
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData()
    fd.append('file', file)
    if (note.trim()) fd.append('note', note.trim())
    const res = await fetch('/api/reports/ledger/import', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json()).catch(() => ({ ok: false, error: 'Lỗi mạng' }))
    setBusy(false)
    if (res.ok) { setResult(res); notify(res.message || 'Đã nhập bảng kê', 'success') }
    else notify(res.error || 'Lỗi nhập bảng kê', 'error')
  }

  return (
    <Modal open onClose={onClose} title="Nhập bảng kê kế toán (MISA)" size="md"
      actions={result ? <Button variant="primary" onClick={onDone}>Xong</Button> : <Button variant="primary" onClick={submit} loading={busy} disabled={!file}>Nhập</Button>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="p-3 rounded-lg" style={{ background: 'var(--success)10', color: 'var(--text-primary)' }}>
            Đã nhập <b>{result.rowCount}</b> dòng từ sheet «{result.sheet}». Khớp dự án: <b style={{ color: 'var(--success)' }}>{result.matchedRows}</b>, chưa khớp: <b style={{ color: result.unmatchedCount ? 'var(--danger)' : 'var(--text-muted)' }}>{result.unmatchedCount}</b>.
          </div>
          {result.unmatchedVuViec.length > 0 && (
            <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--danger)08' }}>
              <div className="font-semibold mb-1" style={{ color: 'var(--danger)' }}>Vụ việc không khớp mã dự án:</div>
              <div style={{ color: 'var(--text-secondary)' }}>{result.unmatchedVuViec.join(', ')}</div>
              <div className="mt-1" style={{ color: 'var(--text-muted)' }}>Kiểm tra mã dự án (projectCode) trong ERP có trùng với « Vụ việc » trên MISA không.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>File Excel xuất từ MISA (.xlsx) *</label>
            <div className="mt-1 flex items-center gap-2">
              <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)}
                className="text-xs" style={{ color: 'var(--text-secondary)' }} />
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Cần có các cột: Tài khoản · Phát sinh Nợ/Có · <b>Vụ việc</b>. Hệ thống tự dò sheet & dòng tiêu đề.</p>
          </div>
          <TextareaField label="Ghi chú (tùy chọn)" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="VD: Bảng kê chi phí Q3/2025" />
        </div>
      )}
    </Modal>
  )
}
