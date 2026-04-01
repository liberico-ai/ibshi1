import type { ReactNode } from 'react'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: ReactNode
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: 'badge badge-success',
  warning: 'badge badge-warning',
  danger: 'badge badge-danger',
  info: 'badge badge-info',
  default: 'badge badge-default',
}

function Badge({ variant = 'default', className = '', children }: BadgeProps) {
  return (
    <span className={`${VARIANT_CLASS[variant]} ${className}`}>
      {children}
    </span>
  )
}

export { Badge }
export type { BadgeProps, BadgeVariant }
