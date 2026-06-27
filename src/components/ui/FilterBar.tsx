'use client'

import { type ReactNode } from 'react'

interface FilterOption {
  value: string
  label: string
  count?: number
}

interface FilterBarProps {
  filters: FilterOption[]
  value: string
  onChange: (value: string) => void
  actions?: ReactNode
  className?: string
}

function FilterBar({ filters, value, onChange, actions, className = '' }: FilterBarProps) {
  return (
    <div className={`filter-bar ${className}`}>
      <div className="filter-bar-pills">
        {filters.map(f => (
          <button
            key={f.value}
            className={`filter-pill ${value === f.value ? 'active' : ''}`}
            onClick={() => onChange(f.value)}
            type="button"
          >
            {f.label}
            {f.count !== undefined && (
              <span className="filter-pill-count">{f.count}</span>
            )}
          </button>
        ))}
      </div>
      {actions && <div className="filter-bar-actions">{actions}</div>}
    </div>
  )
}

export { FilterBar }
export type { FilterBarProps, FilterOption }
