'use client'

interface DiffRow {
  field: string
  before: string
  after: string
}

interface DiffTableProps {
  rows: DiffRow[]
  className?: string
}

function DiffTable({ rows, className = '' }: DiffTableProps) {
  return (
    <div className={`dt-wrapper ${className}`}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Trường</th>
            <th>Trước</th>
            <th>Sau</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const changed = row.before !== row.after
            return (
              <tr key={row.field}>
                <td style={{ fontWeight: 600 }}>{row.field}</td>
                <td style={changed ? { background: '#FDECEA', color: '#C8372B' } : undefined}>
                  {row.before || '—'}
                </td>
                <td style={changed ? { background: '#E6F4EC', color: '#1E8E5A' } : undefined}>
                  {row.after || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export { DiffTable }
export type { DiffTableProps, DiffRow }
