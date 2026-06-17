'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCurrency, formatCompactVND } from '@/lib/utils'
import { RBAC } from '@/lib/rbac-rules'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Card, Button } from '@/components/ui'
import { ChevronRight } from 'lucide-react'

interface Material {
  id: string; materialCode: string; name: string; nameEn: string; unit: string;
  category: string; specification: string; grade: string;
  minStock: number; currentStock: number; reservedStock: number; availableStock: number;
  unitPrice: number | null; currency: string; lowStock: boolean;
  projects?: string[]; projectCount?: number;
}

interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const CATEGORIES = [
  { value: '', label: 'Tất cả' },
  { value: 'thép', label: 'Thép' },
  { value: 'bu lông', label: 'Bu-lông' },
  { value: 'inox', label: 'Inox' },
  { value: 'grating', label: 'Grating' },
  { value: 'sơn', label: 'Sơn' },
  { value: 'hàn', label: 'Que hàn' },
  { value: 'bảo hộ', label: 'Bảo hộ' },
  { value: 'máy', label: 'Máy/TB' },
]

interface WarehouseStats {
  totalMaterials: number; lowStockCount: number; totalValue: number;
  prPending: number; poActive: number;
  byCategory: Record<string, number>;
  recentMovements: Array<{ id: string; materialCode: string; materialName: string; type: string; quantity: number; date: string; reference: string }>
}

export default function WarehousePage() {
  const router = useRouter()
  const [materials, setMaterials] = useState<Material[]>([])
  const [stats, setStats] = useState<WarehouseStats | null>(null)
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const currentUser = useAuthStore((state) => state.user)
  const roleCode = currentUser?.roleCode || ''
  const hasStorePermission = RBAC.STORE_ACTION.includes(roleCode)

  useEffect(() => { apiFetch('/api/warehouse/stats').then(r => { if (r.ok) setStats(r) }) }, [])
  useEffect(() => { setPage(1) }, [search, categoryFilter])
  useEffect(() => { loadMaterials() }, [search, categoryFilter, page])

  async function loadMaterials() {
    const params = new URLSearchParams()
    if (categoryFilter) params.set('category', categoryFilter)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await apiFetch(`/api/warehouse?${params}`)
    if (res.ok) { setMaterials(res.materials); setPagination(res.pagination) }
    setLoading(false)
  }

  if (loading) return (
    <div className="space-y-6 animate-fade-in">
      <div className="h-10 w-64 skeleton rounded-xl" />
      <div className="h-96 skeleton rounded-2xl" />
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Quản lý Kho"
        subtitle={`${pagination.total} vật tư • ${materials.filter(m => m.lowStock).length} dưới mức tối thiểu`}
        actions={hasStorePermission ? <Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Thêm vật tư</Button> : undefined}
      />

      {/* ═══ KPI Dashboard v2 ═══ */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
          <StatCard label="Tổng vật tư" value={stats.totalMaterials} color="#0ea5e9" icon={<span style={{ fontSize: 20 }}>📦</span>} />
          <StatCard label="Thiếu hàng" value={stats.lowStockCount} color={stats.lowStockCount > 0 ? '#dc2626' : '#16a34a'} icon={<span style={{ fontSize: 20 }}>⚠️</span>} accent={stats.lowStockCount > 0} />
          <StatCard label="Giá trị tồn" value={formatCompactVND(stats.totalValue)} color="#f59e0b" icon={<span style={{ fontSize: 20 }}>💰</span>} />
          <StatCard label="PR chờ duyệt" value={stats.prPending} color="#8b5cf6" icon={<span style={{ fontSize: 20 }}>📋</span>} />
          <StatCard label="PO đang xử lý" value={stats.poActive} color="#0ea5e9" icon={<span style={{ fontSize: 20 }}>🚚</span>} />
        </div>
      )}

      {/* Recent Movements */}
      {stats && stats.recentMovements.length > 0 && (
        <Card padding="compact">
          <h3 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-sm)' }}>📊 Biến động gần đây</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stats.recentMovements.slice(0, 6).map(m => (
              <div key={m.id} className="flex-shrink-0 p-3 rounded-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)', minWidth: '180px' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: m.type === 'IN' ? '#16a34a' : m.type === 'OUT' ? '#dc2626' : '#f59e0b' }} />
                  <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{m.materialCode}</span>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{m.materialName}</p>
                <div className="flex justify-between mt-1.5">
                  <span className="text-sm font-bold" style={{ color: m.type === 'IN' ? '#16a34a' : '#dc2626' }}>
                    {m.type === 'IN' ? '+' : '-'}{m.quantity}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.reference}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreate && <CreateMaterialForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadMaterials() }} />}

      {/* Search + Category filter */}
      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã VT, tên..." /></div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((c) => (
            <button key={c.value} onClick={() => setCategoryFilter(c.value)}
              className={`filter-pill ${categoryFilter === c.value ? 'active' : ''}`}>{c.label}</button>
          ))}
        </div>
      </div>

      {/* Materials table */}
      <div className="card overflow-hidden" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 1100 }}>
          <colgroup>
            <col style={{ width: 115 }} />
            <col />
            <col style={{ width: 145 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 75 }} />
            <col style={{ width: 36 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 20 }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              {[
                { label: 'Mã VT', align: 'left' as const },
                { label: 'Tên vật tư', align: 'left' as const },
                { label: 'Profile', align: 'left' as const },
                { label: 'Mác', align: 'left' as const },
                { label: 'Dự án', align: 'left' as const },
                { label: 'ĐVT', align: 'center' as const },
                { label: 'Tồn kho', align: 'right' as const },
                { label: 'Đơn giá', align: 'right' as const },
                { label: '', align: 'center' as const },
                { label: '', align: 'left' as const },
              ].map((h, i) => (
                <th key={i} style={{ color: '#64748b', fontSize: '0.68rem', fontWeight: 600, padding: '7px 8px', letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: h.align, whiteSpace: 'nowrap' }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {materials.map((m, idx) => (
              <tr key={m.id} className="cursor-pointer hover:bg-blue-50/40 transition-colors" style={{ borderTop: '1px solid #f1f5f9', background: idx % 2 === 1 ? '#fafbfc' : '#fff' }} onClick={() => router.push(`/dashboard/warehouse/${m.id}`)}>
                <td style={{ padding: '8px 8px' }}><span className="font-mono text-[11px] font-bold" style={{ color: '#e63946' }}>{m.materialCode}</span></td>
                <td style={{ padding: '8px 8px', color: '#1a202c', fontWeight: 500, fontSize: '0.82rem' }}>{m.name}</td>
                <td style={{ padding: '8px 8px' }}>
                  {m.specification ? <span className="font-mono text-[11px] font-semibold" style={{ color: '#0a2540' }}>{m.specification}</span> : null}
                </td>
                <td style={{ padding: '8px 8px' }}>
                  {m.grade ? <span className="text-[11px] font-medium" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{m.grade}</span> : null}
                </td>
                <td style={{ padding: '8px 8px' }}>
                  {(m.projects && m.projects.length > 0) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {m.projects.slice(0, 2).map((p) => (
                        <span key={p} style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#0a2540', color: '#fff', whiteSpace: 'nowrap' }}>{p}</span>
                      ))}
                      {m.projects.length > 2 && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>+{m.projects.length - 2} DA</span>}
                    </div>
                  ) : <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Chung</span>}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem' }}>{m.unit}</td>
                <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', color: m.lowStock ? '#dc2626' : '#0f172a' }}>{m.currentStock.toLocaleString('vi-VN')}</td>
                <td style={{ padding: '8px 8px', textAlign: 'right', color: '#64748b', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                  {m.unitPrice ? `${Math.round(Number(m.unitPrice)).toLocaleString('vi-VN')} đ` : ''}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                  {m.minStock >= 0 ? (
                    <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: 99, fontWeight: 600, background: m.lowStock ? '#fef2f2' : '#ecfdf5', color: m.lowStock ? '#dc2626' : '#059669', whiteSpace: 'nowrap' }}>
                      {m.lowStock ? 'Thiếu' : '✓ Đủ'}
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: '8px 2px' }}><ChevronRight size={13} stroke="#cbd5e1" /></td>
              </tr>
            ))}
            {materials.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có vật tư nào</td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
        </div>
      </div>
    </div>
  )
}

function CreateMaterialForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ materialCode: '', name: '', unit: 'kg', category: 'VLC', minStock: '0', unitPrice: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSubmitting(true)
    const res = await apiFetch('/api/warehouse', { method: 'POST', body: JSON.stringify(form) })
    setSubmitting(false)
    if (res.ok) onCreated()
    else setError(res.error)
  }

  return (
    <div className="card p-6 animate-fade-in">
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Thêm vật tư mới</h3>
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}
      <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Mã vật tư *</label>
          <input className="input" value={form.materialCode} onChange={(e) => setForm({ ...form, materialCode: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tên *</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Đơn vị *</label>
          <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            <option value="kg">kg</option><option value="cái">cái</option><option value="bộ">bộ</option>
            <option value="m">m</option><option value="m2">m²</option><option value="m3">m³</option><option value="tấn">tấn</option>
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Danh mục *</label>
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tồn kho tối thiểu</label>
          <input className="input" type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
        <div><label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Đơn giá</label>
          <input className="input" type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} /></div>
        <div className="col-span-3 flex gap-3 justify-end">
          <Button variant="outline" type="button" onClick={onClose}>Hủy</Button>
          <Button variant="accent" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Thêm'}</Button>
        </div>
      </form>
    </div>
  )
}

