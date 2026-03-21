'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { SearchBar } from '@/components/SearchPagination'

interface AuditEntry {
  id: string; action: string; entity: string; entityId: string | null
  changes: unknown; ipAddress: string | null
  username: string; fullName: string; userId: string; createdAt: string
}

interface Pagination { page: number; limit: number; total: number; totalPages: number }

const ACTION_OPTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'DEACTIVATE', 'RESET_PASSWORD']
const ACTION_COLORS: Record<string, string> = {
  CREATE: '#16a34a', UPDATE: '#0ea5e9', DELETE: '#dc2626', LOGIN: '#8b5cf6',
  LOGOUT: '#64748b', APPROVE: '#f59e0b', REJECT: '#ef4444', DEACTIVATE: '#ef4444', RESET_PASSWORD: '#d97706',
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 30, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '30' })
    if (search) params.set('search', search)
    if (actionFilter) params.set('action', actionFilter)
    if (entityFilter) params.set('entity', entityFilter)

    const res = await apiFetch(`/api/admin/audit-logs?${params}`)
    if (res.ok) {
      setLogs(res.logs || [])
      setPagination(res.pagination || { page: 1, limit: 30, total: 0, totalPages: 0 })
    }
    setLoading(false)
  }, [search, actionFilter, entityFilter])

  useEffect(() => { fetchLogs(1) }, [fetchLogs])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Nhật ký hệ thống</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {pagination.total} bản ghi · Trang {pagination.page}/{pagination.totalPages || 1}
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="w-72"><SearchBar value={search} onChange={setSearch} placeholder="Tìm user, entity..." /></div>
        <select className="input w-40" value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '12px' }}>
          <option value="">Tất cả action</option>
          {ACTION_OPTIONS.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="input w-40" placeholder="Entity..." value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '12px' }} />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-4">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 skeleton rounded-lg" />)}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Hành động</th>
                <th>Entity</th>
                <th>Entity ID</th>
                <th>User</th>
                <th>IP</th>
                <th>Thời gian</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Không có bản ghi</td></tr>
              ) : logs.map(l => (
                <>
                  <tr key={l.id} className="cursor-pointer" onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                    <td>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
                        background: `${ACTION_COLORS[l.action] || '#888'}20`,
                        color: ACTION_COLORS[l.action] || '#888',
                      }}>{l.action}</span>
                    </td>
                    <td className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{l.entity}</td>
                    <td className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{l.entityId ? l.entityId.slice(0, 12) + '…' : '—'}</td>
                    <td>
                      <span className="text-xs font-semibold" style={{ color: '#0ea5e9' }}>{l.username}</span>
                      <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>({l.fullName})</span>
                    </td>
                    <td className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{l.ipAddress || '—'}</td>
                    <td className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{new Date(l.createdAt).toLocaleString('vi-VN')}</td>
                    <td className="text-center text-xs">{l.changes ? (expandedId === l.id ? '▲' : '▼') : ''}</td>
                  </tr>
                  {expandedId === l.id && l.changes && (
                    <tr key={l.id + '-detail'}>
                      <td colSpan={7} style={{ background: 'var(--surface-hover)', padding: '12px 16px' }}>
                        <p className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-muted)' }}>CHANGES (JSON):</p>
                        <pre className="text-[10px] font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--text-secondary)', maxHeight: 200, overflow: 'auto' }}>
                          {JSON.stringify(l.changes, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => fetchLogs(pagination.page - 1)} disabled={pagination.page <= 1}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30 cursor-pointer"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            ← Trước
          </button>
          {Array.from({ length: Math.min(pagination.totalPages, 7) }, (_, i) => {
            const p = i + 1
            return (
              <button key={p} onClick={() => fetchLogs(p)}
                className="w-8 h-8 rounded-lg text-xs font-bold cursor-pointer"
                style={{
                  background: pagination.page === p ? 'var(--primary)' : 'transparent',
                  color: pagination.page === p ? '#fff' : 'var(--text-secondary)',
                }}>
                {p}
              </button>
            )
          })}
          <button onClick={() => fetchLogs(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30 cursor-pointer"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            Sau →
          </button>
        </div>
      )}
    </div>
  )
}
