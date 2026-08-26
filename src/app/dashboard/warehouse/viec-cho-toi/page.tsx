'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'

interface Group { key: string; label: string; count: number; link: string }

export default function ViecChoToiPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch('/api/procurement/my-approvals')
    setLoading(false)
    if (r.ok) { setGroups(r.groups || []); setTotal(r.total || 0) } else notify(r.error || 'Lỗi tải', 'error')
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Việc chờ tôi duyệt" subtitle="Gom mọi việc mua sắm đang chờ đúng vai trò của bạn ký/duyệt" />
      {loading ? <div className="text-center py-16 text-slate-400 text-sm">Đang tải…</div>
        : total === 0 ? <div className="text-center py-16 text-emerald-600 text-sm">👍 Không có việc nào chờ bạn duyệt.</div>
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {groups.map(g => (
                <Link key={g.key} href={g.link} className="card p-4 block" style={{ borderLeft: '4px solid #b45309', textDecoration: 'none' }}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{g.label}</div>
                    <div className="text-2xl font-bold" style={{ color: '#b45309' }}>{g.count}</div>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--accent)' }}>Mở màn xử lý →</div>
                </Link>
              ))}
            </div>
          )}
    </div>
  )
}
