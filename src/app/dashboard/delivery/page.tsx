'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DeliveryRedirectPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/logistics/shipments') }, [router])
  return <p style={{ color: 'var(--text-muted)', padding: 24 }}>Đang chuyển sang Logistics...</p>
}
