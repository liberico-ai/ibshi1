'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface BOM {
  id: string; bomCode: string; name: string; revision: string; status: string; createdAt: string;
  project: { projectCode: string; projectName: string };
  items: Array<{ id: string; quantity: number; unit: string; remarks: string | null; sortOrder: number;
    material: { materialCode: string; name: string; unit: string } }>;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Nháp', color: '#475569', bg: '#f1f5f9' },
  APPROVED: { label: 'Đã duyệt', color: '#16a34a', bg: '#f0fdf4' },
  RELEASED: { label: 'Phát hành', color: '#2563eb', bg: '#eff6ff' },
}

export default function BOMPage() {
  const [boms, setBoms] = useState<BOM[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    const res = await apiFetch('/api/design/bom')
    if (res.ok) setBoms(res.boms || [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Bill of Materials</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Danh mục vật tư theo dự án</p>
        </div>
        {['R01', 'R04', 'R02'].includes(user?.roleCode || '') && (
          <button className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold" style={{ background: 'var(--accent)' }}>
            + Tạo BOM
          </button>
        )}
      </div>

      <div className="space-y-3">
        {boms.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Chưa có BOM nào</p>
          </div>
        )}
        {boms.map(bom => {
          const st = STATUS_MAP[bom.status] || STATUS_MAP.DRAFT
          const isExpanded = expanded === bom.id
          return (
            <div key={bom.id} className="card overflow-hidden transition-all hover:shadow-md">
              <div className="p-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : bom.id)}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold" style={{ background: st.bg, color: st.color }}>
                    {bom.items.length}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{bom.bomCode}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Rev {bom.revision}</span>
                    </div>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{bom.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>DA: {bom.project.projectCode} • {bom.items.length} items</p>
                  </div>
                  <span className="text-sm transition-transform" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
                </div>
              </div>
              {isExpanded && bom.items.length > 0 && (
                <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-light)' }}>
                  <table style={{ width: '100%', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>#</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Mã VT</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Tên</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>SL</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>ĐVT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bom.items.map((item, i) => (
                        <tr key={item.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                          <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--accent)' }}>{item.material.materialCode}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>{item.material.name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{Number(item.quantity)}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
