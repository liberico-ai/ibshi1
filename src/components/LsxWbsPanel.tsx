'use client'

import { useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import WbsTableUI from '@/app/dashboard/tasks/[id]/components/WbsTableUI'
import type { CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, TeamAssign } from '@/lib/types'

// Vùng làm việc của bước P3.3/P3.4: lưới WBS chế độ LSX — phân giao xưởng, phát hành LSX,
// lập DNC vật tư và ĐỀ NGHỊ CẤP (sinh task P4.5 cho Kho).
//
// Dùng chung cho HAI nơi để không bao giờ lệch nhau:
//   • tab Sản xuất (Cách A — LsxStepCard)
//   • trang Công việc bản cũ /dashboard/tasks/[id] (giữ làm đường lùi)
//
// Mọi thao tác đều ghi thẳng vào task.resultData qua PUT /api/tasks/[id] {action:'save'} —
// P5.1 (báo cáo ngày) và check-p511 đọc lại đúng các khoá cellAssignments / lsxIssuedDetails.

interface Props {
  taskId: string
  projectId: string
  stepCode: string
  wbsItems: unknown
  initialResultData: Record<string, unknown>
  editable?: boolean
  onDataChanged?: () => void
}

const parseMap = <T,>(raw: unknown): T => {
  try {
    if (!raw) return {} as T
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
  } catch { return {} as T }
}

export default function LsxWbsPanel({ taskId, projectId, stepCode, wbsItems, initialResultData, editable = true, onDataChanged }: Props) {
  const [formData, setFormData] = useState<Record<string, unknown>>(initialResultData || {})
  const [msg, setMsg] = useState('')

  const flash = (text: string, ms = 3000) => { setMsg(text); setTimeout(() => setMsg(''), ms) }

  /** Trộn thay đổi vào resultData rồi lưu DB. Trả về bản resultData mới. */
  const patch = async (changes: Record<string, unknown>) => {
    const next = { ...formData, ...changes }
    setFormData(next)
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'save', resultData: next }),
      })
      onDataChanged?.()
    } catch { /* lưu nháp — lỗi mạng không chặn thao tác */ }
    return next
  }

  /** Hạng mục đã phát hành đủ 100% công đoạn → tự sinh P5.1.1 (yêu cầu nghiệm thu CL). */
  const checkP511 = async (rowIdx: number) => {
    try {
      const res = await apiFetch('/api/tasks/check-p511', {
        method: 'POST',
        body: JSON.stringify({ projectId, sourceStep: stepCode, rowIdx, taskId }),
      })
      // apiFetch trả JSON đã parse, successResponse trải phẳng data → đọc thẳng res.created
      if (res?.created) flash(res.reason || 'Đã tạo yêu cầu nghiệm thu chất lượng', 6000)
    } catch { /* silent */ }
  }

  const cellAssignments = parseMap<CellAssignMap>(formData.cellAssignments)
  const lsxIssuedDetails = parseMap<LsxIssuedMap>(formData.lsxIssuedDetails)
  const materialRequests = parseMap<MaterialReqMap>(formData.materialRequests)
  const lsxStatus = (formData.lsxStatus as Record<number, { lsx?: boolean; vt?: boolean }>) || {}

  return (
    <div style={{ width: '100%' }}>
      {msg && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
          {msg}
        </div>
      )}

      <WbsTableUI
        isWbsEditable={false}
        wbsItemsData={wbsItems}
        mode="lsx"
        stepFilter={stepCode}
        lsxStatus={lsxStatus}
        cellAssignments={cellAssignments}
        lsxIssuedDetails={lsxIssuedDetails}
        materialRequests={materialRequests}
        qcFailedAssignments={Array.isArray(formData.qcFailedAssignments) ? formData.qcFailedAssignments : undefined}

        onAssign={!editable ? undefined : async (ri, colKey, assigns: TeamAssign[]) => {
          const updated = { ...cellAssignments, [ri]: { ...(cellAssignments[ri] || {}), [colKey]: assigns } }
          await patch({ cellAssignments: JSON.stringify(updated) })
          flash(`Đã lưu phân giao ${assigns.length} xưởng cho công đoạn ${colKey}`)
        }}

        // Phát hành LSX cho CẢ hạng mục — đánh dấu mọi xưởng của mọi công đoạn trong dòng.
        onIssueLSX={!editable ? undefined : async (ri, row) => {
          const newStatus = { ...lsxStatus, [ri]: { ...lsxStatus[ri], lsx: true } }
          const issued: LsxIssuedMap = { ...lsxIssuedDetails }
          if (cellAssignments[ri]) {
            issued[ri] = { ...(issued[ri] || {}) }
            Object.keys(cellAssignments[ri]).forEach((stageKey) => {
              issued[ri][stageKey] = { ...(issued[ri][stageKey] || {}) }
              cellAssignments[ri][stageKey].forEach((_, tIdx) => { issued[ri][stageKey][tIdx] = true })
            })
          }
          await patch({ lsxStatus: JSON.stringify(newStatus), lsxIssuedDetails: JSON.stringify(issued) })
          flash(`Đã phát hành LSX cho hạng mục: ${row.hangMuc || '#' + (ri + 1)}`)
          await apiFetch('/api/tasks/ensure-daily-report', { method: 'POST', body: JSON.stringify({ projectId }) }).catch(() => {})
          await checkP511(ri)
        }}

        // Phát hành LSX cho MỘT xưởng của một công đoạn.
        onIssueSingleTeam={!editable ? undefined : async (ri, colKey, teamIdx) => {
          const updated: LsxIssuedMap = {
            ...lsxIssuedDetails,
            [ri]: { ...(lsxIssuedDetails[ri] || {}), [colKey]: { ...(lsxIssuedDetails[ri]?.[colKey] || {}), [teamIdx]: true } },
          }
          await patch({ lsxIssuedDetails: JSON.stringify(updated) })
          flash(`Đã phát hành LSX cho xưởng #${teamIdx + 1} — ${colKey}`)
          // Mở sẵn task báo cáo ngày (P5.1/P5.1A) — công đoạn không cần vật tư vẫn báo được,
          // không phải chờ Kho hoàn thành P4.5.
          await apiFetch('/api/tasks/ensure-daily-report', { method: 'POST', body: JSON.stringify({ projectId }) }).catch(() => {})
          await checkP511(ri)
        }}

        onRequestMaterial={!editable ? undefined : async (ri, row) => {
          const newStatus = { ...lsxStatus, [ri]: { ...lsxStatus[ri], vt: true } }
          await patch({ lsxStatus: JSON.stringify(newStatus) })
          flash(`Đã đánh dấu đề nghị cấp VT cho: ${row.hangMuc || 'hạng mục #' + (ri + 1)}`)
        }}

        onUpdateMaterials={!editable ? undefined : async (ri, stageKey, teamIdx, items: MaterialReqItem[]) => {
          const updated: MaterialReqMap = {
            ...materialRequests,
            [ri]: {
              ...(materialRequests[ri] || {}),
              [stageKey]: { ...((materialRequests[ri] || {})[stageKey] || {}), [teamIdx]: items },
            },
          }
          await patch({ materialRequests: JSON.stringify(updated) })
          flash(`Đã lưu ${items.length} vật tư cho đợt DNC`)
        }}

        // ĐỀ NGHỊ CẤP: đánh dấu dòng vật tư đã đề nghị + sinh task P4.5 cho Kho.
        onRequestIssue={!editable ? undefined : async (ri, stageKey, teamIdx, matIdx, material) => {
          const currentItems = materialRequests[ri]?.[stageKey]?.[teamIdx] || []
          const updatedItems = currentItems.map((item, i) => (i === matIdx ? { ...item, requested: true } : item))
          const updatedMR: MaterialReqMap = {
            ...materialRequests,
            [ri]: {
              ...(materialRequests[ri] || {}),
              [stageKey]: { ...((materialRequests[ri] || {})[stageKey] || {}), [teamIdx]: updatedItems },
            },
          }
          // Lưu TRƯỚC khi tạo P4.5 để cellAssignments chắc chắn đã nằm trong DB cho P5.1 đọc.
          await patch({ materialRequests: JSON.stringify(updatedMR) })

          const t = cellAssignments[ri]?.[stageKey]?.[teamIdx]
          const teamAssign = t ? { teamName: t.teamName, volume: t.volume, startDate: t.startDate, endDate: t.endDate } : {}

          const res = await apiFetch('/api/tasks/activate', {
            method: 'POST',
            body: JSON.stringify({
              projectId,
              stepCode: 'P4.5',
              materialInfo: {
                name: material.name, code: material.code, spec: material.spec,
                quantity: material.quantity, unit: material.unit,
                sourceStep: stepCode, sourceRow: ri, stageKey, teamIdx,
                ...teamAssign,
              },
            }),
          })
          flash(
            res?.ok
              ? `Đã gửi đề nghị cấp cho Kho: ${material.name} (${material.quantity} ${material.unit})`
              : `Đã đánh dấu đề nghị cấp: ${material.name} — chưa tạo được việc cho Kho${res?.error ? ` (${res.error})` : ''}`,
            5000,
          )
        }}

        onCloneRework={!editable ? undefined : async (ri, stageKey, teamIdx) => {
          const assigns: CellAssignMap = JSON.parse(JSON.stringify(cellAssignments))
          const team = assigns[ri]?.[stageKey]?.[teamIdx]
          if (!team) return
          team.rework_cloned = true
          const newTeam: TeamAssign = { ...team, teamName: team.teamName + ' (Rework)', rework_cloned: false, startDate: '', endDate: '' }
          const newTeamIdx = assigns[ri][stageKey].length
          assigns[ri][stageKey].push(newTeam)

          const mats: MaterialReqMap = JSON.parse(JSON.stringify(materialRequests))
          const cloned = JSON.parse(JSON.stringify(mats[ri]?.[stageKey]?.[teamIdx] || [])) as MaterialReqItem[]
          if (cloned.length > 0) {
            cloned.forEach((m) => { m.requested = false })
            if (!mats[ri]) mats[ri] = {}
            if (!mats[ri][stageKey]) mats[ri][stageKey] = {}
            mats[ri][stageKey][newTeamIdx] = cloned
          }
          await patch({ cellAssignments: JSON.stringify(assigns), materialRequests: JSON.stringify(mats) })
          flash('Đã tạo LSX bù (Rework) kèm vật tư.')
        }}
      />
    </div>
  )
}
