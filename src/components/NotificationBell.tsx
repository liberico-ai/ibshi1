'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'

interface Notification {
  id: string; title: string; message: string; type: string;
  isRead: boolean; linkUrl: string | null; createdAt: string;
}

const TYPE_ICONS: Record<string, { emoji: string; bg: string }> = {
  task_assigned: { emoji: '📋', bg: '#eff6ff' },
  task_completed: { emoji: '✅', bg: '#f0fdf4' },
  qc_result: { emoji: '🔬', bg: '#fef3c7' },
  stock_alert: { emoji: '📦', bg: '#fef2f2' },
  system: { emoji: '⚙️', bg: '#f1f5f9' },
}

export default function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { loadNotifications() }, [])

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Polling every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadNotifications() {
    const res = await apiFetch('/api/notifications?limit=20')
    if (res.ok) {
      setNotifications(res.notifications)
      setUnreadCount(res.unreadCount)
    }
  }

  async function markRead(id: string) {
    await apiFetch('/api/notifications', {
      method: 'PUT', body: JSON.stringify({ notificationId: id }),
    })
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function markAllRead() {
    await apiFetch('/api/notifications', {
      method: 'PUT', body: JSON.stringify({ markAll: true }),
    })
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    setUnreadCount(0)
  }

  function handleClick(n: Notification) {
    if (!n.isRead) markRead(n.id)
    if (n.linkUrl) { router.push(n.linkUrl); setOpen(false) }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'vừa xong'
    if (mins < 60) return `${mins} phút trước`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} giờ trước`
    const days = Math.floor(hours / 24)
    return `${days} ngày trước`
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg cursor-pointer transition-colors hover:bg-slate-100"
        style={{ color: 'var(--text-secondary)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full px-1" style={{ background: 'var(--danger)' }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-xl shadow-xl border z-50 overflow-hidden animate-fade-in" style={{
          background: 'var(--bg-card)', borderColor: 'var(--border)',
        }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Thông báo {unreadCount > 0 && <span className="text-xs font-normal ml-1" style={{ color: 'var(--primary)' }}>({unreadCount} mới)</span>}
            </h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>Đọc tất cả</button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có thông báo</p>
              </div>
            ) : (
              notifications.map((n) => {
                const cfg = TYPE_ICONS[n.type] || TYPE_ICONS.system
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-50"
                    style={{
                      background: n.isRead ? 'transparent' : 'rgba(37, 99, 235, 0.03)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: cfg.bg }}>
                      {cfg.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: n.isRead ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{n.title}</p>
                      <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{n.message}</p>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.isRead && <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--primary)' }} />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
