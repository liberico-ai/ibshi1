'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import WbsTableUI from '@/app/dashboard/tasks/[id]/components/WbsTableUI'
import MultiFileUpload from '@/components/MultiFileUpload'

// P1.2A — Lập kế hoạch & WBS ở tab Cột mốc (Cách A).
// Hiện khi mở Cột mốc với ?project=<id> VÀ dự án có bước P1.2A đang mở.
// Sửa WBS → lưu nháp vào task.resultData.wbsItems; "Hoàn thành" → đóng bước P1.2A
// (completeStepTaskFromSidebar) → chuỗi chuyển tiếp P1.3.
interface StepTask { id: string; status: string; resultData: Record<string, unknown>; canEdit: boolean }
const STATUS_LABEL: Record<string, string> = { OPEN: 'Chờ lập', IN_PROGRESS: 'Đang lập', RETURNED: 'Bị trả lại' }

export default function WbsPlanCard() {
  const [projectId, setProjectId] = useState('')
  const [task, setTask] = useState<StepTask | null>(null)
  const [wbs, setWbs] = useState('')
  const [completing, setCompleting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setProjectId(new URLSearchParams(window.location.search).get('project') || '')
  }, [])

  const loadTask = useCallback(() => {
    if (!projectId) { setTask(null); return }
    apiFetch(`/api/work/step-task?projectId=${projectId}&stepCode=P1.2A`).then((r) => {
      if (r.ok && r.task) {
        setTask(r.task)
        const w = r.task.resultData?.wbsItems
        setWbs(typeof w === 'string' ? w : w ? JSON.stringify(w) : '')
      } else setTask(null)
    })
  }, [projectId])
  useEffect(() => { loadTask() }, [loadTask])

  const saveWbs = (val: string) => {
    if (!task) return
    apiFetch(`/api/work/tasks/${task.id}/result-data`, {
      method: 'POST',
      body: JSON.stringify({ key: 'wbsItems', value: val ? JSON.parse(val) : null }),
    }).catch(() => {})
  }

  const onWbsChange = (val: string) => {
    setWbs(val)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveWbs(val), 800)
  }

  const handleComplete = async () => {
    if (!task) return
    if (!(await confirmDialog('Hoàn thành lập kế hoạch & WBS (P1.2A)? Quy trình sẽ tiến tới bước duyệt kế hoạch & dự toán (P1.3).'))) return
    setCompleting(true)
    saveWbs(wbs) // lưu bản mới nhất trước khi đóng
    const res = await apiFetch('/api/work/step-task', {
      method: 'POST',
      body: JSON.stringify({ projectId, stepCode: 'P1.2A', action: 'complete' }),
    })
    setCompleting(false)
    if (res.ok) { notify('Đã hoàn thành lập kế hoạch & WBS — quy trình chuyển tiếp', 'success'); loadTask() }
    else notify(res.error || 'Lỗi hoàn thành', 'error')
  }

  if (!projectId || !task) return null

  return (
    <div className="card p-5 space-y-3" style={{ border: '1px solid #f59e0b40', background: '#fffbeb' }}>
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-sm font-bold" style={{ color: '#92400e' }}>Lập kế hoạch & WBS (P1.2A)</h3>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#f59e0b20', color: '#92400e' }}>
          {STATUS_LABEL[task.status] || task.status}
        </span>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Phân rã hạng mục (WBS), mốc thanh toán và tải biên bản kickoff. Xong thì bấm "Hoàn thành & chuyển tiếp".
      </p>

      <WbsTableUI isWbsEditable={task.canEdit} wbsItemsData={wbs} onChange={onWbsChange} />

      <div>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Biên bản họp kickoff / file WBS</label>
        <MultiFileUpload label="Tải biên bản kickoff / WBS" entityType="TaskDoc" entityId={`${task.id}__kickoff`} />
      </div>

      {task.canEdit && (
        <div className="flex justify-end">
          <button onClick={handleComplete} disabled={completing}
            className="text-sm px-4 py-2.5 rounded-lg font-semibold" style={{ background: '#16a34a', color: '#fff', opacity: completing ? 0.5 : 1 }}>
            {completing ? 'Đang xử lý…' : '✓ Hoàn thành & chuyển tiếp'}
          </button>
        </div>
      )}
    </div>
  )
}
