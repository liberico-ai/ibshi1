'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Dept { id: string; code: string; name: string; nameEn: string; _count: { employees: number; users: number } }

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<Dept[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = () => {
    apiFetch('/api/departments').then(res => { if (res.ok) setDepts(res.departments); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/departments', {
      method: 'POST',
      body: JSON.stringify({ code: fd.get('code'), name: fd.get('name'), nameEn: fd.get('nameEn') || '' }),
    })
    if (res.ok) { setShowForm(false); load() } else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalEmployees = depts.reduce((s, d) => s + d._count.employees, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🏢 Phòng ban</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{depts.length} phòng ban • {totalEmployees} nhân viên</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm phòng ban</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm phòng ban</h3>
          <div className="grid grid-cols-3 gap-3">
            <input name="code" required placeholder="Mã PB *" className="input-field text-sm" />
            <input name="name" required placeholder="Tên phòng ban *" className="input-field text-sm" />
            <input name="nameEn" placeholder="Tên tiếng Anh" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {depts.map(d => (
          <div key={d.id} className="card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded font-bold font-mono" style={{ background: 'var(--accent)', color: '#fff' }}>{d.code}</span>
            </div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{d.name}</h3>
            {d.nameEn && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{d.nameEn}</p>}
            <div className="flex gap-4 pt-1">
              <div><span className="text-lg font-bold" style={{ color: '#0ea5e9' }}>{d._count.employees}</span><span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>NV</span></div>
              <div><span className="text-lg font-bold" style={{ color: '#f59e0b' }}>{d._count.users}</span><span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>TK</span></div>
            </div>
          </div>
        ))}
        {depts.length === 0 && <p className="text-sm col-span-4 text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có phòng ban</p>}
      </div>
    </div>
  )
}
