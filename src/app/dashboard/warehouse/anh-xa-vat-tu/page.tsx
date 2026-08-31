'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button, KPICard, EmptyState, SelectField } from '@/components/ui'
import { SearchBar } from '@/components/SearchPagination'
import { formatNumber } from '@/lib/utils'
import { ArrowLeftRight } from 'lucide-react'

// Ánh xạ vật tư APL → mã kho, ba tầng:
//   LUẬT     — giải mã ký hiệu bản vẽ (PL25 → thép tấm 25), tự động
//   BÍ DANH  — người dùng chỉ tay, luôn thắng luật máy
//   CHƯA CÓ MÃ — kho thật sự chưa có; đẩy sang tạo mã chứ không ép khớp
// Xếp theo KHỐI LƯỢNG giảm dần vì khối lượng dồn rất mạnh: ~100 cặp đầu đã phủ 80%.

interface Row {
  key: string; grade: string; profile: string; lines: number; weightKg: number
  via: 'alias' | 'rule' | 'history' | null
  materialId: string | null; materialCode: string | null; materialName: string | null
  gradeMismatch: boolean
  candidates: { id: string; materialCode: string; name: string }[]
}
interface Stat {
  pairs: number; totalWeightKg: number; alias: number; rule: number; history: number
  unmatched: number; gradeMismatch: number; matchedWeightKg: number; aliasWeightKg: number
}
interface ProjectOption { id: string; projectCode: string; projectName: string }
interface MatOption { id: string; materialCode: string; name: string; unit: string }

const STATUS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'unmatched', label: 'Chưa có mã' },
  { value: 'grade', label: 'Lệch mác thép' },
  { value: 'alias', label: 'Đã chỉ tay' },
  { value: 'history', label: 'Từ PR/BOM cũ' },
  { value: 'matched', label: 'Đã khớp' },
]

export default function AnhXaVatTuPage() {
  const role = useAuthStore(s => s.user?.roleCode || '')
  const canEdit = ['R01', 'R03', 'R03a', 'R04', 'R04a', 'R05', 'R05a', 'R10'].includes(role)

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [aplId, setAplId] = useState('')
  const [aplName, setAplName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [stat, setStat] = useState<Stat | null>(null)
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  // Ô đang mở để chọn mã kho
  const [editKey, setEditKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<MatOption[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { apiFetch('/api/projects?page=1&limit=200').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  useEffect(() => {
    if (!projectId) { setAplId(''); setRows([]); setStat(null); return }
    setMsg('')
    apiFetch(`/api/design/apl/items?projectId=${projectId}`).then(r => {
      if (r.ok && r.apl) { setAplId(r.apl.id); setAplName(r.apl.fileName) }
      else { setAplId(''); setRows([]); setStat(null); setMsg(r.message || 'Dự án này chưa nhập APL.') }
    })
  }, [projectId])

  const load = useCallback(() => {
    if (!aplId) return
    setLoading(true)
    const sp = new URLSearchParams({ status })
    if (q) sp.set('q', q)
    apiFetch(`/api/design/apl/${aplId}/material-map?${sp}`)
      .then(r => { if (r.ok) { setRows(r.rows || []); setStat(r.stat) } else setMsg(r.error || 'Lỗi tải bảng ánh xạ') })
      .finally(() => setLoading(false))
  }, [aplId, status, q])

  useEffect(() => { load() }, [load])

  // Tìm mã kho để gắn
  useEffect(() => {
    if (!editKey || search.trim().length < 2) { setFound([]); return }
    const t = setTimeout(() => {
      apiFetch(`/api/materials?search=${encodeURIComponent(search)}&limit=20`)
        .then(r => setFound(r.ok ? (r.materials || []) : []))
        .catch(() => setFound([]))
    }, 350)
    return () => clearTimeout(t)
  }, [editKey, search])

  const openPicker = (r: Row) => {
    setEditKey(r.key)
    setSearch(r.materialCode || r.profile || '')
    setFound(r.candidates.map(c => ({ id: c.id, materialCode: c.materialCode, name: c.name, unit: '' })))
  }

  const bind = async (r: Row, materialId: string) => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/design/apl/material-alias', {
        method: 'POST',
        body: JSON.stringify({ grade: r.grade, profile: r.profile, materialId }),
      })
      if (!res?.ok) { notify(res?.error || 'Lưu thất bại', 'error'); return }
      notify(res.message || 'Đã gắn mã', 'success')
      setEditKey(null); setSearch(''); setFound([])
      load()
    } finally { setSaving(false) }
  }

  const unbind = async (r: Row) => {
    const res = await apiFetch(`/api/design/apl/material-alias?grade=${encodeURIComponent(r.grade)}&profile=${encodeURIComponent(r.profile)}`, { method: 'DELETE' })
    if (!res?.ok) { notify(res?.error || 'Không bỏ được', 'error'); return }
    notify('Đã bỏ ánh xạ tay — trả về cho luật máy', 'success')
    load()
  }

  const pctW = stat && stat.totalWeightKg > 0 ? (stat.matchedWeightKg / stat.totalWeightKg) * 100 : 0

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Ánh xạ vật tư APL → mã kho"
        subtitle="Ký hiệu bản vẽ (PL25, H-400X400X13X21) đối chiếu với danh mục kho. Chỉ phần đã có mã mới đề nghị cấp vật tư được." />

      <div className="card p-4" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 2fr', gap: 12, alignItems: 'end' }}>
        <SelectField label="Dự án" value={projectId} onChange={e => setProjectId(e.target.value)}
          options={[{ value: '', label: '— Chọn dự án —' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
        <SelectField label="Lọc" value={status} onChange={e => setStatus(e.target.value)} options={STATUS} />
        <div>
          <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Tìm</label>
          <SearchBar value={q} onChange={setQ} placeholder="Mác thép / quy cách / mã kho…" />
        </div>
      </div>

      {msg && <div className="card p-3" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '0.85rem' }}>{msg}</div>}

      {stat && (
        <>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>APL: <b>{aplName}</b></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <KPICard label="Cặp mác × quy cách" value={formatNumber(stat.pairs)} />
            <KPICard label="Phủ khối lượng" value={`${pctW.toFixed(1)}%`} accentColor="var(--accent)" />
            <KPICard label="Luật tự khớp" value={formatNumber(stat.rule)} />
            <KPICard label="Từ PR/BOM cũ" value={formatNumber(stat.history || 0)} />
            <KPICard label="Đã chỉ tay" value={formatNumber(stat.alias)} />
            <KPICard label="Chưa có mã" value={formatNumber(stat.unmatched)} accentColor="#dc2626" />
          </div>
        </>
      )}

      {aplId && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Mác thép</th>
                <th className="text-left">Quy cách (APL)</th>
                <th className="text-right">Khối lượng</th>
                <th className="text-right">Dòng</th>
                <th className="text-left">Mã kho</th>
                <th className="text-left">Nguồn</th>
                {canEdit && <th className="text-center">Gắn mã</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={<ArrowLeftRight />} title="Không có cặp nào khớp bộ lọc" /></td></tr>
              ) : rows.map(r => (
                <tr key={r.key} style={{ background: !r.via ? '#fef2f2' : r.gradeMismatch ? '#fffbeb' : undefined }}>
                  <td className="font-mono text-xs">{r.grade}</td>
                  <td className="font-mono text-xs">{r.profile}</td>
                  <td className="text-right font-mono text-xs">{formatNumber(Math.round(r.weightKg))} kg</td>
                  <td className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>{formatNumber(r.lines)}</td>
                  <td className="text-xs">
                    {r.materialCode
                      ? <><span className="font-mono font-bold" style={{ color: '#4338ca' }}>{r.materialCode}</span>
                          <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.materialName}</span></>
                      : <span style={{ color: '#dc2626', fontWeight: 600 }}>chưa có mã</span>}
                  </td>
                  <td className="text-xs">
                    {r.via === 'alias' ? <span style={{ color: '#047857', fontWeight: 700 }}>chỉ tay</span>
                      : r.via === 'rule' ? <span style={{ color: 'var(--text-muted)' }}>luật{r.gradeMismatch ? ' · lệch mác' : ''}</span>
                      : r.via === 'history' ? <span style={{ color: '#0369a1', fontWeight: 600 }}>PR/BOM cũ</span>
                      : <span style={{ color: '#dc2626' }}>—</span>}
                    {r.candidates.length > 1 && <span className="block text-[11px]" style={{ color: '#b45309' }}>{r.candidates.length} ứng viên</span>}
                  </td>
                  {canEdit && (
                    <td className="text-center">
                      {editKey === r.key ? (
                        <div style={{ minWidth: 320, textAlign: 'left' }}>
                          <input autoFocus className="input-field text-xs w-full" value={search} onChange={e => setSearch(e.target.value)} placeholder="Gõ tên hoặc mã vật tư…" />
                          <div style={{ maxHeight: 190, overflow: 'auto', marginTop: 4, border: '1px solid var(--border)', borderRadius: 6 }}>
                            {found.length === 0 && <div className="p-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>Gõ ít nhất 2 ký tự…</div>}
                            {found.map(m => (
                              <button key={m.id} type="button" disabled={saving} onClick={() => bind(r, m.id)}
                                className="w-full text-left p-1.5 text-[11px] hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border)' }}>
                                <b className="font-mono">{m.materialCode}</b> — {m.name}
                              </button>
                            ))}
                          </div>
                          <Button variant="outline" onClick={() => { setEditKey(null); setFound([]) }}>Đóng</Button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <Button variant="outline" onClick={() => openPicker(r)}>{r.via === 'alias' ? 'Đổi' : 'Gắn'}</Button>
                          {r.via === 'alias' && <Button variant="outline" onClick={() => unbind(r)}>Bỏ</Button>}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
