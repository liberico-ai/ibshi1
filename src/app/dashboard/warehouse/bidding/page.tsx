'use client'

import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button, Badge } from '@/components/ui'
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils'

interface Proj { id: string; projectCode: string; projectName: string }
interface BidRow { id: string; bidCode: string; subject: string; status: string; matGroup: string | null; urgent: boolean; itemCount: number; vendorCount: number; totalValue: number; projectCode: string; bidDate: string | null }
interface PrItem { id: string; itemCode: string; itemName: string; profile: string; grade: string; uom: string; toBuyQty: number; materialGroupCode: string | null; prCode: string }
interface Vendor { id: string; vendorName: string; vendorType: string; currency: string; totalQuote: number; isWinner: boolean }
interface Offer { scope?: string | null; unitPrice: number; totalPrice: number; deliveryTerm?: string | null; remarks?: string | null }
interface BidItem { id: string; itemOrder: number; itemCode: string; itemName: string; profile: string; grade: string; uom: string; qtyToBuy: number; qtyPr: number; estimateTotal: number; alreadyBoughtAmount: number; selectedVendorName: string | null; notes: string | null; offers: Record<string, Offer> }
interface BidPO { id: string; poCode: string; status: string; currency: string; totalValue: number; vendorName: string }
interface BidDetail { bid: { id: string; bidCode: string; subject: string; status: string; selectionMode: string; matGroup: string | null; project?: { projectCode: string } | null }; vendors: Vendor[]; items: BidItem[]; purchaseOrders: BidPO[] }

const STATUS_COLOR: Record<string, 'info' | 'warning' | 'success' | 'default' | 'danger'> = {
  OPEN: 'default', EVALUATING: 'info', SELECTED: 'warning', CONTRACTED: 'success', CANCELLED: 'danger',
}
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Chờ báo giá', EVALUATING: 'Đang so sánh', SELECTED: 'Đã duyệt NCC', CONTRACTED: 'Đã ký HĐ', CANCELLED: 'Huỷ',
}
// 5 chế độ chọn NCC (bám bid-status.ts của Commerce)
const SELECTION_MODES = [
  { key: 'PER_ITEM', label: 'Chọn NCC theo từng dòng', desc: 'Mỗi vật tư chọn NCC riêng (linh hoạt)', icon: '📋' },
  { key: 'PER_BID', label: 'Chọn 1 NCC cho cả BID', desc: '1 NCC thắng toàn bộ vật tư', icon: '🛡️' },
  { key: 'AUTO_MIN_PRICE', label: 'Tự động giá thấp nhất', desc: 'Hệ thống chọn đơn giá thấp nhất mỗi dòng', icon: '✨' },
  { key: 'PER_GROUP', label: 'Chọn theo nhóm vật tư', desc: 'Mỗi nhóm 1 NCC (đang dùng chọn theo dòng)', icon: '🗂️' },
  { key: 'MANUAL_WEIGHTED', label: 'Chấm điểm đa tiêu chí', desc: 'Giá + chất lượng + thanh toán (đang dùng chọn theo dòng)', icon: '📊' },
]
const fmtN = (n: number) => formatNumber(n)
const fmtM = (n: number) => formatCurrency(n)

export default function BiddingPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [bids, setBids] = useState<BidRow[]>([])
  const [detail, setDetail] = useState<BidDetail | null>(null)
  const [tab, setTab] = useState<'compare' | 'approve'>('compare')
  const [showCreate, setShowCreate] = useState(false)
  const [prItems, setPrItems] = useState<PrItem[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [showQuote, setShowQuote] = useState(false)

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const loadBids = useCallback(() => {
    if (!projectId) { setBids([]); return }
    apiFetch(`/api/procurement/bid-analyses?projectId=${projectId}`).then(r => { if (r.ok) setBids(r.bids || []) })
  }, [projectId])
  useEffect(() => { loadBids(); setDetail(null) }, [loadBids])

  const openCreate = async () => {
    const r = await apiFetch(`/api/procurement/prs/items-for-bidding?projectId=${projectId}`)
    if (r.ok) { setPrItems(r.items || []); setPicked(new Set()); setSubject(''); setShowCreate(true) }
    else notify(r.error || 'Lỗi tải PR item', 'error')
  }
  const createRfq = async () => {
    if (picked.size === 0) { notify('Chọn ít nhất 1 dòng PR', 'error'); return }
    const r = await apiFetch('/api/procurement/bid-analyses/from-pr', { method: 'POST', body: JSON.stringify({ projectId, prItemIds: [...picked], subject: subject || undefined }) })
    if (r.ok) { notify(`Đã tạo ${r.bidCode}`, 'success'); setShowCreate(false); loadBids() }
    else notify(r.error || 'Lỗi tạo RFQ', 'error')
  }
  const openDetail = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${id}`)
    if (r.ok) setDetail({ bid: r.bid, vendors: r.vendors, items: r.items, purchaseOrders: r.purchaseOrders || [] })
    else notify(r.error || 'Lỗi tải BID', 'error')
  }, [])
  const reloadDetail = () => { if (detail) { openDetail(detail.bid.id); loadBids() } }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Báo giá / Đấu thầu (RFQ)" subtitle="Tạo RFQ từ PR → nhập báo giá NCC → so sánh → duyệt chọn NCC" />

      <div className="flex gap-3 items-center flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {projectId && <Button variant="primary" onClick={openCreate}>+ Tạo RFQ từ PR</Button>}
      </div>

      {projectId && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr>
              <th>Mã RFQ / BID</th><th>Chủ đề</th><th>Dự án</th><th className="text-center">Ngày</th>
              <th className="text-center">Nhóm</th><th className="text-center">Dòng</th><th className="text-center">NCC</th>
              <th className="text-right">Tổng giá trị</th><th>Trạng thái</th>
            </tr></thead>
            <tbody>
              {bids.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có RFQ nào — bấm &quot;Tạo RFQ từ PR&quot;</td></tr>
              ) : bids.map(b => (
                <tr key={b.id} style={{ cursor: 'pointer', background: detail?.bid.id === b.id ? 'var(--surface-hover)' : undefined }} onClick={() => { setTab('compare'); openDetail(b.id) }}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: b.urgent ? '#dc2626' : 'var(--accent)' }}>{b.urgent && '⚡'}{b.bidCode}</span></td>
                  <td className="text-xs">{b.subject}</td>
                  <td className="text-xs font-mono">{b.projectCode}</td>
                  <td className="text-center text-xs">{b.bidDate ? formatDate(b.bidDate) : '—'}</td>
                  <td className="text-center"><span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--surface-hover)' }}>{b.matGroup || '—'}</span></td>
                  <td className="text-center text-xs">{b.itemCount}</td>
                  <td className="text-center text-xs font-semibold">{b.vendorCount}</td>
                  <td className="text-right font-mono text-xs">{b.totalValue > 0 ? fmtM(b.totalValue) : '—'}</td>
                  <td><Badge variant={STATUS_COLOR[b.status] || 'default'}>{STATUS_LABEL[b.status] || b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="card p-5 space-y-4">
          <div className="flex justify-between items-start flex-wrap gap-2">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                {detail.bid.bidCode}
                <Badge variant={STATUS_COLOR[detail.bid.status] || 'default'}>{STATUS_LABEL[detail.bid.status] || detail.bid.status}</Badge>
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{detail.bid.subject} · Dự án {detail.bid.project?.projectCode || '—'} · Nhóm {detail.bid.matGroup || '—'}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setShowQuote(true)}>+ Nhập báo giá NCC</Button>
              <Button variant="outline" onClick={() => setDetail(null)}>Đóng</Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
            {([['compare', '⚖️ So sánh báo giá'], ['approve', '✓ Duyệt & chọn NCC']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className="text-sm px-4 py-2 font-semibold" style={{ borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent', color: tab === k ? 'var(--accent)' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>

          {tab === 'compare' ? <CompareTab detail={detail} onReload={reloadDetail} /> : <ApproveTab detail={detail} onReload={reloadDetail} />}
        </div>
      )}

      {showCreate && <CreateRfqModal items={prItems} picked={picked} setPicked={setPicked} subject={subject} setSubject={setSubject} onCancel={() => setShowCreate(false)} onCreate={createRfq} />}
      {showQuote && detail && <EnterQuoteModal bidId={detail.bid.id} items={detail.items} onCancel={() => setShowQuote(false)} onSaved={() => { setShowQuote(false); reloadDetail() }} />}
    </div>
  )
}

// ══ Tab SO SÁNH — ma trận đầy đủ cột ══
function CompareTab({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const { vendors, items } = detail
  const selectPerBid = async (vendorId: string, vendorName: string) => {
    if (!await confirmDialog(`Chọn ${vendorName} cho TOÀN BỘ dòng của BID này?`)) return
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/select-vendor`, { method: 'POST', body: JSON.stringify({ vendorId }) })
    if (r.ok) { notify(r.message || 'Đã chọn NCC', 'success'); onReload() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <div className="space-y-3">
      {/* Vendor summary cards */}
      {vendors.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {vendors.map(v => (
            <div key={v.id} className="rounded-lg px-3 py-2" style={{ border: `1px solid ${v.isWinner ? '#16a34a' : 'var(--border)'}`, background: v.isWinner ? '#f0fdf4' : 'var(--surface)', minWidth: 150 }}>
              <div className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>{v.isWinner && '🏆'}{v.vendorName}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{v.vendorType === 'IMPORT' ? '🌏 Nhập khẩu' : '🇻🇳 Trong nước'} · {v.currency}</div>
              <div className="text-xs font-mono font-semibold mt-0.5">{fmtM(v.totalQuote)}</div>
              {!v.isWinner && <button onClick={() => selectPerBid(v.id, v.vendorName)} className="text-[10px] mt-1 px-2 py-0.5 rounded font-semibold" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Chọn NCC này (cả BID)</button>}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)' }}>
              <th className="text-left px-2 py-1.5" rowSpan={2}>Item</th>
              <th className="text-left px-2 py-1.5" rowSpan={2}>Mô tả</th>
              <th className="text-left px-2 py-1.5" rowSpan={2}>Quy cách</th>
              <th className="text-left px-2 py-1.5" rowSpan={2}>Mác</th>
              <th className="text-right px-2 py-1.5" rowSpan={2}>SL mua</th>
              <th className="text-right px-2 py-1.5" rowSpan={2}>SL PR</th>
              <th className="text-right px-2 py-1.5" rowSpan={2}>DT tổng</th>
              <th className="text-right px-2 py-1.5" rowSpan={2}>Đã mua</th>
              {vendors.map(v => <th key={v.id} className="text-center px-2 py-1 border-l" colSpan={3} style={{ borderColor: 'var(--border)' }}>{v.isWinner && '🏆 '}{v.vendorName}</th>)}
              {vendors.length === 0 && <th className="text-center px-2 py-1.5" rowSpan={2} style={{ color: 'var(--text-muted)' }}>(chưa có báo giá)</th>}
              <th className="text-left px-2 py-1.5 border-l" rowSpan={2} style={{ borderColor: 'var(--border)' }}>Lựa chọn</th>
              <th className="text-left px-2 py-1.5" rowSpan={2}>Ghi chú</th>
            </tr>
            <tr style={{ background: 'var(--bg-secondary)' }}>
              {vendors.map(v => (
                <Fragment key={v.id}>
                  <th className="text-center px-1 py-1 border-l text-[10px] font-normal" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>Phạm vi</th>
                  <th className="text-right px-1 py-1 text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>Đơn giá</th>
                  <th className="text-right px-1 py-1 text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>Thành tiền</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(it => {
              const prices = vendors.map(v => it.offers[v.id]?.unitPrice || 0).filter(p => p > 0)
              const min = prices.length ? Math.min(...prices) : 0
              return (
                <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                  <td className="px-2 py-1">{it.itemName}</td>
                  <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.profile || '—'}</td>
                  <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.grade || '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtN(it.qtyToBuy)}</td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{fmtN(it.qtyPr)}</td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{it.estimateTotal > 0 ? fmtM(it.estimateTotal) : '—'}</td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{it.alreadyBoughtAmount > 0 ? fmtM(it.alreadyBoughtAmount) : '—'}</td>
                  {vendors.map(v => {
                    const o = it.offers[v.id]
                    const isMin = o && o.unitPrice > 0 && o.unitPrice === min
                    return (
                      <Fragment key={v.id}>
                        <td className="px-1 py-1 text-center border-l" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>{o?.scope || '—'}</td>
                        <td className="px-1 py-1 text-right font-mono" style={{ background: isMin ? '#fef9c3' : undefined, fontWeight: isMin ? 700 : 400, color: isMin ? '#854d0e' : 'var(--text-primary)' }}>{o && o.unitPrice > 0 ? fmtN(o.unitPrice) : '—'}</td>
                        <td className="px-1 py-1 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{o && o.totalPrice > 0 ? fmtM(o.totalPrice) : '—'}</td>
                      </Fragment>
                    )
                  })}
                  {vendors.length === 0 && <td />}
                  <td className="px-2 py-1 border-l" style={{ borderColor: 'var(--border)' }}>{it.selectedVendorName ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#dcfce7', color: '#166534' }}>{it.selectedVendorName}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.notes || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══ Tab DUYỆT — chế độ + chọn NCC per-item + tổng hợp ══
interface ApproveSummary { summary: { totalItems: number; assignedItems: number; pendingItems: number; totalApprovedValue: number; vendorCount: number }; byVendor: Array<{ vendorName: string; itemCount: number; totalValue: number; items: Array<{ itemCode: string; itemName: string; profile: string; grade: string; qtyToBuy: number; uom: string; unitPrice: number; totalPrice: number }> }> }

function ApproveTab({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const { vendors, items } = detail
  const [mode, setMode] = useState(detail.bid.selectionMode || 'PER_ITEM')
  const [summary, setSummary] = useState<ApproveSummary | null>(null)

  const loadSummary = useCallback(() => {
    apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/approval-summary`).then(r => { if (r.ok) setSummary({ summary: r.summary, byVendor: r.byVendor }) })
  }, [detail.bid.id])
  useEffect(() => { loadSummary() }, [loadSummary, items])

  const changeMode = async (m: string) => {
    setMode(m)
    await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/selection-mode`, { method: 'PATCH', body: JSON.stringify({ selectionMode: m }) })
    if (m === 'AUTO_MIN_PRICE') {
      const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/auto-select-min-price`, { method: 'POST', body: '{}' })
      if (r.ok) { notify(r.message || 'Đã tự chọn', 'success'); onReload() }
    }
  }
  const selectItem = async (itemId: string, vendorName: string) => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/items/${itemId}/select-vendor`, { method: 'PATCH', body: JSON.stringify({ vendorName: vendorName || null }) })
    if (r.ok) onReload(); else notify(r.error || 'Lỗi chọn NCC', 'error')
  }
  const createPO = async () => {
    if (!await confirmDialog('Tạo PO từ các dòng đã duyệt? Mỗi NCC 1 đơn đặt hàng (PENDING — chờ duyệt ở Đơn đặt hàng).')) return
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/create-po`, { method: 'POST', body: '{}' })
    if (r.ok) { notify(r.message || 'Đã tạo PO', 'success'); onReload() } else notify(r.error || 'Lỗi tạo PO', 'error')
  }

  return (
    <div className="space-y-4">
      {/* Chế độ chọn NCC */}
      <div>
        <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Chế độ chọn nhà cung cấp</div>
        <div className="flex gap-2 flex-wrap">
          {SELECTION_MODES.map(sm => (
            <button key={sm.key} onClick={() => changeMode(sm.key)} className="rounded-lg px-3 py-2 text-left" style={{ border: `1px solid ${mode === sm.key ? 'var(--accent)' : 'var(--border)'}`, background: mode === sm.key ? 'var(--surface-hover)' : 'var(--surface)', maxWidth: 210 }}>
              <div className="text-xs font-bold" style={{ color: mode === sm.key ? 'var(--accent)' : 'var(--text-primary)' }}>{sm.icon} {sm.label}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sm.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[['Tổng dòng', summary.summary.totalItems], ['Đã duyệt', summary.summary.assignedItems], ['Chờ duyệt', summary.summary.pendingItems], ['Tổng giá trị', fmtM(summary.summary.totalApprovedValue)]].map(([l, v], i) => (
            <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
              <div className="text-sm font-bold font-mono" style={{ color: i === 3 ? '#166534' : 'var(--text-primary)' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bảng chọn NCC per-item */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg-secondary)' }}>
            <th className="text-left px-2 py-1.5">Item</th><th className="text-left px-2 py-1.5">Mô tả</th>
            <th className="text-left px-2 py-1.5">Quy cách/Mác</th><th className="text-right px-2 py-1.5">SL mua</th>
            {vendors.map(v => <th key={v.id} className="text-right px-2 py-1.5" style={{ maxWidth: 110 }}>{v.vendorName}</th>)}
            <th className="text-left px-2 py-1.5" style={{ minWidth: 150 }}>NCC duyệt</th>
          </tr></thead>
          <tbody>
            {items.map(it => {
              const prices = vendors.map(v => it.offers[v.id]?.unitPrice || 0).filter(p => p > 0)
              const min = prices.length ? Math.min(...prices) : 0
              return (
                <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                  <td className="px-2 py-1">{it.itemName}</td>
                  <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.profile || '—'}{it.grade && ` / ${it.grade}`}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtN(it.qtyToBuy)} {it.uom}</td>
                  {vendors.map(v => {
                    const o = it.offers[v.id]
                    const isMin = o && o.unitPrice > 0 && o.unitPrice === min
                    const isChosen = it.selectedVendorName && it.selectedVendorName.toLowerCase() === v.vendorName.toLowerCase()
                    return (
                      <td key={v.id} className="px-2 py-1 text-right font-mono" style={{ background: isChosen ? '#dcfce7' : isMin ? '#fef9c3' : undefined, fontWeight: isChosen || isMin ? 700 : 400, color: isChosen ? '#166534' : isMin ? '#854d0e' : 'var(--text-primary)' }} title={o ? `${fmtN(o.unitPrice)}/đv × ${fmtN(it.qtyToBuy)} = ${fmtM(o.totalPrice)}` : ''}>
                        {o && o.unitPrice > 0 ? fmtN(o.unitPrice) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1">
                    <select value={it.selectedVendorName || ''} onChange={e => selectItem(it.id, e.target.value)} className="input text-xs" style={{ minWidth: 140 }}>
                      <option value="">— Chưa duyệt —</option>
                      {vendors.filter(v => (it.offers[v.id]?.unitPrice || 0) > 0).map(v => <option key={v.id} value={v.vendorName}>{v.vendorName}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Tổng hợp phê duyệt theo NCC */}
      {summary && summary.byVendor.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Tổng hợp phê duyệt theo NCC</div>
          {summary.byVendor.map(vg => (
            <div key={vg.vendorName} className="rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <div className="flex justify-between items-center px-3 py-1.5" style={{ background: 'var(--surface)' }}>
                <span className="text-xs font-bold">{vg.vendorName} <span className="font-normal" style={{ color: 'var(--text-muted)' }}>· {vg.itemCount} dòng</span></span>
                <span className="text-xs font-mono font-bold" style={{ color: '#166534' }}>{fmtM(vg.totalValue)}</span>
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: 'var(--text-muted)' }}><th className="text-left px-3 py-1">Item</th><th className="text-left px-3 py-1">Mô tả</th><th className="text-left px-3 py-1">QC/Mác</th><th className="text-right px-3 py-1">SL</th><th className="text-right px-3 py-1">Đơn giá</th><th className="text-right px-3 py-1">Thành tiền</th></tr></thead>
                <tbody>
                  {vg.items.map((it, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-3 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode}</td>
                      <td className="px-3 py-1">{it.itemName}</td>
                      <td className="px-3 py-1" style={{ color: 'var(--text-muted)' }}>{it.profile}{it.grade && ` / ${it.grade}`}</td>
                      <td className="px-3 py-1 text-right font-mono">{fmtN(it.qtyToBuy)} {it.uom}</td>
                      <td className="px-3 py-1 text-right font-mono">{fmtN(it.unitPrice)}</td>
                      <td className="px-3 py-1 text-right font-mono font-semibold" style={{ color: '#166534' }}>{fmtM(it.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Tạo PO / HĐ */}
      <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Tạo Đơn đặt hàng (PO) từ BID</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Gom dòng theo NCC đã duyệt → mỗi NCC 1 PO (PENDING). Duyệt PO ở trang Đơn đặt hàng → cập nhật ngân sách.</div>
          </div>
          <Button variant="primary" onClick={createPO} disabled={!summary || summary.summary.assignedItems === 0}>Tạo PO / HĐ</Button>
        </div>
        {detail.purchaseOrders.length > 0 && (
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--text-muted)' }}><th className="text-left px-2 py-1">Mã PO</th><th className="text-left px-2 py-1">NCC</th><th className="text-right px-2 py-1">Giá trị</th><th className="text-center px-2 py-1">Trạng thái</th></tr></thead>
            <tbody>
              {detail.purchaseOrders.map(po => (
                <tr key={po.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono font-bold" style={{ color: 'var(--accent)' }}>{po.poCode}</td>
                  <td className="px-2 py-1">{po.vendorName}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtM(po.totalValue)}</td>
                  <td className="px-2 py-1 text-center"><span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: po.status === 'PENDING' ? '#fef9c3' : '#dcfce7', color: po.status === 'PENDING' ? '#854d0e' : '#166534' }}>{po.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ══ Modal: tạo RFQ từ PR item ══
function CreateRfqModal({ items, picked, setPicked, subject, setSubject, onCancel, onCreate }: {
  items: PrItem[]; picked: Set<string>; setPicked: (s: Set<string>) => void; subject: string; setSubject: (s: string) => void; onCancel: () => void; onCreate: () => void
}) {
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n) }
  const allChecked = items.length > 0 && picked.size === items.length
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onCancel}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Tạo RFQ — chọn dòng PR cần báo giá</h3>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Chủ đề (để trống → tự gợi ý)" className="input text-sm w-full" />
        {items.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>Không còn PR item nào chưa đưa vào BID cho dự án này.</p>
        ) : (
          <div className="overflow-x-auto" style={{ maxHeight: '50vh' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                <th className="px-2 py-1.5"><input type="checkbox" checked={allChecked} onChange={() => setPicked(allChecked ? new Set() : new Set(items.map(i => i.id)))} /></th>
                <th className="text-left px-2 py-1.5">Mã VT</th><th className="text-left px-2 py-1.5">Tên</th><th className="text-left px-2 py-1.5">Nhóm</th><th className="text-right px-2 py-1.5">Cần mua</th><th className="text-left px-2 py-1.5">PR</th>
              </tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} style={{ borderTop: '1px solid var(--border)', background: picked.has(it.id) ? '#eff6ff' : undefined, cursor: 'pointer' }} onClick={() => toggle(it.id)}>
                    <td className="px-2 py-1 text-center"><input type="checkbox" checked={picked.has(it.id)} readOnly /></td>
                    <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                    <td className="px-2 py-1">{it.itemName}{it.profile && <span style={{ color: 'var(--text-muted)' }}> · {it.profile}</span>}</td>
                    <td className="px-2 py-1"><span className="text-[10px] px-1 rounded font-mono" style={{ background: 'var(--surface-hover)' }}>{it.materialGroupCode || '—'}</span></td>
                    <td className="px-2 py-1 text-right font-mono">{fmtN(it.toBuyQty)} {it.uom}</td>
                    <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-muted)' }}>{it.prCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đã chọn {picked.size}/{items.length}</span>
          <div className="flex gap-2"><Button variant="outline" onClick={onCancel}>Huỷ</Button><Button variant="primary" onClick={onCreate} disabled={picked.size === 0}>Tạo RFQ</Button></div>
        </div>
      </div>
    </div>
  )
}

// ══ Modal: nhập báo giá 1 NCC (đủ cột như Commerce) ══
function EnterQuoteModal({ bidId, items, onCancel, onSaved }: { bidId: string; items: BidItem[]; onCancel: () => void; onSaved: () => void }) {
  const [vendorName, setVendorName] = useState('')
  const [vendorType, setVendorType] = useState('DOMESTIC')
  const [currency, setCurrency] = useState('VND')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Record<string, { unitPrice: string; totalPrice: string; scope: string; manual: boolean }>>({})
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const setUnit = (id: string, qty: number, val: string) => setRows(p => { const r = p[id] || { unitPrice: '', totalPrice: '', scope: 'V', manual: false }; const total = r.manual ? r.totalPrice : String(Math.round((Number(val) || 0) * qty)); return { ...p, [id]: { ...r, unitPrice: val, totalPrice: total } } })
  const setTotal = (id: string, val: string) => setRows(p => ({ ...p, [id]: { ...(p[id] || { unitPrice: '', scope: 'V' }), totalPrice: val, manual: true } as { unitPrice: string; totalPrice: string; scope: string; manual: boolean } }))
  const setScope = (id: string, val: string) => setRows(p => ({ ...p, [id]: { ...(p[id] || { unitPrice: '', totalPrice: '', manual: false }), scope: val } as { unitPrice: string; totalPrice: string; scope: string; manual: boolean } }))
  const grandTotal = Object.values(rows).reduce((s, r) => s + (Number(r.totalPrice) || 0), 0)

  const downloadTemplate = () => {
    const data = items.map(it => ({ 'Mã VT': it.itemCode || '', 'Tên': it.itemName || '', 'ĐVT': it.uom || '', 'SL mua': it.qtyToBuy, 'Đơn giá': '', 'Thành tiền': '', 'Phạm vi': 'V', 'Điều kiện giao': '' }))
    const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 18 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BaoGia'); XLSX.writeFile(wb, `MauBaoGia_${(vendorName || 'NCC').replace(/[^\w]/g, '')}.xlsx`)
  }
  const importExcel = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')
      const byCode = new Map(items.map(it => [norm(it.itemCode || ''), it]))
      const pick = (r: Record<string, unknown>, keys: string[]) => { for (const k of Object.keys(r)) { if (keys.some(t => norm(k) === norm(t))) return r[k] } return '' }
      const toNum = (v: unknown) => typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, '')) || 0
      const next = { ...rows }; let matched = 0, unmatched = 0
      for (const r of raw) {
        const code = norm(String(pick(r, ['Mã VT', 'Ma VT', 'itemCode'])))
        const unit = toNum(pick(r, ['Đơn giá', 'Don gia', 'unitPrice']))
        const tot = toNum(pick(r, ['Thành tiền', 'Thanh tien', 'totalPrice']))
        const scope = String(pick(r, ['Phạm vi', 'Pham vi', 'scope']) || 'V')
        if (!code) continue
        const it = byCode.get(code)
        if (it && unit > 0) { next[it.id] = { unitPrice: String(unit), totalPrice: String(tot > 0 ? tot : Math.round(unit * it.qtyToBuy)), scope: scope || 'V', manual: tot > 0 }; matched++ }
        else if (unit > 0) unmatched++
      }
      setRows(next)
      notify(matched > 0 ? `Đã khớp ${matched} dòng theo Mã VT${unmatched ? `, ${unmatched} không khớp` : ''}` : 'Không khớp dòng nào — kiểm tra cột "Mã VT"/"Đơn giá"', matched > 0 ? 'success' : 'error')
    } catch (e) { console.error(e); notify('Không đọc được file Excel', 'error') }
  }

  const save = async () => {
    if (!vendorName.trim()) { notify('Nhập tên NCC', 'error'); return }
    const lines = items.map(it => { const r = rows[it.id]; const up = Number(r?.unitPrice) || 0; return { itemId: it.id, unitPrice: up, totalPrice: Number(r?.totalPrice) || undefined, scope: r?.scope || undefined } }).filter(l => l.unitPrice > 0)
    if (lines.length === 0) { notify('Nhập ít nhất 1 đơn giá', 'error'); return }
    setSaving(true)
    const r = await apiFetch(`/api/procurement/bid-analyses/${bidId}/quotes`, { method: 'POST', body: JSON.stringify({ vendorName: vendorName.trim(), vendorType, currency, notes: notes || undefined, items: lines }) })
    setSaving(false)
    if (r.ok) { notify('Đã lưu báo giá', 'success'); onSaved() } else notify(r.error || 'Lỗi lưu báo giá', 'error')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onCancel}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 900, width: '100%', maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Nhập báo giá NCC</h3>
          <div className="flex gap-2">
            <button type="button" onClick={downloadTemplate} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--surface)' }}>⬇ Tải mẫu Excel</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid #16a34a', color: '#166534', background: '#f0fdf4' }}>⬆ Import Excel (khớp Mã VT)</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = '' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Tên NCC *" className="input text-sm" />
          <select value={vendorType} onChange={e => setVendorType(e.target.value)} className="input text-sm"><option value="DOMESTIC">Nội địa</option><option value="IMPORT">Nhập khẩu</option></select>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="input text-sm"><option value="VND">VND</option><option value="USD">USD</option></select>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ghi chú" className="input text-sm" />
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: '52vh' }}>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--bg-secondary)' }}>
              <th className="text-left px-2 py-1.5">Mã VT</th><th className="text-left px-2 py-1.5">Tên vật tư</th><th className="text-right px-2 py-1.5">SL</th><th className="text-left px-2 py-1.5">ĐVT</th>
              <th className="text-right px-2 py-1.5">Đơn giá</th><th className="text-right px-2 py-1.5">Thành tiền</th><th className="text-center px-2 py-1.5">Phạm vi</th>
            </tr></thead>
            <tbody>
              {items.map(it => { const r = rows[it.id]; return (
                <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                  <td className="px-2 py-1">{it.itemName}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtN(it.qtyToBuy)}</td>
                  <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.uom}</td>
                  <td className="px-2 py-1 text-right"><input type="number" value={r?.unitPrice || ''} onChange={e => setUnit(it.id, it.qtyToBuy, e.target.value)} className="input text-xs text-right" style={{ width: 100 }} placeholder="0" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" value={r?.totalPrice || ''} onChange={e => setTotal(it.id, e.target.value)} className="input text-xs text-right" style={{ width: 110 }} placeholder="0" /></td>
                  <td className="px-2 py-1 text-center"><select value={r?.scope || 'V'} onChange={e => setScope(it.id, e.target.value)} className="input text-xs" style={{ width: 56 }}><option value="V">V</option><option value="X">X</option></select></td>
                </tr>
              ) })}
            </tbody>
            <tfoot><tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}><td colSpan={5} className="px-2 py-1.5 text-right">Tổng cộng ({currency}):</td><td className="px-2 py-1.5 text-right font-mono">{fmtN(grandTotal)}</td><td /></tr></tfoot>
          </table>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Huỷ</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu báo giá'}</Button></div>
      </div>
    </div>
  )
}
