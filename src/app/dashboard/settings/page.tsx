'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'

interface UserProfile {
  id: string; email: string; fullName: string; roleCode: string; avatar: string | null;
}

interface SystemConfig {
  company_name: string; company_address: string; company_phone: string; company_email: string
  password_min_length: string; session_timeout_hours: string
  email_notifications_enabled: string; system_maintenance_mode: string
}

const DEFAULT_CONFIG: SystemConfig = {
  company_name: 'IBS - Công ty CP Đóng tàu và Công nghiệp Hàng hải Sài Gòn',
  company_address: '', company_phone: '', company_email: '',
  password_min_length: '6', session_timeout_hours: '8',
  email_notifications_enabled: 'true', system_maintenance_mode: 'false',
}

export default function SettingsPage() {
  const { user: authUser } = useAuthStore()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [locale, setLocale] = useState('vi')
  const [theme, setTheme] = useState('dark')
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [toast, setToast] = useState('')

  const isAdmin = authUser?.roleCode === 'R10'

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    setLocale(localStorage.getItem('ibs-locale') || 'vi')
    setTheme(localStorage.getItem('ibs-theme') || 'dark')
    apiFetch('/api/me').then(res => {
      if (res.ok) setUser(res.user || res)
      setLoading(false)
    }).catch(() => setLoading(false))

    if (authUser?.roleCode === 'R10') {
      setConfigLoading(true)
      apiFetch('/api/admin/config').then(res => {
        if (res.ok && res.config) setConfig({ ...DEFAULT_CONFIG, ...res.config })
        setConfigLoading(false)
      }).catch(() => setConfigLoading(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleLocale = () => {
    const next = locale === 'vi' ? 'en' : 'vi'
    setLocale(next)
    localStorage.setItem('ibs-locale', next)
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('ibs-theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    document.documentElement.classList.toggle('light', next === 'light')
  }

  const saveConfig = async () => {
    setConfigSaving(true)
    const res = await apiFetch('/api/admin/config', {
      method: 'PUT', body: JSON.stringify({ config }),
    })
    setConfigSaving(false)
    if (res.ok) showToast(res.message || 'Đã lưu cấu hình')
    else showToast('Lỗi: ' + (res.error || 'Không thể lưu'))
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-semibold animate-fade-in-scale"
          style={{ background: '#16a34a', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          ✓ {toast}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Cài đặt</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Quản lý tài khoản và cấu hình hệ thống</p>
      </div>

      {/* Profile Card */}
      <div className="card p-6">
        <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Thông tin tài khoản</h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Họ tên</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{user?.fullName || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Email</span>
            <span className="text-sm font-mono" style={{ color: '#0ea5e9' }}>{user?.email || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Vai trò</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>{user?.roleCode || '—'}</span>
          </div>
        </div>
      </div>

      {/* Language & Theme */}
      <div className="card p-6">
        <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Ngôn ngữ & Giao diện</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Ngôn ngữ</span>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Chuyển đổi Việt ↔ English</p>
            </div>
            <button onClick={toggleLocale} className="px-4 py-2 rounded-lg text-sm font-bold cursor-pointer" style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>
              {locale === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
            </button>
          </div>
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Giao diện</span>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Dark / Light mode</p>
            </div>
            <button onClick={toggleTheme} className="px-4 py-2 rounded-lg text-sm font-bold cursor-pointer" style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>
              {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>
        </div>
      </div>

      {/* System Config - R10 only */}
      {isAdmin && (
        <>
          <div className="card p-6">
            <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Thông tin Công ty</h2>
            {configLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-9 skeleton rounded-lg" />)}</div>
            ) : (
              <div className="space-y-3">
                <ConfigInput label="Tên công ty" value={config.company_name} onChange={v => setConfig({ ...config, company_name: v })} />
                <ConfigInput label="Địa chỉ" value={config.company_address} onChange={v => setConfig({ ...config, company_address: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <ConfigInput label="Điện thoại" value={config.company_phone} onChange={v => setConfig({ ...config, company_phone: v })} />
                  <ConfigInput label="Email" value={config.company_email} onChange={v => setConfig({ ...config, company_email: v })} />
                </div>
              </div>
            )}
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Chính sách Bảo mật</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <ConfigInput label="Độ dài mật khẩu tối thiểu" value={config.password_min_length}
                  onChange={v => setConfig({ ...config, password_min_length: v })} type="number" />
                <ConfigInput label="Session timeout (giờ)" value={config.session_timeout_hours}
                  onChange={v => setConfig({ ...config, session_timeout_hours: v })} type="number" />
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Email thông báo</span>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Gửi notification qua email</p>
                </div>
                <button onClick={() => setConfig({ ...config, email_notifications_enabled: config.email_notifications_enabled === 'true' ? 'false' : 'true' })}
                  className="px-4 py-2 rounded-lg text-sm font-bold cursor-pointer" style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>
                  {config.email_notifications_enabled === 'true' ? '✅ Bật' : '❌ Tắt'}
                </button>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Chế độ bảo trì</span>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Chặn truy cập hệ thống (trừ Admin)</p>
                </div>
                <button onClick={() => setConfig({ ...config, system_maintenance_mode: config.system_maintenance_mode === 'true' ? 'false' : 'true' })}
                  className="px-4 py-2 rounded-lg text-sm font-bold cursor-pointer" style={{
                    background: config.system_maintenance_mode === 'true' ? '#fef2f2' : 'var(--surface-hover)',
                    color: config.system_maintenance_mode === 'true' ? '#dc2626' : 'var(--text-primary)',
                    border: config.system_maintenance_mode === 'true' ? '1px solid #fecaca' : 'none',
                  }}>
                  {config.system_maintenance_mode === 'true' ? '⚠️ Đang bảo trì' : '✅ Hoạt động bình thường'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={saveConfig} disabled={configSaving}
              className="btn-accent disabled:opacity-50 px-6">
              {configSaving ? 'Đang lưu...' : '💾 Lưu cấu hình hệ thống'}
            </button>
          </div>
        </>
      )}

      {/* System Info */}
      <div className="card p-6">
        <h2 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Thông tin hệ thống</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Phiên bản</span><p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>v2.0.0</p></div>
          <div><span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Models</span><p className="text-sm font-bold" style={{ color: '#16a34a' }}>46</p></div>
          <div><span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>APIs</span><p className="text-sm font-bold" style={{ color: '#0ea5e9' }}>58</p></div>
          <div><span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Pages</span><p className="text-sm font-bold" style={{ color: '#f59e0b' }}>50+</p></div>
        </div>
      </div>
    </div>
  )
}

function ConfigInput({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input className="input" type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
