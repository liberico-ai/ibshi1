'use client'

import { useEffect, useRef } from 'react'

export default function ApiDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadSwagger() {
      const SwaggerUI = (await import('swagger-ui-dist')).default

      if (containerRef.current) {
        // @ts-expect-error swagger-ui-dist types
        SwaggerUI({
          url: '/api/docs',
          domNode: containerRef.current,
          deepLinking: true,
          presets: [],
        })
      }
    }

    // Load swagger-ui CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css'
    document.head.appendChild(link)

    loadSwagger()

    return () => {
      document.head.removeChild(link)
    }
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <div ref={containerRef} />
    </div>
  )
}
