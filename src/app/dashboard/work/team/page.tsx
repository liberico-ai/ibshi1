'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'
import { formatDate } from '@/lib/utils'
import { PageHeader, Badge, KPICard, EmptyState } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Users } from 'lucide-react'

interface MTask { id: string; title: string; status: string; projectCode: string | null; deadline: string | null; overdue: boolean }
interface Member { userId: string; fullName: string; roleCode: string; counts: { active: number; done: number; overdue: number }; tasks: MTask[] }
interface Team { deptCode: string | null; deptName: string; members: Member[] }

const ST_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'default'> = {
  OPEN: 'default', IN_PROGRESS: 'info', AWAITING_REVIEW: 'warning', RETURNED: 'danger',
}
const ST_LABEL: Record<string, string> = {
  OPEN: 'Mới', IN_PROGRESS: 'Đang xử lý', AWAITING_REVIEW: 'Chờ kết thúc', RETURNED: 'Bị trả lại',
}
const roleLabel = (r: string) => (ROLES as Record<string, { name: string }>)[r]?.name || r

export default function TeamPage() {
  const router = useRouter()
  const [team, setTeam] = useState<Team | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => { apiFetch('/api/work/team').then((r) => { if (r.ok) setTeam({ deptCode: r.deptCode, deptName: r.deptName, members: r.members }) }) }, [])

  if (!team) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const tot = team.members.reduce((s, m) => ({ active: s.active + m.counts.active, overdue: s.overdue + m.counts.overdue, done: s.done + m.counts.done }), { active: 0, overdue: 0, done: 0 })

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title={`Phòng của tôi — ${team.deptName}`} subtitle="Nhân sự phòng đang xử lý việc gì, tiến độ ra sao" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
        <KPICard label="Đang làm" value={tot.active} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Quá hạn" value={tot.overdue} accentColor={tot.overdue > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
        <KPICard label="Đã xong" value={tot.done} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Nhân sự" value={team.members.length} accentColor="#0a2540" />
      </div>

      <div className="space-y-3 stagger-children">
        {team.members.map((m) => (
          <div key={m.userId} className="glass-card p-4">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen((s) => ({ ...s, [m.userId]: !s[m.userId] }))}>
              <div className="flex-1">
                <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{m.fullName}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{roleLabel(m.roleCode)}</div>
              </div>
              <Badge variant="info">{m.counts.active} đang làm</Badge>
              {m.counts.overdue > 0 && <Badge variant="danger">{m.counts.overdue} quá hạn</Badge>}
              <Badge variant="success">{m.counts.done} xong</Badge>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{open[m.userId] ? '▲' : '▼'}</span>
            </div>
            {open[m.userId] && (
              <div className="mt-3 space-y-1.5">
                {m.tasks.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Không có việc đang làm.</div>}
                {m.tasks.map((t) => (
                  <div key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)}
                    className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg cursor-pointer transition-colors"
                    style={{ background: 'var(--surface-alt, transparent)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover, #f1f5f9)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-alt, transparent)'}>
                    {t.projectCode && <Badge variant="info">{t.projectCode}</Badge>}
                    <span className="flex-1 text-xs" style={{ color: 'var(--text-primary)' }}>{t.title}</span>
                    <Badge variant={ST_VARIANT[t.status] || 'default'}>{ST_LABEL[t.status] || t.status}</Badge>
                    <span className="text-xs" style={{ color: t.overdue ? SEMANTIC_COLORS.danger.solid : 'var(--text-muted)', fontWeight: t.overdue ? 700 : 400 }}>
                      {t.deadline ? formatDate(t.deadline) : '—'}{t.overdue ? ' !' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {team.members.length === 0 && <EmptyState icon={<Users />} title="Phòng chưa có nhân sự" />}
      </div>
    </div>
  )
}
