'use client'

import { useRouter } from 'next/navigation'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: '2rem',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>❌</div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          Trang này gặp lỗi
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.6, fontSize: '0.9rem' }}>
          {error.message || 'Đã xảy ra lỗi khi tải trang. Vui lòng thử lại hoặc quay về trang chủ.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              padding: '10px 24px', background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              fontWeight: 600, fontSize: '0.85rem',
            }}
          >
            🔄 Thử lại
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '10px 24px', background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
              fontWeight: 600, fontSize: '0.85rem',
            }}
          >
            ← Về Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
