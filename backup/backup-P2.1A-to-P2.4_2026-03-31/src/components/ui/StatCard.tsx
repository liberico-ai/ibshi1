'use client'

import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: number | string
  color: string
  icon?: ReactNode
  accent?: boolean
  href?: string
  compact?: boolean
  className?: string
}

function StatCard({ label, value, color, icon, accent, href, compact, className = '' }: StatCardProps) {
  const content = (
    <>
      <div className="stat-card-bar" style={{ background: color }} />
      {!compact && (
        <div className="stat-card-header">
          {icon && (
            <div className="stat-card-icon" style={{ background: `${color}10` }}>
              {icon}
            </div>
          )}
          {accent && typeof value === 'number' && value > 0 && (
            <span className="stat-card-warning">⚠ Cảnh báo</span>
          )}
        </div>
      )}
      <p className={compact ? 'stat-card-value-compact' : 'stat-card-value'} style={{ color }}>
        {value}
      </p>
      <p className="stat-card-label">{label}</p>
    </>
  )

  const classes = [
    'stat-card',
    compact ? 'stat-card--compact' : '',
    accent && typeof value === 'number' && value > 0 ? 'animate-pulse-glow' : '',
    className,
  ].filter(Boolean).join(' ')

  if (href) {
    return <a href={href} className={`${classes} stat-card--link`}>{content}</a>
  }

  return <div className={classes}>{content}</div>
}

export { StatCard }
export type { StatCardProps }
