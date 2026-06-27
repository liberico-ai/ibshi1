import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production'
const cspScriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'"
const cspConnectSrc = isDev
  ? "'self' ws://localhost:3000"
  : "'self'"

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Content-Security-Policy', value: `default-src 'self'; script-src ${cspScriptSrc}; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob:; font-src 'self'; connect-src ${cspConnectSrc}; frame-ancestors 'none'` },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    GIT_SHA: process.env.GIT_SHA || '',
    BUILD_TIME: process.env.BUILD_TIME || '',
  },
  // Allow large file uploads (50MB) — default 1MB blocks ZIP/RAR files
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
