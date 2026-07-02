'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, Button, SelectField, InputField, TextareaField } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface MaterialOption { id: string; materialCode: string; name: string; unit: string }

interface PrItemRow {
  materialId: string
  quantity: string
  notes: string
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
  const [materials, setMaterials] = useState<MaterialOption[]>([])
  const [projectId, setProjectId] = useState(presetProjectId)
  const [urgency, setUrgency] = useState('NORMAL')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<PrItemRow[]>([{ materialId: '', quantity: '', notes: '' }])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    apiFetch('/api/projects').then(res => { if (res.ok) setProjects(res.projects || []) })
    apiFetch('/api/materials').then(res => { if (res.ok) setMaterials(res.materials || []) })
  }, [])

  const canCreate = CAN_CREATE_ROLES.includes(user?.roleCode || '')

  const updateItem = (idx: number, field: keyof PrItemRow, value: string) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
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
            onClick={() => setItems(prev => [...prev, { materialId: '', quantity: '', notes: '' }])}
          >
            + Thêm dòng
          </Button>
        </div>

        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-1 md:grid-cols-[2fr_120px_1fr_auto] gap-3 items-end">
            <SelectField
              label={idx === 0 ? 'Vật tư *' : undefined}
              value={item.materialId}
              onChange={e => updateItem(idx, 'materialId', e.target.value)}
              options={[
                { value: '', label: 'Chọn vật tư...' },
                ...materials.map(m => ({ value: m.id, label: `${m.materialCode} — ${m.name} (${m.unit})` })),
              ]}
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
