'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, KPICard } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import Link from 'next/link'
import { HardHat, ClipboardList, MessageCircle } from 'lucide-react'

interface DashData {
  incidents: {
    total: number; open: number; daysSinceLastIncident: number | null; totalLostDays: number;
    bySeverity: { critical: number; major: number; minor: number; nearMiss: number };
  };
  permits: { total: number; active: number; expired: number; pending: number };
  toolboxTalks: { total: number; thisMonth: number; totalAttendees: number };
}

export default function HSEDashboardPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/hse/dashboard').then(r => {
      if (r.ok) setData(r)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-32 skeleton rounded-xl" />)}</div>
  if (!data) return <div className="text-center py-10" style={{ color: 'var(--text-muted)' }}>Không tải được dữ liệu</div>

  const cards = [
    { href: '/dashboard/hse/incidents', label: 'Sự cố', icon: <HardHat size={28} /> },
    { href: '/dashboard/hse/work-permits', label: 'Giấy phép', icon: <ClipboardList size={28} /> },
    { href: '/dashboard/hse/toolbox-talks', label: 'Họp an toàn', icon: <MessageCircle size={28} /> },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="An toàn lao động (HSE)" subtitle="Tổng quan" />

      <div className="glass-card p-5 space-y-3" style={{ borderLeft: `3px solid ${data.incidents.open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}` }}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ngày không tai nạn</h3>
        <div className="text-4xl font-black" style={{ color: data.incidents.daysSinceLastIncident !== null && data.incidents.daysSinceLastIncident < 7 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid }}>
          {data.incidents.daysSinceLastIncident ?? '∞'}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Ngày kể từ sự cố gần nhất</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="Sự cố đang mở" value={data.incidents.open} accentColor={data.incidents.open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Ngày mất LĐ" value={data.incidents.totalLostDays} accentColor={data.incidents.totalLostDays > 0 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Permit hiệu lực" value={data.permits.active} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Permit hết hạn" value={data.permits.expired} accentColor={data.permits.expired > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="Nghiêm trọng" value={data.incidents.bySeverity.critical} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard label="Lớn" value={data.incidents.bySeverity.major} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="Nhỏ" value={data.incidents.bySeverity.minor} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Suýt xảy ra" value={data.incidents.bySeverity.nearMiss} accentColor="#64748B" />
      </div>

      <div className="glass-card p-5 space-y-2">
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Toolbox Talk tháng này</h3>
        <div className="flex gap-6">
          <div><span className="text-2xl font-black" style={{ color: SEMANTIC_COLORS.info.solid }}>{data.toolboxTalks.thisMonth}</span> <span className="text-xs" style={{ color: 'var(--text-muted)' }}>buổi</span></div>
          <div><span className="text-2xl font-black" style={{ color: SEMANTIC_COLORS.success.solid }}>{data.toolboxTalks.totalAttendees}</span> <span className="text-xs" style={{ color: 'var(--text-muted)' }}>người</span></div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {cards.map(c => (
          <Link key={c.href} href={c.href} className="glass-card p-5 text-center hover:scale-[1.02] transition-transform">
            <div className="mb-2" style={{ color: 'var(--text-muted)' }}>{c.icon}</div>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
