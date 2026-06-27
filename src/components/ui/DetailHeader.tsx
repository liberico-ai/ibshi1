'use client'

import type { ReactNode } from 'react'

interface DetailHeaderProps {
  title: string
  code?: string
  subtitle?: string
  badge?: ReactNode
  actions?: ReactNode
  backHref?: string
  className?: string
}

function DetailHeader({ title, code, subtitle, badge, actions, backHref, className = '' }: DetailHeaderProps) {
  return (
    <div className={`detail-header ${className}`}>
      <div className="detail-header-left">
        {backHref && (
          <a href={backHref} className="detail-header-back" aria-label="Quay lại">
            ← Quay lại
          </a>
        )}
        <div className="detail-header-title-row">
          {code && <span className="detail-header-code font-mono">{code}</span>}
          <h1 className="detail-header-title font-heading">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="detail-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="detail-header-actions">{actions}</div>}
    </div>
  )
}

export { DetailHeader }
export type { DetailHeaderProps }
