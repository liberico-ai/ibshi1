'use client'

import { useEffect, useState, useCallback, Fragment, type CSSProperties } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'
import { formatNumber, formatDate } from '@/lib/utils'

// [PORT Thương Mại] Theo dõi mua hàng (Master Tracking): PR ↔ tồn ↔ mua DOM/IMP ↔ QC ↔ so sánh.
interface Proj { id: string; projectCode: string; projectName: string }
interface Grp {
  contractNo: string; vendor: string; signedDate: string | null; spec: string; qty: number; weight: number; unitPrice: number; total: number; currency: string
  deliveredQty: number; deliveredWeight: number; handoverDate: string | null
  exportPort: string | null; lcDate: string | null; cifDate: string | null; paymentDate: string | null; customsDate: string | null; arrivedDate: string | null; qcInvitationDate: string | null
  qcReportNo: string; qcDate: string | null; qcAcceptedQty: number; qcAcceptedWeight: number; qcResult: string
}
interface Row {
  id: string; prCode: string | null; groupCode: string; itemCode: string | null; matCode: string | null; matCodeSource: string | null; description: string | null
  profile: string | null; grade: string | null; unit: string | null; unitWeight: number
  netQty: number; netWeight: number; reqQty: number; reqWeight: number; remainQty: number; remainWeight: number; toBuyQty: number; toBuyWeight: number
  statusFlag: string | null; dom: Grp; imp: Grp; boughtQty: number; boughtWeight: number; diffQty: number; diffWeight: number; ket: string
}

const nn = (v: number) => (v ? formatNumber(v) : '')
const dt = (s: string | null) => (s ? formatDate(s) : '')
const KET: Record<string, { label: string; bg: string; tx: string }> = {
  DU: { label: 'Đủ', bg: '#dcfce7', tx: '#166534' }, THIEU: { label: 'Thiếu', bg: '#fef2f2', tx: '#dc2626' }, THUA: { label: 'Thừa', bg: '#fef9c3', tx: '#854d0e' },
}

// Cấu hình 12 cụm cột. mỗi cột: header + hàm lấy giá trị (trả chuỗi/JSX).
type Col = { h: string; w?: number; r?: boolean; get: (row: Row) => React.ReactNode }
type Group = { key: string; label: string; bg: string; cols: Col[] }
const GROUPS: Group[] = [
  { key: 'info', label: 'Thông tin vật tư', bg: '#e2e8f0', cols: [
    { h: 'Phiếu', w: 90, get: r => r.prCode || '' },
    { h: 'Mã kho', w: 110, get: r => r.matCode ? <span title={r.matCodeSource || ''}>{r.matCode}{r.matCodeSource === 'NOI_MAY_CHUA_DUYET' ? ' ~' : ''}</span> : '' },
    { h: 'Mã VT', w: 110, get: r => <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{r.itemCode || ''}</span> },
    { h: 'Mô tả', w: 200, get: r => r.description || '' },
    { h: 'Quy cách', w: 120, get: r => r.profile || '' },
    { h: 'Mác', w: 70, get: r => r.grade || '' },
    { h: 'ĐVT', w: 44, get: r => r.unit || '' },
    { h: 'U.KL', w: 60, r: true, get: r => nn(r.unitWeight) },
  ] },
  { key: 'net', label: 'Net (tinh)', bg: '#dbeafe', cols: [
    { h: 'SL', w: 66, r: true, get: r => nn(r.netQty) }, { h: 'KL', w: 70, r: true, get: r => nn(r.netWeight) },
  ] },
  { key: 'ton', label: 'Tận dụng tồn', bg: '#e0e7ff', cols: [
    { h: 'SL', w: 66, r: true, get: r => nn(r.remainQty) }, { h: 'KL', w: 70, r: true, get: r => nn(r.remainWeight) },
  ] },
  { key: 'canmua', label: 'KL phải mua', bg: '#fef3c7', cols: [
    { h: 'SL', w: 66, r: true, get: r => <b>{nn(r.toBuyQty)}</b> }, { h: 'KL', w: 70, r: true, get: r => <b>{nn(r.toBuyWeight)}</b> },
  ] },
  { key: 'dom', label: 'Vật tư trong nước (DOM)', bg: '#dcfce7', cols: [
    { h: 'Số HĐ', w: 120, get: r => r.dom.contractNo ? <a href="/dashboard/warehouse/hop-dong" style={{ color: 'var(--accent)' }}>{r.dom.contractNo}</a> : '' },
    { h: 'NCC', w: 130, get: r => r.dom.vendor },
    { h: 'Spec HĐ', w: 110, get: r => r.dom.spec },
    { h: 'SL', w: 66, r: true, get: r => nn(r.dom.qty) }, { h: 'KL', w: 70, r: true, get: r => nn(r.dom.weight) },
    { h: 'Ngày ký', w: 84, get: r => dt(r.dom.signedDate) },
    { h: 'Đơn giá', w: 90, r: true, get: r => nn(r.dom.unitPrice) },
    { h: 'Tổng noVAT', w: 100, r: true, get: r => <span style={{ color: '#166534' }}>{nn(r.dom.total)}</span> },
  ] },
  { key: 'domdel', label: 'Đã mua DOM', bg: '#bbf7d0', cols: [
    { h: 'SL giao', w: 70, r: true, get: r => nn(r.dom.deliveredQty) }, { h: 'KL giao', w: 72, r: true, get: r => nn(r.dom.deliveredWeight) },
  ] },
  { key: 'domqc', label: 'QC trong nước', bg: '#a7f3d0', cols: [
    { h: 'Report', w: 90, get: r => r.dom.qcReportNo }, { h: 'Ngày', w: 84, get: r => dt(r.dom.qcDate) },
    { h: 'KL Acc', w: 72, r: true, get: r => nn(r.dom.qcAcceptedWeight) }, { h: 'KQ', w: 70, get: r => r.dom.qcResult },
  ] },
  { key: 'imp', label: 'Mua sắm nước ngoài (IMP)', bg: '#e0e7ff', cols: [
    { h: 'Số HĐ', w: 120, get: r => r.imp.contractNo ? <a href="/dashboard/warehouse/hop-dong" style={{ color: 'var(--accent)' }}>{r.imp.contractNo}</a> : '' },
    { h: 'NCC', w: 130, get: r => r.imp.vendor },
    { h: 'SL', w: 66, r: true, get: r => nn(r.imp.qty) }, { h: 'KL', w: 70, r: true, get: r => nn(r.imp.weight) },
    { h: 'Ngày ký', w: 84, get: r => dt(r.imp.signedDate) },
    { h: 'Đơn giá', w: 84, r: true, get: r => r.imp.unitPrice ? `${nn(r.imp.unitPrice)} ${r.imp.currency}` : '' },
    { h: 'Tổng', w: 90, r: true, get: r => nn(r.imp.total) },
    { h: 'Ngày L/C', w: 84, get: r => dt(r.imp.lcDate) },
    { h: 'Cảng xuất', w: 90, get: r => r.imp.exportPort || '' },
    { h: 'CIF', w: 84, get: r => dt(r.imp.cifDate) },
    { h: 'Ngày TT', w: 84, get: r => dt(r.imp.paymentDate) },
    { h: 'Hải quan', w: 84, get: r => dt(r.imp.customsDate) },
    { h: 'Hàng về', w: 84, get: r => dt(r.imp.arrivedDate) },
    { h: 'Mời QC', w: 84, get: r => dt(r.imp.qcInvitationDate) },
  ] },
  { key: 'impdel', label: 'Đã mua IMP + QC', bg: '#c7d2fe', cols: [
    { h: 'SL giao', w: 70, r: true, get: r => nn(r.imp.deliveredQty) }, { h: 'Report', w: 90, get: r => r.imp.qcReportNo }, { h: 'KQ', w: 70, get: r => r.imp.qcResult },
  ] },
  { key: 'tong', label: 'Tổng đã mua & So sánh', bg: '#fed7aa', cols: [
    { h: 'ĐM SL', w: 70, r: true, get: r => <b>{nn(r.boughtQty)}</b> }, { h: 'ĐM KL', w: 72, r: true, get: r => <b>{nn(r.boughtWeight)}</b> },
    { h: 'Chênh SL', w: 76, r: true, get: r => <span style={{ color: r.diffQty > 0.001 ? '#dc2626' : r.diffQty < -0.001 ? '#854d0e' : '#166534' }}>{nn(r.diffQty)}</span> },
    { h: 'KQ Mua', w: 66, get: r => { const k = KET[r.ket]; return <span style={{ background: k.bg, color: k.tx, padding: '1px 6px', borderRadius: 999, fontWeight: 700, fontSize: 10 }}>{k.label}</span> } },
  ] },
]

export default function TheoDoiMuaHangPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<{ total: number; thieu: number; du: number; thua: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(100)

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])
  const load = useCallback(async () => {
    if (!projectId) { setRows([]); setSummary(null); return }
    setLoading(true); setLimit(100)
    const r = await apiFetch(`/api/procurement/master-tracking?projectId=${projectId}`)
    setLoading(false)
    if (r.ok) { setRows(r.rows || []); setSummary(r.summary || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [projectId])
  useEffect(() => { load() }, [load])

  const toggleGrp = (k: string) => setCollapsed(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })
  const filtered = rows.filter(r => {
    const q = search.trim().toLowerCase(); if (!q) return true
    return `${r.itemCode || ''} ${r.matCode || ''} ${r.description || ''} ${r.profile || ''} ${r.dom.contractNo} ${r.imp.contractNo}`.toLowerCase().includes(q)
  })
  const shown = filtered.slice(0, limit)
  const visGroups = GROUPS.map(g => ({ ...g, open: !collapsed.has(g.key) }))

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Theo dõi mua hàng" subtitle="Bảng tổng hợp: PR → tận dụng tồn → đã mua (trong nước / nhập khẩu) → QC → so sánh với yêu cầu" />

      <div className="flex items-center gap-3 flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 360 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {rows.length > 0 && <input value={search} onChange={e => { setSearch(e.target.value); setLimit(100) }} placeholder="Tìm mã VT / mã kho / số HĐ…" className="input text-sm" style={{ maxWidth: 260 }} />}
        {summary && (
          <div className="flex gap-3 text-xs">
            <span>Tổng: <b>{summary.total}</b></span>
            <span style={{ color: '#166534' }}>Đủ: <b>{summary.du}</b></span>
            <span style={{ color: '#dc2626' }}>Thiếu: <b>{summary.thieu}</b></span>
            <span style={{ color: '#854d0e' }}>Thừa: <b>{summary.thua}</b></span>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex gap-1.5 flex-wrap items-center text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>Cụm cột:</span>
          {GROUPS.map(g => (
            <button key={g.key} onClick={() => toggleGrp(g.key)} className="px-2 py-0.5 rounded font-medium" style={{ background: collapsed.has(g.key) ? 'var(--surface)' : g.bg, color: 'var(--text-secondary)', border: '1px solid var(--border)', opacity: collapsed.has(g.key) ? 0.5 : 1 }}>
              {collapsed.has(g.key) ? '+ ' : '− '}{g.label}
            </button>
          ))}
        </div>
      )}

      {!projectId && <div className="text-center py-16 text-slate-400 text-sm">Chọn dự án để xem bảng theo dõi mua hàng.</div>}
      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>}

      {projectId && !loading && rows.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Dự án chưa có vật tư PR nào.</div>}

      {shown.length > 0 && (
        <div className="card p-0" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', width: 'max-content', fontSize: '0.7rem' }}>
              <thead>
                <tr>
                  {visGroups.map(g => g.open
                    ? <th key={g.key} colSpan={g.cols.length} style={{ ...gh, background: g.bg }}>{g.label}</th>
                    : <th key={g.key} style={{ ...gh, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => toggleGrp(g.key)} title="Bấm để mở">+ {g.label}</th>)}
                </tr>
                <tr>
                  {visGroups.map(g => g.open
                    ? g.cols.map((c, i) => <th key={g.key + i} style={{ ...ch, width: c.w, textAlign: c.r ? 'right' : 'left', borderLeft: i === 0 ? '2px solid #94a3b8' : undefined }}>{c.h}</th>)
                    : <th key={g.key} style={{ ...ch, borderLeft: '2px solid #94a3b8' }} />)}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    {visGroups.map(g => g.open
                      ? g.cols.map((c, i) => <td key={g.key + i} style={{ ...td, textAlign: c.r ? 'right' : 'left', borderLeft: i === 0 ? '2px solid #cbd5e1' : undefined, fontFamily: c.r ? 'monospace' : undefined }}>{c.get(r)}</td>)
                      : <td key={g.key} style={{ ...td, borderLeft: '2px solid #cbd5e1', textAlign: 'center', color: 'var(--text-muted)' }}>···</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > limit && (
            <div className="text-center py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setLimit(l => l + 200)} className="text-xs px-4 py-1 rounded-lg font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--accent)' }}>Xem thêm ({filtered.length - limit} dòng)</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const gh: CSSProperties = { padding: '4px 8px', textAlign: 'center', border: '1px solid #b7c9d4', fontWeight: 700, color: '#1f3a4d', fontSize: '0.68rem', position: 'sticky', top: 0 }
const ch: CSSProperties = { padding: '3px 6px', border: '1px solid #cbd5e1', fontWeight: 600, color: '#334155', background: '#f1f5f9', fontSize: '0.64rem' }
const td: CSSProperties = { padding: '2px 6px', border: '1px solid var(--border)', verticalAlign: 'middle' }
