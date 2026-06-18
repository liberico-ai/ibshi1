'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface BriefingTask {
  id: string
  taskType: string
  title: string
  status: string
  priority: string
  startedAt: string | null
  deadline: string | null
  daysOverdue: number
  assigneeNames: string[]
  criteria: string
  proposal: string
  decision: string
  notes: string
}
interface ProjectGroup {
  project: { id: string; projectCode: string; projectName: string } | null
  tasks: BriefingTask[]
  totalOverdue: number
  maxDaysOverdue: number
}
interface PreviewItem {
  row: number
  action: 'create' | 'update' | 'skip' | 'error'
  title: string
  detail: string
}
interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: { row: number; reason: string }[]
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Mới', color: '#475569', bg: '#f1f5f9' },
  IN_PROGRESS: { label: 'Đang xử lý', color: '#1d4ed8', bg: '#eff6ff' },
  AWAITING_REVIEW: { label: 'Chờ kết thúc', color: '#b45309', bg: '#fffbeb' },
  RETURNED: { label: 'Bị trả lại', color: '#e63946', bg: '#fef2f2' },
}

const ACTION_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  create: { label: 'Tạo mới', color: '#059669', bg: '#ecfdf5' },
  update: { label: 'Cập nhật', color: '#1d4ed8', bg: '#eff6ff' },
  skip: { label: 'Bỏ qua', color: '#6b7280', bg: '#f3f4f6' },
  error: { label: 'Lỗi', color: '#dc2626', bg: '#fef2f2' },
}

function overdueSeverity(days: number): { color: string; bg: string } {
  if (days > 14) return { color: '#dc2626', bg: '#fef2f2' }
  if (days > 0) return { color: '#d97706', bg: '#fffbeb' }
  return { color: '#475569', bg: '#f1f5f9' }
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

export default function BriefingPage() {
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [totalTasks, setTotalTasks] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  // Import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const [previewSummary, setPreviewSummary] = useState<{ total: number; toCreate: number; toUpdate: number; skipped: number; errors: number } | null>(null)
  const [applying, setApplying] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/work/briefing/agenda').then((r) => {
      if (r.ok) {
        setGroups(r.groups || [])
        setTotalTasks(r.totalTasks || 0)
        const allIds = new Set<string>((r.groups || []).map((g: ProjectGroup) => g.project?.id || '__general__'))
        setExpanded(allIds)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => { load() }, [load])

  const toggleProject = (pid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
      const res = await fetch('/api/work/briefing/export', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      a.download = `Giao_ban_tuan_${dateStr}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Lỗi xuất file. Vui lòng thử lại.')
    }
    setExporting(false)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportResult(null)
    setPreviewing(true)
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
      const form = new FormData()
      form.append('file', file)
      form.append('mode', 'preview')
      const res = await fetch('/api/work/briefing/import', {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      })
      const data = await res.json()
      if (data.ok) {
        setPreview(data.preview || [])
        setPreviewSummary(data.summary || null)
      } else {
        alert(data.error || 'Lỗi đọc file')
        resetImport()
      }
    } catch {
      alert('Lỗi kết nối server')
      resetImport()
    }
    setPreviewing(false)
  }

  const handleApply = async () => {
    if (!importFile) return
    setApplying(true)
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
      const form = new FormData()
      form.append('file', importFile)
      form.append('mode', 'apply')
      const res = await fetch('/api/work/briefing/import', {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      })
      const data = await res.json()
      if (data.ok) {
        setImportResult({ created: data.created, updated: data.updated, skipped: data.skipped || 0, errors: data.errors || [] })
        setPreview(null)
        setPreviewSummary(null)
        setImportFile(null)
        if (fileRef.current) fileRef.current.value = ''
        load()
      } else {
        alert(data.error || 'Lỗi ghi dữ liệu')
      }
    } catch {
      alert('Lỗi kết nối server')
    }
    setApplying(false)
  }

  const resetImport = () => {
    setImportFile(null)
    setPreview(null)
    setPreviewSummary(null)
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Giao ban tuần
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {totalTasks} việc quá hạn · {groups.length} dự án
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Tải lại
          </button>
          <label className="text-sm px-4 py-2 rounded-lg cursor-pointer" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Import biên bản
            <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={handleFileSelect} />
          </label>
          <button onClick={handleExport} disabled={exporting || totalTasks === 0} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
            {exporting ? 'Đang xuất...' : 'Xuất biên bản'}
          </button>
        </div>
      </div>

      {/* Import preview modal */}
      {(previewing || preview) && (
        <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '2px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              {previewing ? 'Đang đọc file...' : `Xem trước import: ${importFile?.name}`}
            </h2>
            {!previewing && (
              <button onClick={resetImport} className="text-xs px-3 py-1 rounded" style={{ color: 'var(--text-muted)' }}>
                Hủy
              </button>
            )}
          </div>

          {previewing && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
          )}

          {preview && previewSummary && (
            <>
              <div className="flex gap-4 text-sm flex-wrap">
                <span style={{ color: '#059669' }}>Tạo mới: {previewSummary.toCreate}</span>
                <span style={{ color: '#1d4ed8' }}>Cập nhật: {previewSummary.toUpdate}</span>
                {previewSummary.skipped > 0 && <span style={{ color: '#6b7280' }}>Bỏ qua (đã tồn tại): {previewSummary.skipped}</span>}
                <span style={{ color: '#dc2626' }}>Lỗi: {previewSummary.errors}</span>
                <span style={{ color: 'var(--text-muted)' }}>Tổng: {previewSummary.total} dòng</span>
              </div>

              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--surface-alt, #f8fafc)' }}>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)', width: 50 }}>Dòng</th>
                      <th className="text-center px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)', width: 90 }}>Hành động</th>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>Nội dung</th>
                      <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-muted)' }}>Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p, i) => {
                      const st = ACTION_STYLE[p.action]
                      return (
                        <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{p.row}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
                              {st.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>{p.title}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: p.action === 'error' ? '#dc2626' : 'var(--text-secondary)' }}>{p.detail}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={resetImport} className="text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  Hủy
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || (previewSummary.toCreate === 0 && previewSummary.toUpdate === 0)}
                  className="btn-primary text-sm px-5 py-2 rounded-lg disabled:opacity-50"
                >
                  {applying ? 'Đang ghi...' : `Xác nhận (${previewSummary.toCreate + previewSummary.toUpdate} thay đổi)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Import result banner */}
      {importResult && (
        <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <div className="text-sm" style={{ color: '#065f46' }}>
            Import hoàn tất: tạo {importResult.created}, cập nhật {importResult.updated}
            {importResult.skipped > 0 && <span>, bỏ qua {importResult.skipped}</span>}
            {importResult.errors.length > 0 && <span style={{ color: '#dc2626' }}>, {importResult.errors.length} lỗi</span>}
          </div>
          <button onClick={resetImport} className="text-xs px-3 py-1 rounded" style={{ color: '#065f46' }}>Đóng</button>
        </div>
      )}

      {totalTasks === 0 && !preview && !importResult && (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-lg font-semibold" style={{ color: 'var(--text-secondary)' }}>Không có việc quá hạn</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Tất cả công việc đều đang đúng tiến độ.</p>
        </div>
      )}

      {/* Project accordions */}
      {groups.map((g) => {
        const groupKey = g.project?.id || '__general__'
        const isOpen = expanded.has(groupKey)
        const sev = overdueSeverity(g.maxDaysOverdue)
        return (
          <div key={groupKey} className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <button onClick={() => toggleProject(groupKey)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-opacity-80 transition-colors" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center gap-3">
                <span className="text-lg font-mono" style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                  ▶
                </span>
                <div>
                  <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {g.project?.projectCode || 'Công việc chung'}
                  </span>
                  {g.project && (
                    <span className="text-sm ml-2" style={{ color: 'var(--text-secondary)' }}>
                      {g.project.projectName}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: sev.bg, color: sev.color }}>
                  {g.totalOverdue} quá hạn · max {g.maxDaysOverdue} ngày
                </span>
              </div>
            </button>

            {isOpen && (
              <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--surface-alt, #f8fafc)' }}>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 70 }}>Mã</th>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Nội dung</th>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 140 }}>Người thực hiện</th>
                        <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 90 }}>Hạn</th>
                        <th className="text-center px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 80 }}>Quá hạn</th>
                        <th className="text-center px-4 py-2.5 font-semibold" style={{ color: 'var(--text-muted)', width: 100 }}>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.tasks.map((t) => {
                        const sev = overdueSeverity(t.daysOverdue)
                        const st = STATUS_LABELS[t.status] || { label: t.status, color: '#475569', bg: '#f1f5f9' }
                        return (
                          <tr key={t.id} className="border-t hover:bg-opacity-50" style={{ borderColor: 'var(--border)' }}>
                            <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {t.taskType !== 'FREE' ? t.taskType : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <a href={`/dashboard/work/${t.id}`} className="hover:underline font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t.title}
                              </a>
                            </td>
                            <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {t.assigneeNames.join(', ') || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {fmtDate(t.deadline)}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: sev.bg, color: sev.color }}>
                                {t.daysOverdue}d
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: st.bg, color: st.color }}>
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
