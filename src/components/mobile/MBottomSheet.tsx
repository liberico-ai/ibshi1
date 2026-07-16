'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface MBottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

/**
 * Sheet trượt từ đáy — thay Modal của desktop (dialog giữa màn, không có safe-area).
 * Đóng bằng nút, chạm nền, hoặc Esc.
 */
export function MBottomSheet({ open, onClose, title, children }: MBottomSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'rgba(23,25,29,.45)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '20px 20px 0 0',
          padding: '10px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
          maxHeight: '86dvh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 40, height: 4, borderRadius: 3, background: '#d5d8dd', alignSelf: 'center', flexShrink: 0 }}
        />
        <div
          style={{
            fontFamily: "'Space Grotesk', var(--font-geist-sans), sans-serif",
            fontSize: 17,
            fontWeight: 600,
            color: 'var(--color-ink, #17191D)',
          }}
        >
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
