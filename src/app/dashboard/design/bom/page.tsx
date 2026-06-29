'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, StatusBadge, Button, EmptyState, Modal, InputField, SelectField } from '@/components/ui'
import { STATUS_COLORS } from '@/lib/design-tokens'
import { Package } from 'lucide-react'

interface BOM {
  id: string; bomCode: string; name: string; revision: string; status: string; createdAt: string;
  project: { projectCode: string; projectName: string };
  items: Array<{ id: string; quantity: number; unit: string; remarks: string | null; sortOrder: number;
    material: { materialCode: string; name: string; unit: string } }>;
}

interface Project {
  id: string; projectCode: string; projectName: string;
}

const CAN_CREATE_ROLES = ['R01', 'R04', 'R02']

export default function BOMPage() {
  const [boms, setBoms] = useState<BOM[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)

  // Create modal state
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [formName, setFormName] = useState('')
  const [formProjectId, setFormProjectId] = useState('')
  const [formRevision, setFormRevision] = useState('A')
  const [formError, setFormError] = useState('')

  const loadData = async () => {
    setLoading(true)
    const res = await apiFetch('/api/design/bom')
    if (res.ok) setBoms(res.boms || [])
    setLoading(false)
  }

  const loadProjects = async () => {
    const res = await apiFetch('/api/projects?limit=200')
    if (res.ok) setProjects(res.projects || [])
  }

  useEffect(() => { loadData() }, []) // load once on mount

  const openCreateModal = () => {
    setFormName('')
    setFormProjectId('')
    setFormRevision('A')
    setFormError('')
    setShowCreate(true)
    loadProjects()
  }

  const handleCreate = async () => {
    if (!formName.trim()) { setFormError('Tên BOM là bắt buộc'); return }
    if (!formProjectId) { setFormError('Vui lòng chọn dự án'); return }

    setCreating(true)
    setFormError('')
    const res = await apiFetch('/api/design/bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: formName.trim(), projectId: formProjectId }),
    })
    setCreating(false)

    if (res.ok) {
      setShowCreate(false)
      loadData()
    } else {
      setFormError(res.error || 'Không thể tạo BOM')
    }
  }

  const canCreate = CAN_CREATE_ROLES.includes(user?.roleCode || '')

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1, 2].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Định mức vật tư (BOM)"
        subtitle="Danh mục vật tư theo dự án"
        actions={
          canCreate ? (
            <Button variant="primary" icon={<span>+</span>} onClick={openCreateModal}>
              Tạo BOM
            </Button>
          ) : undefined
        }
      />

      {boms.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="Chưa có BOM nào"
          description="Tạo BOM đầu tiên để quản lý danh mục vật tư cho dự án"
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreateModal}>+ Tạo BOM</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {boms.map(bom => {
            const isExpanded = expanded === bom.id
            const colors = (STATUS_COLORS.bom as Record<string, { bg: string; text: string }>)[bom.status]
            return (
              <div key={bom.id} className="card overflow-hidden transition-all hover:shadow-md">
                <div className="p-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : bom.id)}>
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold font-mono"
                      style={{
                        background: colors?.bg || '#F1F3F5',
                        color: colors?.text || '#64748B',
                      }}
                    >
                      {bom.items.length}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>
                          {bom.bomCode}
                        </span>
                        <StatusBadge category="bom" status={bom.status} />
                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          Rev {bom.revision}
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {bom.name}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        DA: {bom.project.projectCode} &bull; {bom.items.length} items
                      </p>
                    </div>
                    <span
                      className="text-sm transition-transform"
                      style={{
                        color: 'var(--text-muted)',
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                      }}
                    >
                      &#x25BC;
                    </span>
                  </div>
                </div>
                {isExpanded && bom.items.length > 0 && (
                  <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-light)' }}>
                    <div className="dt-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>#</th>
                            <th style={{ textAlign: 'left' }}>Mã VT</th>
                            <th style={{ textAlign: 'left' }}>Tên</th>
                            <th style={{ textAlign: 'right' }}>SL</th>
                            <th style={{ textAlign: 'left' }}>ĐVT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bom.items.map((item, i) => (
                            <tr key={item.id}>
                              <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                              <td>
                                <span className="font-mono" style={{ color: 'var(--accent)' }}>
                                  {item.material.materialCode}
                                </span>
                              </td>
                              <td style={{ color: 'var(--text-primary)' }}>{item.material.name}</td>
                              <td className="font-mono" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {Number(item.quantity)}
                              </td>
                              <td style={{ color: 'var(--text-muted)' }}>{item.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create BOM Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Tạo BOM mới"
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Hủy</Button>
            <Button variant="primary" loading={creating} onClick={handleCreate}>Tạo BOM</Button>
          </>
        }
      >
        <div className="space-y-4">
          <InputField
            label="Tên BOM"
            placeholder="Nhập tên BOM..."
            value={formName}
            onChange={e => setFormName(e.target.value)}
            autoFocus
          />
          <SelectField
            label="Dự án"
            value={formProjectId}
            onChange={e => setFormProjectId(e.target.value)}
            options={[
              { value: '', label: '-- Chọn dự án --' },
              ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` })),
            ]}
          />
          <InputField
            label="Revision"
            value={formRevision}
            onChange={e => setFormRevision(e.target.value)}
            placeholder="A"
          />
          {formError && (
            <p className="text-sm" style={{ color: 'var(--danger, #C8372B)' }}>{formError}</p>
          )}
        </div>
      </Modal>
    </div>
  )
}
