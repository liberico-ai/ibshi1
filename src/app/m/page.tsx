'use client'

import Link from 'next/link'
import { useAuthStore } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { tilesForRole } from '@/lib/mobile-nav'
import { MAppBar } from '@/components/mobile'
import TelegramLinkCard from '@/components/TelegramLinkCard'
import { Monitor, LogOut } from 'lucide-react'

export default function MobileHome() {
  const { user, logout } = useAuthStore()

  const roleCode = user?.roleCode || ''
  const roleName = ROLES[roleCode as keyof typeof ROLES]?.name || roleCode
  const tiles = tilesForRole(roleCode)

  return (
    <>
      <MAppBar title={user?.fullName || 'IBS Xưởng'} subtitle={`${roleName} · ${roleCode}`} hideBack />

      <main className="m-main">
        <div className="m-section-title">Công việc tại xưởng</div>

        <div className="m-tiles">
          {tiles.map((t) =>
            t.ready ? (
              <Link key={t.key} href={t.href} className="m-tile">
                <b>{t.label}</b>
                <span>{t.hint}</span>
              </Link>
            ) : (
              // Màn chưa dựng — hiện mờ để thấy trước lộ trình, nhưng không dẫn vào ngõ cụt.
              <div key={t.key} className="m-tile m-tile-soon" aria-disabled="true">
                <b>{t.label}</b>
                <span>{t.hint}</span>
                <em>Sắp có</em>
              </div>
            ),
          )}
        </div>

        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-section-title" style={{ margin: 0 }}>Thông báo Telegram</div>
          <TelegramLinkCard variant="compact" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <Link href="/dashboard" className="m-btn m-btn-quiet" style={{ textDecoration: 'none' }}>
            <Monitor size={18} /> Mở bản máy tính
          </Link>
          <button
            type="button"
            className="m-btn m-btn-quiet"
            onClick={() => {
              logout()
              window.location.href = '/login'
            }}
          >
            <LogOut size={18} /> Đăng xuất
          </button>
        </div>
      </main>
    </>
  )
}
