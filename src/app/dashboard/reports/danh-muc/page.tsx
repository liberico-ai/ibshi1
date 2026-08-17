'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { Button, Modal, InputField, SelectField, TextareaField } from '@/components/ui'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'

interface MReport {
  id: string; sortOrder: number; department: string; name: string
  owner: string | null; dataSource: string | null; recipient: string | null
  frequency: string | null; note: string | null; autoKey: string | null; active: boolean
}
interface Summary { total: number; deptCount: number; byDept: { department: string; count: number; pct: number }[]; byFreq: { frequency: string; count: number }[] }

const FREQ_OPTS = ['Ngày', 'Tuần', 'Tháng', 'Quý', '6 tháng', 'Năm', 'Đột xuất']
type Tab = 'list' | 'summary'

export default function ManagementReportCatalog() {
  const [tab, setTab] = useState<Tab>('list')
  const [reports, setReports] = useState<MReport[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [fDept, setFDept] = useState('')
  const [fFreq, setFFreq] = useState('')
  const [edit, setEdit] = useState<MReport | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/reports/management')
    if (res.ok) { setReports(res.reports || []); setSummary(res.summary || null); setCanEdit(!!res.canEdit) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const depts = useMemo(() => [...new Set(reports.map(r => r.department))].sort(), [reports])
  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase()
    return reports.filter(r =>
      (!fDept || r.department === fDept) &&
      (!fFreq || (r.frequency || '') === fFreq) &&
      (!nq || [r.name, r.owner, r.dataSource, r.recipient, r.note].some(v => (v || '').toLowerCase().includes(nq)))
    )
  }, [reports, q, fDept, fFreq])

  const del = async (r: MReport) => {
    if (!(await confirmDialog(`Xóa "${r.name}" khỏi danh mục?`))) return
    const res = await apiFetch(`/api/reports/management?id=${r.id}`, { method: 'DELETE' })
    if (res.ok) { notify('Đã xóa', 'success'); load() } else notify(res.error || 'Lỗi xóa', 'error')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Danh mục Báo cáo quản trị</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {summary ? `${summary.total} báo cáo • ${summary.deptCount} phòng/ban` : 'Tổng hợp báo cáo quản trị theo phòng/ban'}
          </p>
        </div>
        {canEdit && tab === 'list' && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Thêm báo cáo</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: 'var(--bg-secondary)' }}>
        {([['list', 'Danh mục'], ['summary', 'Tổng hợp']] as [Tab, string][]).map(([k, lb]) => (
          <button key={k} onClick={() => setTab(k)} className="text-xs px-4 py-1.5 rounded-md font-medium transition-all"
            style={{ background: tab === k ? 'var(--accent)' : 'transparent', color: tab === k ? 'white' : 'var(--text-muted)' }}>{lb}</button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
      ) : tab === 'list' ? (
        <>
          {/* Bộ lọc */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tên báo cáo, người phụ trách, nguồn..."
                className="input w-full" style={{ paddingLeft: 34 }} />
            </div>
            <select value={fDept} onChange={e => setFDept(e.target.value)} className="input" style={{ maxWidth: 240 }}>
              <option value="">Tất cả phòng/ban</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={fFreq} onChange={e => setFFreq(e.target.value)} className="input" style={{ maxWidth: 160 }}>
              <option value="">Mọi tần suất</option>
              {FREQ_OPTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="dt-wrapper" style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>STT</th>
                    <th>Phòng / Ban</th><th>Tên báo cáo</th><th>Người phụ trách</th>
                    <th>Nguồn dữ liệu</th><th>Người nhận</th><th style={{ width: 90 }}>Tần suất</th><th>Ghi chú</th>
                    {canEdit && <th style={{ width: 80, textAlign: 'center' }}>Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={canEdit ? 9 : 8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Không có báo cáo phù hợp</td></tr>
                  ) : filtered.map((r, i) => (
                    <tr key={r.id}>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.sortOrder || i + 1}</td>
                      <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.department}</td>
                      <td className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.owner || '—'}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)', maxWidth: 260 }}>{r.dataSource || '—'}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.recipient || '—'}</td>
                      <td className="text-xs">{r.frequency ? <FreqBadge f={r.frequency} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)', maxWidth: 200 }}>{r.note || '—'}</td>
                      {canEdit && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={() => setEdit(r)} title="Sửa" className="p-1.5 rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }}><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => del(r)} title="Xóa" className="p-1.5 rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--danger)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <SummaryView summary={summary} />
      )}

      {(creating || edit) && (
        <ReportModal report={edit} onClose={() => { setCreating(false); setEdit(null) }} onSaved={() => { setCreating(false); setEdit(null); load() }} />
      )}
    </div>
  )
}

function FreqBadge({ f }: { f: string }) {
  const color = f === 'Tuần' ? '#2563eb' : f === 'Tháng' ? '#16a34a' : f === 'Năm' ? '#b45309' : f === 'Ngày' ? '#7c3aed' : '#64748b'
  return <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: `${color}18`, color }}>{f}</span>
}

function SummaryView({ summary }: { summary: Summary | null }) {
  if (!summary) return <p style={{ color: 'var(--text-muted)' }}>Không có dữ liệu</p>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card overflow-hidden">
        <div className="p-4 pb-2"><h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Theo phòng / ban</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tổng {summary.total} báo cáo • {summary.deptCount} phòng</p></div>
        <table className="data-table">
          <thead><tr><th>Phòng / Ban</th><th style={{ textAlign: 'right', width: 90 }}>Số lượng</th><th style={{ textAlign: 'right', width: 90 }}>Tỷ trọng</th></tr></thead>
          <tbody>
            {summary.byDept.map(d => (
              <tr key={d.department}>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{d.department}</td>
                <td className="text-xs font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{d.count}</td>
                <td style={{ textAlign: 'right' }}><span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--accent)18', color: 'var(--accent)' }}>{d.pct}%</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ borderTop: '2px solid var(--border)' }}><td className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>TỔNG CỘNG</td><td className="text-xs font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{summary.total}</td><td className="text-xs font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>100%</td></tr></tfoot>
        </table>
      </div>
      <div className="card overflow-hidden h-fit">
        <div className="p-4 pb-2"><h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Theo tần suất</h3></div>
        <table className="data-table">
          <thead><tr><th>Tần suất</th><th style={{ textAlign: 'right', width: 100 }}>Số lượng</th></tr></thead>
          <tbody>
            {summary.byFreq.map(f => (
              <tr key={f.frequency}>
                <td className="text-xs">{f.frequency === 'Không định kỳ' ? <span style={{ color: 'var(--text-muted)' }}>{f.frequency}</span> : <FreqBadge f={f.frequency} />}</td>
                <td className="text-xs font-bold" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{f.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Modal thêm/sửa báo cáo ──
function ReportModal({ report, onClose, onSaved }: { report: MReport | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    department: report?.department || '', name: report?.name || '', owner: report?.owner || '',
    dataSource: report?.dataSource || '', recipient: report?.recipient || '', frequency: report?.frequency || '', note: report?.note || '',
  })
  const [saving, setSaving] = useState(false)
  const upd = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!f.department.trim() || !f.name.trim()) return notify('Nhập Phòng và Tên báo cáo', 'error')
    setSaving(true)
    const body = report ? { id: report.id, ...f } : f
    const res = await apiFetch('/api/reports/management', { method: report ? 'PATCH' : 'POST', body: JSON.stringify(body) })
    setSaving(false)
    if (res.ok) { notify(report ? 'Đã cập nhật' : 'Đã thêm báo cáo', 'success'); onSaved() } else notify(res.error || 'Lỗi lưu', 'error')
  }

  return (
    <Modal open onClose={onClose} title={report ? 'Sửa báo cáo' : 'Thêm báo cáo'} size="lg"
      actions={<Button variant="primary" onClick={submit} loading={saving}>{report ? 'Lưu' : 'Thêm'}</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Phòng / Ban *" value={f.department} onChange={e => upd('department', e.target.value)} />
          <SelectField label="Tần suất" value={f.frequency} onChange={e => upd('frequency', e.target.value)}
            options={[{ value: '', label: '— Không định kỳ —' }, ...FREQ_OPTS.map(x => ({ value: x, label: x }))]} />
        </div>
        <InputField label="Tên báo cáo *" value={f.name} onChange={e => upd('name', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Người phụ trách" value={f.owner} onChange={e => upd('owner', e.target.value)} />
          <InputField label="Người nhận báo cáo" value={f.recipient} onChange={e => upd('recipient', e.target.value)} />
        </div>
        <TextareaField label="Nguồn dữ liệu" rows={2} value={f.dataSource} onChange={e => upd('dataSource', e.target.value)} />
        <TextareaField label="Ghi chú" rows={2} value={f.note} onChange={e => upd('note', e.target.value)} />
      </div>
    </Modal>
  )
}
