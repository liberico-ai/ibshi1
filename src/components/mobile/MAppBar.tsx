'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface MAppBarProps {
  title: string
  subtitle?: string
  /** Mặc định quay lại trang trước; truyền href để về đích cố định. */
  backHref?: string
  /** Màn gốc (/m) không có nút back. */
  hideBack?: boolean
}

export function MAppBar({ title, subtitle, backHref, hideBack }: MAppBarProps) {
  const router = useRouter()

  return (
    <header className="m-appbar">
      {!hideBack && (
        <button
          type="button"
          className="m-appbar-back"
          aria-label="Quay lại"
          onClick={() => (backHref ? router.push(backHref) : router.back())}
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      )}
      <div className="m-appbar-titles">
        <div className="m-appbar-title">{title}</div>
        {subtitle && <div className="m-appbar-sub">{subtitle}</div>}
      </div>
      <span className="m-logo" aria-hidden="true">
        <i /><i /><i />
      </span>
    </header>
  )
}
