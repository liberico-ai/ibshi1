'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { Button, Modal, InputField, SelectField, TextareaField } from '@/components/ui'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { Plus, Trash2, FileText, Download } from 'lucide-react'

interface GiaiTrinh {
  id: string; legacyBidCode: string | null; bidCode: string; subject: string | null; bidDate: string | null
  notes: string | null; sourceFileName: string | null; sourceFilePath: string | null; status: string; createdAt: string
  project: { projectCode: string; projectName: string } | null
}
interface ProjectOption { id: string; projectCode: string; projectName: string }

export default function GiaiTrinhDauThauPage() {
  const [rows, setRows] = useState<GiaiTrinh[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fProject, setFProject] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/procurement/bid-analyses/giai-trinh${fProject ? `?projectId=${fProject}` : ''}`)
    if (res.ok) { setRows(res.rows || []); setCanEdit(!!res.canEdit) }
    setLoading(false)
  }, [fProject])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const del = async (g: GiaiTrinh) => {
    if (!(await confirmDialog(`Xóa giải trình "${g.legacyBidCode || g.bidCode}"?`))) return
    const res = await apiFetch(`/api/procurement/bid-analyses/giai-trinh?id=${g.id}`, { method: 'DELETE' })
    if (res.ok) { notify('Đã xóa', 'success'); load() } else notify(res.error || 'Lỗi xóa', 'error')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Giải trình Mua sắm / Đấu thầu (MSDT)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Lưu file giải trình đã ký + tra cứu theo dự án · {rows.length} phiếu</p>
        </div>
        {canEdit && <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" /> Thêm giải trình</Button>}
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Lọc theo dự án:</label>
        <select value={fProject} onChange={e => setFProject(e.target.value)} className="input text-sm" style={{ maxWidth: 360 }}>
          <option value="">— Tất cả dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="dt-wrapper" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Số / Mã giải trình</th><th>Dự án</th><th>Chủ đề / Vật tư</th>
                  <th style={{ width: 90 }}>Ngày</th><th>Ghi chú (NCC / Quyết định)</th><th style={{ width: 120 }}>File</th>
                  {canEdit && <th style={{ width: 50, textAlign: 'center' }} />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={canEdit ? 7 : 6} className="text-center py-10" style={{ color: 'var(--text-muted)' }}>
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />Chưa có giải trình nào. {canEdit ? 'Bấm "Thêm giải trình" để tải lên.' : ''}
                  </td></tr>
                ) : rows.map(g => (
                  <tr key={g.id}>
                    <td className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{g.legacyBidCode || g.bidCode}</td>
                    <td className="text-xs">{g.project ? <><span className="font-mono font-bold">{g.project.projectCode}</span> <span style={{ color: 'var(--text-muted)' }}>{g.project.projectName}</span></> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{g.subject || '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.bidDate ? formatDate(g.bidDate) : '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)', maxWidth: 300 }}>{g.notes || '—'}</td>
                    <td className="text-xs">
                      {g.sourceFilePath
                        ? <a href={g.sourceFilePath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}><Download className="w-3.5 h-3.5" /> Tải PDF</a>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    {canEdit && <td style={{ textAlign: 'center' }}><button onClick={() => del(g)} title="Xóa" className="p-1.5 rounded hover:bg-[var(--bg-hover)]" style={{ color: 'var(--danger)' }}><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addOpen && <AddModal projects={projects} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load() }} />}
    </div>
  )
}

function AddModal({ projects, onClose, onSaved }: { projects: ProjectOption[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ projectId: '', legacyBidCode: '', subject: '', bidDate: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const upd = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!f.legacyBidCode.trim()) return notify('Nhập Số / mã giải trình', 'error')
    if (!file) return notify('Chọn file giải trình (PDF)', 'error')
    setBusy(true)
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData()
    fd.append('file', file)
    fd.append('legacyBidCode', f.legacyBidCode.trim())
    if (f.projectId) fd.append('projectId', f.projectId)
    if (f.subject.trim()) fd.append('subject', f.subject.trim())
    if (f.bidDate) fd.append('bidDate', f.bidDate)
    if (f.notes.trim()) fd.append('notes', f.notes.trim())
    const res = await fetch('/api/procurement/bid-analyses/giai-trinh', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json()).catch(() => ({ ok: false, error: 'Lỗi mạng' }))
    setBusy(false)
    if (res.ok) { notify(res.message || 'Đã lưu giải trình', 'success'); onSaved() } else notify(res.error || 'Lỗi lưu', 'error')
  }

  return (
    <Modal open onClose={onClose} title="Thêm giải trình đấu thầu" size="lg"
      actions={<Button variant="primary" onClick={submit} loading={busy}>Lưu</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Số / Mã giải trình *" value={f.legacyBidCode} onChange={e => upd('legacyBidCode', e.target.value)} placeholder="VD: MSDT 401" />
          <SelectField label="Dự án" value={f.projectId} onChange={e => upd('projectId', e.target.value)}
            options={[{ value: '', label: '— Chọn dự án —' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Chủ đề / Vật tư" value={f.subject} onChange={e => upd('subject', e.target.value)} placeholder="VD: Cung cấp vật tư thép / Bu lông" />
          <InputField label="Ngày" type="date" value={f.bidDate} onChange={e => upd('bidDate', e.target.value)} />
        </div>
        <TextareaField label="Ghi chú (NCC dự thầu · Quyết định BOM)" rows={2} value={f.notes} onChange={e => upd('notes', e.target.value)} placeholder="VD: Hoàng Hà, Đức Hiệp — chọn Đức Hiệp/Hoàng Hà theo từng dòng" />
        <div>
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>File giải trình (PDF/Excel đã ký) *</label>
          <input type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs block mt-1" style={{ color: 'var(--text-secondary)' }} />
        </div>
      </div>
    </Modal>
  )
}
