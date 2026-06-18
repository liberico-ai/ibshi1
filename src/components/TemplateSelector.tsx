'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import MomSectionsUI from '@/components/MomSectionsUI'
import BomPrUploadUI from '@/app/dashboard/tasks/[id]/components/BomPrUploadUI'
import WeldPaintUploadUI from '@/app/dashboard/tasks/[id]/components/WeldPaintUploadUI'

export type TemplateType = 'PR' | 'BBH' | 'WELD_PAINT' | null

const TEMPLATES: { value: TemplateType; label: string; icon: string; desc: string }[] = [
  { value: 'PR', label: 'Đề xuất vật tư (PR)', icon: '📦', desc: 'Upload file PR, parse danh sách vật tư, đối chiếu kho' },
  { value: 'BBH', label: 'Biên bản họp (BBH)', icon: '📋', desc: 'Upload BB họp Excel, parse nội dung & phân công' },
  { value: 'WELD_PAINT', label: 'Vật tư hàn / sơn', icon: '🔧', desc: 'Upload danh sách vật tư hàn, sơn' },
]

interface Props {
  taskId: string
  isEditable: boolean
  projectCode?: string
  initialTemplate?: TemplateType
}

export default function TemplateSelector({ taskId, isEditable, projectCode, initialTemplate }: Props) {
  const [selected, setSelected] = useState<TemplateType>(initialTemplate ?? null)
  const [loaded, setLoaded] = useState(false)

  // resultData from server
  const [prData, setPrData] = useState('')
  const [momAttendants, setMomAttendants] = useState('')
  const [momSections, setMomSections] = useState('')
  const [weldData, setWeldData] = useState('')
  const [paintData, setPaintData] = useState('')

  const loadResultData = useCallback(() => {
    apiFetch(`/api/work/tasks/${taskId}/result-data`).then((r) => {
      if (r.ok && r.resultData) {
        const rd = r.resultData as Record<string, unknown>
        if (rd.templateType) setSelected(rd.templateType as TemplateType)
        if (rd.bomPr) setPrData(String(rd.bomPr))
        if (rd.momAttendants) setMomAttendants(String(rd.momAttendants))
        if (rd.momSections) setMomSections(String(rd.momSections))
        if (rd.weldData) setWeldData(String(rd.weldData))
        if (rd.paintData) setPaintData(String(rd.paintData))
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [taskId])

  useEffect(() => { loadResultData() }, [loadResultData])

  const saveField = (key: string, value: unknown) => {
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

  const handleMomAttendantsChange = (val: string) => {
    setMomAttendants(val)
    saveField('momAttendants', val)
  }

  const handleMomSectionsChange = (val: string) => {
    setMomSections(val)
    saveField('momSections', val)
  }

  const handleMomHeaderImport = (h: Record<string, string>) => {
    saveField('momHeader', JSON.stringify(h))
  }

  const handleWeldChange = (val: string) => {
    setWeldData(val)
    saveField('weldData', val)
  }

  const handlePaintChange = (val: string) => {
    setPaintData(val)
    saveField('paintData', val)
  }

  if (!loaded) return null

  const hasData = prData || momAttendants || momSections || weldData || paintData

  return (
    <div>
      {/* Template selector chips */}
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TEMPLATES.map((t) => {
            const active = selected === t.value
            return (
              <button
                key={t.value}
                onClick={() => isEditable && handleSelectTemplate(active ? null : t.value)}
                disabled={!isEditable && !active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 10,
                  border: active ? '2px solid #2563eb' : '1px solid var(--border)',
                  background: active ? '#eff6ff' : 'var(--bg-secondary)',
                  cursor: isEditable ? 'pointer' : 'default',
                  opacity: !isEditable && !active ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '1.3rem' }}>{t.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: active ? '#1d4ed8' : 'var(--text-primary)' }}>{t.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{t.desc}</div>
                </div>
                {active && <span style={{ fontSize: '1rem', color: '#2563eb', marginLeft: 4 }}>✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Render selected template UI */}
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
            onAttendantsChange={handleMomAttendantsChange}
            onSectionsChange={handleMomSectionsChange}
            onHeaderImport={handleMomHeaderImport}
          />
        </div>
      )}

      {selected === 'WELD_PAINT' && (
        <div style={{ marginTop: 12 }}>
          <WeldPaintUploadUI
            isEditable={isEditable}
            weldData={weldData || undefined}
            paintData={paintData || undefined}
            onChangeWeld={handleWeldChange}
            onChangePaint={handlePaintChange}
            projectCode={projectCode}
          />
        </div>
      )}
    </div>
  )
}
