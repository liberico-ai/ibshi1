'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, Card, Button, InputField } from '@/components/ui'

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
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg animate-fade-in-scale"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 600, background: '#16a34a', color: '#fff', boxShadow: 'var(--shadow-lg)' }}>
          ✓ {toast}
        </div>
      )}

      <PageHeader title="Cài đặt" subtitle="Quản lý tài khoản và cấu hình hệ thống" />

      {/* Profile Card */}
      <Card padding="default">
        <h2 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>Thông tin tài khoản</h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="input-label" style={{ marginBottom: 0 }}>Họ tên</span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>{user?.fullName || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="input-label" style={{ marginBottom: 0 }}>Email</span>
            <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: '#0ea5e9' }}>{user?.email || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="input-label" style={{ marginBottom: 0 }}>Vai trò</span>
            <span className="role-badge">{user?.roleCode || '—'}</span>
          </div>
        </div>
      </Card>

      {/* Language & Theme */}
      <Card padding="default">
        <h2 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>Ngôn ngữ &amp; Giao diện</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>Ngôn ngữ</span>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Chuyển đổi Việt ↔ English</p>
            </div>
            <Button variant="ghost" onClick={toggleLocale}>
              {locale === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
            </Button>
          </div>
          <div className="flex justify-between items-center">
            <div>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>Giao diện</span>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Dark / Light mode</p>
            </div>
            <Button variant="ghost" onClick={toggleTheme}>
              {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </Button>
          </div>
        </div>
      </Card>

      {/* System Config - R10 only */}
      {isAdmin && (
        <>
          <Card padding="default">
            <h2 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>Thông tin Công ty</h2>
            {configLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-9 skeleton rounded-lg" />)}</div>
            ) : (
              <div className="space-y-3">
                <InputField label="Tên công ty" value={config.company_name} onChange={e => setConfig({ ...config, company_name: e.target.value })} />
                <InputField label="Địa chỉ" value={config.company_address} onChange={e => setConfig({ ...config, company_address: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Điện thoại" value={config.company_phone} onChange={e => setConfig({ ...config, company_phone: e.target.value })} />
                  <InputField label="Email" value={config.company_email} onChange={e => setConfig({ ...config, company_email: e.target.value })} />
                </div>
              </div>
            )}
          </Card>

          <Card padding="default">
            <h2 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>Chính sách Bảo mật</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Độ dài mật khẩu tối thiểu" type="number" value={config.password_min_length}
                  onChange={e => setConfig({ ...config, password_min_length: e.target.value })} />
                <InputField label="Session timeout (giờ)" type="number" value={config.session_timeout_hours}
                  onChange={e => setConfig({ ...config, session_timeout_hours: e.target.value })} />
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>Email thông báo</span>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Gửi notification qua email</p>
                </div>
                <Button variant="ghost"
                  onClick={() => setConfig({ ...config, email_notifications_enabled: config.email_notifications_enabled === 'true' ? 'false' : 'true' })}>
                  {config.email_notifications_enabled === 'true' ? '✅ Bật' : '❌ Tắt'}
                </Button>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>Chế độ bảo trì</span>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Chặn truy cập hệ thống (trừ Admin)</p>
                </div>
                <Button
                  variant={config.system_maintenance_mode === 'true' ? 'danger' : 'ghost'}
                  onClick={() => setConfig({ ...config, system_maintenance_mode: config.system_maintenance_mode === 'true' ? 'false' : 'true' })}>
                  {config.system_maintenance_mode === 'true' ? '⚠️ Đang bảo trì' : '✅ Hoạt động bình thường'}
                </Button>
              </div>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button variant="accent" onClick={saveConfig} loading={configSaving}>
              💾 Lưu cấu hình hệ thống
            </Button>
          </div>
        </>
      )}

      {/* System Info */}
      <Card padding="default">
        <h2 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>Thông tin hệ thống</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="input-label" style={{ textTransform: 'uppercase' }}>Phiên bản</span><p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>v2.0.0</p></div>
          <div><span className="input-label" style={{ textTransform: 'uppercase' }}>Models</span><p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#16a34a' }}>46</p></div>
          <div><span className="input-label" style={{ textTransform: 'uppercase' }}>APIs</span><p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#0ea5e9' }}>58</p></div>
          <div><span className="input-label" style={{ textTransform: 'uppercase' }}>Pages</span><p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#f59e0b' }}>50+</p></div>
        </div>
      </Card>
    </div>
  )
}
