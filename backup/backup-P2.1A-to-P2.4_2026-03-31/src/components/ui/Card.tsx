'use client'

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type CardPadding = 'compact' | 'default' | 'spacious' | 'none'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding
  hoverable?: boolean
  accentColor?: string
  as?: 'div' | 'a'
  href?: string
  children?: ReactNode
}

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  compact: 'card-compact',
  default: 'card-default',
  spacious: 'card-spacious',
}

const Card = forwardRef<HTMLDivElement, CardProps>(({
  padding = 'default',
  hoverable = false,
  accentColor,
  as = 'div',
  href,
  children,
  className = '',
  style,
  ...props
}, ref) => {
  const classes = [
    'card',
    PADDING_CLASS[padding],
    hoverable ? 'card-hoverable' : '',
    className,
  ].filter(Boolean).join(' ')

  const mergedStyle = accentColor
    ? { ...style, '--card-accent': accentColor } as React.CSSProperties
    : style

  if (as === 'a' && href) {
    return (
      <a
        href={href}
        className={`${classes} card-link`}
        style={mergedStyle}
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {accentColor && <div className="card-accent-bar" />}
        {children}
      </a>
    )
  }

  return (
    <div ref={ref} className={classes} style={mergedStyle} {...props}>
      {accentColor && <div className="card-accent-bar" />}
      {children}
    </div>
  )
})

Card.displayName = 'Card'
export { Card }
export type { CardProps, CardPadding }
