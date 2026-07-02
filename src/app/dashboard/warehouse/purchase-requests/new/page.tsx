'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, Button, SelectField, InputField, TextareaField } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { formatNumber } from '@/lib/utils'

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface MaterialOption { id: string; materialCode: string; name: string; unit: string; currentStock?: number }

interface PrItemRow {
  materialId: string
  materialLabel: string
  quantity: string
  notes: string
}

// ── Combobox vật tư: search server-side (debounce 300ms), không load toàn bộ danh mục ──
function MaterialCombobox({
  label,
  selectedId,
  selectedLabel,
  onSelect,
}: {
  label?: string
  selectedId: string
  selectedLabel: string
  onSelect: (material: MaterialOption | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MaterialOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounce 300ms → fetch server-side search (chỉ khi đã gõ)
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) { setResults([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/materials?search=${encodeURIComponent(q)}&status=ACTIVE&limit=20`)
        if (!cancelled && res.ok) setResults(res.materials || [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open])

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  return (
    <div className="input-field" ref={containerRef} style={{ position: 'relative' }}>
      {label && <label className="input-label">{label}</label>}
      {selectedId ? (
        <div className="input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="truncate" title={selectedLabel} style={{ color: 'var(--text-primary)' }}>{selectedLabel}</span>
          <button
            type="button"
            aria-label="Bỏ chọn vật tư"
            onClick={() => { onSelect(null); setQuery(''); setOpen(false) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            className="input"
            value={query}
            placeholder="Gõ mã hoặc tên vật tư để tìm..."
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
          />
          {open && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4,
                maxHeight: 280, overflowY: 'auto',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
              }}
            >
              {loading && (
                <div className="text-xs" style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>Đang tìm...</div>
              )}
              {!loading && !query.trim() && (
                <div className="text-xs" style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                  Gõ mã hoặc tên vật tư để tìm kiếm...
                </div>
              )}
              {!loading && query.trim() && results.length === 0 && (
                <div className="text-xs" style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                  Không tìm thấy vật tư phù hợp
                </div>
              )}
              {!loading && results.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onSelect(m); setQuery(''); setOpen(false) }}
                  className="text-sm"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid var(--border-light)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{m.materialCode}</span>
                  <span style={{ color: 'var(--text-primary)' }}> · {m.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {' '}· {m.unit}
                    {m.currentStock != null ? ` · tồn ${formatNumber(m.currentStock)}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const CAN_CREATE_ROLES = ['R01', 'R02', 'R03', 'R05']

const URGENCY_OPTIONS = [
  { value: 'NORMAL', label: 'Bình thường' },
  { value: 'URGENT', label: 'Gấp' },
  { value: 'CRITICAL', label: 'Rất gấp' },
]

// Route quay về trang nguồn (nếu có)
const ORIGIN_BACK_ROUTE: Record<string, string> = {
  ECO: '/dashboard/design/eco',
  NCR: '/dashboard/qc/ncr',
}

function CreatePrForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useAuthStore(s => s.user)

  // Nguồn phát sinh từ query (?originType=ECO|NCR&originId=&originLabel=&projectId=)
  const rawOriginType = searchParams.get('originType') || ''
  const originType = rawOriginType === 'ECO' || rawOriginType === 'NCR' ? rawOriginType : ''
  const originId = searchParams.get('originId') || ''
  const originLabel = searchParams.get('originLabel') || ''
  const presetProjectId = searchParams.get('projectId') || ''
  const hasOrigin = Boolean(originType && originId)

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState(presetProjectId)
  const [urgency, setUrgency] = useState('NORMAL')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<PrItemRow[]>([{ materialId: '', materialLabel: '', quantity: '', notes: '' }])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Vật tư KHÔNG load toàn bộ nữa — combobox search server-side theo từ khóa
    apiFetch('/api/projects').then(res => { if (res.ok) setProjects(res.projects || []) })
  }, [])

  const canCreate = CAN_CREATE_ROLES.includes(user?.roleCode || '')

  const updateItem = (idx: number, field: keyof PrItemRow, value: string) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  const selectMaterial = (idx: number, material: MaterialOption | null) => {
    setItems(prev => prev.map((it, i) => (
      i === idx
        ? {
            ...it,
            materialId: material?.id || '',
            materialLabel: material ? `${material.materialCode} — ${material.name} (${material.unit})` : '',
          }
        : it
    )))
  }

  const submit = async () => {
    if (!projectId) return alert('Chọn dự án')
    const validItems = items.filter(it => it.materialId && Number(it.quantity) > 0)
    if (validItems.length === 0) return alert('Cần ít nhất 1 dòng vật tư với số lượng > 0')

    setSubmitting(true)
    const res = await apiFetch('/api/purchase-requests', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        urgency,
        notes: notes || undefined,
        items: validItems.map(it => ({
          materialId: it.materialId,
          quantity: Number(it.quantity),
          notes: it.notes || undefined,
        })),
        // Gắn nguồn phát sinh (Đợt 2D — truy vết ECO/NCR → PR)
        ...(hasOrigin ? { originType, originId, originLabel: originLabel || undefined } : {}),
      }),
    })
    setSubmitting(false)
    if (res.ok) {
      alert(res.message || 'Đã tạo yêu cầu mua hàng')
      router.push('/dashboard/warehouse/purchase-requests')
    } else {
      alert(res.error || 'Lỗi tạo PR')
    }
  }

  if (!canCreate) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Tạo Đề nghị mua hàng" />
        <div className="card p-5" style={{ color: 'var(--text-muted)' }}>
          Bạn không có quyền tạo yêu cầu mua hàng (chỉ BGĐ, PM, KTKH, Kho).
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Tạo Đề nghị mua hàng (PR)"
        subtitle="Đề nghị mua vật tư cho dự án"
        actions={
          <Button variant="ghost" onClick={() => router.push('/dashboard/warehouse/purchase-requests')}>
            Quay lại
          </Button>
        }
      />

      {/* Banner nguồn phát sinh — PR từ ECO / NCR */}
      {hasOrigin && (
        <div
          className="card p-4"
          style={{
            borderLeft: `4px solid ${SEMANTIC_COLORS.warning.solid}`,
            background: SEMANTIC_COLORS.warning.bg,
          }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', margin: 0 }}>
            PR này phát sinh từ {originType === 'ECO' ? 'thay đổi thiết kế' : 'sản phẩm không phù hợp'}{' '}
            <span className="font-mono">{originLabel || originId}</span>
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Nguồn sẽ được lưu vào PR để truy vết ({originType}
            {originLabel ? ` — ${originLabel}` : ''}).{' '}
            {ORIGIN_BACK_ROUTE[originType] && (
              <Link href={ORIGIN_BACK_ROUTE[originType]} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                Xem trang {originType}
              </Link>
            )}
          </p>
        </div>
      )}

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField
            label="Dự án *"
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            options={[
              { value: '', label: 'Chọn dự án...' },
              ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` })),
            ]}
          />
          <SelectField
            label="Mức độ ưu tiên"
            value={urgency}
            onChange={e => setUrgency(e.target.value)}
            options={URGENCY_OPTIONS}
          />
        </div>
        <TextareaField
          label="Ghi chú"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Lý do mua, yêu cầu giao hàng..."
        />
      </div>

      {/* Danh sách vật tư */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)', margin: 0 }}>
            Vật tư cần mua ({items.length} dòng)
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setItems(prev => [...prev, { materialId: '', materialLabel: '', quantity: '', notes: '' }])}
          >
            + Thêm dòng
          </Button>
        </div>

        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-1 md:grid-cols-[2fr_120px_1fr_auto] gap-3 items-end">
            <MaterialCombobox
              label={idx === 0 ? 'Vật tư *' : undefined}
              selectedId={item.materialId}
              selectedLabel={item.materialLabel}
              onSelect={m => selectMaterial(idx, m)}
            />
            <InputField
              label={idx === 0 ? 'Số lượng *' : undefined}
              type="number"
              min={0}
              value={item.quantity}
              onChange={e => updateItem(idx, 'quantity', e.target.value)}
            />
            <InputField
              label={idx === 0 ? 'Ghi chú' : undefined}
              value={item.notes}
              onChange={e => updateItem(idx, 'notes', e.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={items.length === 1}
              onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
            >
              Xóa
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => router.push('/dashboard/warehouse/purchase-requests')}>
          Hủy
        </Button>
        <Button variant="primary" loading={submitting} onClick={submit}>
          Tạo PR
        </Button>
      </div>
    </div>
  )
}

export default function CreatePurchaseRequestPage() {
  return (
    <Suspense fallback={<div className="h-40 skeleton rounded-xl" />}>
      <CreatePrForm />
    </Suspense>
  )
}
