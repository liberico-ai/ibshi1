'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

// Popup dùng chung toàn hệ thống, thay hộp thoại mặc định của trình duyệt.
// Dùng imperative để migrate cơ học: notify(msg) thay alert; await confirmDialog(msg) thay confirm.

export type ToastType = 'info' | 'success' | 'error' | 'warning'

interface ToastItem { id: number; message: string; type: ToastType }
interface ConfirmItem {
  id: number; message: string; title?: string; confirmText?: string; cancelText?: string;
  danger?: boolean; resolve: (v: boolean) => void
}

// ── Store singleton (pub/sub) ──
let toastListeners: Array<(t: ToastItem[]) => void> = []
let confirmListeners: Array<(c: ConfirmItem | null) => void> = []
let toasts: ToastItem[] = []
let currentConfirm: ConfirmItem | null = null
let seq = 1

function emitToasts() { toastListeners.forEach(l => l([...toasts])) }
function emitConfirm() { confirmListeners.forEach(l => l(currentConfirm)) }

function dismiss(id: number) { toasts = toasts.filter(t => t.id !== id); emitToasts() }

/** Hiện toast (thay cho alert). type mặc định 'info'. */
export function notify(message: string, type: ToastType = 'info', durationMs = 4500): number {
  const id = seq++
  toasts = [...toasts, { id, message: String(message ?? ''), type }]
  emitToasts()
  if (durationMs > 0) setTimeout(() => dismiss(id), durationMs)
  return id
}

/** Hộp thoại xác nhận (thay cho confirm). Trả về Promise<boolean>. */
export function confirmDialog(
  message: string,
  options?: { title?: string; confirmText?: string; cancelText?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    // Nếu đang có 1 confirm khác → tự huỷ cái cũ (false)
    if (currentConfirm) currentConfirm.resolve(false)
    currentConfirm = { id: seq++, message: String(message ?? ''), resolve, ...options }
    emitConfirm()
  })
}

const TYPE_STYLE: Record<ToastType, { bar: string; icon: string }> = {
  info: { bar: 'var(--info, #2563eb)', icon: 'ℹ' },
  success: { bar: 'var(--success, #16a34a)', icon: '✓' },
  error: { bar: 'var(--danger, #dc2626)', icon: '✕' },
  warning: { bar: 'var(--warning, #f59e0b)', icon: '!' },
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  const [confirmItem, setConfirmItem] = useState<ConfirmItem | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const tl = (t: ToastItem[]) => setItems(t)
    const cl = (c: ConfirmItem | null) => setConfirmItem(c)
    toastListeners.push(tl); confirmListeners.push(cl)
    setItems([...toasts]); setConfirmItem(currentConfirm)
    return () => {
      toastListeners = toastListeners.filter(l => l !== tl)
      confirmListeners = confirmListeners.filter(l => l !== cl)
    }
  }, [])

  const closeConfirm = useCallback((val: boolean) => {
    if (currentConfirm) { currentConfirm.resolve(val); currentConfirm = null; emitConfirm() }
  }, [])

  if (!mounted) return null

  // z-index 100010 / 100000: PHẢI cao hơn mọi modal trong hệ (có modal đặt overlay 10050).
  // Thông báo mà bị che thì người dùng bấm xong không biết thành công hay lỗi.
  return createPortal(
    <>
      {/* Toast stack — góc trên phải */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100010, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'min(92vw, 400px)', pointerEvents: 'none' }}>
        {items.map(t => {
          const s = TYPE_STYLE[t.type]
          return (
            <div key={t.id} onClick={() => dismiss(t.id)}
              style={{
                pointerEvents: 'auto', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
                background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #0f172a)',
                borderLeft: `4px solid ${s.bar}`, borderRadius: 12, padding: '12px 14px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.16)', fontSize: 14, lineHeight: 1.45,
                animation: 'ibsToastIn 0.18s ease-out',
              }}>
              <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 999, background: s.bar, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, marginTop: 1 }}>{s.icon}</span>
              <span style={{ whiteSpace: 'pre-line', flex: 1 }}>{t.message}</span>
            </div>
          )
        })}
      </div>

      {/* Confirm dialog */}
      {confirmItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}
          onClick={() => closeConfirm(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #0f172a)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', animation: 'ibsToastIn 0.18s ease-out' }}>
            {confirmItem.title && (
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{confirmItem.title}</h3>
            )}
            <p style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-line', color: 'var(--text-secondary, #475569)' }}>{confirmItem.message}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
              <button onClick={() => closeConfirm(false)}
                style={{ padding: '9px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: 'var(--bg-secondary, #f1f5f9)', color: 'var(--text-muted, #64748b)', border: 'none', cursor: 'pointer' }}>
                {confirmItem.cancelText || 'Huỷ'}
              </button>
              <button onClick={() => closeConfirm(true)}
                style={{ padding: '9px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer', background: confirmItem.danger ? 'var(--danger, #dc2626)' : 'var(--accent, #2563eb)' }}>
                {confirmItem.confirmText || 'Đồng ý'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes ibsToastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </>,
    document.body,
  )
}
