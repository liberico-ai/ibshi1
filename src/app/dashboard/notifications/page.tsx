'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface Notification {
  id: string; title: string; message: string; type: string; isRead: boolean; createdAt: string;
}

const typeLabel: Record<string, string> = { INFO: 'Thông tin', WARNING: 'Cảnh báo', SUCCESS: 'Thành công', ERROR: 'Lỗi', TASK: 'Công việc' }
const typeColor: Record<string, string> = { INFO: '#0ea5e9', WARNING: '#f59e0b', SUCCESS: '#16a34a', ERROR: '#dc2626', TASK: '#8b5cf6' }

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/notifications').then(res => {
      if (res.ok) setNotifications(res.notifications || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const unreadCount = notifications.filter(n => !n.isRead).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>🔔 Thông báo</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{notifications.length} thông báo • {unreadCount} chưa đọc</p>
        </div>
      </div>

      <div className="space-y-2">
        {notifications.length === 0 ? (
          <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Không có thông báo</div>
        ) : notifications.map(n => (
          <div key={n.id} className="card p-4 flex items-start gap-3" style={{ borderLeft: `3px solid ${typeColor[n.type] || '#888'}`, opacity: n.isRead ? 0.6 : 1 }}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${typeColor[n.type] || '#888'}20`, color: typeColor[n.type] || '#888' }}>{typeLabel[n.type] || n.type}</span>
                {!n.isRead && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
              </div>
              <h3 className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{n.title}</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{n.message}</p>
            </div>
            <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{new Date(n.createdAt).toLocaleDateString('vi-VN')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
