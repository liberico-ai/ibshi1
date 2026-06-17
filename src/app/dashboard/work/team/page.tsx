'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { ROLES } from '@/lib/constants'

interface MTask { id: string; title: string; status: string; projectCode: string | null; deadline: string | null; overdue: boolean }
interface Member { userId: string; fullName: string; roleCode: string; counts: { active: number; done: number; overdue: number }; tasks: MTask[] }
interface Team { deptCode: string | null; deptName: string; members: Member[] }
const ST: Record<string, { l: string; c: string; b: string }> = {
  OPEN: { l: 'Mới', c: '#475569', b: '#f1f5f9' },
  IN_PROGRESS: { l: 'Đang xử lý', c: '#1d4ed8', b: '#eff6ff' },
  AWAITING_REVIEW: { l: 'Chờ kết thúc', c: '#b45309', b: '#fffbeb' },
  RETURNED: { l: 'Bị trả lại', c: '#e63946', b: '#fef2f2' },
}
const roleLabel = (r: string) => (ROLES as Record<string, { name: string }>)[r]?.name || r

export default function TeamPage() {
  const router = useRouter()
  const [team, setTeam] = useState<Team | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => { apiFetch('/api/work/team').then((r) => { if (r.ok) setTeam({ deptCode: r.deptCode, deptName: r.deptName, members: r.members }) }) }, [])

  if (!team) return <div className="p-6" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>

  const tot = team.members.reduce((s, m) => ({ active: s.active + m.counts.active, overdue: s.overdue + m.counts.overdue, done: s.done + m.counts.done }), { active: 0, overdue: 0, done: 0 })

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>👥 Phòng của tôi — {team.deptName}</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nhân sự phòng đang xử lý việc gì, tiến độ ra sao</p>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #1d4ed8' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Đang làm</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color: '#1d4ed8' }}>{tot.active}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #e63946' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Quá hạn</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color: '#e63946' }}>{tot.overdue}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #059669' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Đã xong</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color: '#059669' }}>{tot.done}</div>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #0a2540' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Nhân sự</div>
          <div className="text-2xl font-extrabold mt-1" style={{ color: '#0a2540' }}>{team.members.length}</div>
        </div>
      </div>

      <div className="space-y-3">
        {team.members.map((m) => (
          <div key={m.userId} className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen((s) => ({ ...s, [m.userId]: !s[m.userId] }))}>
              <div className="flex-1">
                <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{m.fullName}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{roleLabel(m.roleCode)}</div>
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{m.counts.active} đang làm</span>
              {m.counts.overdue > 0 && <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: '#fef2f2', color: '#e63946' }}>{m.counts.overdue} quá hạn</span>}
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#ecfdf5', color: '#059669' }}>{m.counts.done} xong</span>
              <span style={{ color: 'var(--text-muted)' }}>{open[m.userId] ? '▲' : '▼'}</span>
            </div>
            {open[m.userId] && (
              <div className="mt-3 space-y-1.5">
                {m.tasks.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Không có việc đang làm.</div>}
                {m.tasks.map((t) => {
                  const st = ST[t.status] || ST.OPEN
                  return (
                    <div key={t.id} onClick={() => router.push(`/dashboard/work/${t.id}`)} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded cursor-pointer hover:bg-blue-50">
                      {t.projectCode && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{t.projectCode}</span>}
                      <span className="flex-1" style={{ color: 'var(--text-primary)' }}>{t.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.b, color: st.c }}>{st.l}</span>
                      <span className="text-xs" style={{ color: t.overdue ? '#e63946' : 'var(--text-muted)', fontWeight: t.overdue ? 700 : 400 }}>{t.deadline ? new Date(t.deadline).toLocaleDateString('vi-VN') : '—'}{t.overdue ? ' ⚠' : ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {team.members.length === 0 && <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Phòng chưa có nhân sự.</div>}
      </div>
    </div>
  )
}
