'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from './useAuth'

/**
 * Tập khả năng hiệu lực của user hiện tại (từ ma trận phân quyền DB).
 * Trả null khi CHƯA tải xong — nơi gọi nên fallback về luật tĩnh để không nhấp nháy.
 * Vì mặc định capability == luật tĩnh, khi tải xong menu/quyền không đổi;
 * chỉ đổi khi admin đã chỉnh ma trận.
 */
export function useCapabilities(): Set<string> | null {
  const [caps, setCaps] = useState<Set<string> | null>(null)

  useEffect(() => {
    let alive = true
    apiFetch('/api/me/capabilities').then((r) => {
      if (alive && r.ok) setCaps(new Set<string>(r.capabilities || []))
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  return caps
}
