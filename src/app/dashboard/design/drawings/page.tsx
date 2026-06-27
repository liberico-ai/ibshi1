'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import {
  PageHeader, StatusBadge, Button, FilterBar,
  EmptyState, Modal, InputField, SelectField,
} from '@/components/ui'

interface Drawing {
  id: string; drawingCode: string; title: string; discipline: string; currentRev: string;
  status: string; drawnBy: string | null;
  project: { projectCode: string; projectName: string }
  revisions: { id: string; revision: string; description: string | null; issuedDate: string }[]
}

const discLabel: Record<string, string> = { structural: 'Kết cấu', piping: 'Đường ống', electrical: 'Điện', mechanical: 'Cơ khí' }
const discColor: Record<string, string> = {
  structural: SEMANTIC_COLORS.info.solid,
  piping: SEMANTIC_COLORS.warning.solid,
  electrical: SEMANTIC_COLORS.danger.solid,
  mechanical: SEMANTIC_COLORS.success.solid,
}

const TRANSITIONS: Record<string, { next: string; label: string; variant: 'outline' | 'accent' | 'primary' }[]> = {
  IFR: [{ next: 'IFC', label: 'IFC', variant: 'accent' }],
  IFC: [
    { next: 'AFC', label: 'AFC', variant: 'primary' },
    { next: 'IFR', label: 'IFR', variant: 'outline' },
  ],
}

export default function DrawingRegisterPage() {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')
  const [projectList, setProjectList] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = () => {
    const url = filter ? `/api/drawings?status=${filter}` : '/api/drawings'
    apiFetch(url).then(res => {
      if (res.ok) { setDrawings(res.drawings); setStats(res.stats || {}) }
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [filter])

  const openForm = async () => {
    const res = await apiFetch('/api/projects?page=1&limit=50')
    if (res.ok) setProjectList(res.projects || [])
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const res = await apiFetch('/api/drawings', {
      method: 'POST',
      body: JSON.stringify({
        drawingCode: fd.get('drawingCode'), projectId: fd.get('projectId'),
        title: fd.get('title'), discipline: fd.get('discipline'),
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const handleTransition = async (id: string, nextStatus: string) => {
    setActionLoading(id)
    const res = await apiFetch(`/api/drawings/${id}/transition`, {
      method: 'POST', body: JSON.stringify({ nextStatus }),
    })
    if (res.ok) load()
    else alert(res.error || 'Lỗi chuyển trạng thái')
    setActionLoading(null)
  }

  const totalCount = Object.values(stats).reduce((s, c) => s + c, 0)

  const filterOptions = [
    { value: '', label: 'Tất cả', count: totalCount },
    { value: 'IFR', label: 'Chờ duyệt', count: stats['IFR'] || 0 },
    { value: 'IFC', label: 'Thi công', count: stats['IFC'] || 0 },
    { value: 'AFC', label: 'Hoàn công', count: stats['AFC'] || 0 },
  ]

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Sổ bản vẽ"
        subtitle={`${drawings.length} bản vẽ`}
        actions={
          <Button variant="primary" size="sm" onClick={openForm}>
            + Thêm bản vẽ
          </Button>
        }
      />

      <FilterBar
        filters={filterOptions}
        value={filter}
        onChange={setFilter}
      />

      {/* Create drawing modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Thêm bản vẽ"
        size="lg"
      >
        <form onSubmit={handleSubmit} id="drawing-create-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              name="drawingCode"
              label="Mã bản vẽ"
              required
              placeholder="VD: DWG-001"
            />
            <SelectField
              name="projectId"
              label="Dự án"
              required
              options={[
                { value: '', label: '-- Chọn dự án --' },
                ...projectList.map(p => ({
                  value: p.id,
                  label: `${p.projectCode} — ${p.projectName}`,
                })),
              ]}
            />
            <InputField
              name="title"
              label="Tiêu đề"
              required
              placeholder="Tên bản vẽ"
            />
            <SelectField
              name="discipline"
              label="Bộ môn"
              required
              options={[
                { value: '', label: '-- Chọn bộ môn --' },
                ...Object.entries(discLabel).map(([k, v]) => ({
                  value: k,
                  label: v,
                })),
              ]}
            />
          </div>
        </form>
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
            Hủy
          </Button>
          <Button variant="primary" size="sm" type="submit" form="drawing-create-form">
            Lưu
          </Button>
        </div>
      </Modal>

      {/* Table */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã BV</th>
              <th>Tiêu đề</th>
              <th>Bộ môn</th>
              <th>Dự án</th>
              <th>Rev</th>
              <th>Trạng thái</th>
              <th>Sửa đổi gần nhất</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {drawings.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon="📐"
                    title="Chưa có bản vẽ"
                    description="Bấm nút 'Thêm bản vẽ' để bắt đầu"
                  />
                </td>
              </tr>
            ) : drawings.map(d => (
              <tr key={d.id}>
                <td>
                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    {d.drawingCode}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>
                  {d.title}
                </td>
                <td>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: `${discColor[d.discipline]}20`,
                      color: discColor[d.discipline],
                    }}
                  >
                    {discLabel[d.discipline] || d.discipline}
                  </span>
                </td>
                <td>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {d.project.projectCode}
                  </span>
                </td>
                <td>
                  <span className="font-mono text-xs font-bold" style={{ color: SEMANTIC_COLORS.info.solid }}>
                    {d.currentRev}
                  </span>
                </td>
                <td>
                  <StatusBadge category="drawing" status={d.status} />
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {d.revisions[0]
                    ? `${d.revisions[0].revision} — ${formatDate(d.revisions[0].issuedDate)}`
                    : '—'}
                </td>
                <td>
                  <div className="flex gap-1">
                    {(TRANSITIONS[d.status] || []).map(t => (
                      <Button
                        key={t.next}
                        variant={t.variant}
                        size="sm"
                        onClick={() => handleTransition(d.id, t.next)}
                        loading={actionLoading === d.id}
                      >
                        {t.label}
                      </Button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
