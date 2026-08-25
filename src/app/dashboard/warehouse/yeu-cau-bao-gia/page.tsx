'use client'

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatNumber, formatDate } from '@/lib/utils'

// Màn "Yêu cầu báo giá" — lưới vật tư cần hỏi giá + cột NCC ĐỀ XUẤT (khớp Commerce).
interface Row {
  id: string; projectCode: string; projectId: string | null; prCode: string
  itemCode: string; matCode: string; description: string; profile: string; grade: string; uom: string
  reqQty: number; requiredDate: string | null
  groupCode: string; groupLabel: string; subGroup: string | null; noSubGroup: boolean
  suggestedVendors: string[]; suggestedMore: number
}
interface Summary { total: number; withRequiredDate: number; withSuggestion: number; noSubGroup: number; groups: Array<{ code: string; label: string; count: number }> }
type Tab = 'need' | 'asking' | 'received'

const COLS: Array<{ k: string; label: string; w: number; num?: boolean }> = [
  { k: 'projectCode', label: 'Dự án', w: 120 },
  { k: 'prCode', label: 'Mã dòng PR', w: 110 },
  { k: 'matCode', label: 'Mã kho', w: 120 },
  { k: 'description', label: 'Tên vật tư', w: 180 },
  { k: 'profile', label: 'Quy cách', w: 190 },
  { k: 'grade', label: 'Mác', w: 150 },
  { k: 'uom', label: 'ĐVT', w: 55 },
  { k: 'reqQty', label: 'Cần mua', w: 90, num: true },
  { k: 'requiredDate', label: 'Ngày cần', w: 100 },
]

export default function YeuCauBaoGiaPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('need')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [group, setGroup] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [projects, setProjects] = useState<Array<{ id: string; projectCode: string }>>([])

  const load = useCallback(async () => {
    setLoading(true); setPicked(new Set())
    const qs = new URLSearchParams({ tab })
    if (projectId) qs.set('projectId', projectId)
    if (group) qs.set('group', group)
    const r = await apiFetch(`/api/procurement/rfq-items?${qs}`)
    setLoading(false)
    if (r.ok) { setRows(r.rows || []); setSummary(r.summary || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [tab, projectId, group])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => [r.itemCode, r.matCode, r.description, r.profile, r.grade, r.prCode].some(v => (v || '').toLowerCase().includes(q))) : rows
  }, [rows, search])

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const createRfq = async () => {
    const sel = shown.filter(r => picked.has(r.id))
    if (sel.length === 0) return notify('Chọn ít nhất 1 dòng', 'error')
    const projIds = [...new Set(sel.map(s => s.projectId))]
    if (projIds.length > 1) return notify('Chỉ tạo RFQ cho các dòng CÙNG 1 dự án — lọc theo dự án trước', 'error')
    if (!await confirmDialog(`Tạo RFQ từ ${sel.length} dòng đã chọn?`)) return
    const r = await apiFetch('/api/procurement/bid-analyses/from-pr', { method: 'POST', body: JSON.stringify({ projectId: projIds[0], prItemIds: sel.map(s => s.id) }) })
    if (r.ok) { notify(`Đã tạo ${r.bidCode}`, 'success'); router.push('/dashboard/warehouse/bidding') } else notify(r.error || 'Lỗi tạo RFQ', 'error')
  }

  const minW = COLS.reduce((s, c) => s + c.w, 0) + 40 + 220
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: Row[] }>()
    for (const r of shown) { if (!m.has(r.groupCode)) m.set(r.groupCode, { label: r.groupLabel, items: [] }); m.get(r.groupCode)!.items.push(r) }
    return [...m.entries()]
  }, [shown])

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Yêu cầu báo giá" subtitle="Lưới vật tư cần hỏi giá → gợi ý NCC theo lịch sử mua & họ vật tư → tạo RFQ" />
        {picked.size > 0 && <Button variant="primary" onClick={createRfq}>Tạo RFQ ({picked.size} dòng)</Button>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
        {([['need', '📝 Cần hỏi giá'], ['asking', '📤 Đang hỏi giá'], ['received', '📥 Đã nhận báo giá']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="text-sm px-4 py-2 font-semibold" style={{ borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent', color: tab === k ? 'var(--accent)' : 'var(--text-muted)' }}>{l}</button>
        ))}
      </div>

      {/* Tổng hợp */}
      {summary && (
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs" style={{ color: 'var(--text-muted)' }}>
          <span><b style={{ color: 'var(--text-primary)' }}>{summary.total}</b> dòng</span>
          <span><b style={{ color: '#166534' }}>{summary.withSuggestion}</b> có gợi ý NCC</span>
          <span><b style={{ color: '#b45309' }}>{summary.withRequiredDate}</b> có ngày cần</span>
          {summary.noSubGroup > 0 && <span style={{ color: 'var(--warning)' }}>{summary.noSubGroup} dòng chưa phân họ → không gợi ý được NCC</span>}
        </div>
      )}

      {/* Chip nhóm vật tư */}
      {summary && summary.groups.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setGroup('')} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: group === '' ? 'var(--accent)' : 'var(--surface)', color: group === '' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>Tất cả {summary.total}</button>
          {summary.groups.map(g => (
            <button key={g.code} onClick={() => setGroup(g.code)} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: group === g.code ? 'var(--accent)' : 'var(--surface)', color: group === g.code ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>{g.label} {g.count}</button>
          ))}
        </div>
      )}

      {/* Lọc */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 240 }}>
          <option value="">— Tất cả dự án —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mã, tên, quy cách, dự án…" className="input text-sm" style={{ maxWidth: 300 }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{shown.length} dòng</span>
      </div>

      {loading ? <div className="text-center py-16 text-slate-400 text-sm">Đang tải…</div>
        : shown.length === 0 ? <div className="text-center py-16 text-slate-400 text-sm">Không có dòng nào ở tab này.</div>
          : (
            <div className="card p-0 overflow-hidden">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: minW, fontSize: '.72rem', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: '#1e3a5f', color: '#fff', position: 'sticky', top: 0, zIndex: 2 }}>
                      <th style={{ width: 40, padding: '8px 8px' }}></th>
                      {COLS.map(c => <th key={c.k} style={{ width: c.w, minWidth: c.w, padding: '8px 10px', textAlign: c.num ? 'right' : 'left', fontWeight: 700 }}>{c.label}</th>)}
                      <th style={{ width: 220, minWidth: 220, padding: '8px 10px', textAlign: 'left', fontWeight: 700 }}>NCC đề xuất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([code, g]) => (
                      <Fragment key={code}>
                        {summary && summary.groups.length > 1 && (
                          <tr style={{ background: 'var(--bg-secondary)' }}><td colSpan={COLS.length + 2} style={{ padding: '5px 10px', fontWeight: 700, color: 'var(--text-secondary)' }}>{g.label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {g.items.length} dòng</span></td></tr>
                        )}
                        {g.items.map(r => (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--border)', background: picked.has(r.id) ? '#eff6ff' : undefined }}>
                            <td style={{ padding: '5px 8px', textAlign: 'center' }}><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                            {COLS.map(c => {
                              let v: React.ReactNode = (r as unknown as Record<string, string>)[c.k] || (['description', 'profile', 'grade'].includes(c.k) ? '' : '—')
                              if (c.k === 'reqQty') v = r.reqQty ? formatNumber(r.reqQty) : ''
                              if (c.k === 'requiredDate') v = r.requiredDate ? formatDate(r.requiredDate) : '—'
                              return <td key={c.k} style={{ padding: '5px 10px', textAlign: c.num ? 'right' : 'left', fontFamily: ['matCode', 'prCode', 'reqQty'].includes(c.k) ? 'monospace' : undefined, color: c.k === 'matCode' ? 'var(--accent)' : c.k === 'grade' ? '#166534' : undefined, maxWidth: c.w, overflow: 'hidden', textOverflow: 'ellipsis' }} title={typeof v === 'string' ? v : ''}>{v}</td>
                            })}
                            <td style={{ padding: '5px 10px' }}>
                              {r.suggestedVendors.length === 0
                                ? <span style={{ color: 'var(--text-muted)' }}>{r.noSubGroup ? 'chưa phân họ' : '—'}</span>
                                : <span className="flex gap-1 flex-wrap items-center">
                                    {r.suggestedVendors.map((v, i) => <span key={i} className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--surface-hover)', color: 'var(--accent)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>)}
                                    {r.suggestedMore > 0 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>+{r.suggestedMore}</span>}
                                  </span>}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
    </div>
  )
}
