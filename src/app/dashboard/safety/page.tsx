'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SafetyRedirectPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/hse/incidents') }, [router])
  return <p style={{ color: 'var(--text-muted)', padding: 24 }}>Đang chuyển sang HSE...</p>
}
