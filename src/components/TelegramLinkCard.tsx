'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { Send, Check, ExternalLink, Loader2 } from 'lucide-react'

/**
 * Thẻ tự phục vụ: liên kết tài khoản với Telegram để nhận thông báo riêng.
 * Liên kết MỘT lần (lưu telegramChatId vĩnh viễn) — không phải làm lại mỗi lần đăng nhập.
 * variant='compact' cho bản mobile.
 */
export default function TelegramLinkCard({ variant = 'card' }: { variant?: 'card' | 'compact' }) {
  const [linked, setLinked] = useState<boolean | null>(null)
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [err, setErr] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadStatus = useCallback(async () => {
    const r = await apiFetch('/api/me/telegram')
    if (r.ok) setLinked(!!r.linked)
  }, [])
  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startLink = async () => {
    setBusy(true); setErr('')
    const r = await apiFetch('/api/me/telegram/link-token', { method: 'POST' })
    setBusy(false)
    if (!r.ok) { setErr(r.error || 'Không tạo được liên kết'); return }
    setDeepLink(r.deepLink)
    window.open(r.deepLink, '_blank', 'noopener')
    // Chờ user bấm Start trong Telegram — poll trạng thái tối đa ~60s
    setWaiting(true)
    let n = 0
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      n++
      const s = await apiFetch('/api/me/telegram')
      if (s.ok && s.linked) {
        setLinked(true); setWaiting(false); setDeepLink(null)
        if (pollRef.current) clearInterval(pollRef.current)
      } else if (n >= 30) {
        setWaiting(false)
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }, 2000)
  }

  const unlink = async () => {
    setBusy(true)
    await apiFetch('/api/me/telegram', { method: 'DELETE' })
    setBusy(false)
    setLinked(false); setDeepLink(null); setWaiting(false)
    if (pollRef.current) clearInterval(pollRef.current)
  }

  const TG_BLUE = '#229ED9'

  const body = (
    <>
      {linked === null ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Đang kiểm tra…</div>
      ) : linked ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: '#16a34a' }}>
            <Check size={17} /> Đã liên kết Telegram
          </span>
          <button onClick={unlink} disabled={busy}
            style={{ fontSize: 13, fontWeight: 600, color: '#c8372b', background: 'none', border: '1px solid #f3c6c1', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
            Hủy liên kết
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Liên kết một lần để nhận thông báo công việc riêng qua Telegram (thay vì chỉ xem trong nhóm chung).
          </div>
          <button onClick={startLink} disabled={busy || waiting}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: '#fff', background: TG_BLUE, border: 'none', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', opacity: busy || waiting ? 0.6 : 1 }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {waiting ? 'Đang chờ xác nhận…' : 'Liên kết ngay'}
          </button>
          {waiting && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span><Loader2 size={13} className="animate-spin" style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} /> Mở Telegram và bấm <b>Start</b> — trang này tự cập nhật khi xong.</span>
              {deepLink && (
                <a href={deepLink} target="_blank" rel="noopener noreferrer" style={{ color: TG_BLUE, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ExternalLink size={12} /> Chưa mở? Bấm vào đây
                </a>
              )}
            </div>
          )}
          {err && <div style={{ fontSize: 12.5, color: '#c8372b' }}>{err}</div>}
        </div>
      )}
    </>
  )

  if (variant === 'compact') return body

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Send size={16} style={{ color: TG_BLUE }} /> Thông báo qua Telegram
      </h2>
      {body}
    </div>
  )
}
