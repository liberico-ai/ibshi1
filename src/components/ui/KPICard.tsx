'use client'

import type { ReactNode } from 'react'

interface KPICardProps {
  label: string
  value: number | string
  delta?: string
  deltaType?: 'up' | 'down' | 'neutral'
  icon?: ReactNode
  accentColor?: string
  href?: string
  className?: string
}

function KPICard({ label, value, delta, deltaType, icon, accentColor, href, className = '' }: KPICardProps) {
  const deltaColor = deltaType === 'up' ? 'var(--success)' : deltaType === 'down' ? 'var(--danger)' : 'var(--text-muted)'

  const content = (
    <div className={`kpi-card ${className}`} style={accentColor ? { '--card-accent': accentColor } as React.CSSProperties : undefined}>
      {accentColor && <div className="kpi-card-bar" style={{ background: accentColor }} />}
      <div className="kpi-card-top">
        {icon && <div className="kpi-card-icon" style={accentColor ? { background: `${accentColor}10` } : undefined}>{icon}</div>}
        <p className="kpi-card-label">{label}</p>
      </div>
      <p className="kpi-card-value font-mono" style={accentColor ? { color: accentColor } : undefined}>{value}</p>
      {delta && (
        <p className="kpi-card-delta" style={{ color: deltaColor }}>
          {deltaType === 'up' ? '↑' : deltaType === 'down' ? '↓' : ''} {delta}
        </p>
      )}
    </div>
  )

  if (href) {
    return <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{content}</a>
  }
  return content
}

export { KPICard }
export type { KPICardProps }
