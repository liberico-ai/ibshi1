'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import {
  PageHeader, FilterBar, KPICard, EmptyState, StatusBadge,
} from '@/components/ui'
import { Search, ClipboardList, CheckCircle2, Clock } from 'lucide-react'

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

  const tabFilters = data ? [
    { value: 'overview', label: 'Tong quan' },
    { value: 'inspections', label: `Inspections (${data.summary.inspections.total})` },
    { value: 'ncr', label: `NCR (${data.summary.ncr.total})` },
  ] : []

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Hồ sơ QC — MRB (Manufacturer Record Book)"
        subtitle="Tổng hợp hồ sơ chất lượng theo dự án"
      />

      {/* Project Selector */}
      <div className="card p-4">
        <label className="input-label">Chọn dự án</label>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          className="input mt-1"
        >
          <option value="">-- Chon --</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} -- {p.projectName}</option>)}
        </select>
      </div>

      {loading && <div className="h-32 skeleton rounded-xl" />}

      {data && data.summary && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-5 gap-4">
            <KPICard
              label="Inspections"
              value={`${data.summary.inspections.passed}/${data.summary.inspections.total}`}
              delta={`${data.summary.inspections.pending} pending`}
              deltaType="neutral"
              accentColor={SEMANTIC_COLORS.success.solid}
            />
            <KPICard
              label="NCR"
              value={`${data.summary.ncr.open} open`}
              delta={`${data.summary.ncr.total} total`}
              deltaType={data.summary.ncr.open > 0 ? 'down' : 'neutral'}
              accentColor={data.summary.ncr.open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}
            />
            <KPICard
              label="Certificates"
              value={data.summary.certificates}
              delta="certs"
              deltaType="neutral"
              accentColor={SEMANTIC_COLORS.info.solid}
            />
            <KPICard
              label="Mill Certs"
              value={data.summary.millCertificates}
              delta="MTR"
              deltaType="neutral"
              accentColor="#8b5cf6"
            />
            <KPICard
              label="ITP Progress"
              value={`${data.summary.itp.progress}%`}
              delta={`${data.summary.itp.completed}/${data.summary.itp.total}`}
              deltaType="neutral"
              accentColor={SEMANTIC_COLORS.warning.solid}
            />
          </div>

          {/* Overall Status */}
          <div className="card p-4 flex items-center gap-3">
            <span>{data.summary.overallStatus === 'READY' ? <CheckCircle2 size={28} style={{ color: '#16a34a' }} /> : <Clock size={28} style={{ color: '#d97706' }} />}</span>
            <div>
              <p className="font-heading font-bold" style={{
                color: data.summary.overallStatus === 'READY' ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.warning.solid,
              }}>
                {data.summary.overallStatus === 'READY' ? 'MRB san sang dong goi' : 'MRB chua hoan chinh'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {data.summary.inspections.failed > 0 && `${data.summary.inspections.failed} inspections failed • `}
                {data.summary.ncr.open > 0 && `${data.summary.ncr.open} NCR chua dong • `}
                {data.summary.inspections.pending > 0 && `${data.summary.inspections.pending} inspections pending`}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <FilterBar
            filters={tabFilters}
            value={tab}
            onChange={v => setTab(v as 'overview' | 'inspections' | 'ncr')}
          />

          {/* Inspections Tab */}
          {tab === 'inspections' && (
            <div className="dt-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>Code</th><th>Type</th><th>Status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {data.inspections.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState icon={<Search />} title="Chua co inspection nao" />
                      </td>
                    </tr>
                  ) : data.inspections.map(i => (
                    <tr key={i.id}>
                      <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{i.inspectionCode}</td>
                      <td className="text-xs">{i.type}</td>
                      <td>
                        <span
                          className="badge text-xs"
                          style={{
                            background: i.status === 'PASSED' ? SEMANTIC_COLORS.success.bg
                              : i.status === 'FAILED' ? SEMANTIC_COLORS.danger.bg
                              : SEMANTIC_COLORS.warning.bg,
                            color: i.status === 'PASSED' ? SEMANTIC_COLORS.success.solid
                              : i.status === 'FAILED' ? SEMANTIC_COLORS.danger.solid
                              : SEMANTIC_COLORS.warning.solid,
                          }}
                        >
                          {i.status}
                        </span>
                      </td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(i.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* NCR Tab */}
          {tab === 'ncr' && (
            <div className="dt-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>Code</th><th>Severity</th><th>Status</th><th>Description</th></tr>
                </thead>
                <tbody>
                  {data.ncrs.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState icon={<ClipboardList />} title="Chua co NCR nao" />
                      </td>
                    </tr>
                  ) : data.ncrs.map(n => (
                    <tr key={n.id}>
                      <td className="font-mono text-xs" style={{ color: SEMANTIC_COLORS.danger.solid }}>{n.ncrCode}</td>
                      <td>
                        <span className="text-xs font-bold" style={{
                          color: n.severity === 'CRITICAL' ? SEMANTIC_COLORS.danger.solid
                            : n.severity === 'MAJOR' ? SEMANTIC_COLORS.warning.solid
                            : SEMANTIC_COLORS.neutral.solid,
                        }}>
                          {n.severity}
                        </span>
                      </td>
                      <td>
                        <StatusBadge category="ncr" status={n.status} />
                      </td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{n.description?.slice(0, 60) || '--'}</td>
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
