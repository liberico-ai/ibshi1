'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { QUOTE_EDIT_ROLES, canEditForm } from '@/lib/constants'
import MomSectionsUI from '@/components/MomSectionsUI'
import EstimateUploadUI from '@/components/EstimateUploadUI'
import WbsMilestonesUploadUI from '@/components/WbsMilestonesUploadUI'
import BomItemsUploadUI from '@/components/BomItemsUploadUI'
import BomPrUploadUI from '@/app/dashboard/tasks/[id]/components/BomPrUploadUI'
import WeldPaintUploadUI from '@/app/dashboard/tasks/[id]/components/WeldPaintUploadUI'
import SupplierQuoteUI from '@/components/SupplierQuoteUI'
import { useAuthStore } from '@/hooks/useAuth'

export type TemplateType = 'ESTIMATE' | 'PR' | 'BBH' | 'WBS' | 'WELD_PAINT' | 'BOM' | 'SUPPLIER_QUOTE' | null

export const TEMPLATES: { value: NonNullable<TemplateType>; label: string; icon: string; desc: string }[] = [
  { value: 'ESTIMATE', label: 'Dự toán thi công', icon: 'DT', desc: 'Upload Excel dự toán (DT01-DT07), parse tổng hợp chi phí' },
  { value: 'PR', label: 'Đề xuất vật tư (PR)', icon: 'PR', desc: 'Upload file PR, parse danh sách vật tư chính, đối chiếu kho' },
  { value: 'BBH', label: 'Biên bản họp (BBH)', icon: 'BB', desc: 'Upload BB họp Excel, parse nội dung & phân công' },
  { value: 'WBS', label: 'WBS + Milestones', icon: 'WB', desc: 'Upload WBS cơ cấu phân chia công việc + cột mốc dự án' },
  { value: 'WELD_PAINT', label: 'Vật tư hàn / sơn', icon: 'HS', desc: 'Upload danh sách vật tư hàn, sơn' },
  { value: 'BOM', label: 'BOM vật tư phụ', icon: 'BM', desc: 'Upload danh mục vật tư phụ (BOM)' },
  { value: 'SUPPLIER_QUOTE', label: 'Báo giá nhà cung cấp', icon: 'BG', desc: 'Tìm NCC, đính kèm báo giá/hợp đồng, so sánh & chọn' },
]

interface Props {
  taskId: string
  isEditable: boolean
  projectCode?: string
  project?: { projectCode?: string; projectName?: string; clientName?: string; contractValue?: number | string; productType?: string; startDate?: string | Date; endDate?: string | Date } | null
  projectId?: string
  taskTitle?: string
  initialTemplate?: TemplateType
}

// Màu nhận diện từng biểu mẫu (chip + viền)
const TPL_COLOR: Record<string, string> = {
  ESTIMATE: '#2563eb', PR: '#c2410c', BBH: '#7c3aed', WBS: '#0891b2',
  WELD_PAINT: '#dc2626', BOM: '#059669', SUPPLIER_QUOTE: '#d97706',
}

export default function TemplateSelector({ taskId, isEditable, projectCode, project, projectId, taskTitle, initialTemplate }: Props) {
  const [selected, setSelected] = useState<TemplateType>(initialTemplate ?? null)
  const [loaded, setLoaded] = useState(false)
  const [resultData, setResultData] = useState<Record<string, unknown>>({})
  const roleCode = useAuthStore(s => s.user?.roleCode || '')

  const [prData, setPrData] = useState('')
  const [momAttendants, setMomAttendants] = useState('')
  const [momSections, setMomSections] = useState('')
  const [weldData, setWeldData] = useState('')
  const [paintData, setPaintData] = useState('')
  const [wbsData, setWbsData] = useState('')
  const [milestonesData, setMilestonesData] = useState('')
  const [bomItems, setBomItems] = useState('')

  const loadResultData = useCallback(() => {
    apiFetch(`/api/work/tasks/${taskId}/result-data`).then((r) => {
      if (r.ok && r.resultData) {
        const rd = r.resultData as Record<string, unknown>
        setResultData(rd)
        const prSrc = rd.bomPrItems || rd.bomPr
        if (prSrc) setPrData(String(prSrc))
        if (rd.momAttendants) setMomAttendants(String(rd.momAttendants))
        if (rd.momSections) setMomSections(String(rd.momSections))
        if (rd.weldData) setWeldData(String(rd.weldData))
        if (rd.paintData) setPaintData(String(rd.paintData))
        if (rd.wbsItems) setWbsData(String(rd.wbsItems))
        if (rd.milestones) setMilestonesData(String(rd.milestones))
        if (rd.bomItemsList) setBomItems(String(rd.bomItemsList))
        // Auto-detect template: explicit > data-based > prop
        if (rd.templateType) {
          setSelected(rd.templateType as TemplateType)
        } else {
          const rc = useAuthStore.getState().user?.roleCode || ''
          const isQuoteRole = (QUOTE_EDIT_ROLES as readonly string[]).includes(rc)
          const detected = rd.totalEstimate ? 'ESTIMATE'
            : (rd.momSections || rd.momAttendants) ? 'BBH'
            : rd.supplierQuotes ? 'SUPPLIER_QUOTE'
            : (isQuoteRole && rd.bomPr) ? 'SUPPLIER_QUOTE'
            : rd.bomPr ? 'PR'
            : (rd.wbsItems || rd.milestones) ? 'WBS'
            : (rd.weldData || rd.paintData) ? 'WELD_PAINT'
            : rd.bomItemsList ? 'BOM'
            : initialTemplate ?? null
          if (detected) setSelected(detected)
        }
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [taskId])

  useEffect(() => { loadResultData() }, [loadResultData])

  const saveField = (key: string, value: unknown): Promise<void> => {
    setResultData(prev => ({ ...prev, [key]: value }))
    return apiFetch(`/api/work/tasks/${taskId}/result-data`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    }).then(() => {}).catch(() => {})
  }

  const handleSelectTemplate = (t: TemplateType) => {
    setSelected(t)
    saveField('templateType', t)
  }

  const handlePrChange = (val: string) => {
    setPrData(val)
    apiFetch(`/api/work/tasks/${taskId}/bom-pr`, {
      method: 'POST',
      body: JSON.stringify({ data: val }),
    }).catch(() => {})
  }

  if (!loaded) return null

  return (
    <div>
      <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Chọn biểu mẫu sử dụng
          </div>
          {selected && isEditable && (
            <button
              onClick={() => handleSelectTemplate(null)}
              className="text-xs px-2.5 py-1 rounded-lg"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', background: 'none' }}
            >
              ✕ Bỏ chọn
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {TEMPLATES.map((t) => {
            const active = selected === t.value
            const color = TPL_COLOR[t.value] || '#2563eb'
            return (
              <button
                key={t.value}
                onClick={() => isEditable && handleSelectTemplate(active ? null : t.value)}
                disabled={!isEditable && !active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 12,
                  border: `1px solid ${active ? color : 'var(--border, #e2e8f0)'}`,
                  borderLeft: `4px solid ${color}`,
                  background: active ? `${color}12` : 'var(--surface, #ffffff)',
                  boxShadow: active ? `0 0 0 1px ${color}` : '0 1px 2px rgba(16,24,40,.04)',
                  cursor: isEditable ? 'pointer' : 'default',
                  opacity: !isEditable && !active ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${color}18`, color, fontWeight: 700, fontSize: '0.8rem',
                }}>{t.icon}</span>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: active ? color : 'var(--text-primary)' }}>{t.label}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}</div>
                </div>
                {active && <span style={{ fontSize: '0.9rem', color, marginLeft: 'auto', flexShrink: 0 }}>✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      {selected === 'ESTIMATE' && (
        <div style={{ marginTop: 12 }}>
          <EstimateUploadUI
            isEditable={isEditable && canEditForm('ESTIMATE', roleCode)}
            project={project || (projectCode ? { projectCode } : undefined)}
            estimateData={{
              totalMaterial: Number(resultData.totalMaterial) || 0,
              totalLabor: Number(resultData.totalLabor) || 0,
              totalService: Number(resultData.totalService) || 0,
              totalOverhead: Number(resultData.totalOverhead) || 0,
              totalEstimate: Number(resultData.totalEstimate) || 0,
              dt02Detail: resultData.dt02Detail ? String(resultData.dt02Detail) : undefined,
              estimateFileName: resultData.estimateFileName ? String(resultData.estimateFileName) : undefined,
            }}
            onFieldChange={saveField}
          />
        </div>
      )}

      {selected === 'PR' && (
        <div style={{ marginTop: 12 }}>
          <BomPrUploadUI
            isEditable={isEditable && canEditForm('PR', roleCode)}
            bomPrData={prData || undefined}
            onChange={handlePrChange}
            projectCode={projectCode}
          />
          {(QUOTE_EDIT_ROLES as readonly string[]).includes(roleCode) && !resultData.supplierQuotes && (
            <button
              onClick={() => handleSelectTemplate('SUPPLIER_QUOTE')}
              style={{ marginTop: 10, padding: '8px 16px', borderRadius: 10, border: '2px dashed #93c5fd', background: '#f0f9ff', color: '#1d4ed8', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', width: '100%' }}
            >
              + Bắt đầu báo giá NCC
            </button>
          )}
        </div>
      )}

      {selected === 'BBH' && (
        <div style={{ marginTop: 12 }}>
          <MomSectionsUI
            isEditable={isEditable && canEditForm('BBH', roleCode)}
            attendantsData={momAttendants || undefined}
            sectionsData={momSections || undefined}
            onAttendantsChange={(val) => { setMomAttendants(val); saveField('momAttendants', val) }}
            onSectionsChange={(val) => { setMomSections(val); saveField('momSections', val) }}
            onHeaderImport={(h) => saveField('momHeader', JSON.stringify(h))}
            projectId={projectId}
            taskSourceTitle={taskTitle}
          />
        </div>
      )}

      {selected === 'WBS' && (
        <div style={{ marginTop: 12 }}>
          <WbsMilestonesUploadUI
            isEditable={isEditable && canEditForm('WBS', roleCode)}
            wbsData={wbsData || undefined}
            milestonesData={milestonesData || undefined}
            onWbsChange={(val) => { setWbsData(val); saveField('wbsItems', val) }}
            onMilestonesChange={(val) => { setMilestonesData(val); saveField('milestones', val) }}
            projectCode={projectCode}
          />
        </div>
      )}

      {selected === 'WELD_PAINT' && (
        <div style={{ marginTop: 12 }}>
          <WeldPaintUploadUI
            isEditable={isEditable && canEditForm('WELD_PAINT', roleCode)}
            weldData={weldData || undefined}
            paintData={paintData || undefined}
            onChangeWeld={(val) => { setWeldData(val); saveField('weldData', val) }}
            onChangePaint={(val) => { setPaintData(val); saveField('paintData', val) }}
            projectCode={projectCode}
          />
        </div>
      )}

      {selected === 'BOM' && (
        <div style={{ marginTop: 12 }}>
          <BomItemsUploadUI
            isEditable={isEditable && canEditForm('BOM', roleCode)}
            bomData={bomItems || undefined}
            onChange={(val) => { setBomItems(val); saveField('bomItemsList', val) }}
            projectCode={projectCode}
          />
        </div>
      )}

      {selected === 'SUPPLIER_QUOTE' && (
        <div style={{ marginTop: 12 }}>
          <SupplierQuoteUI
            taskId={taskId}
            isEditable={isEditable && canEditForm('SUPPLIER_QUOTE', roleCode)}
            bomPrData={prData || (resultData.bomPrItems ? String(resultData.bomPrItems) : resultData.bomPr ? String(resultData.bomPr) : undefined)}
            projectCode={projectCode}
            projectName={project?.projectName}
            value={resultData.supplierQuotes ? (Array.isArray(resultData.supplierQuotes) ? resultData.supplierQuotes : (() => { try { return JSON.parse(String(resultData.supplierQuotes)) } catch { return [] } })()) : undefined}
            existingPoId={resultData.poId ? String(resultData.poId) : undefined}
            existingPoCode={resultData.poCode ? String(resultData.poCode) : undefined}
            onChange={async (quotes) => {
              const chosen = quotes.find(q => q.selected)
              await saveField('supplierQuotes', quotes)
              saveField('chosenVendorId', chosen?.vendorId || '')
            }}
          />
        </div>
      )}
    </div>
  )
}
