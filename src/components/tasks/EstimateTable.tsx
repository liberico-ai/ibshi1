'use client'

// Shared editable estimate table component used by P1.2, P2.1A/B/C, P2.4 forms

export type EstColumn = { key: string; label: string; type?: string; width?: string }
export type EstRow = Record<string, string>

interface EstimateTableProps {
  title: string
  code: string
  dataKey: string
  columns: EstColumn[]
  defaultRows: EstRow[]
  formData: Record<string, string | number>
  onFieldChange: (key: string, value: string) => void
  isActive: boolean
}

export default function EstimateTable({
  title, code, dataKey, columns, defaultRows, formData, onFieldChange, isActive,
}: EstimateTableProps) {
  let rows: EstRow[] = []
  try {
    const p = formData[dataKey] ? JSON.parse(formData[dataKey] as string) : null
    rows = (Array.isArray(p) && p.length > 0) ? p : defaultRows
  } catch {
    rows = defaultRows
  }

  const save = (next: EstRow[]) => onFieldChange(dataKey, JSON.stringify(next))
  const addRow = () => save([...rows, Object.fromEntries(columns.map(c => [c.key, '']))])
  const removeRow = (i: number) => save(rows.filter((_, idx) => idx !== i))
  const update = (i: number, key: string, val: string) => {
    const n = [...rows]; n[i] = { ...n[i], [key]: val }; save(n)
  }

  return (
    <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent)' }}>
          {title} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({code})</span>
        </h3>
        {isActive && (
          <button type="button" onClick={addRow}
            style={{ padding: '4px 12px', fontSize: '0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            + Thêm
          </button>
        )}
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')} ${isActive ? '28px' : ''}`, gap: 4, padding: '6px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>#</span>
          {columns.map(c => (
            <span key={c.key} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>{c.label}</span>
          ))}
          {isActive && <span />}
        </div>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')} ${isActive ? '28px' : ''}`, gap: 4, padding: '3px 8px', borderBottom: ri < rows.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ri + 1}</span>
            {columns.map(c => (
              <input key={c.key} className="input" value={row[c.key] || ''} disabled={!isActive}
                onChange={e => update(ri, c.key, e.target.value)}
                placeholder={c.label}
                style={{ fontSize: '0.75rem', padding: '3px 6px', textAlign: c.type === 'number' ? 'right' : 'left' }} />
            ))}
            {isActive && rows.length > 1 && (
              <button type="button" onClick={() => removeRow(ri)}
                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, padding: 0 }}>−</button>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rows.length} dòng</div>
    </div>
  )
}
