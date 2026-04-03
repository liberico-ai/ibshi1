'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { SearchBar } from '@/components/SearchPagination'

interface ErrorEntry {
  id: string; level: string; message: string; stack: string | null; code: string | null
  requestId: string | null; method: string | null; path: string | null
  statusCode: number | null; duration: number | null
  userId: string | null; userRole: string | null
  ipAddress: string | null; userAgent: string | null
  requestBody: Record<string, unknown> | null; metadata: Record<string, unknown> | null
  source: string; resolved: boolean; createdAt: string
}

interface Pagination { page: number; limit: number; total: number; totalPages: number }
interface Stats { totalErrors: number; unresolvedCount: number; todayCount: number; topRoutes: { path: string; count: number }[] }

const LEVEL_COLORS: Record<string, string> = { ERROR: '#dc2626', WARN: '#f59e0b', INFO: '#0ea5e9' }
const CODE_OPTIONS = ['', 'VALIDATION', 'DATABASE', 'AUTH', 'BUSINESS', 'UNKNOWN']

export default function ErrorLogPage() {
  const [logs, setLogs] = useState<ErrorEntry[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 30, total: 0, totalPages: 0 })
  const [stats, setStats] = useState<Stats>({ totalErrors: 0, unresolvedCount: 0, todayCount: 0, topRoutes: [] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [codeFilter, setCodeFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [resolvedFilter, setResolvedFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '30' })
    if (search) params.set('search', search)
    if (levelFilter) params.set('level', levelFilter)
    if (codeFilter) params.set('code', codeFilter)
    if (sourceFilter) params.set('source', sourceFilter)
    if (resolvedFilter) params.set('resolved', resolvedFilter)

    const res = await apiFetch(`/api/admin/error-logs?${params}`)
    if (res.ok) {
      setLogs(res.logs || [])
      setPagination(res.pagination || { page: 1, limit: 30, total: 0, totalPages: 0 })
      if (res.stats) setStats(res.stats)
    }
    setLoading(false)
  }, [search, levelFilter, codeFilter, sourceFilter, resolvedFilter])

  useEffect(() => { fetchLogs(1) }, [fetchLogs])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchLogs(pagination.page), 30000)
    return () => clearInterval(interval)
  }, [fetchLogs, pagination.page])

  const toggleResolved = async (ids: string[], resolved: boolean) => {
    await apiFetch('/api/admin/error-logs', {
      method: 'PATCH',
      body: JSON.stringify({ ids, resolved }),
    })
    fetchLogs(pagination.page)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Error Logs</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {pagination.total} errors · Trang {pagination.page}/{pagination.totalPages || 1}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #dc2626' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Errors</p>
          <p className="text-2xl font-bold" style={{ color: '#dc2626' }}>{stats.totalErrors}</p>
        </div>
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #f59e0b' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Unresolved</p>
          <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{stats.unresolvedCount}</p>
        </div>
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #0ea5e9' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Today</p>
          <p className="text-2xl font-bold" style={{ color: '#0ea5e9' }}>{stats.todayCount}</p>
        </div>
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #8b5cf6' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Top Route (7d)</p>
          <p className="text-sm font-bold font-mono" style={{ color: '#8b5cf6' }}>
            {stats.topRoutes[0]?.path || '—'}
            {stats.topRoutes[0] && <span className="text-xs ml-1">({stats.topRoutes[0].count})</span>}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="w-72"><SearchBar value={search} onChange={setSearch} placeholder="Tìm message, route, requestId..." /></div>
        <select className="input w-32" value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '12px' }}>
          <option value="">Level</option>
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
        </select>
        <select className="input w-36" value={codeFilter} onChange={e => setCodeFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '12px' }}>
          <option value="">Error Code</option>
          {CODE_OPTIONS.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-32" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '12px' }}>
          <option value="">Source</option>
          <option value="server">Server</option>
          <option value="client">Client</option>
        </select>
        <select className="input w-36" value={resolvedFilter} onChange={e => setResolvedFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '12px' }}>
          <option value="">Resolved?</option>
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-4">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 skeleton rounded-lg" />)}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>Time</th>
                <th>Route</th>
                <th>Message</th>
                <th>Code</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Không có error logs</td></tr>
              ) : logs.map(l => (
                <Fragment key={l.id}>
                  <tr key={l.id} className="cursor-pointer" onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                    style={{ opacity: l.resolved ? 0.5 : 1 }}>
                    <td>
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{
                        background: `${LEVEL_COLORS[l.level] || '#888'}20`,
                        color: LEVEL_COLORS[l.level] || '#888',
                      }}>{l.level}</span>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(l.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                      {l.method && <span className="font-bold mr-1" style={{ color: '#0ea5e9' }}>{l.method}</span>}
                      {l.path || l.source === 'client' ? 'Client' : '—'}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-primary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.message.slice(0, 80)}{l.message.length > 80 ? '...' : ''}
                    </td>
                    <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{l.code || '—'}</td>
                    <td className="text-xs">
                      {l.resolved
                        ? <span style={{ color: '#16a34a' }}>Resolved</span>
                        : <span style={{ color: '#dc2626' }}>Open</span>
                      }
                    </td>
                    <td className="text-center text-xs">{expandedId === l.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandedId === l.id && (
                    <tr key={l.id + '-detail'}>
                      <td colSpan={7} style={{ background: 'var(--surface-hover)', padding: '12px 16px' }}>
                        <div className="space-y-3">
                          {/* Meta info */}
                          <div className="flex gap-4 flex-wrap text-xs" style={{ color: 'var(--text-muted)' }}>
                            {l.requestId && <span>Request ID: <code className="font-mono">{l.requestId}</code></span>}
                            {l.statusCode && <span>Status: <strong>{l.statusCode}</strong></span>}
                            {l.duration && <span>Duration: <strong>{l.duration}ms</strong></span>}
                            {l.userId && <span>User: <strong>{l.userId}</strong> ({l.userRole})</span>}
                            {l.ipAddress && <span>IP: {l.ipAddress}</span>}
                          </div>

                          {/* Stack trace */}
                          {l.stack && (
                            <details>
                              <summary className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Stack Trace</summary>
                              <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-1" style={{ color: '#dc2626', maxHeight: 200, overflow: 'auto' }}>
                                {l.stack}
                              </pre>
                            </details>
                          )}

                          {/* Request body */}
                          {l.requestBody && (
                            <details>
                              <summary className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Request Body</summary>
                              <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-1" style={{ color: 'var(--text-secondary)', maxHeight: 150, overflow: 'auto' }}>
                                {JSON.stringify(l.requestBody, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* Metadata */}
                          {l.metadata && (
                            <details>
                              <summary className="text-xs font-bold cursor-pointer" style={{ color: 'var(--text-muted)' }}>Metadata</summary>
                              <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-1" style={{ color: 'var(--text-secondary)', maxHeight: 150, overflow: 'auto' }}>
                                {JSON.stringify(l.metadata, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); toggleResolved([l.id], !l.resolved) }}
                              className="px-3 py-1 rounded text-xs font-semibold cursor-pointer"
                              style={{ background: l.resolved ? '#f59e0b20' : '#16a34a20', color: l.resolved ? '#f59e0b' : '#16a34a', border: 'none' }}>
                              {l.resolved ? 'Reopen' : 'Mark Resolved'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
            &#8592; Trước
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
            Sau &#8594;
          </button>
        </div>
      )}
    </div>
  )
}
