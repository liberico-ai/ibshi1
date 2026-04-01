'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Inspection {
  id: string; inspectionCode: string; type: string; status: string;
  stepCode: string | null; result: string | null; createdAt: string;
  project: { projectCode: string } | null
}

const tabCfg = {
  fat: { label: 'FAT (Factory)', emoji: '🏭', types: ['fat', 'FAT'] },
  sat: { label: 'SAT (Site)', emoji: '🏗️', types: ['sat', 'SAT'] },
}

export default function FATSATPage() {
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'fat' | 'sat'>('fat')

  useEffect(() => {
    apiFetch('/api/qc?limit=200').then(res => {
      if (res.ok) setInspections(res.inspections || [])
      setLoading(false)
    })
  }, [])

  const filtered = inspections.filter(i => tabCfg[tab].types.includes(i.type))

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🔬 FAT / SAT — Nghiệm thu</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Factory Acceptance Test & Site Acceptance Test</p>
      </div>

      <div className="flex gap-2">
        {(Object.entries(tabCfg) as [('fat' | 'sat'), typeof tabCfg.fat][]).map(([key, cfg]) => (
          <button key={key} onClick={() => setTab(key)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: tab === key ? 'var(--primary)' : 'var(--bg-card)', color: tab === key ? '#fff' : 'var(--text-muted)' }}
          >{cfg.emoji} {cfg.label} ({inspections.filter(i => cfg.types.includes(i.type)).length})</button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Dự án</th><th>Step</th><th>Kết quả</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có {tabCfg[tab].label}</td></tr>
            ) : filtered.map(i => (
              <tr key={i.id}>
                <td className="font-mono text-xs" style={{ color: 'var(--primary)' }}>{i.inspectionCode}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{i.project?.projectCode || '—'}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{i.stepCode || '—'}</td>
                <td className="text-xs font-bold" style={{ color: i.result === 'PASS' ? '#16a34a' : i.result === 'FAIL' ? '#dc2626' : '#888' }}>{i.result || '—'}</td>
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
    </div>
  )
}
