'use client'

import { useState } from 'react'
import { DEPARTMENTS_V2 } from '@/lib/org-map'
import { Download, Loader2 } from 'lucide-react'

interface Props {
  endpoint: string          // '/api/admin/audit-logs/export'
  secondLabel: string       // nhãn chiều nhóm thứ 2: 'Hành động' | 'Mức'
  secondParam: string       // tên tham số: 'action' | 'level'
  secondOptions: string[]   // danh sách giá trị (không gồm 'Tất cả')
  filePrefix: string        // 'nhat-ky' | 'error-logs'
}

const MAX_SPAN_DAYS = 93 // ~3 tháng

function dayStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export default function LogExportButton({ endpoint, secondLabel, secondParam, secondOptions, filePrefix }: Props) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(dayStr(-30))
  const [to, setTo] = useState(dayStr(0))
  const [dept, setDept] = useState('ALL')
  const [second, setSecond] = useState('ALL')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const doExport = async () => {
    setErr('')
    if (!from || !to) { setErr('Chọn khoảng thời gian'); return }
    if (from > to) { setErr('Ngày bắt đầu phải trước ngày kết thúc'); return }
    const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / 86400000
    if (spanDays > MAX_SPAN_DAYS) { setErr('Khoảng thời gian tối đa 3 tháng'); return }

    setBusy(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (dept !== 'ALL') params.set('dept', dept)
      if (second !== 'ALL') params.set(secondParam, second)

      const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErr(j.error || `Xuất thất bại (${res.status})`)
        setBusy(false)
        return
      }
      const blob = await res.blob()
      const urlObj = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = urlObj
      a.download = `${filePrefix}_${from}_${to}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(urlObj)
      setBusy(false)
      setOpen(false)
    } catch {
      setErr('Lỗi kết nối, thử lại')
      setBusy(false)
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }
  const fieldStyle: React.CSSProperties = { padding: '6px 10px', fontSize: 12, width: '100%' }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
          color: '#fff', background: 'var(--primary, #4f46e5)', border: 'none', borderRadius: 8, padding: '7px 14px',
        }}
      >
        <Download size={15} /> Export Excel
      </button>

      {open && (
        <>
          {/* nền để bấm ngoài là đóng */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            className="card"
            style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, width: 300, padding: 16, boxShadow: '0 10px 30px rgba(0,0,0,.18)' }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>Xuất Excel theo bộ lọc</p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Từ ngày</label>
                <input type="date" className="input" style={fieldStyle} value={from} max={to} onChange={e => setFrom(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Đến ngày</label>
                <input type="date" className="input" style={fieldStyle} value={to} min={from} onChange={e => setTo(e.target.value)} />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Phòng ban</label>
              <select className="input" style={fieldStyle} value={dept} onChange={e => setDept(e.target.value)}>
                <option value="ALL">Tất cả phòng ban</option>
                {DEPARTMENTS_V2.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{secondLabel}</label>
              <select className="input" style={fieldStyle} value={second} onChange={e => setSecond(e.target.value)}>
                <option value="ALL">Tất cả</option>
                {secondOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
              Chọn &quot;Tất cả&quot; → file tách mỗi phòng ban 1 sheet + sheet Tổng hợp. Khoảng thời gian tối đa 3 tháng.
            </p>

            {err && <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{err}</p>}

            <button
              onClick={doExport}
              disabled={busy}
              className="cursor-pointer"
              style={{
                width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--primary, #4f46e5)',
                border: 'none', borderRadius: 8, padding: '8px 14px', opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {busy ? 'Đang xuất…' : 'Tải file .xlsx'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
