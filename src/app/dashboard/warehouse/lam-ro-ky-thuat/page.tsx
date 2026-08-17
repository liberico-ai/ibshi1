'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'
import { X, MessageSquare, Search, Send, ArrowRightLeft, History } from 'lucide-react'
import PurchaseHistoryPanel from '@/components/PurchaseHistoryPanel'

// [PORT Thương Mại — F2] Làm rõ kỹ thuật: thread trao đổi kỹ thuật per dòng vật tư PR.
interface Comment { id: string; content: string; commentType: string; threadStatus: string | null; tags: string | null; authorId: string | null; authorName: string; authorRole: string; createdAt: string }
interface Row { prDetailId: string; itemCode: string; itemName: string; profile: string; grade: string; uom: string; reqQty: number; toBuyQty: number; urgency: string; commentCount: number; threadStatus: string; latestComment: Comment | null; comments: Comment[] }
interface Summary { total: number; pending: number; inDiscussion: number; clarified: number; substitutionRequested: number; approved: number; rejected: number; readyForRFQ: number }
interface PROpt { id: string; prCode: string; project?: { projectCode: string } | null }

const STATUS_CONFIG: Record<string, { label: string; cls: string; border: string }> = {
  PENDING: { label: 'Chưa làm rõ', cls: 'bg-slate-100 text-slate-500', border: 'border-slate-200' },
  IN_DISCUSSION: { label: 'Đang trao đổi', cls: 'bg-violet-100 text-violet-700', border: 'border-violet-300' },
  CLARIFIED: { label: 'Đã làm rõ', cls: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-300' },
  SUBSTITUTION_REQUESTED: { label: 'Xin chuyển đổi', cls: 'bg-amber-100 text-amber-700', border: 'border-amber-400' },
  APPROVED: { label: 'Đã duyệt', cls: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-400' },
  REJECTED: { label: 'Từ chối', cls: 'bg-red-100 text-red-600', border: 'border-red-300' },
}
const TYPE_LABELS: Record<string, string> = { QUESTION: 'Câu hỏi', ANSWER: 'Trả lời', SUBSTITUTION_REQUEST: 'Xin chuyển đổi', APPROVAL: 'Duyệt', REJECTION: 'Từ chối', NOTE: 'Ghi chú' }
const TYPE_COLORS: Record<string, string> = {
  QUESTION: 'bg-blue-50 text-blue-700 border-blue-200', ANSWER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SUBSTITUTION_REQUEST: 'bg-amber-50 text-amber-700 border-amber-200', APPROVAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTION: 'bg-red-50 text-red-700 border-red-200', NOTE: 'bg-slate-50 text-slate-600 border-slate-200',
}
const roleColor = (r: string) => (r === 'R01' ? 'bg-amber-600' : /R03/.test(r) ? 'bg-violet-600' : /R07/.test(r) ? 'bg-blue-600' : /R09/.test(r) ? 'bg-emerald-600' : /R04/.test(r) ? 'bg-fuchsia-600' : 'bg-slate-500')

function Avatar({ name, role }: { name: string; role?: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(-2).join('').toUpperCase()
  return <div className={`w-7 h-7 rounded-full ${roleColor(role || '')} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>{initials || '?'}</div>
}
function fmtDate(d: string) {
  const dt = new Date(d), diff = (Date.now() - dt.getTime()) / 1000
  if (diff < 60) return 'vừa xong'
  if (diff < 3600) return Math.floor(diff / 60) + ' phút trước'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h trước'
  return dt.toLocaleDateString('vi-VN')
}

// ── Panel thread (trượt phải) ──
function TechPanel({ row, onClose, onUpdated }: { row: Row; onClose: () => void; onUpdated: () => void }) {
  const [content, setContent] = useState('')
  const [commentType, setCommentType] = useState('NOTE')
  const [threadStatus, setThreadStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!content.trim()) return
    setBusy(true)
    const r = await apiFetch(`/api/procurement/tech-comments/${row.prDetailId}`, { method: 'POST', body: JSON.stringify({ content: content.trim(), commentType, threadStatus: threadStatus || undefined }) })
    setBusy(false)
    if (r.ok) { setContent(''); setCommentType('NOTE'); setThreadStatus(null); onUpdated() } else notify(r.error || 'Lỗi gửi', 'error')
  }
  const changeStatus = async (status: string, note?: string) => {
    const r = await apiFetch(`/api/procurement/tech-comments/${row.prDetailId}/status`, { method: 'PATCH', body: JSON.stringify({ threadStatus: status, note }) })
    if (r.ok) { notify('Đã cập nhật trạng thái', 'success'); onUpdated() } else notify(r.error || 'Lỗi', 'error')
  }
  const cfg = STATUS_CONFIG[row.threadStatus] || STATUS_CONFIG.PENDING

  return (
    <div className="fixed inset-0 z-[9990] flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[480px] max-w-full bg-white h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">Làm rõ kỹ thuật</div>
              <div className="font-semibold text-slate-900 truncate">{row.itemCode}</div>
              <div className="text-sm text-slate-600 truncate">{row.itemName}</div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                <span>YC: {row.reqQty.toLocaleString()} {row.uom}</span>
                <span>Mua: {row.toBuyQty.toLocaleString()} {row.uom}</span>
                {row.grade && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{row.grade}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2 py-1 rounded text-[11px] font-medium ${cfg.cls}`}>{cfg.label}</span>
              <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
          </div>
        </div>

        {row.threadStatus === 'SUBSTITUTION_REQUESTED' && (
          <div className="px-5 py-3 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-amber-600" />
            <span className="text-[11px] text-amber-700 flex-1 font-medium">Đang chờ duyệt chuyển đổi vật tư</span>
            <button onClick={() => changeStatus('APPROVED', 'Chuyển đổi vật tư được duyệt')} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-[11px] font-medium hover:bg-emerald-700">Duyệt</button>
            <button onClick={() => changeStatus('REJECTED', 'Yêu cầu chuyển đổi bị từ chối')} className="px-3 py-1.5 bg-red-500 text-white rounded text-[11px] font-medium hover:bg-red-600">Từ chối</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {row.comments.length === 0 && <div className="flex flex-col items-center justify-center py-10 text-slate-300 gap-2"><MessageSquare className="w-9 h-9" /><div className="text-[11px]">Chưa có trao đổi nào</div></div>}
          {row.comments.map(c => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.authorName} role={c.authorRole} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-slate-800">{c.authorName}</span>
                  <span className={`px-1.5 rounded border text-[10px] font-medium ${TYPE_COLORS[c.commentType] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{TYPE_LABELS[c.commentType] || c.commentType}</span>
                  <span className="text-[10px] text-slate-400 ml-auto">{fmtDate(c.createdAt)}</span>
                </div>
                <div className={`p-3 rounded-lg text-sm text-slate-700 ${(TYPE_COLORS[c.commentType] || 'bg-slate-50').split(' ')[0]}`}>{c.content}</div>
                {c.threadStatus && <div className="mt-1"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CONFIG[c.threadStatus]?.cls || 'bg-slate-100 text-slate-500'}`}>→ {STATUS_CONFIG[c.threadStatus]?.label || c.threadStatus}</span></div>}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {[
              { type: 'QUESTION', label: 'Hỏi kỹ thuật', status: 'IN_DISCUSSION' },
              { type: 'ANSWER', label: 'Trả lời', status: 'CLARIFIED' },
              { type: 'SUBSTITUTION_REQUEST', label: 'Xin chuyển đổi', status: 'SUBSTITUTION_REQUESTED' },
              { type: 'NOTE', label: 'Ghi chú', status: null },
            ].map(q => (
              <button key={q.type} onClick={() => { setCommentType(q.type); setThreadStatus(q.status) }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${commentType === q.type ? `${TYPE_COLORS[q.type]} border-current` : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{q.label}</button>
            ))}
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
            placeholder="Nhập nội dung trao đổi... (Ctrl+Enter để gửi)" rows={3}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          <div className="flex items-center justify-between">
            {threadStatus && <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_CONFIG[threadStatus]?.cls || 'bg-slate-100 text-slate-500'}`}>Chuyển → {STATUS_CONFIG[threadStatus]?.label}</span>}
            <div className="flex gap-2 ml-auto">
              {threadStatus && <button onClick={() => setThreadStatus(null)} className="text-[11px] text-slate-400 hover:text-slate-600 px-2 py-1">Bỏ chuyển trạng thái</button>}
              <button onClick={submit} disabled={!content.trim() || busy} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[11px] font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1"><Send className="w-3.5 h-3.5" />{busy ? 'Đang gửi...' : 'Gửi'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Thẻ SKU ──
function SkuCard({ row, onOpen, onOpenHistory, onQuickStatus }: { row: Row; onOpen: () => void; onOpenHistory: () => void; onQuickStatus: (s: string, n: string) => void }) {
  const cfg = STATUS_CONFIG[row.threadStatus] || STATUS_CONFIG.PENDING
  return (
    <div className={`bg-white rounded-xl border ${cfg.border} p-4 hover:shadow-sm transition-shadow`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{row.itemCode || '—'}</span>
            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${cfg.cls}`}>{cfg.label}</span>
            {row.urgency && row.urgency !== 'NORMAL' && <span className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-medium">{row.urgency}</span>}
          </div>
          <div className="text-sm text-slate-600 mt-0.5 truncate">{row.itemName}</div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
            {row.profile && <span>{row.profile}</span>}
            {row.grade && <span className="text-blue-600">{row.grade}</span>}
            <span>YC: {row.reqQty.toLocaleString()} {row.uom}</span>
            <span>Mua: {row.toBuyQty.toLocaleString()} {row.uom}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onOpenHistory} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600" title="Lịch sử mua hàng"><History className="w-4 h-4" /></button>
          <button onClick={onOpen} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600" title="Mở thread"><MessageSquare className="w-4 h-4" /></button>
        </div>
      </div>
      {row.latestComment && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-start gap-2">
            <Avatar name={row.latestComment.authorName} role={row.latestComment.authorRole} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-semibold text-slate-700">{row.latestComment.authorName}</span>
                <span className="text-[10px] text-slate-400">{fmtDate(row.latestComment.createdAt)}</span>
                <span className="ml-auto text-[11px] text-slate-400">{row.commentCount} tin</span>
              </div>
              <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">{row.latestComment.content}</div>
            </div>
          </div>
        </div>
      )}
      {row.threadStatus === 'SUBSTITUTION_REQUESTED' && (
        <div className="mt-3 pt-3 border-t border-amber-100 flex items-center gap-2">
          <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-[11px] text-amber-700 flex-1">Chờ duyệt chuyển đổi vật tư</span>
          <button onClick={() => onQuickStatus('APPROVED', 'Chuyển đổi vật tư được duyệt')} className="px-3 py-1 bg-emerald-600 text-white rounded text-[10px] font-medium hover:bg-emerald-700">Duyệt</button>
          <button onClick={() => onQuickStatus('REJECTED', 'Yêu cầu chuyển đổi bị từ chối')} className="px-3 py-1 bg-red-500 text-white rounded text-[10px] font-medium hover:bg-red-600">Từ chối</button>
        </div>
      )}
    </div>
  )
}

const FILTERS = [
  { id: 'ALL', label: 'Tất cả' }, { id: 'PENDING', label: 'Chưa làm rõ' }, { id: 'IN_DISCUSSION', label: 'Đang trao đổi' },
  { id: 'SUBSTITUTION_REQUESTED', label: 'Xin chuyển đổi' }, { id: 'CLARIFIED', label: 'Đã làm rõ' },
]

export default function LamRoKyThuatPage() {
  const sp = useSearchParams()
  const [prs, setPrs] = useState<PROpt[]>([])
  const [prId, setPrId] = useState(sp.get('prId') || '')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<Row | null>(null)
  const [historyItem, setHistoryItem] = useState<{ itemCode: string; itemName: string } | null>(null)

  useEffect(() => { apiFetch('/api/purchase-requests?limit=100').then(r => { if (r.ok) setPrs(r.purchaseRequests || []) }) }, [])

  const load = useCallback(async () => {
    if (!prId) { setRows([]); setSummary(null); return }
    setLoading(true)
    const r = await apiFetch(`/api/procurement/tech-comments?prId=${prId}`)
    setLoading(false)
    if (r.ok) { setRows(r.rows || []); setSummary(r.summary || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [prId])
  useEffect(() => { load() }, [load])

  // Đồng bộ lại panel đang mở sau khi reload
  const reloadAndSync = useCallback(async () => {
    if (!prId) return
    const r = await apiFetch(`/api/procurement/tech-comments?prId=${prId}`)
    if (r.ok) {
      setRows(r.rows || []); setSummary(r.summary || null)
      setPanel(p => p ? (r.rows || []).find((x: Row) => x.prDetailId === p.prDetailId) || null : null)
    }
  }, [prId])

  const quickStatus = async (prDetailId: string, status: string, note: string) => {
    const r = await apiFetch(`/api/procurement/tech-comments/${prDetailId}/status`, { method: 'PATCH', body: JSON.stringify({ threadStatus: status, note }) })
    if (r.ok) { notify('Đã cập nhật', 'success'); reloadAndSync() } else notify(r.error || 'Lỗi', 'error')
  }

  const filtered = rows.filter(r => {
    if (filterStatus !== 'ALL' && r.threadStatus !== filterStatus) return false
    if (search) { const s = search.toLowerCase(); return r.itemCode.toLowerCase().includes(s) || r.itemName.toLowerCase().includes(s) }
    return true
  })

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Làm rõ kỹ thuật" subtitle="Trao đổi kỹ thuật per dòng vật tư — hỏi/đáp, xin chuyển đổi, duyệt trước khi RFQ" />

      <div className="flex flex-wrap items-center gap-3">
        <select value={prId} onChange={e => setPrId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn phiếu yêu cầu (PR) —</option>
          {prs.map(p => <option key={p.id} value={p.id}>{p.prCode}{p.project?.projectCode ? ` — ${p.project.projectCode}` : ''}</option>)}
        </select>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-4">
          {[
            { label: 'Tổng SKU', value: summary.total, color: 'text-slate-800' },
            { label: 'Đã làm rõ', value: summary.clarified + summary.approved, color: 'text-emerald-600' },
            { label: 'Đang trao đổi', value: summary.inDiscussion, color: 'text-violet-600' },
            { label: 'Xin chuyển đổi', value: summary.substitutionRequested, color: 'text-amber-600' },
            { label: 'Từ chối', value: summary.rejected, color: 'text-red-500' },
          ].map(k => <div key={k.label} className="flex items-center gap-1.5"><span className={`text-lg font-bold ${k.color}`}>{k.value}</span><span className="text-xs text-slate-500">{k.label}</span></div>)}
        </div>
      )}

      {prId && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm mã, tên vật tư..." className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/30" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map(f => <button key={f.id} onClick={() => setFilterStatus(f.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatus === f.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{f.label}</button>)}
          </div>
        </div>
      )}

      {!prId && <div className="text-center py-16 text-slate-400 text-sm">Chọn 1 phiếu yêu cầu (PR) ở trên để xem/làm rõ kỹ thuật từng dòng vật tư.</div>}
      {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>}
      {prId && !loading && filtered.length === 0 && <div className="text-center py-16 text-slate-400 text-sm">Không có SKU nào khớp bộ lọc.</div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3">
        {filtered.map(row => <SkuCard key={row.prDetailId} row={row} onOpen={() => setPanel(row)} onOpenHistory={() => setHistoryItem({ itemCode: row.itemCode, itemName: row.itemName })} onQuickStatus={(s, n) => quickStatus(row.prDetailId, s, n)} />)}
      </div>

      {panel && <TechPanel row={panel} onClose={() => setPanel(null)} onUpdated={reloadAndSync} />}
      {historyItem && <PurchaseHistoryPanel itemCode={historyItem.itemCode} itemName={historyItem.itemName} onClose={() => setHistoryItem(null)} />}
    </div>
  )
}
