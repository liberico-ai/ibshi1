'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Lesson {
  id: string; category: string; description: string; rootCause: string | null; actionTaken: string | null;
  recommendation: string | null; submittedBy: string; createdAt: string;
  project: { projectCode: string; projectName: string }
}

const CATEGORIES = ['schedule', 'quality', 'cost', 'safety', 'communication']
const catLabel: Record<string, string> = { schedule: 'Tiến độ', quality: 'Chất lượng', cost: 'Chi phí', safety: 'An toàn', communication: 'Truyền thông' }
const catColor: Record<string, string> = { schedule: '#0ea5e9', quality: '#16a34a', cost: '#f59e0b', safety: '#dc2626', communication: '#8b5cf6' }

export default function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])

  const load = () => {
    const url = filter ? `/api/lessons?category=${filter}` : '/api/lessons'
    apiFetch(url).then(res => {
      if (res.ok) { setLessons(res.lessons); setStats(res.stats || {}) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [filter])

  const openForm = async () => {
    const res = await apiFetch('/api/projects?page=1&limit=50')
    if (res.ok) setProjectList(res.projects || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/lessons', {
      method: 'POST',
      body: JSON.stringify({
        projectId: fd.get('projectId'), category: fd.get('category'), description: fd.get('description'),
        rootCause: fd.get('rootCause') || null, actionTaken: fd.get('actionTaken') || null,
        recommendation: fd.get('recommendation') || null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📚 Bài học kinh nghiệm</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{lessons.length} bài học từ các dự án</p>
        </div>
        <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm bài học</button>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} className="text-xs px-3 py-1 rounded-full font-medium"
          style={{ background: !filter ? 'var(--accent)' : 'var(--surface-hover)', color: !filter ? '#fff' : 'var(--text-muted)' }}>
          Tất cả ({Object.values(stats).reduce((s, c) => s + c, 0)})
        </button>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setFilter(c)} className="text-xs px-3 py-1 rounded-full font-medium"
            style={{ background: filter === c ? catColor[c] : 'var(--surface-hover)', color: filter === c ? '#fff' : 'var(--text-muted)' }}>
            {catLabel[c]} ({stats[c] || 0})
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ghi nhận bài học kinh nghiệm</h3>
          <div className="grid grid-cols-2 gap-3">
            <select name="projectId" required className="input-field text-sm">
              <option value="">— Chọn dự án —</option>
              {projectList.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
            <select name="category" required className="input-field text-sm">
              <option value="">— Danh mục —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{catLabel[c]}</option>)}
            </select>
          </div>
          <textarea name="description" required placeholder="Mô tả bài học *" rows={2} className="input-field text-sm w-full" />
          <div className="grid grid-cols-3 gap-3">
            <input name="rootCause" placeholder="Nguyên nhân gốc" className="input-field text-sm" />
            <input name="actionTaken" placeholder="Hành động đã thực hiện" className="input-field text-sm" />
            <input name="recommendation" placeholder="Khuyến nghị" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      {/* Cards */}
      {lessons.length === 0 ? (
        <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Chưa có bài học. Nhấn "+ Thêm bài học" để bắt đầu.</div>
      ) : lessons.map(l => (
        <div key={l.id} className="card p-4 space-y-2" style={{ borderLeft: `3px solid ${catColor[l.category] || '#666'}` }}>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{l.project.projectCode}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${catColor[l.category]}20`, color: catColor[l.category] }}>
                {catLabel[l.category]}
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(l.createdAt).toLocaleDateString('vi-VN')}</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{l.description}</p>
          <div className="grid grid-cols-3 gap-2">
            {l.rootCause && <div><span className="text-xs font-bold" style={{ color: '#dc2626' }}>Nguyên nhân:</span><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.rootCause}</p></div>}
            {l.actionTaken && <div><span className="text-xs font-bold" style={{ color: '#16a34a' }}>Hành động:</span><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.actionTaken}</p></div>}
            {l.recommendation && <div><span className="text-xs font-bold" style={{ color: '#0ea5e9' }}>Khuyến nghị:</span><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.recommendation}</p></div>}
          </div>
        </div>
      ))}
    </div>
  )
}
