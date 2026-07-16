'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch, openAuthedFile } from '@/hooks/useAuth'
import { PageHeader, Badge } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { formatDate } from '@/lib/utils'
import { ROLES } from '@/lib/constants'

// T5 — Sổ tài liệu dự án (Project Document Register)

interface DocFile {
  id: string
  fileName: string
  fileUrl: string
  mimeType: string | null
}
interface ProjectDoc {
  id: string
  docCode: string
  docType: string
  revision: string
  deptCode: string | null
  title: string
  fileAttachmentId: string | null
  taskId: string | null
  status: string
  uploadedBy: string
  createdAt: string
  file: DocFile | null
}
interface LoadData {
  project: { projectCode: string; projectName: string }
  documents: ProjectDoc[]
  canCreate: boolean
}

const DOC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'BAN_VE', label: 'Bản vẽ' },
  { value: 'BOM', label: 'BOM / Bảng vật tư' },
  { value: 'HDMB', label: 'Hợp đồng mua bán' },
  { value: 'DTTC', label: 'Dự toán / Tài chính' },
  { value: 'QC', label: 'Hồ sơ QC' },
  { value: 'HSE', label: 'Hồ sơ HSE' },
  { value: 'BBH', label: 'Biên bản họp' },
  { value: 'KHAC', label: 'Khác' },
]
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPE_OPTIONS.map(o => [o.value, o.label]))

const DOC_TYPE_VARIANT: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  BAN_VE: 'info', BOM: 'default', HDMB: 'warning', DTTC: 'warning', QC: 'success', HSE: 'danger', BBH: 'default', KHAC: 'default',
}
const STATUS_VARIANT: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success', SUPERSEDED: 'warning', ARCHIVED: 'default',
}

// Phòng phát hành — dùng roleCode làm deptCode (nhãn từ ROLES)
const DEPT_OPTIONS = ['R02', 'R03', 'R04', 'R07', 'R08', 'R09'] as const
function deptLabel(code: string | null): string {
  if (!code) return '—'
  return ROLES[code as keyof typeof ROLES]?.name || code
}

const ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.dwg', '.dxf', '.zip']

export default function ProjectDocumentsPage() {
  const params = useParams()
  const projectId = params.id as string

  const [data, setData] = useState<LoadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filterType, setFilterType] = useState('')
  const [filterDept, setFilterDept] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ docCode: '', docType: 'BAN_VE', revision: 'Rev0', deptCode: '', title: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    if (!projectId) return
    const qs = new URLSearchParams()
    if (filterType) qs.set('docType', filterType)
    if (filterDept) qs.set('deptCode', filterDept)
    const url = `/api/projects/${projectId}/documents${qs.toString() ? `?${qs}` : ''}`
    apiFetch(url).then(r => {
      if (r.ok) { setData(r); setError('') }
      else setError(r.error || 'Không tải được sổ tài liệu')
      setLoading(false)
    })
  }, [projectId, filterType, filterDept])

  useEffect(() => { load() }, [load])

  const canCreate = data?.canCreate ?? false

  const uploadFile = async (f: File): Promise<string | null> => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData()
    fd.append('file', f)
    fd.append('entityType', 'ProjectDoc')
    fd.append('entityId', projectId)
    const res = await fetch('/api/upload', {
      method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json()).catch(() => ({ ok: false, error: 'Lỗi mạng' }))
    if (res.ok && res.attachment) return res.attachment.id as string
    throw new Error(res.error || 'Lỗi upload file')
  }

  const handleSubmit = async () => {
    if (saving) return
    setFormMsg('')
    if (!form.docCode.trim()) { setFormMsg('Nhập mã tài liệu'); return }
    if (!form.title.trim()) { setFormMsg('Nhập tiêu đề tài liệu'); return }
    if (file) {
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
      if (!ALLOWED_EXTS.includes(ext)) { setFormMsg(`Định dạng không hỗ trợ. Chấp nhận: ${ALLOWED_EXTS.join(', ')}`); return }
    }
    setSaving(true)
    try {
      let fileAttachmentId: string | null = null
      if (file) fileAttachmentId = await uploadFile(file)

      const res = await apiFetch(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          docCode: form.docCode.trim(),
          docType: form.docType,
          revision: form.revision.trim() || 'Rev0',
          deptCode: form.deptCode || null,
          title: form.title.trim(),
          fileAttachmentId,
        }),
      })
      if (res.ok) {
        setForm({ docCode: '', docType: 'BAN_VE', revision: 'Rev0', deptCode: '', title: '' })
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        setShowForm(false)
        load()
      } else {
        setFormMsg(res.error || 'Không lưu được tài liệu')
      }
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : 'Lỗi không xác định')
    } finally {
      setSaving(false)
    }
  }

  const documents = useMemo(() => data?.documents ?? [], [data])
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of documents) m[d.docType] = (m[d.docType] || 0) + 1
    return m
  }, [documents])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>
  if (error || !data) return <div className="card p-6 text-center" style={{ color: SEMANTIC_COLORS.danger.solid }}>{error || 'Lỗi'}</div>

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm border bg-transparent'
  const inputStyle = { borderColor: 'var(--border)', color: 'var(--text-primary)' } as React.CSSProperties

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Sổ tài liệu — ${data.project.projectCode}`}
        subtitle={data.project.projectName}
        actions={canCreate ? (
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: SEMANTIC_COLORS.info.solid }}
          >
            {showForm ? 'Đóng' : '+ Thêm tài liệu'}
          </button>
        ) : undefined}
      />

      {/* Form thêm tài liệu */}
      {showForm && canCreate && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm tài liệu vào sổ</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="input-label mb-1 block">Mã tài liệu *</label>
              <input className={inputCls} style={inputStyle} value={form.docCode}
                onChange={e => setForm(f => ({ ...f, docCode: e.target.value }))} placeholder="VD: BV-KC-001" />
            </div>
            <div>
              <label className="input-label mb-1 block">Loại tài liệu *</label>
              <select className={inputCls} style={inputStyle} value={form.docType}
                onChange={e => setForm(f => ({ ...f, docType: e.target.value }))}>
                {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="input-label mb-1 block">Tiêu đề *</label>
              <input className={inputCls} style={inputStyle} value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tên tài liệu" />
            </div>
            <div>
              <label className="input-label mb-1 block">Revision</label>
              <input className={inputCls} style={inputStyle} value={form.revision}
                onChange={e => setForm(f => ({ ...f, revision: e.target.value }))} placeholder="Rev0" />
            </div>
            <div>
              <label className="input-label mb-1 block">Phòng phát hành</label>
              <select className={inputCls} style={inputStyle} value={form.deptCode}
                onChange={e => setForm(f => ({ ...f, deptCode: e.target.value }))}>
                <option value="">— Không xác định —</option>
                {DEPT_OPTIONS.map(c => <option key={c} value={c}>{deptLabel(c)}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="input-label mb-1 block">File đính kèm (tùy chọn)</label>
              <input ref={fileInputRef} type="file" className={inputCls} style={inputStyle}
                accept={ALLOWED_EXTS.join(',')}
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          {formMsg && <p className="text-xs" style={{ color: SEMANTIC_COLORS.danger.solid }}>{formMsg}</p>}
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60"
              style={{ background: SEMANTIC_COLORS.success.solid }}>
              {saving ? 'Đang lưu…' : 'Lưu tài liệu'}
            </button>
            <button onClick={() => { setShowForm(false); setFormMsg('') }}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Huỷ</button>
          </div>
        </div>
      )}

      {/* Bộ lọc */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="input-label mb-1 block">Lọc theo loại</label>
            <select className={inputCls} style={inputStyle} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">Tất cả loại</option>
              {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} {typeCounts[o.value] ? `(${typeCounts[o.value]})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label mb-1 block">Lọc theo phòng</label>
            <select className={inputCls} style={inputStyle} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="">Tất cả phòng</option>
              {DEPT_OPTIONS.map(c => <option key={c} value={c}>{deptLabel(c)}</option>)}
            </select>
          </div>
          {(filterType || filterDept) && (
            <button onClick={() => { setFilterType(''); setFilterDept('') }}
              className="px-3 py-2 rounded-lg text-xs font-bold"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Xoá lọc</button>
          )}
          <div className="ml-auto text-xs self-center" style={{ color: 'var(--text-muted)' }}>{documents.length} tài liệu</div>
        </div>
      </div>

      {/* Bảng tài liệu */}
      <div className="card p-0 overflow-hidden">
        {documents.length === 0 ? (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            <p className="text-sm">Chưa có tài liệu nào trong sổ dự án.</p>
            {canCreate && <p className="text-xs mt-1">Bấm “+ Thêm tài liệu” để bắt đầu.</p>}
          </div>
        ) : (
          <div className="dt-wrapper">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>Mã tài liệu</th>
                  <th>Tiêu đề</th>
                  <th>Loại</th>
                  <th>Rev</th>
                  <th>Phòng phát hành</th>
                  <th>Trạng thái</th>
                  <th>Ngày</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id}>
                    <td className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{d.docCode}</td>
                    <td className="max-w-[240px] truncate" title={d.title}>{d.title}</td>
                    <td><Badge variant={DOC_TYPE_VARIANT[d.docType] || 'default'}>{DOC_TYPE_LABEL[d.docType] || d.docType}</Badge></td>
                    <td className="font-mono">{d.revision}</td>
                    <td>{deptLabel(d.deptCode)}</td>
                    <td><Badge variant={STATUS_VARIANT[d.status] || 'default'}>{d.status}</Badge></td>
                    <td className="font-mono">{formatDate(d.createdAt)}</td>
                    <td>
                      {d.file ? (
                        <button onClick={() => openAuthedFile(d.file!.id, d.file!.fileName, d.file!.mimeType)}
                          className="underline" style={{ color: SEMANTIC_COLORS.info.solid }} title={d.file.fileName}>
                          Mở
                        </button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
