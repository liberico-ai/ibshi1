'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'

interface InspectionDetail {
  id: string; projectId: string; inspectionCode: string;
  type: string; stepCode: string; status: string;
  inspectorId: string | null; inspectedAt: string | null;
  remarks: string | null; createdAt: string;
  checklistItems: CheckItem[];
}

interface CheckItem {
  id: string; checkItem: string; standard: string | null;
  result: string | null; measurement: string | null; notes: string | null;
}

const QC_TYPES: Record<string, string> = {
  material_incoming: 'Nghiệm thu vật tư', ndt: 'Kiểm tra NDT',
  pressure_test: 'Thử áp lực', dimensional: 'Kiểm tra kích thước',
  visual: 'Kiểm tra trực quan', fat: 'FAT', sat: 'SAT',
}

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  PENDING: { label: 'Chờ kiểm', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  PASSED: { label: 'Đạt', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  FAILED: { label: 'Không đạt', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  CONDITIONAL: { label: 'Đạt ĐK', bg: '#fefce8', color: '#ca8a04', border: '#fde68a' },
}

export default function QCDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [inspection, setInspection] = useState<InspectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [remarks, setRemarks] = useState('')
  const [itemResults, setItemResults] = useState<Record<string, { result: string; measurement: string; notes: string }>>({})

  useEffect(() => { loadInspection() }, [id])

  async function loadInspection() {
    const res = await apiFetch(`/api/qc/${id}`)
    if (res.ok) {
      setInspection(res.inspection)
      const results: Record<string, { result: string; measurement: string; notes: string }> = {}
      for (const ci of res.inspection.checklistItems) {
        results[ci.id] = { result: ci.result || '', measurement: ci.measurement || '', notes: ci.notes || '' }
      }
      setItemResults(results)
    }
    setLoading(false)
  }

  async function submitVerdict(status: string) {
    const checklistResults = Object.entries(itemResults).map(([itemId, data]) => ({
      id: itemId, ...data,
    }))
    const res = await apiFetch(`/api/qc/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status, remarks, checklistResults }),
    })
    if (res.ok) loadInspection()
  }

  function updateItem(itemId: string, field: string, value: string) {
    setItemResults((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }))
  }

  if (loading) return <div className="animate-fade-in"><div className="h-48 rounded-xl animate-pulse" style={{ background: 'var(--bg-card)' }} /></div>
  if (!inspection) return <div className="card p-8 text-center" style={{ color: 'var(--text-muted)' }}>Không tìm thấy biên bản QC</div>

  const cfg = STATUS_CFG[inspection.status] || STATUS_CFG.PENDING
  const isPending = inspection.status === 'PENDING'

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => router.push('/dashboard/qc')} className="text-sm flex items-center gap-1" style={{ color: 'var(--primary)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        Quay lại QC
      </button>

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-lg font-bold" style={{ color: 'var(--primary)' }}>{inspection.inspectionCode}</span>
              <span className="badge" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border, borderWidth: '1px' }}>{cfg.label}</span>
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{QC_TYPES[inspection.type] || inspection.type}</h1>
          </div>
          {isPending && (
            <div className="flex gap-2">
              <button onClick={() => submitVerdict('PASSED')} className="text-sm px-4 py-2 rounded-lg font-medium" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>Đạt</button>
              <button onClick={() => submitVerdict('CONDITIONAL')} className="text-sm px-4 py-2 rounded-lg font-medium" style={{ background: '#fefce8', color: '#ca8a04', border: '1px solid #fde68a' }}>Đạt ĐK</button>
              <button onClick={() => submitVerdict('FAILED')} className="text-sm px-4 py-2 rounded-lg font-medium" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>Không đạt</button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Bước WF</span><p className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{inspection.stepCode}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ngày tạo</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatDate(inspection.createdAt)}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ngày KT</span><p className="font-medium" style={{ color: inspection.inspectedAt ? '#16a34a' : 'var(--text-muted)' }}>{inspection.inspectedAt ? formatDate(inspection.inspectedAt) : 'Chưa kiểm'}</p></div>
          <div><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Checklist</span><p className="font-medium" style={{ color: 'var(--text-primary)' }}>{inspection.checklistItems.length} mục</p></div>
        </div>
      </div>

      {/* Remarks */}
      {isPending && (
        <div className="card p-5">
          <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>Ghi chú / Nhận xét</label>
          <textarea className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Nhận xét chung..." />
        </div>
      )}
      {inspection.remarks && !isPending && (
        <div className="card p-5">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Nhận xét:</span>
          <p className="mt-1" style={{ color: 'var(--text-primary)' }}>{inspection.remarks}</p>
        </div>
      )}

      {/* Checklist */}
      {inspection.checklistItems.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 font-semibold text-sm" style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>Danh mục kiểm tra</div>
          <table className="data-table">
            <thead><tr><th>Nội dung</th><th>Tiêu chuẩn</th><th>Kết quả</th><th>Đo lường</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {inspection.checklistItems.map((ci) => (
                <tr key={ci.id}>
                  <td style={{ color: 'var(--text-primary)' }}>{ci.checkItem}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{ci.standard || '—'}</td>
                  <td>
                    {isPending ? (
                      <select className="input py-1 text-xs" value={itemResults[ci.id]?.result || ''} onChange={(e) => updateItem(ci.id, 'result', e.target.value)}>
                        <option value="">—</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="N_A">N/A</option>
                      </select>
                    ) : (
                      <span className="badge" style={{
                        background: ci.result === 'PASS' ? '#f0fdf4' : ci.result === 'FAIL' ? '#fef2f2' : '#f1f5f9',
                        color: ci.result === 'PASS' ? '#16a34a' : ci.result === 'FAIL' ? '#dc2626' : '#475569',
                      }}>{ci.result || '—'}</span>
                    )}
                  </td>
                  <td>{isPending ? <input className="input py-1 text-xs" placeholder="Giá trị" value={itemResults[ci.id]?.measurement || ''} onChange={(e) => updateItem(ci.id, 'measurement', e.target.value)} /> : <span style={{ color: 'var(--text-muted)' }}>{ci.measurement || '—'}</span>}</td>
                  <td>{isPending ? <input className="input py-1 text-xs" placeholder="Ghi chú" value={itemResults[ci.id]?.notes || ''} onChange={(e) => updateItem(ci.id, 'notes', e.target.value)} /> : <span style={{ color: 'var(--text-muted)' }}>{ci.notes || '—'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
