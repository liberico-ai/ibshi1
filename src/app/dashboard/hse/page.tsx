'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, KPICard, Button, InputField, Modal } from '@/components/ui'
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
  rates: {
    recordableCount: number; lostTimeCount: number; manHours: number;
    manHoursSource: string; trir: number | null; ltifr: number | null;
  };
}

export default function HSEDashboardPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showManHours, setShowManHours] = useState(false)
  const user = useAuthStore(s => s.user)
  const canEditManHours = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')

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

  const fmtRate = (v: number | null) => v != null ? v.toFixed(2) : 'N/A'

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="An toàn lao động (HSE)"
        subtitle="Tổng quan"
        actions={canEditManHours ? <Button variant="outline" onClick={() => setShowManHours(true)}>Nhập giờ công</Button> : undefined}
      />

      <div className="glass-card p-5 space-y-3" style={{ borderLeft: `3px solid ${data.incidents.open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}` }}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Ngày không tai nạn</h3>
        <div className="text-4xl font-black" style={{ color: data.incidents.daysSinceLastIncident !== null && data.incidents.daysSinceLastIncident < 7 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid }}>
          {data.incidents.daysSinceLastIncident ?? '∞'}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Ngày kể từ sự cố gần nhất</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="TRIR" value={fmtRate(data.rates.trir)} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="LTIFR" value={fmtRate(data.rates.ltifr)} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="Sự cố đang mở" value={data.incidents.open} accentColor={data.incidents.open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Ngày mất LĐ" value={data.incidents.totalLostDays} accentColor={data.incidents.totalLostDays > 0 ? SEMANTIC_COLORS.warning.solid : SEMANTIC_COLORS.success.solid} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="Permit hiệu lực" value={data.permits.active} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Permit hết hạn" value={data.permits.expired} accentColor={data.permits.expired > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Nghiêm trọng" value={data.incidents.bySeverity.critical} accentColor={SEMANTIC_COLORS.danger.solid} />
        <KPICard label="Lớn" value={data.incidents.bySeverity.major} accentColor={SEMANTIC_COLORS.warning.solid} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="Nhỏ" value={data.incidents.bySeverity.minor} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Suýt xảy ra" value={data.incidents.bySeverity.nearMiss} accentColor="#64748B" />
        <div className="glass-card p-4">
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Man-hours</div>
          <div className="text-xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>
            {data.rates.manHours > 0 ? new Intl.NumberFormat('en-US').format(data.rates.manHours) : 'N/A'}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Nguồn: {data.rates.manHoursSource}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Recordable</div>
          <div className="text-xl font-black mt-1" style={{ color: 'var(--text-primary)' }}>{data.rates.recordableCount}</div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>sự cố</div>
        </div>
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

      {showManHours && (
        <ManHoursModal onClose={() => setShowManHours(false)} onSaved={() => { setShowManHours(false); window.location.reload() }} />
      )}
    </div>
  )
}

function ManHoursModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const now = new Date()
  const [form, setForm] = useState({
    periodYear: String(now.getFullYear()),
    periodMonth: String(now.getMonth() + 1),
    manHours: '',
    note: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [records, setRecords] = useState<{ periodYear: number; periodMonth: number; manHours: number; note: string | null }[]>([])

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/hse/man-hours?year=${form.periodYear}`).then(res => {
      if (!cancelled && res.ok) setRecords(res.records)
    })
    return () => { cancelled = true }
  }, [form.periodYear])

  const submit = async () => {
    if (!form.manHours) return alert('Nhập số giờ công')
    setSubmitting(true)
    const res = await apiFetch('/api/hse/man-hours', {
      method: 'POST',
      body: JSON.stringify({
        periodYear: parseInt(form.periodYear),
        periodMonth: parseInt(form.periodMonth),
        manHours: parseFloat(form.manHours),
        note: form.note || undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) onSaved()
    else alert(res.error || 'Lỗi')
  }

  const months = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12']

  return (
    <Modal open onClose={onClose} title="Nhập giờ công HSE" size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <InputField label="Năm" type="number" value={form.periodYear} onChange={e => setForm({ ...form, periodYear: e.target.value })} />
          <InputField label="Tháng" type="number" value={form.periodMonth} onChange={e => setForm({ ...form, periodMonth: e.target.value })} />
          <InputField label="Giờ công *" type="number" value={form.manHours} onChange={e => setForm({ ...form, manHours: e.target.value })} />
        </div>
        <InputField label="Ghi chú" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      </div>

      {records.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>Đã nhập năm {form.periodYear}</div>
          <div className="grid grid-cols-6 gap-1">
            {months.map((m, i) => {
              const rec = records.find(r => r.periodMonth === i + 1)
              return (
                <div key={i} className="text-center p-1 rounded text-[10px]" style={{
                  background: rec ? SEMANTIC_COLORS.success.bg : '#F1F3F5',
                  color: rec ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)',
                }}>
                  <div className="font-bold">{m}</div>
                  {rec && <div>{new Intl.NumberFormat('en-US').format(Number(rec.manHours))}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>Lưu</Button>
      </div>
    </Modal>
  )
}
