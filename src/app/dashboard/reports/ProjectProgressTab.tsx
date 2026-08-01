'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { Button, Modal } from '@/components/ui'
import { notify } from '@/components/ui/Toast'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const C_PLAN = '#b45309', C_ACTUAL = '#15803d'

interface ProjRow {
  id: string; projectCode: string; projectName: string; pmName: string | null
  startDate: string | null; endDate: string | null; pct: number; rDays: number | null
  taskDone: number; taskTotal: number
}
interface ScurvePoint { label: string; plan: number | null; actual: number | null }
interface ScurveDoc { unit: string; points: ScurvePoint[]; note?: string }

export default function ProjectProgressTab() {
  const [projects, setProjects] = useState<ProjRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState('')
  const [scurve, setScurve] = useState<ScurveDoc | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    apiFetch('/api/reports/project-list').then(r => {
      if (r.ok) { setProjects(r.projects || []); if (r.projects?.[0]) setSelId(r.projects[0].id) }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const loadScurve = useCallback((pid: string) => {
    if (!pid) { setScurve(null); return }
    apiFetch(`/api/reports/project-scurve?projectId=${pid}`).then(r => {
      if (r.ok) { setScurve(r.scurve); setCanEdit(!!r.canEdit) }
    })
  }, [])
  useEffect(() => { loadScurve(selId) }, [selId, loadScurve])

  const selProj = projects.find(p => p.id === selId)
  const chartData = (scurve?.points || []).map(p => ({ name: p.label, 'Kế hoạch': p.plan, 'Thực hiện': p.actual }))

  if (loading) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-4">
      {/* S-curve */}
      <div className="card p-4">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <h3 className="font-heading text-sm font-bold flex-1" style={{ color: 'var(--text-primary)' }}>S-curve tiến độ — Kế hoạch vs Thực hiện (%)</h3>
          <select value={selId} onChange={e => setSelId(e.target.value)} className="input" style={{ padding: '4px 8px', fontSize: '0.85rem', maxWidth: 320 }}>
            <option value="">— Chọn dự án —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
          </select>
          {canEdit && selId && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>Nhập S-curve</Button>}
        </div>
        {!selId ? (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Chọn dự án để xem S-curve</div>
        ) : chartData.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu S-curve cho dự án này{canEdit ? ' — bấm "Nhập S-curve" để thêm.' : '.'}</div>
        ) : mounted ? (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip formatter={(v) => [`${v}%`]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Kế hoạch" stroke={C_PLAN} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="Thực hiện" stroke={C_ACTUAL} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {selProj && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Tiến độ task hiện tại: <b>{selProj.pct}%</b> ({selProj.taskDone}/{selProj.taskTotal} việc){selProj.pmName ? ` · PM: ${selProj.pmName}` : ''}</p>}
      </div>

      {/* Danh mục dự án */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 pb-2">
          <h3 className="font-heading text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Danh mục dự án đang theo dõi ({projects.length})</h3>
        </div>
        <div className="dt-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Mã DA</th><th>Tên dự án</th><th>PM</th><th style={{ minWidth: 140 }}>Tiến độ</th><th>Kết thúc (KH)</th><th>Còn lại</th></tr>
            </thead>
            <tbody>
              {projects.map(p => {
                const over = p.rDays != null && p.rDays < 0
                return (
                  <tr key={p.id} onClick={() => setSelId(p.id)} className="cursor-pointer" style={{ background: p.id === selId ? 'var(--bg-secondary)' : undefined }}>
                    <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{p.projectCode}</span></td>
                    <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{p.projectName}</td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.pmName || '—'}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="rounded-full overflow-hidden" style={{ width: 80, height: 6, background: 'var(--bg-secondary)' }}>
                          <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.pct >= 80 ? 'var(--success)' : p.pct >= 40 ? 'var(--info)' : 'var(--warning)' }} />
                        </div>
                        <span className="font-mono text-xs">{p.pct}%</span>
                      </div>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.endDate ? formatDate(p.endDate) : '—'}</td>
                    <td className="text-xs font-semibold" style={{ color: over ? 'var(--danger)' : 'var(--text-secondary)' }}>
                      {p.rDays == null ? '—' : over ? `Quá ${-p.rDays} ngày` : `Còn ${p.rDays} ngày`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editOpen && selProj && scurve && (
        <ScurveModal projectId={selId} projectCode={selProj.projectCode} doc={scurve}
          onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); loadScurve(selId) }} />
      )}
    </div>
  )
}

// ── Nhập S-curve (các mốc tuần: nhãn · plan% · actual%) ──
function ScurveModal({ projectId, projectCode, doc, onClose, onSaved }: {
  projectId: string; projectCode: string; doc: ScurveDoc; onClose: () => void; onSaved: () => void
}) {
  const [unit, setUnit] = useState(doc.unit || 'week')
  const [rows, setRows] = useState<ScurvePoint[]>(doc.points.length ? doc.points : [{ label: '', plan: null, actual: null }])
  const [saving, setSaving] = useState(false)

  const upd = (i: number, field: keyof ScurvePoint, value: string) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: field === 'label' ? value : (value === '' ? null : Number(value)) } : r))
  }
  const addRow = () => setRows(prev => [...prev, { label: '', plan: null, actual: null }])
  const delRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))

  const save = async () => {
    setSaving(true)
    const points = rows.filter(r => r.label.trim())
    const res = await apiFetch('/api/reports/project-scurve', { method: 'PUT', body: JSON.stringify({ projectId, unit, points }) })
    setSaving(false)
    if (res.ok) { notify('Đã lưu S-curve', 'success'); onSaved() } else notify(res.error || 'Lỗi lưu', 'error')
  }

  const cell = { width: '100%', padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--bg-primary)', fontSize: '0.8rem' }

  return (
    <Modal open onClose={onClose} title={`Nhập S-curve — ${projectCode}`} size="lg"
      actions={<Button variant="primary" onClick={save} loading={saving}>Lưu S-curve</Button>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đơn vị mốc:</span>
          <select value={unit} onChange={e => setUnit(e.target.value)} className="input" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
            <option value="week">Theo tuần (ngày)</option>
            <option value="cw">Theo CW (tuần lịch)</option>
          </select>
          <Button variant="outline" size="sm" onClick={addRow}>+ Thêm mốc</Button>
        </div>
        <div className="dt-wrapper">
          <table className="data-table">
            <thead><tr><th>Mốc (nhãn)</th><th style={{ width: 110 }}>Kế hoạch %</th><th style={{ width: 110 }}>Thực hiện %</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input value={r.label} placeholder={unit === 'cw' ? 'CW14' : '2026-04-21'} onChange={e => upd(i, 'label', e.target.value)} style={cell} /></td>
                  <td><input type="number" value={r.plan ?? ''} onChange={e => upd(i, 'plan', e.target.value)} style={cell} /></td>
                  <td><input type="number" value={r.actual ?? ''} onChange={e => upd(i, 'actual', e.target.value)} style={cell} /></td>
                  <td><button onClick={() => delRow(i)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Mỗi dòng = 1 mốc thời gian. Bỏ trống ô % nếu chưa có số (đường sẽ nối qua điểm trống).</p>
      </div>
    </Modal>
  )
}
