'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Workshop { id: string; code: string; name: string; nameEn: string; capacity: number; _count: { workOrders: number } }

export default function WorkshopsPage() {
  const [workshops, setWorkshops] = useState<Workshop[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = () => {
    apiFetch('/api/workshops').then(res => { if (res.ok) setWorkshops(res.workshops || []); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/workshops', {
      method: 'POST',
      body: JSON.stringify({ code: fd.get('code'), name: fd.get('name'), nameEn: fd.get('nameEn') || '', capacity: fd.get('capacity') || 100 }),
    })
    if (res.ok) { setShowForm(false); load() } else alert(res.error || 'Lỗi')
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🏭 Phân xưởng</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{workshops.length} xưởng</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Thêm xưởng</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm phân xưởng</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="code" required placeholder="Mã xưởng *" className="input-field text-sm" />
            <input name="name" required placeholder="Tên xưởng *" className="input-field text-sm" />
            <input name="nameEn" placeholder="Tên EN" className="input-field text-sm" />
            <input name="capacity" type="number" defaultValue={100} placeholder="Capacity %" className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {workshops.map(ws => (
          <div key={ws.id} className="card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded font-bold font-mono" style={{ background: '#f59e0b', color: '#fff' }}>{ws.code}</span>
            </div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{ws.name}</h3>
            {ws.nameEn && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ws.nameEn}</p>}
            <div className="flex gap-4 pt-1">
              <div><span className="text-lg font-bold" style={{ color: '#0ea5e9' }}>{ws._count.workOrders}</span><span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>WO</span></div>
              <div className="flex items-center gap-1">
                <div className="w-16 h-2 rounded-full" style={{ background: 'var(--surface-hover)' }}>
                  <div className="h-2 rounded-full" style={{ width: `${ws.capacity}%`, background: ws.capacity > 80 ? '#dc2626' : ws.capacity > 50 ? '#f59e0b' : '#16a34a' }} />
                </div>
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{ws.capacity}%</span>
              </div>
            </div>
          </div>
        ))}
        {workshops.length === 0 && <p className="text-sm col-span-4 text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có xưởng</p>}
      </div>
    </div>
  )
}
