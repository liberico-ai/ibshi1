'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatCompactVND, formatCurrency, formatNumber } from '@/lib/utils'
import { RBAC } from '@/lib/rbac-rules'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Card, Button, DataTable, type Column } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ChevronRight, Package, AlertCircle, Banknote, ClipboardList, ShoppingCart } from 'lucide-react'

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

  const columns: Column<Material>[] = [
    { key: 'materialCode', label: 'Mã VT', width: '115px', mono: true, render: (m) => (
      <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--ibs-red)' }}>{m.materialCode}</span>
    )},
    { key: 'name', label: 'Tên vật tư', render: (m) => (
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</span>
    )},
    { key: 'specification', label: 'Profile', width: '145px', render: (m) => (
      m.specification ? <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--text-heading)' }}>{m.specification}</span> : null
    )},
    { key: 'grade', label: 'Mác', width: '110px', render: (m) => (
      m.grade ? <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{m.grade}</span> : null
    )},
    { key: 'projects', label: 'Dự án', width: '75px', render: (m) => (
      (m.projects && m.projects.length > 0) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {m.projects.slice(0, 2).map((p) => (
            <span key={p} style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'var(--ibs-navy)', color: '#fff', whiteSpace: 'nowrap' }}>{p}</span>
          ))}
          {m.projects.length > 2 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>+{m.projects.length - 2} DA</span>}
        </div>
      ) : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Chung</span>
    )},
    { key: 'unit', label: 'ĐVT', width: '36px', align: 'center', render: (m) => (
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.unit}</span>
    )},
    { key: 'currentStock', label: 'Tồn kho', width: '80px', align: 'right', mono: true, render: (m) => (
      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: m.lowStock ? SEMANTIC_COLORS.danger.solid : 'var(--text-primary)' }}>{formatNumber(m.currentStock)}</span>
    )},
    { key: 'unitPrice', label: 'Đơn giá', width: '80px', align: 'right', mono: true, render: (m) => (
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.unitPrice ? formatCurrency(Math.round(Number(m.unitPrice))) : ''}</span>
    )},
    { key: 'status', label: '', width: '44px', align: 'center', render: (m) => (
      m.minStock >= 0 ? (
        <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: 99, fontWeight: 600, background: m.lowStock ? SEMANTIC_COLORS.danger.bg : SEMANTIC_COLORS.success.bg, color: m.lowStock ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid, whiteSpace: 'nowrap' }}>
          {m.lowStock ? 'Thiếu' : 'Đủ'}
        </span>
      ) : null
    )},
    { key: 'arrow', label: '', width: '20px', render: () => <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} /> },
  ]

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
        actions={hasStorePermission ? <Button variant="primary" onClick={() => setShowCreate(!showCreate)}>+ Thêm vật tư</Button> : undefined}
      />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
          <StatCard label="Tổng vật tư" value={stats.totalMaterials} color={SEMANTIC_COLORS.info.solid} icon={<Package size={20} />} />
          <StatCard label="Thiếu hàng" value={stats.lowStockCount} color={stats.lowStockCount > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} icon={<AlertCircle size={20} />} accent={stats.lowStockCount > 0} />
          <StatCard label="Giá trị tồn" value={formatCompactVND(stats.totalValue)} color={SEMANTIC_COLORS.warning.solid} icon={<Banknote size={20} />} />
          <StatCard label="PR chờ duyệt" value={stats.prPending} color="#8b5cf6" icon={<ClipboardList size={20} />} />
          <StatCard label="PO đang xử lý" value={stats.poActive} color={SEMANTIC_COLORS.info.solid} icon={<ShoppingCart size={20} />} />
        </div>
      )}

      {stats && stats.recentMovements.length > 0 && (
        <Card padding="compact">
          <h3 className="section-title" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-sm)' }}>Biến động gần đây</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stats.recentMovements.slice(0, 6).map(m => (
              <div key={m.id} className="flex-shrink-0 p-3 rounded-xl" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-light)', minWidth: '180px' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: m.type === 'IN' ? SEMANTIC_COLORS.success.solid : m.type === 'OUT' ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.warning.solid }} />
                  <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{m.materialCode}</span>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{m.materialName}</p>
                <div className="flex justify-between mt-1.5">
                  <span className="text-sm font-bold" style={{ color: m.type === 'IN' ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.danger.solid }}>
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

      <div className="flex gap-3 items-center">
        <div className="w-96"><SearchBar value={search} onChange={setSearch} placeholder="Tìm mã VT, tên..." /></div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((c) => (
            <button key={c.value} onClick={() => setCategoryFilter(c.value)}
              className={`filter-pill ${categoryFilter === c.value ? 'active' : ''}`}>{c.label}</button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={materials}
        rowKey={(m) => m.id}
        onRowClick={(m) => router.push(`/dashboard/warehouse/${m.id}`)}
        emptyText="Chưa có vật tư nào"
        compact
      />
      <div className="px-4 pb-3">
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
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
      {error && <div className="mb-3 p-2 rounded text-sm" style={{ background: 'var(--danger-light, #fef2f2)', color: 'var(--danger)' }}>{error}</div>}
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
          <Button variant="primary" type="submit" loading={submitting}>{submitting ? 'Đang tạo...' : 'Thêm'}</Button>
        </div>
      </form>
    </div>
  )
}
