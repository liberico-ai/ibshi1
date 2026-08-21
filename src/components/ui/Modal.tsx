'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  actions?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Đặt cao hơn khi modal mở CHỒNG lên một lớp phủ khác (vd panel Vật tư mở trên màn xem WBS,
   *  lớp đó đặt inline z-index 9990). Bỏ trống thì dùng z-index 1000 của .modal-overlay. */
  overlayZIndex?: number
}

function Modal({ open, onClose, title, children, actions, size = 'md', className = '', overlayZIndex }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 400, md: 560, lg: 760 }

  return (
    <div className="modal-overlay" style={overlayZIndex ? { zIndex: overlayZIndex } : undefined}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={ref}
        className={`modal-panel animate-fade-in-scale ${className}`}
        style={{ maxWidth: widths[size] }}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="modal-header">
            <h3 className="modal-title font-heading">{title}</h3>
            <button className="modal-close" onClick={onClose} aria-label="Đóng">✕</button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-footer">{actions}</div>}
      </div>
    </div>
  )
}

export { Modal }
export type { ModalProps }
