'use client'

import type { ReactNode } from 'react'
import { SearchX } from 'lucide-react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p className="empty-state-text">{title}</p>
      {description && <p className="empty-state-sub">{description}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

function FilteredEmpty({ onClear, className = '' }: { onClear: () => void; className?: string }) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="Không tìm thấy kết quả"
      description="Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm"
      action={
        <button onClick={onClear} className="btn-outline" style={{ fontSize: 'var(--text-sm)' }}>
          Xóa lọc
        </button>
      }
      className={className}
    />
  )
}

export { EmptyState, FilteredEmpty }
export type { EmptyStateProps }
