'use client'

import { useState, useEffect } from 'react'

// ── Search Bar ──
export function SearchBar({ value, onChange, placeholder = 'Tìm kiếm...' }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [local, setLocal] = useState(value)

  useEffect(() => { setLocal(value) }, [value])

  useEffect(() => {
    const timer = setTimeout(() => { if (local !== value) onChange(local) }, 300)
    return () => clearTimeout(timer)
  }, [local])

  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        className="input pl-9"
        type="text"
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
    </div>
  )
}

// ── Pagination ──
export function Pagination({ page, totalPages, total, onPageChange }: {
  page: number; totalPages: number; total: number; onPageChange: (p: number) => void
}) {
  if (totalPages <= 1) return null

  const pages: (number | 'dots')[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== 'dots') {
      pages.push('dots')
    }
  }

  return (
    <div className="flex items-center justify-between pt-4">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tổng: {total} bản ghi</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2 py-1 text-xs rounded disabled:opacity-30"
          style={{ color: 'var(--text-secondary)' }}
        >←</button>
        {pages.map((p, i) => (
          p === 'dots' ? (
            <span key={`d${i}`} className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className="w-7 h-7 text-xs rounded font-medium transition-colors"
              style={{
                background: p === page ? 'var(--primary)' : 'transparent',
                color: p === page ? 'white' : 'var(--text-secondary)',
              }}
            >{p}</button>
          )
        ))}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2 py-1 text-xs rounded disabled:opacity-30"
          style={{ color: 'var(--text-secondary)' }}
        >→</button>
      </div>
    </div>
  )
}
