'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import {
  PageHeader, Button, KPICard, EmptyState, Modal,
  InputField, SelectField, TextareaField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface Talk {
  id: string; talkCode: string; topic: string; content: string | null;
  talkDate: string; attendees: number; notes: string | null;
  department: { code: string; name: string } | null;
}

interface Dept { id: string; code: string; name: string }

export default function ToolboxTalksPage() {
  const user = useAuthStore(s => s.user)
  const [talks, setTalks] = useState<Talk[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const canEdit = ['R01', 'R10', 'R06', 'R06a', 'R06b'].includes(user?.roleCode || '')

  const loadData = useCallback(async () => {
    const res = await apiFetch('/api/hse/toolbox-talks')
    if (res.ok) setTalks(res.talks)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>

  const totalAttendees = talks.reduce((s, t) => s + t.attendees, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Họp an toàn đầu ca"
        subtitle={`${talks.length} buổi`}
        actions={canEdit ? <Button variant="accent" onClick={() => setShowCreate(true)}>+ Tạo buổi</Button> : undefined}
      />

      <div className="grid grid-cols-3 gap-4 stagger-children">
        <KPICard label="Tổng buổi" value={talks.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Người tham dự" value={totalAttendees} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Tháng này" value={talks.filter(t => { const d = new Date(t.talkDate); const now = new Date(); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() }).length} accentColor={SEMANTIC_COLORS.info.solid} />
      </div>

      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>Mã</th><th>Tổ/Phòng</th><th>Chủ đề</th><th>Ngày</th><th>Tham dự</th></tr>
          </thead>
          <tbody>
            {talks.length === 0 ? (
              <tr><td colSpan={5}><EmptyState icon="🗣️" title="Chưa có buổi họp" /></td></tr>
            ) : talks.map(t => (
              <tr key={t.id}>
                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{t.talkCode}</span></td>
                <td className="text-xs font-mono">{t.department?.code || '—'}</td>
                <td className="text-xs font-bold">{t.topic}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(t.talkDate)}</td>
                <td className="text-xs font-mono">{t.attendees}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateTalkModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData() }} />}
    </div>
  )
}

function CreateTalkModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [depts, setDepts] = useState<Dept[]>([])
  const [form, setForm] = useState({ departmentId: '', topic: '', content: '', talkDate: '', attendees: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const u = (f: string, v: string) => setForm({ ...form, [f]: v })

  useEffect(() => {
    apiFetch('/api/production/teams').then(r => { if (r.ok) setDepts(r.teams) })
  }, [])

  const submit = async () => {
    if (!form.topic || !form.talkDate || !form.attendees) return alert('Nhập chủ đề, ngày, số người')
    setSubmitting(true)
    const res = await apiFetch('/api/hse/toolbox-talks', {
      method: 'POST',
      body: JSON.stringify({ ...form, attendees: Number(form.attendees), departmentId: form.departmentId || undefined }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else alert(res.error || 'Lỗi')
  }

  return (
    <Modal open={true} onClose={onClose} title="Tạo buổi họp an toàn" size="md">
      <div className="space-y-3">
        <SelectField label="Tổ/Phòng" value={form.departmentId} onChange={e => u('departmentId', e.target.value)}
          options={[{ value: '', label: 'Không chọn' }, ...depts.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` }))]} />
        <InputField label="Chủ đề *" value={form.topic} onChange={e => u('topic', e.target.value)} placeholder="An toàn hàn cắt nóng" />
        <TextareaField label="Nội dung" rows={3} value={form.content} onChange={e => u('content', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Ngày *" type="date" value={form.talkDate} onChange={e => u('talkDate', e.target.value)} />
          <InputField label="Số người *" type="number" value={form.attendees} onChange={e => u('attendees', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="accent" className="flex-1" onClick={submit} loading={submitting}>Tạo</Button>
      </div>
    </Modal>
  )
}
