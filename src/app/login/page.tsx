'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/hooks/useAuth'
import Image from 'next/image'

const FEATURES = [
  { title: 'Quản lý Dự án', desc: '32 bước quy trình tự động', icon: 'folder' },
  { title: 'Sản xuất', desc: 'Lệnh SX, theo dõi tiến độ', icon: 'factory' },
  { title: 'Quản lý Kho', desc: 'Nhập xuất chính xác 100%', icon: 'package' },
  { title: 'Kiểm soát CL', desc: 'QC 5 tầng, truy vết đầy đủ', icon: 'shield' },
]

function FeatureIcon({ name }: { name: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'folder': return <svg {...p}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
    case 'factory': return <svg {...p}><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>
    case 'package': return <svg {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
    case 'shield': return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
    default: return <div className="w-5 h-5" />
  }
}

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const login = useAuthStore((s) => s.login)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Đăng nhập thất bại'); setLoading(false); return }
      login(data.token, data.user)
      router.push('/dashboard')
    } catch {
      setError('Lỗi kết nối server')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-end overflow-hidden">

      {/* ═══ FULL-SCREEN Factory Background ═══ */}
      <Image
        src="/images/factory-bg.png"
        alt="IBS Heavy Industry Shipyard"
        fill
        className="object-cover"
        style={{ objectPosition: 'center 25%' }}
        priority
        quality={95}
      />

      {/* Subtle gradient — mostly transparent, only darkens edges for contrast */}
      <div className="absolute inset-0" style={{
        background: `
          linear-gradient(to right, rgba(10,37,64,0.3) 0%, rgba(10,37,64,0.1) 40%, rgba(10,37,64,0.45) 75%, rgba(10,37,64,0.7) 100%),
          linear-gradient(to bottom, transparent 0%, rgba(10,37,64,0.2) 60%, rgba(10,37,64,0.5) 100%)
        `,
      }} />

      {/* ═══ TOP-LEFT — Brand & Features (floating over image) ═══ */}
      <div className="hidden lg:block absolute top-0 left-0 z-10 p-8 xl:p-12">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-6">
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)',
            background: '#fff', flexShrink: 0,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Image
              src="/ibs-logo.jpeg"
              alt="IBS Logo"
              width={56}
              height={56}
              className="object-contain"
              style={{ padding: '6px' }}
            />
          </div>
          <div>
            <span className="text-xl font-extrabold text-white tracking-wide drop-shadow-lg">IBS</span>
            <span className="text-[10px] block text-white/60 font-semibold tracking-[0.15em] mt-0.5 drop-shadow">HEAVY INDUSTRY</span>
          </div>
        </div>
      </div>

      {/* ═══ BOTTOM-LEFT — Hero text + features (over image) ═══ */}
      <div className="hidden lg:block absolute bottom-0 left-0 z-10 p-8 xl:p-12 max-w-[600px]">
        <h1 style={{
          fontSize: '30px', fontWeight: 800, lineHeight: 1.3,
          color: 'white', marginBottom: '12px', letterSpacing: '-0.02em',
          textShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          Quản lý{' '}
          <span style={{ color: '#ff6b6b' }}>Chuỗi sản xuất</span>
          {' '}thông minh
        </h1>
        <p style={{
          fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.7,
          marginBottom: '20px', maxWidth: '420px',
          textShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }}>
          Hệ thống ERP chuyên ngành công nghiệp nặng — tích hợp quản lý dự án, vật tư, sản xuất và kiểm soát chất lượng toàn diện.
        </p>

        {/* Feature chips — horizontal row */}
        <div className="flex flex-wrap gap-2 mb-4">
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              borderRadius: '10px', padding: '10px 14px',
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(12px)',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255, 107, 107, 0.25)', color: '#ff8a8a',
              }}>
                <FeatureIcon name={f.icon} />
              </div>
              <div>
                <p style={{ fontSize: '12px', fontWeight: 600, color: 'white' }}>{f.title}</p>
                <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '1px' }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
          © 2026 IBS Heavy Industry JSC · Global Standards, Local Expertise
        </p>
      </div>

      {/* ═══ RIGHT — Floating Glass Login Form ═══ */}
      <div className="relative z-20 flex items-center justify-center p-6 sm:p-8 lg:p-12 w-full lg:w-auto lg:min-w-[420px] lg:max-w-[440px] min-h-screen"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderLeft: '1px solid rgba(255,255,255,0.15)',
        }}
      >

        <div className="w-full max-w-[340px] animate-fade-in-scale">

          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              overflow: 'hidden', border: '2px solid rgba(255,255,255,0.2)',
              background: '#fff', margin: '0 auto 12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            }}>
              <Image src="/ibs-logo.jpeg" alt="IBS Logo" width={64} height={64}
                className="object-contain" style={{ padding: '6px' }} />
            </div>
            <h1 className="text-lg font-extrabold text-white">IBS-ERP</h1>
          </div>

          {/* Form card */}
          <div style={{
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(20px)',
            borderRadius: '16px',
            padding: '32px 28px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.3)',
            border: '1px solid rgba(255,255,255,0.5)',
          }}>

            {/* Form header */}
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0a2540' }}>Đăng nhập</h2>
              <p style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
                Nhập thông tin tài khoản để truy cập hệ thống
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 rounded-lg text-sm font-medium animate-fade-in flex items-center gap-2"
                style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#e63946' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b' }}>
                  Tên đăng nhập
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                    className="input" style={{ paddingLeft: '2.5rem', background: 'rgba(255,255,255,0.9)' }}
                    placeholder="Nhập username" required autoFocus />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b' }}>
                  Mật khẩu
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  </span>
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    className="input" style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem', background: 'rgba(255,255,255,0.9)' }}
                    placeholder="••••••••" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer" style={{ color: '#94a3b8', background: 'none', border: 'none' }}>
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading}
                style={{
                  width: '100%', padding: '12px', fontSize: '14px', fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                  background: loading ? '#94a3b8' : '#e63946',
                  color: 'white', border: 'none', borderRadius: '10px',
                  boxShadow: loading ? 'none' : '0 4px 14px rgba(230, 57, 70, 0.4)', transition: 'all 0.2s ease',
                }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Đang xác thực...
                  </span>
                ) : 'Đăng nhập'}
              </button>
            </form>

            {/* System footer */}
            <p className="text-center mt-8" style={{ fontSize: '11px', color: '#94a3b8' }}>
              IBS-ERP v2.0 · Hệ thống quản lý sản xuất
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
