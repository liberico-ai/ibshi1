'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button, Badge } from '@/components/ui'

interface Proj { id: string; projectCode: string; projectName: string }
interface BidRow { id: string; bidCode: string; subject: string; status: string; matGroup: string | null; urgent: boolean; itemCount: number; vendorCount: number; totalValue: number }
interface PrItem { id: string; itemCode: string; itemName: string; profile: string; grade: string; uom: string; toBuyQty: number; materialGroupCode: string | null; prCode: string }
interface Vendor { id: string; vendorName: string; vendorType: string; currency: string; totalQuote: number; isWinner: boolean }
interface Offer { unitPrice: number; totalPrice: number; deliveryTerm?: string | null; remarks?: string | null }
interface BidItem { id: string; itemOrder: number; itemCode: string; itemName: string; profile: string; grade: string; uom: string; qtyToBuy: number; selectedVendorName: string | null; offers: Record<string, Offer> }
interface BidDetail { bid: { id: string; bidCode: string; subject: string; status: string; matGroup: string | null }; vendors: Vendor[]; items: BidItem[] }

const STATUS_COLOR: Record<string, 'info' | 'warning' | 'success' | 'default'> = {
  OPEN: 'info', EVALUATING: 'warning', SELECTED: 'success', CONTRACTED: 'success', CANCELLED: 'default',
}
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Mới tạo', EVALUATING: 'Đang chào giá', SELECTED: 'Đã chọn NCC', CONTRACTED: 'Đã ký HĐ', CANCELLED: 'Đã huỷ',
}
const fmt = (n: number) => n.toLocaleString('vi-VN')

export default function BiddingPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [bids, setBids] = useState<BidRow[]>([])
  const [detail, setDetail] = useState<BidDetail | null>(null)
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
    const r = await apiFetch('/api/procurement/bid-analyses/from-pr', {
      method: 'POST',
      body: JSON.stringify({ projectId, prItemIds: [...picked], subject: subject || undefined }),
    })
    if (r.ok) { notify(`Đã tạo ${r.bidCode}`, 'success'); setShowCreate(false); loadBids() }
    else notify(r.error || 'Lỗi tạo RFQ', 'error')
  }

  const openDetail = async (id: string) => {
    const r = await apiFetch(`/api/procurement/bid-analyses/${id}`)
    if (r.ok) setDetail({ bid: r.bid, vendors: r.vendors, items: r.items })
    else notify(r.error || 'Lỗi tải BID', 'error')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Báo giá / Đấu thầu (RFQ)" subtitle="Tạo yêu cầu báo giá từ PR → nhập báo giá NCC → so sánh" />

      <div className="flex gap-3 items-center flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {projectId && <Button variant="primary" onClick={openCreate}>+ Tạo RFQ từ PR</Button>}
      </div>

      {/* Danh sách BID */}
      {projectId && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Mã BID</th><th>Chủ đề</th><th>Nhóm</th><th className="text-center">Dòng</th><th className="text-center">NCC</th><th className="text-right">Tổng giá trị</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {bids.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có RFQ nào — bấm &quot;Tạo RFQ từ PR&quot;</td></tr>
              ) : bids.map(b => (
                <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(b.id)}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{b.urgent && '⚡'}{b.bidCode}</span></td>
                  <td className="text-xs">{b.subject}</td>
                  <td><span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--surface-hover)' }}>{b.matGroup || '—'}</span></td>
                  <td className="text-center text-xs">{b.itemCount}</td>
                  <td className="text-center text-xs">{b.vendorCount}</td>
                  <td className="text-right font-mono text-xs">{b.totalValue > 0 ? fmt(b.totalValue) : '—'}</td>
                  <td><Badge variant={STATUS_COLOR[b.status] || 'default'}>{STATUS_LABEL[b.status] || b.status}</Badge></td>
                  <td className="text-right"><span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Xem →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Chi tiết BID — ma trận item × NCC */}
      {detail && (
        <div className="card p-5 space-y-3">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{detail.bid.bidCode}</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{detail.bid.subject}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setShowQuote(true)}>+ Nhập báo giá NCC</Button>
              <Button variant="outline" onClick={() => setDetail(null)}>Đóng</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th className="text-left px-2 py-1.5">#</th>
                  <th className="text-left px-2 py-1.5">Mã VT</th>
                  <th className="text-left px-2 py-1.5">Tên</th>
                  <th className="text-right px-2 py-1.5">SL mua</th>
                  {detail.vendors.map(v => (
                    <th key={v.id} className="text-right px-2 py-1.5" style={{ minWidth: 90 }}>
                      {v.vendorName}
                      <div className="font-normal" style={{ color: 'var(--text-muted)' }}>{v.currency}</div>
                    </th>
                  ))}
                  {detail.vendors.length === 0 && <th className="text-center px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>(chưa có báo giá)</th>}
                </tr>
              </thead>
              <tbody>
                {detail.items.map(it => {
                  const prices = detail.vendors.map(v => it.offers[v.id]?.unitPrice || 0).filter(p => p > 0)
                  const min = prices.length ? Math.min(...prices) : 0
                  return (
                    <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{it.itemOrder}</td>
                      <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                      <td className="px-2 py-1">{it.itemName}{it.profile && <span style={{ color: 'var(--text-muted)' }}> · {it.profile}</span>}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(it.qtyToBuy)} {it.uom}</td>
                      {detail.vendors.map(v => {
                        const o = it.offers[v.id]
                        const isMin = o && o.unitPrice > 0 && o.unitPrice === min
                        return (
                          <td key={v.id} className="px-2 py-1 text-right font-mono" style={{ background: isMin ? '#dcfce7' : undefined, fontWeight: isMin ? 700 : 400, color: isMin ? '#166534' : 'var(--text-primary)' }}>
                            {o && o.unitPrice > 0 ? fmt(o.unitPrice) : '—'}
                          </td>
                        )
                      })}
                      {detail.vendors.length === 0 && <td />}
                    </tr>
                  )
                })}
                {detail.vendors.length > 0 && (
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                    <td colSpan={4} className="px-2 py-1.5 text-right">Tổng báo giá:</td>
                    {detail.vendors.map(v => <td key={v.id} className="px-2 py-1.5 text-right font-mono">{fmt(v.totalQuote)}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateRfqModal items={prItems} picked={picked} setPicked={setPicked} subject={subject} setSubject={setSubject}
          onCancel={() => setShowCreate(false)} onCreate={createRfq} />
      )}
      {showQuote && detail && (
        <EnterQuoteModal bidId={detail.bid.id} items={detail.items} onCancel={() => setShowQuote(false)}
          onSaved={() => { setShowQuote(false); openDetail(detail.bid.id); loadBids() }} />
      )}
    </div>
  )
}

// ── Modal: tạo RFQ từ PR item ──
function CreateRfqModal({ items, picked, setPicked, subject, setSubject, onCancel, onCreate }: {
  items: PrItem[]; picked: Set<string>; setPicked: (s: Set<string>) => void
  subject: string; setSubject: (s: string) => void; onCancel: () => void; onCreate: () => void
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
                    <td className="px-2 py-1 text-right font-mono">{fmt(it.toBuyQty)} {it.uom}</td>
                    <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-muted)' }}>{it.prCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Đã chọn {picked.size}/{items.length}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Huỷ</Button>
            <Button variant="primary" onClick={onCreate} disabled={picked.size === 0}>Tạo RFQ</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: nhập báo giá 1 NCC ──
function EnterQuoteModal({ bidId, items, onCancel, onSaved }: {
  bidId: string; items: BidItem[]; onCancel: () => void; onSaved: () => void
}) {
  const [vendorName, setVendorName] = useState('')
  const [vendorType, setVendorType] = useState('DOMESTIC')
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Tải mẫu Excel: cột "Đơn giá" để trống cho NCC điền, khớp lại theo "Mã VT".
  const downloadTemplate = () => {
    const rows = items.map(it => ({
      'Mã VT': it.itemCode || '', 'Tên': it.itemName || '', 'ĐVT': it.uom || '',
      'SL mua': it.qtyToBuy, 'Đơn giá': '', 'Điều kiện giao': '', 'Ghi chú': '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 20 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BaoGia')
    XLSX.writeFile(wb, `MauBaoGia_${(vendorName || 'NCC').replace(/[^\w]/g, '')}.xlsx`)
  }

  // Import Excel: đọc dòng, khớp "Mã VT" (chuẩn hoá hoa/khoảng trắng) → điền Đơn giá.
  const importExcel = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')
      const byCode = new Map(items.map(it => [norm(it.itemCode || ''), it.id]))
      const pick = (r: Record<string, unknown>, keys: string[]) => {
        for (const k of Object.keys(r)) { if (keys.some(t => norm(k) === norm(t))) return r[k] }
        return ''
      }
      const toNum = (v: unknown) => typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, '')) || 0
      const next = { ...prices }
      let matched = 0, unmatched = 0
      for (const r of rows) {
        const code = norm(String(pick(r, ['Mã VT', 'Ma VT', 'itemCode', 'Mã'])))
        const price = toNum(pick(r, ['Đơn giá', 'Don gia', 'unitPrice', 'Giá']))
        if (!code) continue
        const id = byCode.get(code)
        if (id && price > 0) { next[id] = String(price); matched++ }
        else if (price > 0) unmatched++
      }
      setPrices(next)
      notify(matched > 0 ? `Đã khớp ${matched} dòng theo Mã VT${unmatched ? `, ${unmatched} dòng không khớp` : ''}` : 'Không khớp dòng nào — kiểm tra cột "Mã VT"/"Đơn giá"', matched > 0 ? 'success' : 'error')
    } catch (e) {
      console.error('importExcel error:', e)
      notify('Không đọc được file Excel', 'error')
    }
  }

  const save = async () => {
    if (!vendorName.trim()) { notify('Nhập tên NCC', 'error'); return }
    const lines = items.map(it => ({ itemId: it.id, unitPrice: Number(prices[it.id]) || 0 })).filter(l => l.unitPrice > 0)
    if (lines.length === 0) { notify('Nhập ít nhất 1 đơn giá', 'error'); return }
    setSaving(true)
    const r = await apiFetch(`/api/procurement/bid-analyses/${bidId}/quotes`, {
      method: 'POST', body: JSON.stringify({ vendorName: vendorName.trim(), vendorType, items: lines }),
    })
    setSaving(false)
    if (r.ok) { notify('Đã lưu báo giá', 'success'); onSaved() }
    else notify(r.error || 'Lỗi lưu báo giá', 'error')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onCancel}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Nhập báo giá NCC</h3>
          <div className="flex gap-2">
            <button type="button" onClick={downloadTemplate} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--surface)' }}>⬇ Tải mẫu Excel</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid #16a34a', color: '#166534', background: '#f0fdf4' }}>⬆ Import Excel (khớp Mã VT)</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = '' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Tên NCC *" className="input text-sm" />
          <select value={vendorType} onChange={e => setVendorType(e.target.value)} className="input text-sm">
            <option value="DOMESTIC">Nội địa</option><option value="IMPORT">Nhập khẩu</option>
          </select>
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: '50vh' }}>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--bg-secondary)' }}>
              <th className="text-left px-2 py-1.5">Mã VT</th><th className="text-left px-2 py-1.5">Tên</th><th className="text-right px-2 py-1.5">SL mua</th><th className="text-right px-2 py-1.5">Đơn giá</th>
            </tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--accent)' }}>{it.itemCode || '—'}</td>
                  <td className="px-2 py-1">{it.itemName}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(it.qtyToBuy)} {it.uom}</td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" value={prices[it.id] || ''} onChange={e => setPrices(p => ({ ...p, [it.id]: e.target.value }))}
                      className="input text-xs text-right" style={{ width: 110 }} placeholder="0" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Huỷ</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu báo giá'}</Button>
        </div>
      </div>
    </div>
  )
}
