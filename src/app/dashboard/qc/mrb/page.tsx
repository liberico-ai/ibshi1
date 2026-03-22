'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface MRBData {
  project: { projectCode: string; projectName: string; clientName: string } | null
  summary: {
    inspections: { total: number; passed: number; failed: number; pending: number }
    ncr: { total: number; open: number; closed: number }
    certificates: number
    millCertificates: number
    itp: { total: number; completed: number; progress: number }
    overallStatus: string
  }
  inspections: { id: string; inspectionCode: string; type: string; status: string; createdAt: string }[]
  ncrs: { id: string; ncrCode: string; severity: string; status: string; description: string }[]
}

export default function MRBPage() {
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [data, setData] = useState<MRBData | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'overview' | 'inspections' | 'ncr'>('overview')

  useEffect(() => {
    apiFetch('/api/projects?limit=100').then(res => {
      if (res.ok) setProjects(res.projects || [])
    })
  }, [])

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    apiFetch(`/api/qc/mrb?projectId=${projectId}`).then(res => {
      if (res.ok) setData(res as MRBData)
      setLoading(false)
    })
  }, [projectId])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📋 Hồ sơ QC — MRB (Manufacturer Record Book)</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tổng hợp hồ sơ chất lượng theo dự án</p>
      </div>

      <div className="card p-4">
        <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Chọn dự án</label>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          className="mt-1 w-full p-2 rounded-lg text-sm"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          <option value="">— Chọn —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>

      {loading && <div className="h-32 skeleton rounded-xl" />}

      {data && data.summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Inspections', value: `${data.summary.inspections.passed}/${data.summary.inspections.total}`, sub: `${data.summary.inspections.pending} pending`, color: '#16a34a' },
              { label: 'NCR', value: `${data.summary.ncr.open} open`, sub: `${data.summary.ncr.total} total`, color: data.summary.ncr.open > 0 ? '#dc2626' : '#16a34a' },
              { label: 'Certificates', value: String(data.summary.certificates), sub: 'certs', color: '#0ea5e9' },
              { label: 'Mill Certs', value: String(data.summary.millCertificates), sub: 'MTR', color: '#8b5cf6' },
              { label: 'ITP Progress', value: `${data.summary.itp.progress}%`, sub: `${data.summary.itp.completed}/${data.summary.itp.total}`, color: '#f59e0b' },
            ].map((c, i) => (
              <div key={i} className="card p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Overall Status */}
          <div className="card p-4 flex items-center gap-3">
            <span className="text-2xl">{data.summary.overallStatus === 'READY' ? '✅' : '⏳'}</span>
            <div>
              <p className="font-bold" style={{ color: data.summary.overallStatus === 'READY' ? '#16a34a' : '#f59e0b' }}>
                {data.summary.overallStatus === 'READY' ? 'MRB sẵn sàng đóng gói' : 'MRB chưa hoàn chỉnh'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {data.summary.inspections.failed > 0 && `${data.summary.inspections.failed} inspections failed • `}
                {data.summary.ncr.open > 0 && `${data.summary.ncr.open} NCR chưa đóng • `}
                {data.summary.inspections.pending > 0 && `${data.summary.inspections.pending} inspections pending`}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            {[
              { key: 'overview' as const, label: 'Tổng quan' },
              { key: 'inspections' as const, label: `Inspections (${data.summary.inspections.total})` },
              { key: 'ncr' as const, label: `NCR (${data.summary.ncr.total})` },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: tab === t.key ? 'var(--primary)' : 'var(--bg-card)', color: tab === t.key ? '#fff' : 'var(--text-muted)' }}
              >{t.label}</button>
            ))}
          </div>

          {tab === 'inspections' && (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Code</th><th>Type</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {data.inspections.map(i => (
                    <tr key={i.id}>
                      <td className="font-mono text-xs" style={{ color: 'var(--primary)' }}>{i.inspectionCode}</td>
                      <td className="text-xs">{i.type}</td>
                      <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{
                        background: i.status === 'PASSED' ? '#16a34a20' : i.status === 'FAILED' ? '#dc262620' : '#f59e0b20',
                        color: i.status === 'PASSED' ? '#16a34a' : i.status === 'FAILED' ? '#dc2626' : '#f59e0b',
                      }}>{i.status}</span></td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(i.createdAt).toLocaleDateString('vi-VN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'ncr' && (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Code</th><th>Severity</th><th>Status</th><th>Description</th></tr></thead>
                <tbody>
                  {data.ncrs.map(n => (
                    <tr key={n.id}>
                      <td className="font-mono text-xs" style={{ color: '#dc2626' }}>{n.ncrCode}</td>
                      <td className="text-xs font-bold" style={{ color: n.severity === 'CRITICAL' ? '#dc2626' : n.severity === 'MAJOR' ? '#f59e0b' : '#888' }}>{n.severity}</td>
                      <td><span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{
                        background: n.status === 'CLOSED' ? '#16a34a20' : '#dc262620',
                        color: n.status === 'CLOSED' ? '#16a34a' : '#dc2626',
                      }}>{n.status}</span></td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{n.description?.slice(0, 60) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
