'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatCurrency } from '@/lib/utils'
import { SearchBar, Pagination } from '@/components/SearchPagination'
import { PageHeader, StatCard, Card, Button } from '@/components/ui'
import { ChevronRight } from 'lucide-react'

interface Material {
  id: string; materialCode: string; name: string; nameEn: string; unit: string;
  category: string; specification: string; grade: string;
  minStock: number; currentStock: number; reservedStock: number; availableStock: number;
  unitPrice: number | null; currency: string; lowStock: boolean;
}

interface PaginationData { page: number; limit: number; total: number; totalPages: number }

const CATEGORIES = [
  { value: '', label: 'Tất cả' },
  { value: 'steel', label: 'Thép' },
  { value: 'pipe', label: 'Ống' },
  { value: 'valve', label: 'Van' },
  { value: 'bolt', label: 'Bu-lông' },
  { value: 'paint', label: 'Sơn' },
  { value: 'welding', label: 'Que hàn' },
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
        actions={<Button variant="accent" onClick={() => setShowCreate(!showCreate)}>+ Thêm vật tư</Button>}
      />

      {/* ═══ KPI Dashboard v2 ═══ */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
          <StatCard label="Tổng vật tư" value={stats.totalMaterials} color="#0ea5e9" icon={<span style={{ fontSize: 20 }}>📦</span>} />
          <StatCard label="Thiếu hàng" value={stats.lowStockCount} color={stats.lowStockCount > 0 ? '#dc2626' : '#16a34a'} icon={<span style={{ fontSize: 20 }}>⚠️</span>} accent={stats.lowStockCount > 0} />
          <StatCard label="Giá trị tồn" value={`${(stats.totalValue / 1e6).toFixed(1)}M`} color="#f59e0b" icon={<span style={{ fontSize: 20 }}>💰</span>} />
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
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã VT</th><th>Tên vật tư</th><th>Spec / Grade</th><th>Danh mục</th>
              <th className="text-right">Tồn kho</th><th className="text-right">Khả dụng</th><th>ĐVT</th>
              <th className="text-right">Đơn giá</th><th>Trạng thái</th><th></th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => router.push(`/dashboard/warehouse/${m.id}`)}>
                <td><span className="font-mono text-xs font-semibold" style={{ color: 'var(--accent)' }}>{m.materialCode}</span></td>
                <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</td>
                <td><span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{m.specification}{m.grade ? ` ${m.grade}` : ''}</span></td>
                <td><span className="badge" style={{ background: 'var(--ibs-navy-50)', color: 'var(--ibs-navy)', borderColor: 'var(--ibs-navy-100)', borderWidth: '1px' }}>{CATEGORIES.find(c => c.value === m.category)?.label || m.category}</span></td>
                <td className="text-right font-semibold" style={{ color: m.lowStock ? '#dc2626' : 'var(--text-primary)' }}>{m.currentStock.toLocaleString()}</td>
                <td className="text-right" style={{ color: m.reservedStock > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{m.availableStock.toLocaleString()}</td>
                <td style={{ color: 'var(--text-muted)' }}>{m.unit}</td>
                <td className="text-right" style={{ color: 'var(--text-secondary)' }}>{m.unitPrice ? formatCurrency(m.unitPrice, m.currency) : '-'}</td>
                <td>
                  <span className="badge" style={{
                    background: m.lowStock ? '#fef2f2' : '#f0fdf4',
                    color: m.lowStock ? '#dc2626' : '#16a34a',
                    borderColor: m.lowStock ? '#fecaca' : '#bbf7d0', borderWidth: '1px',
                  }}>{m.lowStock ? '⚠ Thiếu hàng' : '✓ Đủ'}</span>
                </td>
                <td>
                  <ChevronRight size={16} stroke="var(--text-muted)" />
                </td>
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
  const [form, setForm] = useState({ materialCode: '', name: '', unit: 'kg', category: 'steel', minStock: '0', unitPrice: '' })
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

