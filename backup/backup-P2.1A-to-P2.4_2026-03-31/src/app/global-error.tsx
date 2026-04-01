'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 480, padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Đã xảy ra lỗi hệ thống
            </h1>
            <p style={{ color: '#94a3b8', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              {error.message || 'Một lỗi không mong muốn đã xảy ra. Vui lòng thử lại.'}
            </p>
            <button
              onClick={reset}
              style={{
                padding: '10px 24px', background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontWeight: 600, fontSize: '0.9rem',
              }}
            >
              🔄 Thử lại
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
