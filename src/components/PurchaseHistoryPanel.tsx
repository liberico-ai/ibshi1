'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { X, ExternalLink, Search } from 'lucide-react'

// [PORT Thương Mại — F3] Panel trượt: lịch sử mua 1 SKU (số GD, NCC, giá TB/min/max, biểu đồ NCC, 10 GD gần nhất).
interface Tx { id: string; poCode: string; vendorName: string; orderDate: string | null; qty: number; unitPrice: number; currency: string; totalNoVAT: number; status: string; projectCode: string }
interface Vendor { vendorName: string; txCount: number; totalQty: number; latestPrice: number }
interface Summary { totalTransactions: number; totalVendors: number; avgUnitPrice: number; minUnitPrice: number; maxUnitPrice: number; latestVendor: string | null; latestPrice: number | null; latestDate: string | null }
interface Data { itemCode: string; found: boolean; itemName?: string; uom?: string; summary: Summary | null; recentTransactions: Tx[]; vendorSummary: Vendor[] }

const STATUS_COLORS: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-700', COMPLETED: 'bg-emerald-100 text-emerald-700',
  PARTIAL: 'bg-amber-100 text-amber-700', PENDING: 'bg-slate-100 text-slate-600',
  ORDERED: 'bg-blue-100 text-blue-700', CANCELLED: 'bg-red-100 text-red-600', DRAFT: 'bg-slate-100 text-slate-600',
}
const fmt = (n: number | null | undefined, c = 'VND') => !n ? '—' : (c === 'VND' ? n.toLocaleString('vi-VN') + ' ₫' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + c)
const fmtDate = (d: string | null | undefined) => !d ? '—' : new Date(d).toLocaleDateString('vi-VN')
const fmtQty = (n: number, uom?: string) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + (uom ? ' ' + uom : '')

export default function PurchaseHistoryPanel({ itemCode, itemName, onClose }: { itemCode: string; itemName?: string; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const r = await apiFetch(`/api/procurement/purchase-history/summary?itemCode=${encodeURIComponent(itemCode)}`)
    setLoading(false)
    if (r.ok) setData(r as unknown as Data); else setError(r.error || 'Lỗi tải dữ liệu')
  }, [itemCode])
  useEffect(() => { load() }, [load])

  return (
    <div className="fixed inset-0 z-[9990] flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[520px] max-w-full bg-white h-full flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">Lịch sử mua hàng</div>
              <div className="font-semibold text-slate-900 truncate">{itemCode}</div>
              {itemName && <div className="text-sm text-slate-600 truncate mt-0.5">{itemName}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a href={`/dashboard/warehouse/lich-su-mua-hang?itemCodes=${encodeURIComponent(itemCode)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline"><ExternalLink className="w-3.5 h-3.5" />Xem đầy đủ</a>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200" aria-label="Đóng"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && <div className="text-center py-16 text-slate-400 text-sm">Đang tải…</div>}
          {error && <div className="p-4 bg-red-50 rounded-lg text-red-600 text-sm">{error}</div>}
          {!loading && !error && data && !data.found && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2"><Search className="w-10 h-10" /><div className="text-sm">Chưa có lịch sử mua hàng cho mã này</div></div>
          )}
          {!loading && !error && data?.found && data.summary && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3"><div className="text-[11px] text-slate-500">Số giao dịch</div><div className="text-lg font-semibold text-slate-900">{data.summary.totalTransactions}</div></div>
                <div className="bg-slate-50 rounded-xl p-3"><div className="text-[11px] text-slate-500">Nhà cung cấp</div><div className="text-lg font-semibold text-slate-900">{data.summary.totalVendors}</div></div>
                <div className="bg-slate-50 rounded-xl p-3"><div className="text-[11px] text-slate-500">Giá gần nhất</div><div className="text-sm font-semibold text-slate-800">{fmt(data.summary.latestPrice)}</div><div className="text-[11px] text-slate-400">{fmtDate(data.summary.latestDate)}</div></div>
                <div className="bg-slate-50 rounded-xl p-3"><div className="text-[11px] text-slate-500">Giá TB</div><div className="text-sm font-semibold text-slate-800">{fmt(data.summary.avgUnitPrice)}</div><div className="text-[11px] text-slate-400">{fmt(data.summary.minUnitPrice)} – {fmt(data.summary.maxUnitPrice)}</div></div>
              </div>

              {data.vendorSummary.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">Nhà cung cấp đã mua</div>
                  <div className="space-y-2">
                    {data.vendorSummary.map(v => {
                      const maxQty = Math.max(...data.vendorSummary.map(x => x.totalQty), 1)
                      return (
                        <div key={v.vendorName} className="flex items-center gap-2">
                          <div className="w-28 text-[11px] text-slate-600 truncate" title={v.vendorName}>{v.vendorName}</div>
                          <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden"><div className="h-full bg-blue-600/70 rounded" style={{ width: `${Math.round((v.totalQty / maxQty) * 100)}%` }} /></div>
                          <div className="text-[11px] text-slate-500 w-16 text-right">{fmtQty(v.totalQty, data.uom)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">10 giao dịch gần nhất</div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead><tr className="bg-slate-50 text-slate-500">
                      <th className="px-2 py-2 text-left font-medium">Ngày</th><th className="px-2 py-2 text-left font-medium">NCC</th>
                      <th className="px-2 py-2 text-right font-medium">Số lượng</th><th className="px-2 py-2 text-right font-medium">Đơn giá</th>
                      <th className="px-2 py-2 text-left font-medium">DA</th><th className="px-2 py-2 text-left font-medium">TT</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentTransactions.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50">
                          <td className="px-2 py-2 whitespace-nowrap">{fmtDate(t.orderDate)}</td>
                          <td className="px-2 py-2 max-w-[100px] truncate" title={t.vendorName}>{t.vendorName}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmtQty(t.qty, data.uom)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{fmt(t.unitPrice, t.currency)}</td>
                          <td className="px-2 py-2 text-slate-500 max-w-[60px] truncate" title={t.projectCode}>{t.projectCode || '—'}</td>
                          <td className="px-2 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[t.status] || 'bg-slate-100 text-slate-600'}`}>{t.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
