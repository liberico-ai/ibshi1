'use client'

import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  title: string
  defaultReason: string
  busy?: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

// Modal in-app nhập lý do "Không ảnh hưởng — Bỏ qua" (thay window.prompt native).
// Reason bắt buộc (nút Xác nhận disabled khi rỗng); server cũng chặn min(1).
export default function SkipReasonModal({ open, title, defaultReason, busy, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState(defaultReason)
  useEffect(() => { if (open) setReason(defaultReason) }, [open, defaultReason])
  if (!open) return null
  const valid = reason.trim().length > 0
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}
      onClick={onCancel}
    >
      <div
        style={{ width: '100%', maxWidth: 440, background: 'var(--bg-primary,#fff)', borderRadius: 14, padding: 18, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 800, fontSize: '.98rem', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: '.78rem', color: 'var(--text-secondary,#64748b)', marginBottom: 10 }}>Nêu lý do bỏ qua (được ghi log). Bắt buộc.</div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Lý do bỏ qua…"
          style={{ width: '100%', border: '1px solid var(--border,#cbd5e1)', borderRadius: 9, padding: '9px 11px', fontSize: '.86rem', background: '#f8fafc', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border,#cbd5e1)', background: 'transparent', fontSize: '.84rem', fontWeight: 600, cursor: 'pointer' }}>Huỷ</button>
          <button
            onClick={() => valid && onConfirm(reason.trim())}
            disabled={!valid || busy}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: valid && !busy ? '#4f46e5' : '#c7c7c7', color: '#fff', fontSize: '.84rem', fontWeight: 700, cursor: valid && !busy ? 'pointer' : 'not-allowed' }}
          >{busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
        </div>
      </div>
    </div>
  )
}
