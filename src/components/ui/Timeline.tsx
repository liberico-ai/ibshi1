'use client'

import type { ReactNode } from 'react'

interface TimelineItem {
  id: string
  title: string
  description?: string
  timestamp: string
  icon?: ReactNode
  color?: string
}

interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

function Timeline({ items, className = '' }: TimelineProps) {
  return (
    <div className={`timeline ${className}`}>
      {items.map((item, i) => (
        <div key={item.id} className="timeline-item">
          <div className="timeline-dot-col">
            <div
              className="timeline-dot"
              style={item.color ? { background: item.color, borderColor: `${item.color}30` } : undefined}
            >
              {item.icon || null}
            </div>
            {i < items.length - 1 && <div className="timeline-line" />}
          </div>
          <div className="timeline-content">
            <p className="timeline-title">{item.title}</p>
            {item.description && <p className="timeline-desc">{item.description}</p>}
            <time className="timeline-time font-mono">{item.timestamp}</time>
          </div>
        </div>
      ))}
    </div>
  )
}

export { Timeline }
export type { TimelineProps, TimelineItem }
