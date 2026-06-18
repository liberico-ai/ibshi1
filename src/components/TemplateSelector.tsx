'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import MomSectionsUI from '@/components/MomSectionsUI'
import EstimateUploadUI from '@/components/EstimateUploadUI'
import WbsMilestonesUploadUI from '@/components/WbsMilestonesUploadUI'
import BomItemsUploadUI from '@/components/BomItemsUploadUI'
import BomPrUploadUI from '@/app/dashboard/tasks/[id]/components/BomPrUploadUI'
import WeldPaintUploadUI from '@/app/dashboard/tasks/[id]/components/WeldPaintUploadUI'

export type TemplateType = 'ESTIMATE' | 'PR' | 'BBH' | 'WBS' | 'WELD_PAINT' | 'BOM' | null

const TEMPLATES: { value: NonNullable<TemplateType>; label: string; icon: string; desc: string }[] = [
  { value: 'ESTIMATE', label: 'Dự toán thi công', icon: '📊', desc: 'Upload Excel dự toán (DT01-DT07), parse tổng hợp chi phí' },
  { value: 'PR', label: 'Đề xuất vật tư (PR)', icon: '📦', desc: 'Upload file PR, parse danh sách vật tư chính, đối chiếu kho' },
  { value: 'BBH', label: 'Biên bản họp (BBH)', icon: '📋', desc: 'Upload BB họp Excel, parse nội dung & phân công' },
  { value: 'WBS', label: 'WBS + Milestones', icon: '📐', desc: 'Upload WBS cơ cấu phân chia công việc + cột mốc dự án' },
  { value: 'WELD_PAINT', label: 'Vật tư hàn / sơn', icon: '🔧', desc: 'Upload danh sách vật tư hàn, sơn' },
  { value: 'BOM', label: 'BOM vật tư phụ', icon: '🧱', desc: 'Upload danh mục vật tư phụ (BOM)' },
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

export default function TemplateSelector({ taskId, isEditable, projectCode, project, projectId, taskTitle, initialTemplate }: Props) {
  const [selected, setSelected] = useState<TemplateType>(initialTemplate ?? null)
  const [loaded, setLoaded] = useState(false)
  const [resultData, setResultData] = useState<Record<string, unknown>>({})

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
        if (rd.bomPr) setPrData(String(rd.bomPr))
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
          const detected = rd.totalEstimate ? 'ESTIMATE'
            : (rd.momSections || rd.momAttendants) ? 'BBH'
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

  const saveField = (key: string, value: unknown) => {
    setResultData(prev => ({ ...prev, [key]: value }))
    apiFetch(`/api/work/tasks/${taskId}/result-data`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    }).catch(() => {})
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
            📎 Chọn biểu mẫu sử dụng
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
            return (
              <button
                key={t.value}
                onClick={() => isEditable && handleSelectTemplate(active ? null : t.value)}
                disabled={!isEditable && !active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', borderRadius: 10,
                  border: active ? '2px solid #2563eb' : '1px solid var(--border)',
                  background: active ? '#eff6ff' : 'var(--bg-secondary)',
                  cursor: isEditable ? 'pointer' : 'default',
                  opacity: !isEditable && !active ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '1.2rem' }}>{t.icon}</span>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: active ? '#1d4ed8' : 'var(--text-primary)' }}>{t.label}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}</div>
                </div>
                {active && <span style={{ fontSize: '0.9rem', color: '#2563eb', marginLeft: 'auto', flexShrink: 0 }}>✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      {selected === 'ESTIMATE' && (
        <div style={{ marginTop: 12 }}>
          <EstimateUploadUI
            isEditable={isEditable}
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
            isEditable={isEditable}
            bomPrData={prData || undefined}
            onChange={handlePrChange}
            projectCode={projectCode}
          />
        </div>
      )}

      {selected === 'BBH' && (
        <div style={{ marginTop: 12 }}>
          <MomSectionsUI
            isEditable={isEditable}
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
            isEditable={isEditable}
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
            isEditable={isEditable}
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
            isEditable={isEditable}
            bomData={bomItems || undefined}
            onChange={(val) => { setBomItems(val); saveField('bomItemsList', val) }}
            projectCode={projectCode}
          />
        </div>
      )}
    </div>
  )
}
