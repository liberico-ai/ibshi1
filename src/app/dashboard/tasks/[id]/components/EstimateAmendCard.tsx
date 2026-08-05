'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'

// Bổ sung / chỉnh sửa DỰ TOÁN (P1.2) — kể cả khi task đã DONE.
// Parse lại sheet DT02 (I/II/III/IV) → gọi /amend: ghi resultData + tự đồng bộ Budget.
// Các bước sau đọc trực tiếp resultData nên tự cập nhật; Budget được re-sync ngay.
interface Totals {
  totalMaterial: number; totalLabor: number; totalService: number; totalOverhead: number
  totalEstimate: number; dt02Detail: string; estimateFileName: string
}

function parseDt02(wb: XLSX.WorkBook, fileName: string): Totals | null {
  const dt02Name = wb.SheetNames.find((s) => s.toLowerCase().includes('dt02'))
  if (!dt02Name) return null
  const data = XLSX.utils.sheet_to_json(wb.Sheets[dt02Name], { header: 1 }) as (string | number | null)[][]
  let mat = 0, lab = 0, svc = 0, ovh = 0, grand = 0
  const detail: { maCP: string; noiDung: string; giaTri: number }[] = []
  for (const row of data) {
    if (!row || row.length < 4) continue
    const stt = String(row[0] || '').trim(); const content = String(row[2] || '').trim(); const value = Number(row[3]) || 0
    if (stt === 'I') { mat = value; detail.push({ maCP: 'I', noiDung: content || 'Chi phí vật tư', giaTri: value }) }
    else if (stt === 'II') { lab = value; detail.push({ maCP: 'II', noiDung: content || 'Chi phí nhân công', giaTri: value }) }
    else if (stt === 'III') { svc = value; detail.push({ maCP: 'III', noiDung: content || 'Chi phí dịch vụ', giaTri: value }) }
    else if (stt === 'IV') { ovh = value; detail.push({ maCP: 'IV', noiDung: content || 'Chi phí chung', giaTri: value }) }
    if (/^\d+$/.test(stt) && value > 0) detail.push({ maCP: String(row[1] || stt), noiDung: content, giaTri: value })
  }
  for (const row of data) {
    if (!row) continue
    const c = String(row[2] || '').toLowerCase()
    if (c.includes('tổng hợp') || c.includes('tổng chi phí')) grand = Number(row[3]) || 0
  }
  if (!grand) grand = mat + lab + svc + ovh
  if (!(grand > 0)) return null
  return { totalMaterial: mat, totalLabor: lab, totalService: svc, totalOverhead: ovh, totalEstimate: grand, dt02Detail: JSON.stringify(detail), estimateFileName: fileName }
}

export default function EstimateAmendCard({ taskId, isDone, onSaved }: { taskId: string; isDone: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [busy, setBusy] = useState(false)
  const fmt = (v: number) => v.toLocaleString('vi-VN')

  const pickFile = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target?.result, { type: 'binary' })
          const t = parseDt02(wb, file.name)
          if (!t) { notify('Không tìm thấy sheet DT02 / dòng I–IV có số trong file', 'error'); return }
          setTotals(t)
        } catch { notify('Không đọc được file Excel', 'error') }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  const save = async () => {
    if (!totals) return
    setBusy(true)
    const res = await apiFetch(`/api/work/tasks/${taskId}/amend`, {
      method: 'POST',
      body: JSON.stringify({ resultData: totals, reason: 'Import lại dự toán (bổ sung sau DONE)' }),
    })
    setBusy(false)
    if (res.ok) { notify('Đã cập nhật dự toán & đồng bộ Ngân sách/Dòng tiền', 'success'); setTotals(null); setOpen(false); onSaved() }
    else notify(res.error || 'Lỗi cập nhật', 'error')
  }

  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <button onClick={() => setOpen(true)} className="text-xs px-3 py-2 rounded-lg font-semibold"
          style={{ border: '1px solid #f59e0b', color: '#92400e', background: '#fffbeb', cursor: 'pointer' }}>
          ✎ {isDone ? 'Bổ sung / Chỉnh sửa dự toán (kể cả đã DONE)' : 'Import lại dự toán'}
        </button>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginTop: 10, padding: 14, border: '1px solid #f59e0b55', background: '#fffbeb' }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
        <h4 style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400e', margin: 0 }}>Bổ sung / Chỉnh sửa dự toán</h4>
        <button onClick={() => { setOpen(false); setTotals(null) }} className="text-xs" style={{ color: 'var(--text-muted)', cursor: 'pointer' }}>Đóng</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Chọn lại file dự toán (.xlsx có sheet DT02). Lưu sẽ ghi vào bước này + <b>tự đồng bộ Ngân sách/Dòng tiền</b>; các bước sau tự lấy được dữ liệu.
      </p>
      <button onClick={pickFile} className="text-xs px-3 py-2 rounded-lg" style={{ border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>
        📄 Chọn file Excel dự toán
      </button>
      {totals && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', maxWidth: 360 }}>
            <span>Vật tư</span><b style={{ textAlign: 'right' }}>{fmt(totals.totalMaterial)}</b>
            <span>Nhân công</span><b style={{ textAlign: 'right' }}>{fmt(totals.totalLabor)}</b>
            <span>Dịch vụ</span><b style={{ textAlign: 'right' }}>{fmt(totals.totalService)}</b>
            <span>Quản lý chung</span><b style={{ textAlign: 'right' }}>{fmt(totals.totalOverhead)}</b>
            <span style={{ fontWeight: 700 }}>TỔNG</span><b style={{ textAlign: 'right', color: '#92400e' }}>{fmt(totals.totalEstimate)}</b>
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={save} disabled={busy} className="text-xs px-4 py-2 rounded-lg font-semibold"
              style={{ background: '#16a34a', color: '#fff', opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
              {busy ? 'Đang lưu…' : '✓ Lưu & đồng bộ'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
