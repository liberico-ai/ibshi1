'use client'

import type { ReactNode } from 'react'

interface Column<T> {
  key: string
  label: string
  width?: string
  align?: 'left' | 'center' | 'right'
  mono?: boolean
  render?: (row: T, index: number) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  emptyText?: string
  className?: string
  compact?: boolean
}

function DataTable<T>({ columns, data, rowKey, onRowClick, emptyText = 'Không có dữ liệu', className = '', compact }: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '48px 24px' }}>
        <div className="empty-state-icon">📋</div>
        <p className="empty-state-text">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className={`dt-wrapper ${className}`}>
      <table className={`data-table ${compact ? 'dt-compact' : ''}`}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{ width: col.width, textAlign: col.align }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  style={{ textAlign: col.align }}
                  className={col.mono ? 'font-mono' : ''}
                >
                  {col.render
                    ? col.render(row, i)
                    : String((row as Record<string, unknown>)[col.key] ?? '-')
                  }
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { DataTable }
export type { DataTableProps, Column }
