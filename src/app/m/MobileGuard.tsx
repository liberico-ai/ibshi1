'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/hooks/useAuth'
import { canUseMobile } from '@/lib/mobile-nav'
import { ROLES } from '@/lib/constants'
import { Lock } from 'lucide-react'

/**
 * Guard mềm cho /m — cùng cơ chế với dashboard/layout.tsx (PAGE_ACCESS).
 * Ranh giới bảo mật thật vẫn là role check trong các route API: người ngoài
 * nhóm QAQC và Xưởng có tự gõ /m thì mọi lời gọi API vẫn bị chặn 403.
 */
export function MobileGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, hydrate } = useAuthStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    hydrate()
    setReady(true)
  }, [hydrate])

  useEffect(() => {
    if (!ready || isAuthenticated) return
    // Mang theo đích đến, nếu không đăng nhập xong sẽ rơi về /dashboard và mất /m.
    router.push(`/login?next=${encodeURIComponent(pathname || '/m')}`)
  }, [ready, isAuthenticated, router, pathname])

  if (!ready || !isAuthenticated || !user) {
    return (
      <div className="m-root">
        <div className="m-spinner" />
      </div>
    )
  }

  const roleCode = user.roleCode || ''

  if (!canUseMobile(roleCode)) {
    const roleName = ROLES[roleCode as keyof typeof ROLES]?.name || roleCode
    return (
      <div className="m-root">
        <div className="m-denied">
          <Lock size={30} color="var(--m-ink-3)" />
          <strong style={{ fontSize: 17, fontFamily: "'Space Grotesk', sans-serif" }}>
            Bản điện thoại chỉ dành cho QAQC và Xưởng
          </strong>
          <span style={{ fontSize: 13.5, color: 'var(--m-ink-2)', maxWidth: '30ch' }}>
            Tài khoản của bạn là <b>{roleName}</b>. Hãy dùng bản đầy đủ trên máy tính.
          </span>
          <Link href="/dashboard" className="m-btn m-btn-dark" style={{ marginTop: 12, maxWidth: 260, textDecoration: 'none' }}>
            Mở bản máy tính
          </Link>
        </div>
      </div>
    )
  }

  return <div className="m-root">{children}</div>
}
