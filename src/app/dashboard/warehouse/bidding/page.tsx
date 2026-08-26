'use client'

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button, Badge } from '@/components/ui'
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils'
import { parseQuoteExcel, matchQuoteLinesToPr } from '@/lib/quote-parser'

interface Proj { id: string; projectCode: string; projectName: string }
interface BidRow { id: string; bidCode: string; subject: string; status: string; matGroup: string | null; urgent: boolean; itemCount: number; vendorCount: number; totalValue: number; projectCode: string; bidDate: string | null }
interface PrItem { id: string; itemCode: string; itemName: string; profile: string; grade: string; uom: string; toBuyQty: number; materialGroupCode: string | null; prCode: string }
interface Vendor { id: string; vendorName: string; vendorType: string; currency: string; totalQuote: number; isWinner: boolean }
interface Offer { scope?: string | null; unitPrice: number; totalPrice: number; deliveryTerm?: string | null; remarks?: string | null }
interface BidItem { id: string; itemOrder: number; itemCode: string; itemName: string; profile: string; grade: string; uom: string; qtyToBuy: number; qtyPr: number; estimateTotal: number; alreadyBoughtAmount: number; selectedVendorName: string | null; notes: string | null; offers: Record<string, Offer>; groupCode?: string; groupLabel?: string }
interface StepTask { id: string; status: string; canEdit: boolean }
interface BidPO { id: string; poCode: string; status: string; currency: string; totalValue: number; vendorName: string }
interface WeightCriteria { price?: number; quality?: number; paymentTerms?: number }
interface BidDetail { bid: { id: string; bidCode: string; subject: string; status: string; selectionMode: string; matGroup: string | null; project?: { projectCode: string } | null; legacyBidCode?: string | null; sourceFileName?: string | null; sourceFilePath?: string | null; weightingCriteria?: WeightCriteria | null }; vendors: Vendor[]; items: BidItem[]; purchaseOrders: BidPO[] }

const STATUS_COLOR: Record<string, 'info' | 'warning' | 'success' | 'default' | 'danger'> = {
  OPEN: 'default', EVALUATING: 'info', SELECTED: 'warning', CONTRACTED: 'success', CANCELLED: 'danger',
}
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Chờ báo giá', EVALUATING: 'Đang so sánh', SELECTED: 'Đã duyệt NCC', CONTRACTED: 'Đã ký HĐ', CANCELLED: 'Huỷ',
}
// 5 chế độ chọn NCC (bám bid-status.ts của Commerce)
const SELECTION_MODES = [
  { key: 'PER_ITEM', label: 'Chọn NCC theo từng dòng', desc: 'Mỗi vật tư chọn NCC riêng (linh hoạt)', bestFor: 'Nhiều item cùng nhóm, giá biến động', icon: '📋' },
  { key: 'PER_BID', label: 'Chọn 1 NCC cho cả BID', desc: '1 NCC thắng toàn bộ vật tư', bestFor: 'BID đơn giản, ít item, 1 nhóm', icon: '🛡️' },
  { key: 'AUTO_MIN_PRICE', label: 'Tự động giá thấp nhất', desc: 'Hệ thống chọn đơn giá thấp nhất mỗi dòng', bestFor: 'Tiêu chuẩn, không ràng buộc NCC', icon: '✨' },
  { key: 'PER_GROUP', label: 'Chọn theo nhóm vật tư', desc: 'Mỗi nhóm vật tư 1 NCC', bestFor: '>10 item, >2 nhóm vật tư', icon: '🗂️' },
  { key: 'MANUAL_WEIGHTED', label: 'Chấm điểm đa tiêu chí', desc: 'Giá + chất lượng + thanh toán (trọng số)', bestFor: 'Giá trị lớn, đánh giá tổng thể', icon: '📊' },
]
// Gợi ý chế độ theo số item + số nhóm (bám Commerce suggestSelectionMode).
function suggestSelectionMode(itemsCount: number, uniqueGroups: number): string {
  if (itemsCount < 10) return 'PER_BID'
  if (uniqueGroups > 2) return 'PER_GROUP'
  return 'PER_ITEM'
}
const fmtN = (n: number) => formatNumber(n)
const fmtM = (n: number) => formatCurrency(n)

// Đơn giá thấp nhất theo TỪNG loại tiền tệ cho 1 dòng — KHÔNG so VND với USD (tránh bôi vàng/chọn nhầm khi khác tệ).
function minPriceByCurrency(offers: Record<string, Offer>, vendors: Vendor[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of vendors) {
    const up = offers[v.id]?.unitPrice || 0
    if (up > 0) { const c = v.currency || 'VND'; out[c] = out[c] === undefined ? up : Math.min(out[c], up) }
  }
  return out
}
// Ô có phải giá thấp nhất TRONG CÙNG loại tiền tệ của nó không.
const isCheapestOffer = (o: Offer | undefined, v: Vendor, minByCur: Record<string, number>) =>
  !!o && o.unitPrice > 0 && o.unitPrice === minByCur[v.currency || 'VND']
// BID có trộn nhiều loại tiền tệ giữa các NCC không (để cảnh báo không so sánh trực tiếp).
const hasMixedCurrency = (vendors: Vendor[]) => new Set(vendors.map(v => v.currency || 'VND')).size > 1

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

  const [stepTasks, setStepTasks] = useState<{ p35: StepTask | null; p36: StepTask | null }>({ p35: null, p36: null })

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])
  // Redirect từ bước P3.5/P3.6 mang ?project=<id> → tự chọn dự án
  useEffect(() => { const p = new URLSearchParams(window.location.search).get('project'); if (p) setProjectId(p) }, [])

  const loadBids = useCallback(() => {
    if (!projectId) { setBids([]); return }
    apiFetch(`/api/procurement/bid-analyses?projectId=${projectId}`).then(r => { if (r.ok) setBids(r.bids || []) })
  }, [projectId])
  const loadStepTasks = useCallback(() => {
    if (!projectId) { setStepTasks({ p35: null, p36: null }); return }
    Promise.all([
      apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=P3.5`),
      apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=P3.6`),
    ]).then(([a, b]) => setStepTasks({ p35: a.ok ? a.task : null, p36: b.ok ? b.task : null }))
  }, [projectId])
  useEffect(() => { loadBids(); loadStepTasks(); setDetail(null) }, [loadBids, loadStepTasks])

  const activeStep: 'P3.5' | 'P3.6' | null =
    (stepTasks.p36?.canEdit && stepTasks.p36.status !== 'DONE') ? 'P3.6'
    : (stepTasks.p35?.canEdit && stepTasks.p35.status !== 'DONE') ? 'P3.5' : null

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
  // Tạo hàng loạt: gom dòng đã chọn (hoặc tất cả nếu chưa chọn) theo nhóm vật tư → mỗi nhóm 1 RFQ.
  const createRfqBulkByGroup = async () => {
    const ids = [...picked]
    const msg = ids.length ? `Gom ${ids.length} dòng đã chọn theo nhóm vật tư, mỗi nhóm tạo 1 RFQ?` : 'Chưa chọn dòng — gom TẤT CẢ dòng PR chưa vào BID theo nhóm vật tư, mỗi nhóm 1 RFQ?'
    if (!await confirmDialog(msg)) return
    const r = await apiFetch('/api/procurement/bid-analyses/from-pr-bulk-by-group', { method: 'POST', body: JSON.stringify({ projectId, prItemIds: ids.length ? ids : undefined }) })
    if (r.ok) { notify(r.message || `Đã tạo ${r.bids?.length || 0} RFQ theo nhóm`, 'success'); setShowCreate(false); loadBids() }
    else notify(r.error || 'Lỗi tạo RFQ hàng loạt', 'error')
  }
  const openDetail = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${id}`)
    if (r.ok) setDetail({ bid: r.bid, vendors: r.vendors, items: r.items, purchaseOrders: r.purchaseOrders || [] })
    else notify(r.error || 'Lỗi tải BID', 'error')
  }, [])
  const reloadDetail = () => { if (detail) openDetail(detail.bid.id); loadBids(); loadStepTasks() }
  const reloadAll = () => { loadBids(); loadStepTasks(); setDetail(null) }

  // File GIẢI TRÌNH đã ký — đính kèm ngay vào đợt BID (khớp Commerce, không cần trang riêng)
  const attachGiaiTrinh = async (file: File) => {
    if (!detail) return
    if (file.size > 25 * 1024 * 1024) { notify('File quá lớn (>25MB)', 'error'); return }
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch(`/api/procurement/bid-analyses/${detail.bid.id}/source-file`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(x => x.json()).catch(() => ({ ok: false, error: 'Lỗi mạng' }))
    if (r.ok) { notify('Đã đính kèm giải trình', 'success'); reloadDetail() } else notify(r.error || 'Lỗi đính kèm', 'error')
  }
  // Xuất RFQ ra Excel (bảng phân tích giá thầu) — tải file về máy.
  const exportRfq = async () => {
    if (!detail) return
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    try {
      const r = await fetch(`/api/procurement/bid-analyses/${detail.bid.id}/export-rfq`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!r.ok) { notify('Lỗi xuất RFQ', 'error'); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `RFQ-${detail.bid.bidCode}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { notify('Lỗi mạng khi xuất RFQ', 'error') }
  }
  const removeGiaiTrinh = async () => {
    if (!detail || !(await confirmDialog('Gỡ file giải trình khỏi đợt BID này?'))) return
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/source-file`, { method: 'DELETE' })
    if (r.ok) { notify('Đã gỡ giải trình', 'success'); reloadDetail() } else notify(r.error || 'Lỗi gỡ', 'error')
  }
  // Cấp PO Hàng Loạt: lặp create-po cho mọi BID của dự án còn chưa ký HĐ (khớp Commerce).
  const [bulkBusy, setBulkBusy] = useState(false)
  const bulkCreatePo = async () => {
    const targets = bids.filter(b => b.status !== 'CONTRACTED' && b.status !== 'CANCELLED')
    if (targets.length === 0) { notify('Không có BID nào để cấp PO', 'error'); return }
    if (!await confirmDialog(`Cấp PO hàng loạt cho ${targets.length} đợt báo giá của dự án? (mỗi BID đã chọn NCC → tạo PO)`)) return
    setBulkBusy(true)
    let ok = 0, skip = 0
    const errs: string[] = []
    for (const b of targets) {
      const r = await apiFetch(`/api/procurement/bid-analyses/${b.id}/create-po`, { method: 'POST', body: '{}' })
      if (r.ok) ok++
      else if (/chưa chọn NCC|dòng nào/i.test(r.error || '')) skip++
      else errs.push(`${b.bidCode}: ${r.error}`)
    }
    setBulkBusy(false)
    notify(`Cấp PO hàng loạt: ${ok} BID tạo PO, ${skip} bỏ qua (chưa chọn NCC)${errs.length ? `, ${errs.length} lỗi` : ''}`, errs.length ? 'error' : 'success')
    if (errs.length) console.warn('[bulk PO]', errs)
    reloadAll()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Báo giá / Đấu thầu (RFQ)" subtitle="Tạo RFQ từ PR → nhập báo giá NCC → so sánh → duyệt chọn NCC" />

      <div className="flex gap-3 items-center flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {projectId && <Button variant="primary" onClick={openCreate}>+ Tạo RFQ từ PR</Button>}
        {projectId && bids.length > 0 && <Button variant="outline" onClick={bulkCreatePo} disabled={bulkBusy}>{bulkBusy ? 'Đang cấp PO…' : '⚡ Cấp PO Hàng Loạt'}</Button>}
      </div>

      {projectId && (
        <StepBanner p35={stepTasks.p35} p36={stepTasks.p36} projectId={projectId} bids={bids} onDone={reloadAll} />
      )}

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
              {/* File GIẢI TRÌNH đã ký (MSDT) — đính kèm/tải ngay tại đây */}
              <div className="flex items-center gap-2 mt-1.5 text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>📄 Giải trình MSDT:</span>
                {detail.bid.sourceFilePath ? (
                  <>
                    <a href={detail.bid.sourceFilePath} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: 'var(--accent)' }}>{detail.bid.sourceFileName || 'Tải file'}</a>
                    <label className="cursor-pointer" style={{ color: 'var(--text-muted)' }} title="Thay file khác">✏️ Đổi
                      <input type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) attachGiaiTrinh(f); e.currentTarget.value = '' }} />
                    </label>
                    <button onClick={removeGiaiTrinh} style={{ color: 'var(--danger)' }} title="Gỡ file">🗑 Gỡ</button>
                  </>
                ) : (
                  <label className="cursor-pointer font-semibold" style={{ color: 'var(--accent)' }}>+ Đính kèm PDF đã ký
                    <input type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) attachGiaiTrinh(f); e.currentTarget.value = '' }} />
                  </label>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportRfq} title="Xuất bảng phân tích giá thầu ra Excel (gửi NCC / lưu hồ sơ)">⬇ Xuất RFQ (Excel)</Button>
              <Button variant="primary" onClick={() => setShowQuote(true)}>+ Nhập báo giá NCC</Button>
              {detail.bid.status !== 'CONTRACTED' && detail.bid.status !== 'CANCELLED' && (
                <Button variant="outline" onClick={async () => {
                  if (!await confirmDialog(`Hủy đợt báo giá ${detail.bid.bidCode}? (không thể tạo PO sau khi hủy)`)) return
                  const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}`, { method: 'DELETE' })
                  if (r.ok) { notify(r.message || 'Đã hủy BID', 'success'); reloadAll() } else notify(r.error || 'Lỗi hủy', 'error')
                }}>Hủy BID</Button>
              )}
              <Button variant="outline" onClick={() => setDetail(null)}>Đóng</Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
            {([['compare', '⚖️ So sánh báo giá'], ['approve', '✓ Duyệt & chọn NCC']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className="text-sm px-4 py-2 font-semibold" style={{ borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent', color: tab === k ? 'var(--accent)' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>

          {tab === 'compare' ? <CompareTab detail={detail} onReload={reloadDetail} /> : <ApproveTab detail={detail} onReload={reloadDetail} activeStep={activeStep} />}

          <MilestonesPanel bidId={detail.bid.id} />
        </div>
      )}

      {showCreate && <CreateRfqModal items={prItems} picked={picked} setPicked={setPicked} subject={subject} setSubject={setSubject} projectCode={projects.find(p => p.id === projectId)?.projectCode || ''} onCancel={() => setShowCreate(false)} onCreate={createRfq} onCreateBulk={createRfqBulkByGroup} />}
      {showQuote && detail && <EnterQuoteModal bidId={detail.bid.id} items={detail.items} onCancel={() => setShowQuote(false)} onSaved={() => { setShowQuote(false); reloadDetail() }} />}
    </div>
  )
}

// ══ Tab SO SÁNH — ma trận đầy đủ cột ══
function CompareTab({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const { vendors, items } = detail
  const mixed = hasMixedCurrency(vendors)
  const selectPerBid = async (vendorId: string, vendorName: string) => {
    if (!await confirmDialog(`Chọn ${vendorName} cho TOÀN BỘ dòng của BID này?`)) return
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/select-vendor`, { method: 'POST', body: JSON.stringify({ vendorId }) })
    if (r.ok) { notify(r.message || 'Đã chọn NCC', 'success'); onReload() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <div className="space-y-3">
      {mixed && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          ⚠️ Các NCC báo giá <b>khác loại tiền tệ</b> ({[...new Set(vendors.map(v => v.currency || 'VND'))].join(', ')}). Giá thấp nhất được tô <b>theo TỪNG loại tiền tệ</b> — không so trực tiếp giữa các tệ. Cần quy đổi trước khi kết luận rẻ/đắt.
        </div>
      )}
      {/* Vendor summary cards */}
      {vendors.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {vendors.map(v => {
            const nOffers = items.filter(it => (it.offers[v.id]?.unitPrice || 0) > 0).length
            return (
            <div key={v.id} className="rounded-lg px-3 py-2" style={{ border: `1px solid ${v.isWinner ? '#16a34a' : 'var(--border)'}`, background: v.isWinner ? '#f0fdf4' : 'var(--surface)', minWidth: 150 }}>
              <div className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>{v.isWinner && '🏆'}{v.vendorName}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{v.vendorType === 'IMPORT' ? '🌏 Nhập khẩu' : '🇻🇳 Trong nước'} · {v.currency} · <b>{nOffers}</b>/{items.length} dòng báo</div>
              <div className="text-xs font-mono font-semibold mt-0.5">{fmtM(v.totalQuote)}</div>
              {!v.isWinner && <button onClick={() => selectPerBid(v.id, v.vendorName)} className="text-[10px] mt-1 px-2 py-0.5 rounded font-semibold" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Chọn NCC này (cả BID)</button>}
            </div>
          )})}
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
              const minByCur = minPriceByCurrency(it.offers, vendors)
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
                    const isMin = isCheapestOffer(o, v, minByCur)
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

function ApproveTab({ detail, onReload, activeStep }: { detail: BidDetail; onReload: () => void; activeStep: 'P3.5' | 'P3.6' | null }) {
  const { vendors, items } = detail
  const uniqueGroups = new Set(items.map(it => it.groupCode || 'KHAC')).size || 1
  const suggested = suggestSelectionMode(items.length, uniqueGroups)
  const [mode, setMode] = useState(detail.bid.selectionMode || 'PER_ITEM')
  const [summary, setSummary] = useState<ApproveSummary | null>(null)
  const [poBusy, setPoBusy] = useState(false)
  const roleCode = useAuthStore(s => s.user?.roleCode)

  const loadSummary = useCallback(() => {
    apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/approval-summary`).then(r => { if (r.ok) setSummary({ summary: r.summary, byVendor: r.byVendor }) })
  }, [detail.bid.id])
  useEffect(() => { loadSummary() }, [loadSummary, items])

  const changeMode = async (m: string) => {
    if (m === mode) return
    // Đổi chế độ sẽ XÓA lựa chọn cũ (server reset) → cảnh báo nếu đang có dòng đã chọn.
    if ((summary?.summary.assignedItems ?? 0) > 0) {
      const msg = m === 'AUTO_MIN_PRICE'
        ? 'Chế độ "Tự động giá thấp nhất" sẽ XÓA lựa chọn hiện tại rồi chọn NCC rẻ nhất mỗi dòng. Tiếp tục?'
        : 'Đổi chế độ sẽ XÓA các NCC đang chọn của chế độ hiện tại. Tiếp tục?'
      if (!await confirmDialog(msg)) return
    }
    setMode(m)
    const pr = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/selection-mode`, { method: 'PATCH', body: JSON.stringify({ selectionMode: m }) })
    if (!pr.ok) { notify(pr.error || 'Lỗi đổi chế độ', 'error') }
    onReload() // phản ánh lựa chọn của mode cũ đã bị xóa; thao tác cụ thể nằm ở panel của mode mới
  }
  const selectItem = async (itemId: string, vendorName: string) => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/items/${itemId}/select-vendor`, { method: 'PATCH', body: JSON.stringify({ vendorName: vendorName || null }) })
    if (r.ok) onReload(); else notify(r.error || 'Lỗi chọn NCC', 'error')
  }
  const createPO = async () => {
    if (poBusy) return
    if (!await confirmDialog('Tạo PO từ các dòng đã duyệt? Mỗi NCC 1 đơn đặt hàng (PENDING — chờ duyệt ở Đơn đặt hàng).')) return
    setPoBusy(true)
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/create-po`, { method: 'POST', body: '{}' })
    // Gate 2: giá vượt dự toán > 2%. BGĐ (R01) có thể xác nhận vượt để tiếp tục.
    if (!r.ok && /vượt dự toán/i.test(r.error || '')) {
      if (roleCode === 'R01' && await confirmDialog(`${r.error}\n\nBGĐ xác nhận DUYỆT VƯỢT DỰ TOÁN và tạo PO?`)) {
        const r2 = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/create-po`, { method: 'POST', body: JSON.stringify({ confirmOverBudget: true }) })
        setPoBusy(false)
        if (r2.ok) { notify(r2.message || 'Đã tạo PO (duyệt vượt dự toán)', 'success'); onReload() } else notify(r2.error || 'Lỗi tạo PO', 'error')
        return
      }
      setPoBusy(false)
      notify(r.error || 'Giá vượt dự toán — cần BGĐ duyệt', 'error')
      return
    }
    setPoBusy(false)
    if (r.ok) { notify(r.message || 'Đã tạo PO', 'success'); onReload() } else notify(r.error || 'Lỗi tạo PO', 'error')
  }
  // B6 — Thành hợp đồng: mỗi PO → 1 HĐ (DRAFT) + gắn PO. Đi tiếp bước duyệt điều kiện thanh toán.
  const createContracts = async () => {
    if (poBusy) return
    if (!await confirmDialog('Tạo hợp đồng từ các PO của BID này? Mỗi PO thành 1 HĐ (DRAFT) để duyệt điều kiện thanh toán.')) return
    setPoBusy(true)
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/create-contracts`, { method: 'POST', body: '{}' })
    setPoBusy(false)
    if (r.ok) { notify(r.message || 'Đã tạo hợp đồng', 'success'); onReload() } else notify(r.error || 'Lỗi tạo hợp đồng', 'error')
  }

  return (
    <div className="space-y-4">
      {/* Chế độ chọn NCC */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Chế độ chọn nhà cung cấp · {items.length} item · {uniqueGroups} nhóm · gợi ý: <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{SELECTION_MODES.find(m => m.key === suggested)?.label || suggested}</span>
          </div>
          {mode !== suggested && <button onClick={() => changeMode(suggested)} className="text-[11px] px-2 py-0.5 rounded font-bold" style={{ background: 'var(--surface-hover)', color: 'var(--accent)' }}>Dùng gợi ý</button>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {SELECTION_MODES.map(sm => (
            <button key={sm.key} onClick={() => changeMode(sm.key)} className="rounded-lg px-3 py-2 text-left" style={{ border: `2px solid ${mode === sm.key ? 'var(--accent)' : 'var(--border)'}`, background: mode === sm.key ? 'var(--surface-hover)' : 'var(--surface)' }}>
              <div className="text-xs font-bold flex items-center gap-1 flex-wrap" style={{ color: mode === sm.key ? 'var(--accent)' : 'var(--text-primary)' }}>
                {sm.icon} {sm.label}
                {mode === sm.key && <span className="text-[9px] px-1 rounded-full text-white" style={{ background: 'var(--accent)' }}>Đang dùng</span>}
                {sm.key === suggested && mode !== sm.key && <span className="text-[9px] px-1 rounded-full" style={{ background: 'var(--surface-hover)', color: 'var(--accent)' }}>Gợi ý</span>}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sm.desc}</div>
              <div className="text-[10px] mt-0.5 italic" style={{ color: 'var(--text-muted)' }}>Phù hợp: {sm.bestFor}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Panel riêng theo chế độ (PER_ITEM thao tác trực tiếp ở bảng dưới) */}
      <ModePanel mode={mode} detail={detail} summary={summary} onReload={onReload} />

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
              const minByCur = minPriceByCurrency(it.offers, vendors)
              return (
                <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                  <td className="px-2 py-1">{it.itemName}</td>
                  <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.profile || '—'}{it.grade && ` / ${it.grade}`}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtN(it.qtyToBuy)} {it.uom}</td>
                  {vendors.map(v => {
                    const o = it.offers[v.id]
                    const isMin = isCheapestOffer(o, v, minByCur)
                    const isChosen = it.selectedVendorName && it.selectedVendorName.toLowerCase() === v.vendorName.toLowerCase()
                    return (
                      <td key={v.id} className="px-2 py-1 text-right font-mono" style={{ background: isChosen ? '#dcfce7' : isMin ? '#fef9c3' : undefined, fontWeight: isChosen || isMin ? 700 : 400, color: isChosen ? '#166534' : isMin ? '#854d0e' : 'var(--text-primary)' }}>
                        {o && o.unitPrice > 0 ? fmtN(o.unitPrice) : '—'}
                        {o && o.totalPrice > 0 && <div className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>{fmtM(o.totalPrice)}</div>}
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

      {/* Tạo PO / HĐ — ẩn khi đang ở bước P3.5 (TM chỉ chọn NCC; PO tạo ở bước BGĐ duyệt P3.6) */}
      {activeStep === 'P3.5' ? (
        <p className="text-[11px] rounded-lg p-2.5" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          Bạn đang ở bước <b>P3.5 (Thương mại)</b>: chỉ cần <b>chọn NCC</b> cho các dòng, rồi bấm <b>&quot;Hoàn thành tìm NCC&quot;</b> ở thẻ trên cùng để chuyển BGĐ duyệt. Việc <b>tạo PO</b> do BGĐ thực hiện ở bước P3.6.
        </p>
      ) : (
      <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Tạo Đơn đặt hàng (PO) từ BID</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Gom dòng theo NCC đã duyệt → mỗi NCC 1 PO (PENDING). Duyệt PO ở trang Đơn đặt hàng → cập nhật ngân sách.</div>
          </div>
          <Button variant="primary" onClick={createPO} disabled={poBusy || !summary || summary.summary.assignedItems === 0}>{poBusy ? 'Đang tạo…' : 'Tạo PO / HĐ'}</Button>
        </div>
        {detail.purchaseOrders.length > 0 && (
          <>
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
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1" style={{ borderTop: '1px dashed var(--border)' }}>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Thành hợp đồng: mỗi PO → 1 HĐ (DRAFT) để duyệt điều kiện thanh toán (B7).</div>
              <Button variant="outline" onClick={createContracts} disabled={poBusy}>Tạo hợp đồng từ PO</Button>
            </div>
            <div className="text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--text-muted)' }}>
              <span>Bước tiếp:</span>
              <a href="/dashboard/warehouse/hop-dong" className="underline" style={{ color: 'var(--accent)' }}>Hợp đồng (duyệt điều kiện TT) →</a>
              <a href="/dashboard/warehouse/purchase-orders" className="underline" style={{ color: 'var(--accent)' }}>Duyệt PO (Đơn đặt hàng) →</a>
              <a href="/dashboard/warehouse/grn" className="underline" style={{ color: 'var(--accent)' }}>Hàng về / Nhập kho (GRN) →</a>
              <span>· duyệt PO xong sẽ nhận hàng + QC + nhập kho ở trang GRN, tự cập nhật Kho &amp; Ngân sách.</span>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  )
}

// ══ Panel thao tác riêng theo chế độ chọn NCC ══
function ModePanel({ mode, detail, onReload }: { mode: string; detail: BidDetail; summary: ApproveSummary | null; onReload: () => void }) {
  if (mode === 'PER_BID') return <PerBidPanel detail={detail} onReload={onReload} />
  if (mode === 'PER_GROUP') return <PerGroupPanel detail={detail} onReload={onReload} />
  if (mode === 'AUTO_MIN_PRICE') return <AutoMinPricePanel detail={detail} onReload={onReload} />
  if (mode === 'MANUAL_WEIGHTED') return <WeightedPanel detail={detail} onReload={onReload} />
  return null // PER_ITEM: thao tác trực tiếp ở bảng từng dòng bên dưới
}

function KhungChon({ tieuDe, moTa, children }: { tieuDe: string; moTa: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div>
        <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{tieuDe}</div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{moTa}</div>
      </div>
      {children}
    </div>
  )
}

// PER_BID — giao cả gói cho 1 NCC
function PerBidPanel({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const assign = async (v: Vendor) => {
    if (v.isWinner) return
    if (!await confirmDialog(`Giao TOÀN BỘ ${detail.items.length} dòng cho ${v.vendorName}?`)) return
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/select-vendor`, { method: 'POST', body: JSON.stringify({ vendorId: v.id }) })
    if (r.ok) { notify(r.message || 'Đã giao cả gói', 'success'); onReload() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <KhungChon tieuDe="Chọn 1 NCC cho toàn bộ BID" moTa="1 nhà cung cấp thắng tất cả vật tư trong gói này.">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {detail.vendors.map(v => (
          <div key={v.id} className="rounded-lg p-2.5 flex flex-col gap-1" style={{ border: `1px solid ${v.isWinner ? '#16a34a' : 'var(--border)'}`, background: v.isWinner ? '#f0fdf4' : 'var(--surface)' }}>
            <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{v.vendorName}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{v.vendorType === 'IMPORT' ? 'Nhập khẩu' : 'Trong nước'} · {v.currency}</div>
            <div className="text-xs font-mono font-bold mb-1" style={{ color: '#166534' }}>{fmtM(v.totalQuote)}</div>
            <Button variant={v.isWinner ? 'outline' : 'primary'} size="sm" onClick={() => assign(v)} disabled={v.isWinner}>{v.isWinner ? '✓ Đang chọn' : 'Giao cả gói cho NCC này'}</Button>
          </div>
        ))}
      </div>
    </KhungChon>
  )
}

// PER_GROUP — mỗi nhóm vật tư 1 NCC
function PerGroupPanel({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { code: string; label: string; items: BidItem[] }>()
    for (const it of detail.items) {
      const code = it.groupCode || 'KHAC'
      if (!m.has(code)) m.set(code, { code, label: it.groupLabel || code, items: [] })
      m.get(code)!.items.push(it)
    }
    return [...m.values()]
  }, [detail.items])
  const pick = async (groupCode: string, vendorName: string) => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/group-selection`, { method: 'POST', body: JSON.stringify({ groupCode, vendorName: vendorName || null }) })
    if (r.ok) { notify(r.message || 'Đã gán', 'success'); onReload() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <KhungChon tieuDe="Chọn nhà cung cấp theo nhóm vật tư" moTa="Mỗi nhóm vật tư gán 1 NCC — áp cho tất cả dòng trong nhóm.">
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: 'var(--text-muted)' }}><th className="text-left px-2 py-1">Nhóm vật tư</th><th className="text-right px-2 py-1">Số dòng</th><th className="text-left px-2 py-1">Đã gán</th><th className="text-left px-2 py-1" style={{ minWidth: 180 }}>NCC cho cả nhóm</th></tr></thead>
        <tbody>
          {groups.map(g => {
            const assigned = g.items.filter(it => it.selectedVendorName)
            const distinct = new Set(assigned.map(it => it.selectedVendorName))
            const cur = distinct.size === 1 ? ([...distinct][0] || '') : ''
            return (
              <tr key={g.code} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-2 py-1 font-semibold">{g.label}</td>
                <td className="px-2 py-1 text-right font-mono">{g.items.length}</td>
                <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{assigned.length}/{g.items.length}{distinct.size > 1 && <span style={{ color: '#b45309' }}> ({distinct.size} NCC khác nhau)</span>}</td>
                <td className="px-2 py-1">
                  <select value={cur} onChange={e => pick(g.code, e.target.value)} className="input text-xs" style={{ minWidth: 170 }}>
                    <option value="">— Chọn NCC —</option>
                    {detail.vendors.map(v => <option key={v.id} value={v.vendorName}>{v.vendorName}</option>)}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </KhungChon>
  )
}

// AUTO_MIN_PRICE — chạy chọn tự động
function AutoMinPricePanel({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const [busy, setBusy] = useState(false)
  const usable = detail.items.filter(it => detail.vendors.some(v => (it.offers[v.id]?.unitPrice || 0) > 0)).length
  const run = async () => {
    if (busy) return
    if (!await confirmDialog('Chạy chọn tự động? Lựa chọn thủ công hiện có sẽ bị ghi đè theo đơn giá thấp nhất mỗi dòng.')) return
    setBusy(true)
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/auto-select-min-price`, { method: 'POST', body: '{}' })
    setBusy(false)
    if (r.ok) { notify(r.message || 'Đã chọn tự động', 'success'); onReload() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <KhungChon tieuDe="Tự động chọn nhà cung cấp rẻ nhất" moTa="Mỗi dòng chọn NCC có đơn giá thấp nhất (>0). Dòng không có báo giá sẽ bỏ trống.">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Dòng có báo giá dùng được: <b style={{ color: 'var(--text-primary)' }}>{usable}/{detail.items.length}</b>{hasMixedCurrency(detail.vendors) && <span style={{ color: '#b45309' }}> · BID trộn nhiều loại tiền tệ</span>}</span>
        <Button variant="primary" size="sm" onClick={run} disabled={busy || usable === 0}>{busy ? 'Đang chạy…' : 'Chạy chọn tự động'}</Button>
      </div>
    </KhungChon>
  )
}

// MANUAL_WEIGHTED — chấm điểm theo trọng số
type ScoreRow = { gia: string; chatLuong: string; thanhToan: string; overall: number }
function WeightedPanel({ detail, onReload }: { detail: BidDetail; onReload: () => void }) {
  const w = { price: detail.bid.weightingCriteria?.price ?? 0.5, quality: detail.bid.weightingCriteria?.quality ?? 0.3, paymentTerms: detail.bid.weightingCriteria?.paymentTerms ?? 0.2 }
  const [scores, setScores] = useState<Record<string, ScoreRow>>({})
  const [savingName, setSavingName] = useState('')

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/vendor-scores`)
    if (r.ok) {
      const map: Record<string, ScoreRow> = {}
      for (const s of (r.scores || []) as Array<{ vendorName: string; priceScore: number; qualityScore: number; paymentScore: number; overallScore: number }>) {
        map[s.vendorName] = { gia: String(s.priceScore), chatLuong: String(s.qualityScore), thanhToan: String(s.paymentScore), overall: s.overallScore }
      }
      setScores(map)
    }
  }, [detail.bid.id])
  useEffect(() => { load() }, [load])

  const setField = (name: string, k: 'gia' | 'chatLuong' | 'thanhToan', val: string) =>
    setScores(p => ({ ...p, [name]: { ...(p[name] || { gia: '', chatLuong: '', thanhToan: '', overall: 0 }), [k]: val } }))
  const liveOverall = (name: string): number | null => {
    const s = scores[name]; if (!s) return null
    return Number(s.gia || 0) * w.price + Number(s.chatLuong || 0) * w.quality + Number(s.thanhToan || 0) * w.paymentTerms
  }
  const save = async (v: Vendor) => {
    const s = scores[v.vendorName] || { gia: '', chatLuong: '', thanhToan: '' }
    setSavingName(v.vendorName)
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/vendor-scores`, { method: 'POST', body: JSON.stringify({ vendorName: v.vendorName, priceScore: Number(s.gia || 0), qualityScore: Number(s.chatLuong || 0), paymentScore: Number(s.thanhToan || 0) }) })
    setSavingName('')
    if (r.ok) { notify(r.message || 'Đã chấm điểm', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }
  const ranked = detail.vendors.map(v => ({ v, overall: scores[v.vendorName]?.overall ?? -1 })).filter(x => x.overall >= 0).sort((a, b) => b.overall - a.overall)
  const top = ranked[0]
  const assignTop = async () => {
    if (!top) return
    if (!await confirmDialog(`Giao cả gói cho ${top.v.vendorName} (cao điểm nhất: ${top.overall.toFixed(1)})?`)) return
    const r = await apiFetch(`/api/procurement/bid-analyses/${detail.bid.id}/select-vendor`, { method: 'POST', body: JSON.stringify({ vendorId: top.v.id }) })
    if (r.ok) { notify(r.message || 'Đã giao', 'success'); onReload() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <KhungChon tieuDe="Chấm điểm nhà cung cấp theo trọng số" moTa={`Cho điểm 0–100 mỗi tiêu chí. Điểm tổng = Giá ${Math.round(w.price * 100)}% + Chất lượng ${Math.round(w.quality * 100)}% + Thanh toán ${Math.round(w.paymentTerms * 100)}%. Chấm xong giao cả gói cho NCC cao điểm nhất.`}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: 'var(--text-muted)' }}>
          <th className="text-left px-2 py-1">Nhà cung cấp</th>
          <th className="text-center px-2 py-1">Giá ({Math.round(w.price * 100)}%)</th>
          <th className="text-center px-2 py-1">Chất lượng ({Math.round(w.quality * 100)}%)</th>
          <th className="text-center px-2 py-1">Thanh toán ({Math.round(w.paymentTerms * 100)}%)</th>
          <th className="text-right px-2 py-1">Điểm tổng</th><th />
        </tr></thead>
        <tbody>
          {detail.vendors.map(v => {
            const s = scores[v.vendorName] || { gia: '', chatLuong: '', thanhToan: '' }
            const ov = liveOverall(v.vendorName)
            const isTop = !!top && top.v.id === v.id
            return (
              <tr key={v.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-2 py-1 font-semibold">{isTop && '★ '}{v.vendorName}</td>
                {(['gia', 'chatLuong', 'thanhToan'] as const).map(k => (
                  <td key={k} className="px-2 py-1 text-center"><input type="number" min={0} max={100} value={s[k]} onChange={e => setField(v.vendorName, k, e.target.value)} className="input text-xs text-center" style={{ width: 64 }} /></td>
                ))}
                <td className="px-2 py-1 text-right font-mono font-bold" style={{ color: isTop ? '#166534' : 'var(--text-primary)' }}>{ov !== null ? ov.toFixed(1) : '—'}</td>
                <td className="px-2 py-1 text-right"><Button variant="outline" size="sm" onClick={() => save(v)} disabled={savingName === v.vendorName}>{savingName === v.vendorName ? '…' : 'Lưu điểm'}</Button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {top && (
        <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg p-2" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
          <span className="text-xs" style={{ color: '#166534' }}>Cao điểm nhất: <b>{top.v.vendorName}</b> ({top.overall.toFixed(1)} điểm)</span>
          <Button variant="primary" size="sm" onClick={assignTop}>Giao cả gói cho NCC này</Button>
        </div>
      )}
    </KhungChon>
  )
}

// ══ Modal: tạo RFQ từ PR item ══
function CreateRfqModal({ items, picked, setPicked, subject, setSubject, projectCode, onCancel, onCreate, onCreateBulk }: {
  items: PrItem[]; picked: Set<string>; setPicked: (s: Set<string>) => void; subject: string; setSubject: (s: string) => void; projectCode: string; onCancel: () => void; onCreate: () => void; onCreateBulk: () => void
}) {
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n) }
  const allChecked = items.length > 0 && picked.size === items.length
  // Số nhóm vật tư trong tập sẽ gom (đã chọn, hoặc tất cả nếu chưa chọn) — để gợi ý nút bulk.
  const scope = picked.size ? items.filter(i => picked.has(i.id)) : items
  const groupCount = new Set(scope.map(i => i.materialGroupCode || 'KHAC')).size
  // #6 — Preview mã BID dự kiến (mat = nhóm nếu tập chỉ 1 nhóm, else ALL).
  const [previewCode, setPreviewCode] = useState('')
  useEffect(() => {
    if (!projectCode) return
    const grps = new Set(scope.map(i => i.materialGroupCode || 'KHAC'))
    const mat = grps.size === 1 ? [...grps][0] : 'ALL'
    apiFetch(`/api/procurement/bid-analyses/preview-bidcode?projectCode=${encodeURIComponent(projectCode)}&materialGroupCode=${encodeURIComponent(mat)}`)
      .then(r => { if (r.ok) setPreviewCode(r.bidCode) })
  }, [projectCode, picked.size]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onCancel}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 900, width: '100%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-primary)' }}>Tạo RFQ — chọn dòng PR cần báo giá
          {previewCode && <span className="text-[11px] font-mono font-normal px-2 py-0.5 rounded" style={{ background: 'var(--surface-hover)', color: 'var(--accent)' }} title="Mã BID dự kiến (tạo 1 RFQ)">dự kiến: {previewCode}</span>}
        </h3>
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
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đã chọn {picked.size}/{items.length}{items.length > 0 && ` · ${groupCount} nhóm vật tư`}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Huỷ</Button>
            <Button variant="outline" onClick={onCreateBulk} disabled={items.length === 0} title="Gom theo nhóm vật tư — mỗi nhóm 1 RFQ riêng">Tạo theo nhóm ({groupCount})</Button>
            <Button variant="primary" onClick={onCreate} disabled={picked.size === 0}>Tạo 1 RFQ</Button>
          </div>
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
      const next = { ...rows }; let matched = 0, unmatched = 0

      // 1) Ưu tiên parser IBS chuẩn: đọc template báo giá song ngữ (header dò tự động, cột 2 ngôn ngữ),
      //    khớp dòng ↔ vật tư BID theo mã/quy cách/mác (không phụ thuộc STT).
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      const lines = parseQuoteExcel(grid)
      if (lines.length > 0) {
        const prShape = items.map(it => ({ stt: it.itemCode || '', code: it.itemCode || '', description: it.itemName || '', profile: it.profile || '', grade: it.grade || '', unit: it.uom || '', qty: it.qtyToBuy }))
        for (const l of matchQuoteLinesToPr(lines, prShape)) {
          if (l.unitPrice <= 0) continue
          if (l.matchedPrIndex == null || l.matchedPrIndex < 0) { unmatched++; continue }
          const it = items[l.matchedPrIndex]
          next[it.id] = { unitPrice: String(l.unitPrice), totalPrice: String(l.amount > 0 ? l.amount : Math.round(l.unitPrice * it.qtyToBuy)), scope: 'V', manual: l.amount > 0 }
          matched++
        }
      }

      // 2) Fallback: sheet phẳng (header dòng đầu, cột "Mã VT"/"Đơn giá") — khớp theo mã.
      if (matched === 0) {
        const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')
        const byCode = new Map(items.map(it => [norm(it.itemCode || ''), it]))
        const pick = (r: Record<string, unknown>, keys: string[]) => { for (const k of Object.keys(r)) { if (keys.some(t => norm(k) === norm(t))) return r[k] } return '' }
        const toNum = (v: unknown) => typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, '')) || 0
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
      }

      setRows(next)
      notify(matched > 0 ? `Đã khớp ${matched} dòng báo giá${unmatched ? `, ${unmatched} dòng không khớp vật tư BID` : ''}` : 'Không khớp dòng nào — kiểm tra file có cột Đơn giá + quy cách/mác khớp với BID', matched > 0 ? 'success' : 'error')
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
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ghi chú (điều kiện giao/thanh toán/hiệu lực…)" className="input text-sm md:col-span-1" />
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
                  <td className="px-2 py-1 text-center"><select value={r?.scope || 'V'} onChange={e => setScope(it.id, e.target.value)} className="input text-xs" style={{ width: 56 }}><option value="V">V</option><option value="X">X</option><option value="">—</option></select></td>
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

// ══ Thẻ bước quy trình (P3.5/P3.6) — dùng cầu step-task, không đụng workflow-engine ══
function StepBanner({ p35, p36, projectId, bids, onDone }: { p35: StepTask | null; p36: StepTask | null; projectId: string; bids: BidRow[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [rejOpen, setRejOpen] = useState(false)
  const [rejReason, setRejReason] = useState('')
  const p36Active = p36 && p36.canEdit && p36.status !== 'DONE'
  const p35Active = p35 && p35.canEdit && p35.status !== 'DONE'

  const completeP35 = async () => {
    if (!await confirmDialog('Hoàn thành bước "Tìm NCC" (P3.5)? Quy trình chuyển sang BGĐ duyệt (P3.6).')) return
    setBusy(true)
    const r = await apiFetch('/api/work/step-task', { method: 'POST', body: JSON.stringify({ projectId, stepCode: 'P3.5', action: 'complete' }) })
    setBusy(false)
    if (r.ok) { notify('Đã hoàn thành P3.5 — chuyển BGĐ duyệt', 'success'); onDone() } else notify(r.error || 'Lỗi hoàn thành', 'error')
  }
  const approveAndPO = async () => {
    if (!await confirmDialog('BGĐ duyệt: TẠO PO cho các BID đã chọn NCC rồi hoàn thành bước P3.6?')) return
    setBusy(true)
    let created = 0, total = 0
    for (const b of bids) {
      const r = await apiFetch(`/api/procurement/bid-analyses/${b.id}/create-po`, { method: 'POST', body: '{}' })
      if (r.ok && Array.isArray(r.pos)) { total += r.pos.length; created += r.pos.filter((p: { existing?: boolean }) => !p.existing).length }
    }
    // Chặn đóng bước duyệt rỗng: chưa BID nào chọn NCC → không có PO → không hoàn thành P3.6
    if (total === 0) { setBusy(false); notify('Chưa có BID nào chọn NCC — vào tab Duyệt chọn NCC trước khi duyệt', 'error'); return }
    const c = await apiFetch('/api/work/step-task', { method: 'POST', body: JSON.stringify({ projectId, stepCode: 'P3.6', action: 'complete' }) })
    setBusy(false)
    if (c.ok) { notify(created > 0 ? `Đã tạo ${created} PO + hoàn thành P3.6` : `Đã hoàn thành P3.6 (${total} PO đã có)`, 'success'); onDone() } else notify(c.error || 'Lỗi hoàn thành P3.6', 'error')
  }
  const reject = async () => {
    if (!rejReason.trim() || !p36) { notify('Nhập lý do', 'error'); return }
    setBusy(true)
    const r = await apiFetch(`/api/work/tasks/${p36.id}/return`, { method: 'POST', body: JSON.stringify({ reason: rejReason.trim() }) })
    setBusy(false)
    if (r.ok) { notify('Đã trả lại bước P3.5', 'success'); setRejOpen(false); setRejReason(''); onDone() } else notify(r.error || 'Lỗi', 'error')
  }

  if (!p35Active && !p36Active) return null
  return (
    <div className="card p-4" style={{ border: '1px solid #6366f140', background: '#f5f3ff' }}>
      {p36Active ? (
        <div className="space-y-2">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <span className="text-sm font-bold" style={{ color: '#4338ca' }}>⚙️ Bước P3.6 — BGĐ duyệt báo giá</span>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Xem tab So sánh/Duyệt. Bấm duyệt → hệ thống tạo PO (gom theo NCC) rồi chuyển bước tiếp.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRejOpen(v => !v)}>Từ chối → trả P3.5</Button>
              <Button variant="primary" onClick={approveAndPO} disabled={busy}>✓ BGĐ duyệt &amp; tạo PO</Button>
            </div>
          </div>
          {rejOpen && (
            <div className="flex gap-2">
              <input value={rejReason} onChange={e => setRejReason(e.target.value)} placeholder="Lý do từ chối…" className="input text-sm flex-1" />
              <Button variant="danger" onClick={reject} disabled={busy}>Gửi trả lại</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <span className="text-sm font-bold" style={{ color: '#4338ca' }}>⚙️ Bước P3.5 — Thương mại tìm NCC</span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Tạo RFQ, nhập báo giá, chọn NCC cho các dòng (tab Duyệt). Xong bấm hoàn thành để BGĐ duyệt.</p>
          </div>
          <Button variant="primary" onClick={completeP35} disabled={busy}>✓ Hoàn thành tìm NCC → BGĐ duyệt</Button>
        </div>
      )}
    </div>
  )
}

// #6 — Panel ghi nhận thời điểm 15 mốc quy trình mua sắm (record-only).
interface MItem { no: number; label: string; phase: string; occurredAt: string | null; note: string | null }
function MilestonesPanel({ bidId }: { bidId: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const roleCode = useAuthStore(s => s.user?.roleCode)
  const canRecord = ['R01', 'R02', 'R07', 'R07a', 'R10'].includes(roleCode || '')
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${bidId}/milestones`)
    if (r.ok) { setItems(r.milestones || []); setLoaded(true) }
  }, [bidId])
  useEffect(() => { if (open && !loaded) load() }, [open, loaded, load])
  const rec = async (no: number, clear = false) => {
    const r = clear
      ? await apiFetch(`/api/procurement/bid-analyses/${bidId}/milestones?milestoneNo=${no}`, { method: 'DELETE' })
      : await apiFetch(`/api/procurement/bid-analyses/${bidId}/milestones`, { method: 'POST', body: JSON.stringify({ milestoneNo: no }) })
    if (r.ok) { notify(r.message || 'Đã cập nhật', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }
  const doneCount = items.filter(m => m.occurredAt).length
  return (
    <div className="rounded-lg mt-3" style={{ border: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
        <span>🕒 Mốc thời gian quy trình (15 mốc){loaded ? ` — đã ghi ${doneCount}/15` : ''}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1">
          {!loaded ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>
            : items.map(m => (
              <div key={m.no} className="flex items-center justify-between gap-2 text-[11px] py-0.5" style={{ borderTop: m.no > 1 ? '1px dashed var(--border)' : 'none' }}>
                <span><b>{m.no}.</b> {m.label} <span style={{ color: 'var(--text-muted)' }}>· {m.phase}</span></span>
                <span className="flex items-center gap-2 flex-none">
                  {m.occurredAt ? <b style={{ color: '#166534' }}>✓ {formatDate(m.occurredAt)}</b> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  {canRecord && (m.occurredAt
                    ? <button onClick={() => rec(m.no, true)} style={{ color: 'var(--text-muted)' }} title="Xoá mốc">✕</button>
                    : <button onClick={() => rec(m.no)} className="font-semibold" style={{ color: 'var(--accent)' }}>Ghi</button>)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
