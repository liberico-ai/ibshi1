'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { RBAC } from '@/lib/rbac-rules'
import { formatCurrency, formatNumber } from '@/lib/utils'

interface Alias { id: string; aliasCode: string; source: string; note: string | null }
interface StockLoc { warehouseCode: string; warehouseName: string; projectCode: string | null; kind: string; quantity: number; value: number }
interface Material {
  id: string; materialCode: string; name: string; unit: string; category: string
  specification: string | null; grade: string | null; currentStock: number
  unitPrice: number | null; currency: string; status: string; isProvisional: boolean
  createdByUnit: string | null; aliasCount: number
}
interface Pagination { page: number; limit: number; total: number; totalPages: number }

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Đang dùng', PENDING: 'Chờ duyệt', ARCHIVE: 'Lưu trữ', OBSOLETE: 'Ngừng dùng' }
const STATUS_COLOR: Record<string, string> = { ACTIVE: '#10b981', PENDING: '#f59e0b', ARCHIVE: '#6b7280', OBSOLETE: '#ef4444' }
const fmt = (n: number | null) => (n == null ? '—' : formatNumber(n))

export default function MaterialCodesPage() {
  const { user } = useAuthStore()
  const canEdit = !!user && RBAC.MATERIAL_CODE_ADMIN.includes(user.roleCode)

  const [materials, setMaterials] = useState<Material[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [provisional, setProvisional] = useState('')
  const [page, setPage] = useState(1)

  // resolve box
  const [resolveCode, setResolveCode] = useState('')
  const [resolveResult, setResolveResult] = useState<string | null>(null)

  // detail modal
  const [detail, setDetail] = useState<(Material & { aliases: Alias[]; stocks: StockLoc[] }) | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (q) params.set('q', q)
    if (status) params.set('status', status)
    if (provisional) params.set('provisional', provisional)
    apiFetch(`/api/materials?${params.toString()}`).then((res) => {
      if (res.ok) { setMaterials(res.materials); setPagination(res.pagination) }
      setLoading(false)
    })
  }, [page, q, status, provisional])

  useEffect(() => { load() }, [load])

  const doResolve = async () => {
    if (!resolveCode.trim()) return
    const res = await apiFetch(`/api/materials/resolve?code=${encodeURIComponent(resolveCode.trim())}`)
    if (res.ok) setResolveResult(`${resolveCode.trim()} → ${res.material.materialCode} — ${res.material.name} (nguồn: ${res.resolvedFrom === 'canonical' ? 'mã chuẩn' : 'bí danh'})`)
    else setResolveResult(`${res.error || 'Không tìm thấy'}`)
  }

  const openDetail = async (id: string) => {
    const res = await apiFetch(`/api/materials/${id}`)
    if (res.ok) setDetail(res.material)
  }

  const approve = async (id: string) => {
    const res = await apiFetch(`/api/materials/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE', isProvisional: false }) })
    if (res.ok) { setDetail(null); load() } else alert(res.error || 'Lỗi')
  }

  const addAlias = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!detail) return
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch(`/api/materials/${detail.id}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ aliasCode: fd.get('aliasCode'), source: fd.get('source'), note: fd.get('note') || undefined }),
    })
    if (res.ok) openDetail(detail.id)
    else alert(res.error || 'Lỗi')
  }

  const delAlias = async (aliasId: string) => {
    if (!detail || !confirm('Xoá mã bí danh này?')) return
    const res = await apiFetch(`/api/materials/aliases/${aliasId}`, { method: 'DELETE' })
    if (res.ok) openDetail(detail.id)
    else alert(res.error || 'Lỗi')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quản lý mã vật tư</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pagination.total} mã · mã chuẩn duy nhất + bí danh các phòng</p>
        </div>
      </div>

      {/* Resolve box */}
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Tra mã (chuẩn hoặc cũ → mã chuẩn)</div>
        <div className="flex gap-2 flex-wrap">
          <input value={resolveCode} onChange={(e) => setResolveCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doResolve()}
            placeholder="Nhập mã bất kỳ, vd BAH.AOBH.001 hoặc BAH-AOBH-001"
            className="text-sm px-3 py-2 rounded-lg flex-1 min-w-[260px]" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          <button onClick={doResolve} className="btn-primary text-sm px-4 py-2 rounded-lg">Tra</button>
        </div>
        {resolveResult && <div className="text-sm mt-2" style={{ color: 'var(--text-primary)' }}>{resolveResult}</div>}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input value={q} onChange={(e) => { setPage(1); setQ(e.target.value) }} placeholder="Tìm theo tên / mã / bí danh…"
          className="text-sm px-3 py-2 rounded-lg flex-1 min-w-[220px]" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }} className="text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={provisional} onChange={(e) => { setPage(1); setProvisional(e.target.value) }} className="text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <option value="">Tất cả</option>
          <option value="true">Chỉ mã tạm (chờ chuẩn hóa)</option>
          <option value="false">Mã đã chuẩn</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 skeleton rounded-lg" />)}</div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm" style={{ minWidth: 1100 }}>
            <thead>
              <tr style={{ background: 'var(--ibs-navy)' }}>
                <th className="text-left px-3 py-2.5 font-semibold text-white text-xs whitespace-nowrap" style={{ width: 140 }}>MÃ VT</th>
                <th className="text-left px-3 py-2.5 font-semibold text-white text-xs" style={{ width: '22%' }}>TÊN VẬT TƯ</th>
                <th className="text-left px-3 py-2.5 font-semibold text-white text-xs" style={{ width: 160 }}>PROFILE</th>
                <th className="text-left px-3 py-2.5 font-semibold text-white text-xs" style={{ width: 100 }}>MÁC</th>
                <th className="text-center px-2 py-2.5 font-semibold text-white text-xs" style={{ width: 50 }}>ĐVT</th>
                <th className="text-right px-3 py-2.5 font-semibold text-white text-xs" style={{ width: 90 }}>TỒN KHO</th>
                <th className="text-right px-3 py-2.5 font-semibold text-white text-xs" style={{ width: 80 }}>KHẢ DỤNG</th>
                <th className="text-right px-3 py-2.5 font-semibold text-white text-xs" style={{ width: 110 }}>ĐƠN GIÁ</th>
                <th className="text-center px-2 py-2.5 font-semibold text-white text-xs" style={{ width: 80 }}>TRẠNG THÁI</th>
                <th className="px-2 py-2.5" style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, idx) => {
                const stockNum = Number(m.currentStock) || 0
                return (
                <tr key={m.id} className="group hover:bg-blue-50/50 transition-colors" style={{ borderTop: '1px solid var(--border)', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                  <td className="px-3 py-2.5 font-mono text-xs font-bold whitespace-nowrap" style={{ color: 'var(--ibs-red)' }}>
                    {m.materialCode}
                    {m.isProvisional && <span className="ml-1 text-[10px] px-1 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92400e' }}>tạm</span>}
                  </td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{m.name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold" style={{ color: m.specification ? 'var(--ibs-navy)' : '#d1d5db' }}>{m.specification || '—'}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: m.grade ? '#475569' : '#d1d5db' }}>
                    {m.grade ? <span className="px-1.5 py-0.5 rounded" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>{m.grade}</span> : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-center text-xs" style={{ color: '#64748b' }}>{m.unit}</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: stockNum > 0 ? 'var(--ibs-navy)' : '#9ca3af' }}>{fmt(m.currentStock)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs" style={{ color: '#64748b' }}>{fmt(m.currentStock)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs" style={{ color: '#64748b' }}>{Number(m.unitPrice) > 0 ? `${fmt(m.unitPrice)} đ` : '—'}</td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: (STATUS_COLOR[m.status] || '#6b7280') + '18', color: STATUS_COLOR[m.status] || '#6b7280' }}>
                      {STATUS_LABEL[m.status] || m.status}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <button onClick={() => openDetail(m.id)} className="opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)', fontSize: '1rem' }} title="Chi tiết">›</button>
                  </td>
                </tr>
              )})}
              {materials.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Không có mã nào</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 items-center text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg disabled:opacity-40" style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>‹</button>
          <span style={{ color: 'var(--text-muted)' }}>Trang {pagination.page}/{pagination.totalPages}</span>
          <button disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg disabled:opacity-40" style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>›</button>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setDetail(null)}>
          <div className="rounded-xl p-5 w-full max-w-lg max-h-[85vh] overflow-auto" style={{ background: 'var(--surface)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{detail.materialCode}</div>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{detail.name} · {detail.unit} · {detail.category}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>

            {detail.isProvisional && canEdit && (
              <button onClick={() => approve(detail.id)} className="btn-primary text-sm px-4 py-2 rounded-lg mb-3 w-full">Duyệt mã (chuẩn hóa → ACTIVE)</button>
            )}

            {/* Thông số kỹ thuật + tồn */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
              <div className="px-2 py-1.5 rounded" style={{ background: 'var(--surface-hover)' }}>Profile: <b className="font-mono" style={{ color: 'var(--text-primary)' }}>{detail.specification || '—'}</b></div>
              <div className="px-2 py-1.5 rounded" style={{ background: 'var(--surface-hover)' }}>Mác: <b style={{ color: 'var(--text-primary)' }}>{detail.grade || '—'}</b></div>
              <div className="px-2 py-1.5 rounded" style={{ background: 'var(--surface-hover)' }}>Tổng tồn: <b style={{ color: 'var(--text-primary)' }}>{fmt(detail.currentStock)} {detail.unit}</b></div>
              <div className="px-2 py-1.5 rounded" style={{ background: 'var(--surface-hover)' }}>Đơn giá BQ: <b style={{ color: 'var(--text-primary)' }}>{fmt(detail.unitPrice)}</b></div>
            </div>

            {/* Tồn theo dự án / kho */}
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Tồn theo dự án / kho ({detail.stocks?.length || 0})</div>
            <div className="mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(detail.stocks && detail.stocks.length > 0) ? (
                <table className="w-full text-xs">
                  <thead><tr style={{ background: 'var(--surface-hover)' }}>
                    {['Kho', 'Dự án', 'SL tồn', 'Giá trị'].map((h) => <th key={h} className="text-left px-2 py-1 font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {detail.stocks.map((s, i) => {
                      const qty = Number(s.quantity) || 0
                      const val = Number(s.value) || 0
                      const isAnomaly = qty === 0 && val > 0
                      return (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)', background: isAnomaly ? '#fffbeb' : 'transparent' }}>
                          <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }} title={s.warehouseName}>
                            <span className="font-mono font-semibold">{s.warehouseCode}</span>
                            <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{s.warehouseName}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            {s.projectCode ? (
                              <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--ibs-navy)', color: '#fff' }}>{s.projectCode}</span>
                            ) : (
                              <span className="text-[11px]" style={{ color: '#94a3b8' }}>{s.kind === 'CONSIGNED' ? 'KH cấp' : 'Kho chung'}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold" style={{ color: qty > 0 ? 'var(--text-primary)' : '#dc2626' }}>
                            {fmt(s.quantity)}
                            {isAnomaly && <span className="block text-[9px] font-normal" style={{ color: '#d97706' }}>Hết SL, còn GT kế toán</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right" style={{ color: val > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                            {val > 0 ? formatCurrency(Math.round(val)) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : <div className="text-sm px-2 py-2" style={{ color: 'var(--text-muted)' }}>Chưa có dữ liệu tồn theo kho</div>}
            </div>

            <div className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Mã bí danh ({detail.aliases.length})</div>
            <div className="space-y-1 mb-3">
              {detail.aliases.map((a) => (
                <div key={a.id} className="flex justify-between items-center text-sm px-2 py-1 rounded" style={{ background: 'var(--surface-hover)' }}>
                  <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{a.aliasCode} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({a.source})</span></span>
                  {canEdit && <button onClick={() => delAlias(a.id)} className="text-xs" style={{ color: '#ef4444' }}>Xoá</button>}
                </div>
              ))}
              {detail.aliases.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có bí danh</div>}
            </div>

            {canEdit && (
              <form onSubmit={addAlias} className="flex gap-2 flex-wrap items-end">
                <input name="aliasCode" required placeholder="Mã cũ" className="text-sm px-2 py-1.5 rounded-lg flex-1 min-w-[120px]" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                <select name="source" className="text-sm px-2 py-1.5 rounded-lg" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {['KHO', 'KETOAN', 'LEGACY_DOT', 'TK', 'TM', 'MANUAL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button type="submit" className="btn-primary text-sm px-3 py-1.5 rounded-lg">+ Bí danh</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
