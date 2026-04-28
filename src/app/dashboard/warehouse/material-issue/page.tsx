'use client'

import React, { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { Badge, Button, Card } from '@/components/ui'
import { formatDate, getUrgencyLabel } from '@/lib/utils'
import { Clock, ChevronDown, ChevronUp } from 'lucide-react'

interface MaterialIssueRecord {
  id: string; quantity: number; heatNumber: string | null; lotNumber: string | null; notes: string | null; createdAt: string;
  type: string; reason: string; referenceNo: string | null;
  material: { materialCode: string; name: string; unit: string }
}

interface Task {
  id: string; stepCode: string; stepName: string; assignedRole: string; status: string;
  deadline: string | null; notes: string | null; urgency: string;
  project: { projectCode: string; projectName: string; clientName: string };
  assignee: { fullName: string; username: string } | null;
}

function ExpandedDncRow({ taskId, onComplete }: { taskId: string, onComplete: () => void }) {
  const [taskDetail, setTaskDetail] = useState<any>(null)
  const [inventory, setInventory] = useState<any[]>([])
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [showInventory, setShowInventory] = useState(false)

  useEffect(() => {
    apiFetch(`/api/tasks/${taskId}`).then(res => {
      if (res.ok) {
        setTaskDetail(res.task)
        setInventory(res.previousStepData?.inventory || [])
        setFormData(res.task.resultData || {})
      }
    })
  }, [taskId])

  if (!taskDetail) return <div className="p-4 text-center text-slate-500">Đang tải dữ liệu...</div>

  const reqs = taskDetail.resultData?.materialIssueRequests || []
  const issuedAccumulated = taskDetail.resultData?.issuedAccumulated || {}
  
  if (reqs.length === 0) return <div className="p-4 text-center text-slate-500">Không có danh sách đề nghị cấp.</div>

  const handleSubmit = async () => {
    setSubmitting(true)
    setErrorMsg('')
    setSuccessMsg('')
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'partial_issue', resultData: formData })
      })
      if (res.ok) {
        setSuccessMsg(res.message || 'Đã xuất kho thành công!')
        setTimeout(() => {
          if (!res.isPartial) onComplete()
          else {
            // Refresh to get new accumulated values
            apiFetch(`/api/tasks/${taskId}`).then(r => {
              if (r.ok) {
                setTaskDetail(r.task)
                setFormData(r.task.resultData || {})
                setSubmitting(false)
              }
            })
          }
        }, 1500)
      } else {
        setErrorMsg(res.message || 'Có lỗi xảy ra')
        setSubmitting(false)
      }
    } catch (e: any) {
      setErrorMsg(e.message)
      setSubmitting(false)
    }
  }

  const allFulfilled = reqs.every((req: any, i: number) => {
    const code = req.code?.trim()
    if (!code) return true
    return (issuedAccumulated[`${code}_${i}`] || 0) >= (Number(req.quantity) || 0)
  })

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      {/* Tồn kho */}
      <div className="mb-4 bg-white dark:bg-slate-800 rounded-lg border border-green-200 dark:border-green-900 overflow-hidden shadow-sm">
        <button 
          onClick={() => setShowInventory(!showInventory)}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <span className="font-bold text-green-600 dark:text-green-500 flex items-center gap-2">
            ▶ 📦 Tồn kho hiện tại ({inventory.length} vật tư)
          </span>
          <span className="text-xs text-slate-500">{showInventory ? 'Thu gọn' : 'Nhấn để xem'}</span>
        </button>
        
        {showInventory && (
          <div className="border-t border-slate-100 dark:border-slate-700 max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0">
                <tr>
                  <th className="p-2 text-left text-slate-500">Mã VT</th>
                  <th className="p-2 text-left text-slate-500">Tên</th>
                  <th className="p-2 text-left text-slate-500">Quy chuẩn</th>
                  <th className="p-2 text-right text-slate-500">Tồn kho</th>
                  <th className="p-2 text-center text-slate-500">ĐVT</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((m, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                    <td className="p-2 font-mono font-bold text-sky-600 dark:text-sky-400">{m.code}</td>
                    <td className="p-2 font-medium">{m.name}</td>
                    <td className="p-2 text-slate-500">{m.spec || '—'}</td>
                    <td className={`p-2 text-right font-bold ${m.stock > 0 ? 'text-green-600' : 'text-red-500'}`}>{m.stock.toLocaleString('vi-VN')}</td>
                    <td className="p-2 text-center text-slate-500">{m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bảng Đề nghị cấp */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-sky-200 dark:border-sky-900 overflow-hidden shadow-sm">
        <div className="p-3 bg-sky-50 dark:bg-sky-900/20 border-b border-sky-100 dark:border-sky-900/50 flex justify-between items-center">
          <h3 className="font-bold text-sky-700 dark:text-sky-400">
            🧾 Đề nghị cấp ({reqs.length})
            {allFulfilled && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Đã cấp đủ 100%</span>}
          </h3>
        </div>
        
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="p-3 text-left font-semibold text-slate-600 dark:text-slate-400">Mã & Tên VT</th>
              <th className="p-3 text-center font-semibold text-slate-600 dark:text-slate-400">SL Đề nghị</th>
              <th className="p-3 text-center font-semibold text-slate-600 dark:text-slate-400">Đã xuất</th>
              <th className="p-3 text-center font-semibold text-slate-600 dark:text-slate-400">Tồn kho</th>
              <th className="p-3 text-center font-semibold text-slate-600 dark:text-slate-400">KL Thực xuất</th>
            </tr>
          </thead>
          <tbody>
            {reqs.map((req: any, idx: number) => {
              const code = req.code?.trim() || ''
              const accKey = `${code}_${idx}`
              const alreadyIssued = issuedAccumulated[accKey] || 0
              const reqQty = Number(req.quantity) || 0
              const remaining = reqQty - alreadyIssued
              const itemFulfilled = remaining <= 0

              const stockItem = inventory.find(m => m.code === code)
              const currentStock = stockItem ? Number(stockItem.stock) : 0

              const txKey = `actualQty_${code}_${idx}`
              const actualQtyStr = formData[txKey] || ''

              const actualVal = Number(actualQtyStr) || 0
              const overStock = actualVal > currentStock && actualVal > 0
              const overRemaining = actualVal > remaining && actualVal > 0
              const hasError = overStock || overRemaining

              return (
                <tr key={idx} className={`border-b border-slate-100 dark:border-slate-700 ${itemFulfilled ? 'bg-green-50/50 dark:bg-green-900/10' : ''}`}>
                  <td className="p-3">
                    <div className="font-mono font-bold text-sky-600 dark:text-sky-400">{req.code}</div>
                    <div className="text-xs text-slate-500">{req.name}</div>
                  </td>
                  <td className="p-3 text-center font-bold">
                    {reqQty.toLocaleString('vi-VN')} <span className="text-xs font-normal text-slate-500">{req.unit}</span>
                  </td>
                  <td className="p-3 text-center font-bold text-sky-600 dark:text-sky-400">
                    {alreadyIssued > 0 ? alreadyIssued.toLocaleString('vi-VN') : '0'}
                  </td>
                  <td className="p-3 text-center">
                    {stockItem ? (
                      <span className={`font-bold ${currentStock > 0 ? 'text-green-600' : 'text-red-500'}`}>{currentStock.toLocaleString('vi-VN')}</span>
                    ) : (
                      <span className="text-xs font-bold text-red-500">Chưa có</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {itemFulfilled ? (
                      <span className="font-bold text-green-600">—</span>
                    ) : (
                      <div>
                        <input
                          type="number"
                          min="0"
                          max={Math.min(remaining, currentStock)}
                          placeholder="0"
                          value={actualQtyStr}
                          onChange={e => setFormData({ ...formData, [txKey]: e.target.value })}
                          className={`w-24 text-center px-2 py-1 text-sm border rounded ${hasError ? 'border-red-500 bg-red-50' : 'border-slate-300 dark:border-slate-600'}`}
                        />
                        {overStock && <div className="text-[10px] text-red-500 font-bold mt-1">⚠️ Vượt kho</div>}
                        {!overStock && overRemaining && <div className="text-[10px] text-red-500 font-bold mt-1">⚠️ Vượt thiếu ({remaining})</div>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Actions */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
          <div>
            {errorMsg && <p className="text-sm text-red-500 font-medium">{errorMsg}</p>}
            {successMsg && <p className="text-sm text-green-600 font-medium">{successMsg}</p>}
          </div>
          <Button 
            variant="accent" 
            onClick={handleSubmit} 
            disabled={submitting || allFulfilled}
            className={allFulfilled ? 'opacity-50' : ''}
          >
            {submitting ? 'Đang xử lý...' : 'Xác nhận cấp phát'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function MaterialIssuePage() {
  const [issues, setIssues] = useState<MaterialIssueRecord[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

  const loadData = () => {
    Promise.all([
      apiFetch('/api/stock-movements?type=OUT&reason=wo_issue'),
      apiFetch('/api/tasks?stepCode=P4.5')
    ]).then(([resIssues, resTasks]) => {
      if (resIssues.ok) setIssues(resIssues.movements || [])
      if (resTasks.ok) setTasks(resTasks.tasks || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalQty = issues.reduce((s, r) => s + Number(r.quantity), 0)

  return (
    <div className="space-y-8 animate-fade-in">
      {/* SECTION 1: YÊU CẦU CẤP PHÁT (PENDING TASKS) */}
      <section className="space-y-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>📤 Yêu cầu cấp phát vật tư</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{tasks.length} yêu cầu cần xử lý</p>
        </div>

        {tasks.length === 0 ? (
          <Card padding="spacious" className="text-center">
            <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-primary)' }}>Không có yêu cầu cấp phát nào!</p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Tất cả các đề nghị cấp đã được xử lý</p>
          </Card>
        ) : (
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dự án / WO</th>
                  <th>Nội dung yêu cầu</th>
                  <th>Thời hạn</th>
                  <th>Trạng thái</th>
                  <th className="text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const urgencyInfo = getUrgencyLabel(task.urgency)
                  const isExpanded = expandedTaskId === task.id
                  return (
                    <React.Fragment key={task.id}>
                      <tr 
                        className={`cursor-pointer transition-colors ${isExpanded ? 'bg-sky-50 dark:bg-sky-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      >
                        <td>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{task.project.projectCode}</span>
                            <span className="text-xs truncate max-w-48" style={{ color: 'var(--text-muted)' }}>{task.project.projectName}</span>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.stepName}</span>
                            {urgencyInfo.label && <span className={`badge ${urgencyInfo.color}`}>{urgencyInfo.label}</span>}
                          </div>
                        </td>
                        <td>
                          {task.deadline ? (
                            <span className="flex items-center gap-1 text-xs" style={{ color: task.urgency === 'overdue' ? '#dc2626' : 'var(--text-muted)' }}>
                              <Clock size={12} /> {formatDate(task.deadline)}
                            </span>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td>
                          <Badge variant={task.status === 'IN_PROGRESS' ? 'warning' : 'default'}>
                            {task.status === 'IN_PROGRESS' ? 'Đang chờ cấp' : 'Đã cấp'}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <Button variant={isExpanded ? 'default' : 'accent'} size="sm" onClick={(e) => { e.stopPropagation(); setExpandedTaskId(isExpanded ? null : task.id) }}>
                            {isExpanded ? 'Thu gọn ✕' : 'Mở rộng ↓'}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="p-0 border-b border-slate-200 dark:border-slate-700">
                            <ExpandedDncRow taskId={task.id} onComplete={() => { setExpandedTaskId(null); loadData(); }} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <hr className="border-t border-slate-200 dark:border-slate-800" />

      {/* SECTION 2: LỊCH SỬ CẤP PHÁT (STOCK MOVEMENTS) */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Lịch sử phiếu cấp vật tư</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{issues.length} phiếu đã cấp • Tổng SL: {totalQty.toLocaleString('vi-VN')}</p>
        </div>

        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th>WO</th><th>Vật tư</th><th>SL</th><th>ĐVT</th><th>Heat No.</th><th>Lot No.</th><th>Ghi chú</th><th>Ngày</th></tr></thead>
            <tbody>
              {issues.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có phiếu cấp vật tư</td></tr>
              ) : issues.map(r => (
                <tr key={r.id}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{r.referenceNo || '—'}</span></td>
                  <td className="text-xs" style={{ color: 'var(--text-primary)' }}>{r.material.materialCode} — {r.material.name}</td>
                  <td className="text-xs font-bold" style={{ color: '#dc2626' }}>{Number(r.quantity).toLocaleString('vi-VN')}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.material.unit}</td>
                  <td className="text-xs font-mono" style={{ color: '#0ea5e9' }}>{r.heatNumber || '—'}</td>
                  <td className="text-xs font-mono" style={{ color: '#f59e0b' }}>{r.lotNumber || '—'}</td>
                  <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(r.createdAt).toLocaleDateString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
