'use client'

import Link from 'next/link'

export interface MListCardProps {
  /** Mã chứng từ — chip đỏ chữ mono (JC-0788, WO-0412…). */
  code: string
  title: string
  /** Nhãn trạng thái bên phải mã. Dùng StatusBadge của repo khi có category. */
  badge?: React.ReactNode
  /** Các dòng thông tin phụ: nhãn ↔ giá trị. */
  facts?: { label: string; value: React.ReactNode }[]
  /** Tiến độ 0–100. Bỏ trống nếu không có. */
  progress?: { percent: number; note: string }
  /** Cả thẻ là một link. */
  href?: string
  /** Hoặc cả thẻ là một nút. */
  onClick?: () => void
  children?: React.ReactNode
}

/**
 * Thay DataTable trên mobile — bảng ngang không đọc được trên màn 6".
 * Toàn bộ thẻ là vùng chạm (≥44px).
 */
export function MListCard({
  code,
  title,
  badge,
  facts,
  progress,
  href,
  onClick,
  children,
}: MListCardProps) {
  const body = (
    <>
      <div className="m-card-head">
        <span className="m-code">{code}</span>
        {badge}
      </div>
      <div className="m-card-title">{title}</div>

      {facts && facts.length > 0 && (
        <dl className="m-facts">
          {facts.map((f) => (
            <div className="m-fact" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {progress && (
        <div>
          <div className="m-bar">
            <i style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }} />
          </div>
          <div className="m-bar-note">{progress.note}</div>
        </div>
      )}

      {children}
    </>
  )

  if (href) {
    return (
      <Link href={href} className="m-card m-card-tap" style={{ textDecoration: 'none' }}>
        {body}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" className="m-card m-card-tap" onClick={onClick}>
        {body}
      </button>
    )
  }

  return <div className="m-card">{body}</div>
}
