'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'

interface Task {
  id: string; title: string; status: string; priority: string; deadline: string | null; taskType: string
  blocked: boolean
  project: { projectCode: string; projectName: string } | null
  assigneeNames: string[]; needsMyReview: boolean; _count: { children: number; docs: number }
}
interface Proj { id: string; projectCode: string; projectName: string }

const TABS = [
  { key: 'assigned', label: 'Được giao cho tôi' },
  { key: 'dept', label: 'Phòng tôi' },
  { key: 'created', label: 'Tôi tạo' },
  { key: 'overdue', label: 'Quá hạn' },
]
const ST: Record<string, { l: string; c: string; b: string }> = {
  OPEN: { l: 'Mới', c: '#475569', b: '#f1f5f9' },
  IN_PROGRESS: { l: 'Đang xử lý', c: '#1d4ed8', b: '#eff6ff' },
  AWAITING_REVIEW: { l: 'Chờ kết thúc', c: '#b45309', b: '#fffbeb' },
  RETURNED: { l: 'Bị trả lại', c: '#e63946', b: '#fef2f2' },
  DONE: { l: 'Hoàn thành', c: '#059669', b: '#ecfdf5' },
}

function startOfDay(d: Date | string | number): number {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime()
}

function dueInfo(d: string | null, status: string) {
  if (!d) return null
  if (status === 'DONE' || status === 'CANCELLED') return null
  const dlDay = startOfDay(d)
  const todayDay = startOfDay(Date.now())
  const diffMs = dlDay - todayDay
  const days = Math.round(diffMs / 86400000)
  if (days < 0) return { txt: `Quá hạn ${-days} ngày`, over: true }
  if (days === 0) return { txt: 'Hết hạn hôm nay', over: true }
  return { txt: `Còn ${days} ngày`, over: false }
}

export default function WorkInboxPage() {
  const router = useRouter()
  const [tab, setTab] = useState('assigned')
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState<Proj[]>([])
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({})

  useEffect(() => { apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) }) }, [])
  const loadCounts = useCallback(() => {
    Promise.all(TABS.map((t) => apiFetch(`/api/work/inbox?tab=${t.key}&page=1`).then((r) => ({ key: t.key, count: r.ok ? r.pagination?.total || 0 : 0 }))))
      .then((results) => { const m: Record<string, number> = {}; results.forEach((r) => { m[r.key] = r.count }); setTabCounts(m) })
  }, [])
  useEffect(() => { loadCounts() }, [loadCounts])
  const load = useCallback(() => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ tab, page: String(page) })
    if (q.trim()) params.set('q', q.trim())
    if (projectId) params.set('projectId', projectId)
    apiFetch(`/api/work/inbox?${params.toString()}`).then((r) => {
      if (r.ok) { setTasks(r.tasks); setTotal(r.pagination.total); setTotalPages(r.pagination.totalPages) }
      else { setTasks([]); setTotal(0); setError(r.error || 'Không tải được danh sách việc') }
      setLoading(false)
    })
  }, [tab, page, q, projectId])
  useEffect(() => { load() }, [load])
  // auto-refresh mỗi 30s
  useEffect(() => { const iv = setInterval(load, 30000); return () => clearInterval(iv) }, [load])
  // đổi tab/lọc → về trang 1
  useEffect(() => { setPage(1) }, [tab, q, projectId])

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📥 Hộp việc của tôi</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{total} việc</p>
        </div>
        <button onClick={() => router.push('/dashboard/work/create')} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Tạo việc</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => {
          const cnt = tabCounts[t.key]
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="text-sm px-4 py-2 rounded-full font-semibold flex items-center gap-1.5"
              style={{ background: tab === t.key ? 'var(--navy,#0a2540)' : 'var(--surface)', color: tab === t.key ? '#fff' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
              {t.label}
              {cnt != null && cnt > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 9, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', background: tab === t.key ? 'rgba(255,255,255,0.25)' : (t.key === 'overdue' ? '#fef2f2' : '#f1f5f9'), color: tab === t.key ? '#fff' : (t.key === 'overdue' ? '#dc2626' : '#475569') }}>
                  {cnt > 99 ? '99+' : cnt}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tìm kiếm + lọc dự án */}
      <div className="flex gap-2 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); setQ(qInput) }} className="flex gap-2 flex-1" style={{ minWidth: 200 }}>
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Tìm theo tiêu đề…" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', fontSize: '.85rem', background: '#f8fafc' }} />
          <button type="submit" className="text-sm px-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>Tìm</button>
        </form>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="text-sm px-3 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
          <option value="">Tất cả dự án</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
      ) : error ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-sm" style={{ color: '#e63946' }}>{error}</p>
          <button onClick={load} className="text-sm px-4 py-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>Thử lại</button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          Không có việc nào{q || projectId ? ' khớp bộ lọc' : ''}.
        </div>
      ) : (
        <>
          {tasks.map((t, idx) => {
            const st = t.blocked ? { l: 'Tắc', c: '#c2410c', b: '#fff7ed' } : (ST[t.status] || ST.OPEN)
            const due = dueInfo(t.deadline, t.status)
            const pc = t.priority === 'URGENT' ? '#e63946' : t.priority === 'HIGH' ? '#d97706' : 'var(--border)'
            const rowNum = (page - 1) * 20 + idx + 1
            return (
              <div key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)}
                className="rounded-xl p-4 cursor-pointer hover:shadow-md transition-all"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${pc}` }}>
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: '#f1f5f9', color: '#64748b' }}>{rowNum}</span>
                  <div className="font-bold flex-1" style={{ color: 'var(--text-primary)', minWidth: 180 }}>{t.title}</div>
                  {t.needsMyReview && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fef9c3', color: '#a16207' }}>⏳ Cần bạn kết thúc</span>}
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.b, color: st.c }}>{st.l}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t.project && <span className="px-2 py-0.5 rounded" style={{ background: '#eff6ff', color: '#1d4ed8' }}>📁 {t.project.projectCode}</span>}
                  {t.assigneeNames.length > 0 && <span>Giao: <b>{t.assigneeNames.join(', ')}</b></span>}
                  {due && <span className="px-2 py-0.5 rounded" style={{ background: due.over ? '#fef2f2' : '#fffbeb', color: due.over ? '#e63946' : '#d97706' }}>⏰ {due.txt}</span>}
                  {t._count.children > 0 && <span>↳ {t._count.children} việc con</span>}
                  {t._count.docs > 0 && <span>📎 {t._count.docs} tài liệu</span>}
                </div>
              </div>
            )
          })}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="text-sm px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', opacity: page <= 1 ? 0.4 : 1 }}>← Trước</button>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Trang {page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="text-sm px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', opacity: page >= totalPages ? 0.4 : 1 }}>Sau →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
