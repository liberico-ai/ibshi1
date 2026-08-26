'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader } from '@/components/ui'

// Ánh xạ nhà cung cấp (dọn dữ liệu) — ghép tên NCC tự do trong báo giá → Vendor master.
interface Unmapped { vendorName: string; count: number; suggestId: string | null; suggestName: string | null }

export default function AnhXaNccPage() {
  const [rows, setRows] = useState<Unmapped[]>([])
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Record<string, string>>({})
  const roleCode = useAuthStore(s => s.user?.roleCode)
  const canMap = ['R01', 'R07', 'R07a', 'R10'].includes(roleCode || '')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch('/api/procurement/vendor-mapping')
    setLoading(false)
    if (r.ok) {
      setRows(r.unmapped || []); setVendors(r.vendors || [])
      // Mặc định chọn gợi ý nếu có.
      const init: Record<string, string> = {}
      for (const u of (r.unmapped || []) as Unmapped[]) init[u.vendorName] = u.suggestId || '__new__'
      setSel(init)
    } else notify(r.error || 'Lỗi tải', 'error')
  }, [])
  useEffect(() => { load() }, [load])

  const map = async (vendorName: string) => {
    const vendorId = sel[vendorName] || '__new__'
    const r = await apiFetch('/api/procurement/vendor-mapping', { method: 'POST', body: JSON.stringify({ vendorName, vendorId }) })
    if (r.ok) { notify(r.message || 'Đã ghép', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Ánh xạ nhà cung cấp" subtitle="Dọn dữ liệu — ghép tên NCC tự do trong báo giá vào danh mục NCC (Vendor master) để đồng bộ lịch sử & thống kê" />
      {loading ? <div className="text-center py-16 text-slate-400 text-sm">Đang tải…</div>
        : rows.length === 0 ? <div className="text-center py-16 text-emerald-600 text-sm">👍 Mọi NCC trong báo giá đã được ánh xạ vào danh mục.</div>
          : (
            <>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}><b style={{ color: 'var(--warning)' }}>{rows.length}</b> tên NCC chưa ánh xạ</div>
              <div className="card p-0 overflow-hidden"><div style={{ overflowX: 'auto' }}>
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg-secondary)' }}>{['Tên NCC (trong báo giá)', 'Số bản ghi', 'Ghép vào NCC', ''].map(h => <th key={h} className="px-3 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map(u => (
                      <tr key={u.vendorName} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-3 py-2 font-semibold">{u.vendorName}{u.suggestName && <span className="block text-[10px]" style={{ color: '#166534' }}>gợi ý: {u.suggestName}</span>}</td>
                        <td className="px-3 py-2 font-mono">{u.count}</td>
                        <td className="px-3 py-2">
                          <select value={sel[u.vendorName] || '__new__'} onChange={e => setSel(p => ({ ...p, [u.vendorName]: e.target.value }))} className="input text-xs" style={{ maxWidth: 320 }} disabled={!canMap}>
                            <option value="__new__">➕ Tạo NCC mới: "{u.vendorName}"</option>
                            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">{canMap && <button onClick={() => map(u.vendorName)} className="text-[11px] font-semibold px-2 py-1 rounded" style={{ background: '#166534', color: '#fff' }}>Ghép</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </>
          )}
    </div>
  )
}
