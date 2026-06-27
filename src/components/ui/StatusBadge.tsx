'use client'

import { STATUS_COLORS, type StatusCategory } from '@/lib/design-tokens'

interface StatusBadgeProps {
  category: StatusCategory
  status: string
  className?: string
}

function StatusBadge({ category, status, className = '' }: StatusBadgeProps) {
  const map = STATUS_COLORS[category] as Record<string, { bg: string; text: string; label: string }>
  const entry = map[status]
  if (!entry) {
    return <span className={`badge badge-default ${className}`}>{status}</span>
  }

  return (
    <span
      className={`badge ${className}`}
      style={{ background: entry.bg, color: entry.text, borderColor: `${entry.text}20` }}
    >
      {entry.label}
    </span>
  )
}

export { StatusBadge }
export type { StatusBadgeProps }
