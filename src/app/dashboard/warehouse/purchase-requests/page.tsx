'use client'

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, Button, Modal, InputField, SelectField } from '@/components/ui'
import { notify } from '@/components/ui/Toast'
import { formatNumber } from '@/lib/utils'

// Lưới VẬT TƯ phẳng (item-centric) — mọi dòng PR của nhiều dự án trên 1 bảng cuộn ngang, gộp theo nhóm VT.
// (Khớp trang /mua-hang của Commerce.)
interface Row {
  id: string; projectCode: string; projectId: string | null; prCode: string; revNo: number; prStatus: string
  itemCode: string; matCode: string; description: string; profile: string; grade: string; uom: string
  qty: number; weightTon: number; toBuyQty: number; groupCode: string; groupLabel: string
}
interface Summary { totalItems: number; totalWeightTon: number; groupCount: number; projectCount: number; revCount: number; projects: Array<{ code: string; count: number }> }

const PR_ST: Record<string, { l: string; bg: string; tx: string }> = {
  DRAFT: { l: 'Nháp', bg: '#f1f5f9', tx: '#64748b' }, PENDING: { l: 'Chờ duyệt', bg: '#fffbeb', tx: '#b45309' },
  APPROVED: { l: 'Đã duyệt', bg: '#ecfdf5', tx: '#166534' }, REJECTED: { l: 'Từ chối', bg: '#fef2f2', tx: '#dc2626' },
}
const COLS: Array<{ k: string; label: string; w: number; num?: boolean }> = [
  { k: 'projectCode', label: 'Dự án', w: 120 },
  { k: 'itemCode', label: 'Item / STT', w: 110 },
  { k: 'matCode', label: 'Mã kho', w: 130 },
  { k: 'description', label: 'Description / Chi tiết', w: 200 },
  { k: 'profile', label: 'Profile / Vật tư', w: 200 },
  { k: 'grade', label: 'Grade / Mác', w: 170 },
  { k: 'uom', label: 'ĐVT', w: 60 },
  { k: 'qty', label: 'SL', w: 90, num: true },
  { k: 'weightTon', label: 'Tấn', w: 90, num: true },
  { k: 'toBuyQty', label: 'Cần mua', w: 90, num: true },
  { k: 'revNo', label: 'Rev', w: 60, num: true },
  { k: 'prCode', label: 'Mã PR', w: 110 },
  { k: 'prStatus', label: 'TT PR', w: 100 },
]

export default function PurchaseRequestGridPage() {
  const router = useRouter()
  const roleCode = useAuthStore(s => s.user?.roleCode)
  const canCreate = ['R01', 'R03', 'R03a', 'R04', 'R04a', 'R07', 'R07a', 'R10'].includes(roleCode || '')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [statusF, setStatusF] = useState('')
  const [search, setSearch] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; projectCode: string; projectName: string }>>([])
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (projectId) qs.set('projectId', projectId)
    if (statusF) qs.set('status', statusF)
    const r = await apiFetch(`/api/procurement/pr-items?${qs}`)
    setLoading(false)
    if (r.ok) { setRows(r.rows || []); setSummary(r.summary || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [projectId, statusF])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => [r.itemCode, r.matCode, r.description, r.profile, r.grade, r.prCode].some(v => (v || '').toLowerCase().includes(q))) : rows
  }, [rows, search])

  // Gộp theo nhóm vật tư (giữ thứ tự nhóm xuất hiện).
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: Row[] }>()
    for (const r of shown) {
      if (!m.has(r.groupCode)) m.set(r.groupCode, { label: r.groupLabel, items: [] })
      m.get(r.groupCode)!.items.push(r)
    }
    return [...m.entries()]
  }, [shown])

  const fmtTon = (n: number) => n ? n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : ''
  const cell = (r: Row, k: string) => {
    if (k === 'weightTon') return fmtTon(r.weightTon)
    if (k === 'qty' || k === 'toBuyQty') return r[k] ? formatNumber(r[k as 'qty']) : ''
    if (k === 'revNo') return `R${r.revNo}`
    if (k === 'prStatus') { const s = PR_ST[r.prStatus] || PR_ST.DRAFT; return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: s.bg, color: s.tx }}>{s.l}</span> }
    return (r as unknown as Record<string, string>)[k] || (['description', 'profile', 'grade'].includes(k) ? '' : '—')
  }
  const minW = COLS.reduce((s, c) => s + c.w, 0)

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Yêu cầu mua (PR)" subtitle="Lưới vật tư — toàn bộ dòng PR của các dự án, gộp theo nhóm vật tư" />
        <div className="flex gap-2">
          {canCreate && <Button variant="outline" onClick={() => setShowImport(true)}>⬆ Nhập PR (Excel)</Button>}
          {canCreate && <Button variant="primary" onClick={() => router.push('/dashboard/warehouse/purchase-requests/new')}>+ Tạo PR</Button>}
        </div>
      </div>

      {/* Thanh tổng hợp + chip dự án */}
      {summary && (
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs" style={{ color: 'var(--text-muted)' }}>
          <span><b style={{ color: 'var(--text-primary)' }}>{formatNumber(summary.totalItems)}</b> mã vật tư</span>
          <span><b style={{ color: 'var(--text-primary)' }}>{fmtTon(summary.totalWeightTon)}</b> tấn</span>
          <span><b style={{ color: 'var(--text-primary)' }}>{summary.groupCount}</b> nhóm</span>
          <span><b style={{ color: 'var(--text-primary)' }}>{summary.projectCount}</b> dự án</span>
          <span><b style={{ color: 'var(--text-primary)' }}>{summary.revCount}</b> phiên bản PR</span>
          <span className="flex gap-1.5 flex-wrap">
            {summary.projects.slice(0, 8).map(p => (
              <button key={p.code} onClick={() => setProjectId(projects.find(x => x.projectCode === p.code)?.id || '')}
                className="px-2 py-0.5 rounded-full text-[11px] font-mono" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--accent)' }}>{p.code} <b>{p.count}</b></button>
            ))}
          </span>
        </div>
      )}

      {/* Bộ lọc */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 260 }}>
          <option value="">— Tất cả dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
        </select>
        <select value={statusF} onChange={e => setStatusF(e.target.value)} className="input text-sm">
          <option value="">Mọi trạng thái</option><option value="DRAFT">Nháp</option><option value="PENDING">Chờ duyệt</option><option value="APPROVED">Đã duyệt</option><option value="REJECTED">Từ chối</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mã / mã kho / mô tả / profile / mã PR…" className="input text-sm" style={{ maxWidth: 320 }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{shown.length} dòng</span>
      </div>

      {loading ? <div className="text-center py-16 text-slate-400 text-sm">Đang tải lưới vật tư…</div>
        : shown.length === 0 ? <div className="text-center py-16 text-slate-400 text-sm">Không có dòng vật tư PR nào.</div>
          : (
            <div className="card p-0 overflow-hidden">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: minW, fontSize: '.72rem', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: '#c7e2ef', position: 'sticky', top: 0, zIndex: 2 }}>
                      {COLS.map(c => <th key={c.k} style={{ width: c.w, minWidth: c.w, padding: '8px 10px', textAlign: c.num ? 'right' : 'left', borderBottom: '1px solid var(--border)', fontWeight: 700, color: '#12212e' }}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([code, g]) => (
                      <Fragment key={code}>
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <td colSpan={COLS.length} style={{ padding: '5px 10px', fontWeight: 700, color: 'var(--text-secondary)', borderTop: '1px solid var(--border)' }}>
                            {g.label || code} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— {g.items.length} mã · {fmtTon(g.items.reduce((s, x) => s + x.weightTon, 0))} tấn</span>
                          </td>
                        </tr>
                        {g.items.map(r => (
                          <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                            {COLS.map(c => (
                              <td key={c.k} style={{ padding: '5px 10px', textAlign: c.num ? 'right' : 'left', fontFamily: ['matCode', 'itemCode', 'qty', 'weightTon', 'toBuyQty', 'prCode'].includes(c.k) ? 'monospace' : undefined, color: c.k === 'matCode' || c.k === 'prCode' ? 'var(--accent)' : c.k === 'grade' ? '#166534' : undefined, maxWidth: c.w, overflow: 'hidden', textOverflow: 'ellipsis' }} title={typeof cell(r, c.k) === 'string' ? String(cell(r, c.k)) : ''}>
                                {cell(r, c.k)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Duyệt PR & giữ tồn ở <Link href="/dashboard/warehouse/kiem-tra-ton-kho" className="underline" style={{ color: 'var(--accent)' }}>Kiểm tra tồn kho</Link> · tách RFQ ở <Link href="/dashboard/warehouse/bidding" className="underline" style={{ color: 'var(--accent)' }}>Báo giá</Link>.
      </div>

      {showImport && <ImportPrModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load() }} />}
    </div>
  )
}

// Modal nhập PR từ Excel: chọn dự án + mã PR (tùy chọn) + file → tạo 1 PR + nhiều dòng vật tư.
function ImportPrModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [projects, setProjects] = useState<Array<{ id: string; projectCode: string; projectName: string }>>([])
  const [projectId, setProjectId] = useState('')
  const [prCode, setPrCode] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const submit = async () => {
    if (!projectId) return notify('Chọn dự án', 'error')
    if (!file) return notify('Chọn file Excel', 'error')
    setBusy(true)
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const pick = (r: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) if (r[k] !== undefined && r[k] !== '') return r[k]; return '' }
      const rows = raw.map(r => ({
        itemCode: pick(r, 'Mã VT', 'Mã', 'itemCode'), matCode: pick(r, 'Mã kho', 'matCode'), description: pick(r, 'Mô tả', 'Tên vật tư', 'description'),
        profile: pick(r, 'Quy cách', 'Profile', 'profile'), grade: pick(r, 'Mác', 'Grade', 'grade'), unit: pick(r, 'ĐVT', 'unit'),
        materialGroupCode: pick(r, 'Nhóm', 'materialGroupCode'), materialSubGroupCode: pick(r, 'Nhóm con', 'materialSubGroupCode'),
        unitWeight: pick(r, 'U.KL', 'unitWeight'), netQty: pick(r, 'Net SL', 'netQty'), reqQty: pick(r, 'SL', 'Số lượng', 'reqQty', 'quantity'),
        remainQty: pick(r, 'Tồn', 'remainQty'),
      }))
      if (rows.length === 0) { notify('File không có dòng nào', 'error'); setBusy(false); return }
      const res = await apiFetch('/api/purchase-requests/import', { method: 'POST', body: JSON.stringify({ projectId, prCode: prCode.trim() || undefined, rows }) })
      setBusy(false)
      if (res.ok) { notify(res.message || 'Đã nhập PR', 'success'); onDone() } else notify(res.error || 'Lỗi nhập', 'error')
    } catch (e) { console.error(e); setBusy(false); notify('Không đọc được file Excel', 'error') }
  }

  return (
    <Modal open onClose={onClose} title="Nhập PR từ Excel" size="md" actions={<Button variant="primary" onClick={submit} loading={busy}>Nhập</Button>}>
      <div className="space-y-3">
        <SelectField label="Dự án *" value={projectId} onChange={e => setProjectId(e.target.value)}
          options={[{ value: '', label: '— Chọn dự án —' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
        <InputField label="Mã PR (để trống → tự sinh)" value={prCode} onChange={e => setPrCode(e.target.value)} placeholder="VD: PR-090-01" />
        <div>
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>File Excel *</label>
          <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs block mt-1" />
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Cột: Mã VT · Mã kho · Mô tả · Quy cách · Mác · ĐVT · SL · Tồn …</div>
        </div>
      </div>
    </Modal>
  )
}
