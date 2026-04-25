'use client'

import React, { useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface P3_6Props {
  task: any
  isActive: boolean
  currentUser?: any
}

export default function P3_6ApprovalUI({ task, isActive, currentUser }: P3_6Props) {
  const rd = task.resultData || {}
  const groupsToEvaluate = rd.groups || []

  const [evaluations, setEvaluations] = useState<Record<string, { action: string; reason: string }>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleReasonChange = (groupId: string, reason: string) => {
    if (!isActive) return
    setEvaluations(prev => ({
      ...prev,
      [groupId]: { action: 'REJECT', reason }
    }))
  }

  // Triggered inline immediately for one group at a time
  const submitEvaluations = async (groupId: string, action: 'APPROVE' | 'REJECT', reason: string = '') => {
    if (action === 'REJECT' && !reason.trim()) {
      alert('Vui lòng nhập lý do từ chối để bộ phận Thương mại có thể cập nhật lại.')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          action: 'p36_evaluate_groups',
          resultData: { 
            evaluations: [{ groupId, action, reason }]
          }
        })
      })

      if (res.ok || res.success) {
        const pendingGroups = groupsToEvaluate.filter((g: any) => g.status === 'PENDING' || g.status === 'SUBMITTED')
        // If this was the last pending group being evaluated, redirect back to task list
        if (pendingGroups.length <= 1) {
           window.location.href = '/dashboard/tasks'
        } else {
           window.location.reload()
        }
      } else {
        alert(res.error || 'Có lỗi xảy ra khi lưu.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
      <div className="space-y-6 flex flex-col h-full">
         <div className="card p-6 bg-white border border-gray-200 flex-1">
             <div className="space-y-8">
                 {groupsToEvaluate.map((group: any, idx: number) => {
                     const isPending = group.status === 'PENDING' || group.status === 'SUBMITTED'
                     const evalState = evaluations[group.id]

                     return (
                         <div key={group.id} className={`border rounded-xl overflow-hidden shadow-sm transition-colors ${
                            !isPending ? (group.status === 'APPROVED' ? 'border-green-300' : 'border-red-300') : 
                            (evalState?.action === 'REJECT' ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200')
                         }`}>
                             {/* Group Header */}
                             <div className={`p-4 border-b flex justify-between items-center ${
                                !isPending ? (group.status === 'APPROVED' ? 'bg-green-50/50 border-green-200' : 'bg-red-50/50 border-red-200') :
                                (evalState?.action === 'REJECT' ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-gray-200')
                             }`}>
                                 <div>
                                     <h3 className="font-bold text-lg text-gray-800">#{idx + 1}. {group.name}</h3>
                                     <p className="text-sm text-gray-500">{group.items.length} vật tư — Tổng tiền dự kiến: <strong className="text-red-600">{group.totalValue.toLocaleString('vi-VN')} đ</strong></p>
                                 </div>
                                 <div className="flex gap-2 items-center">
                                     {!isPending ? (
                                         group.status === 'APPROVED' 
                                            ? <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-semibold border border-green-200 shadow-sm flex items-center gap-1">✅ Đã Duyệt</span>
                                            : <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full font-semibold border border-red-200 shadow-sm flex items-center gap-1">❌ Đã Từ Chối</span>
                                     ) : (
                                         <>
                                            <button 
                                               onClick={() => submitEvaluations(group.id, 'APPROVE')}
                                               disabled={!isActive || isSubmitting}
                                               className={`px-4 py-1.5 rounded-md font-semibold text-sm transition-all border bg-white hover:bg-green-50 text-green-600 border-green-200 shadow-sm hover:shadow`}
                                            >
                                               {isSubmitting ? '⏳...' : '✅ Phê duyệt'}
                                            </button>
                                            <button 
                                               onClick={() => setEvaluations(p => ({ ...p, [group.id]: { action: 'REJECT', reason: p[group.id]?.reason || '' } }))}
                                               disabled={!isActive || evalState?.action === 'REJECT'}
                                               className={`px-4 py-1.5 rounded-md font-semibold text-sm transition-all border ${
                                                  evalState?.action === 'REJECT' 
                                                  ? 'bg-red-50 text-red-600 border-red-200' 
                                                  : 'bg-white hover:bg-red-50 text-red-600 border-red-200 shadow-sm hover:shadow'
                                               }`}
                                            >
                                               ❌ Từ Chối
                                            </button>
                                         </>
                                     )}
                                 </div>
                             </div>
                             
                             {/* Items Table */}
                             <div className="p-4 bg-white relative">
                                 <div className="max-h-96 overflow-y-auto mb-4 border border-gray-200 rounded">
                                     <table className="w-full text-sm border-collapse">
                                         <thead>
                                             <tr className="bg-gray-100 text-gray-700 sticky top-0 z-10 shadow-sm">
                                                 <th className="p-2 border font-semibold text-left">Nội dung</th>
                                                 <th className="p-2 border font-semibold text-right w-24">SL Cần Mua</th>
                                                 <th className="p-2 border font-semibold text-left">Nhà Cung Cấp Đề Xuất</th>
                                                 <th className="p-2 border font-semibold text-right">Đơn giá</th>
                                                 <th className="p-2 border font-semibold text-right">Thành tiền</th>
                                             </tr>
                                         </thead>
                                         <tbody>
                                             {group.items.map((it: any, i: number) => {
                                                 if (it.quotes && it.quotes.length > 0) {
                                                     return (
                                                         <React.Fragment key={i}>
                                                             <tr className="bg-gray-200 border-t-4 border-white text-gray-800">
                                                                 <td className="p-2 border-b font-bold" colSpan={5}>
                                                                     {i + 1}. {it.name} <span className="text-xs font-normal text-gray-600 ml-2">{it.code} {it.spec && `— ${it.spec}`}</span>
                                                                 </td>
                                                             </tr>
                                                             {it.quotes.map((q: any, qIdx: number) => {
                                                                 const isSelected = it.selectedQuoteIndex === qIdx;
                                                                 const validPrices = it.quotes.map((qt: any) => qt.price).filter((p: number) => p > 0);
                                                                 const isCheapest = q.price > 0 && q.price === Math.min(...validPrices);
                                                                 return (
                                                                     <tr key={`${i}-${qIdx}`} className={`text-sm hover:bg-gray-50 ${isSelected ? 'bg-blue-50/60 text-blue-900 border-l-4 border-l-blue-500 font-medium' : 'text-gray-500 border-l-4 border-l-transparent'}`}>
                                                                         <td className="p-2 border-b pl-6">
                                                                            Báo giá {qIdx + 1} 
                                                                            {isSelected && <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded shadow-sm">ĐƯỢC CHỌN</span>}
                                                                         </td>
                                                                         <td className="p-2 border-b text-right">
                                                                            {isSelected ? <span className="text-blue-700">{it.shortfall} {it.unit}</span> : ''}
                                                                         </td>
                                                                         <td className="p-2 border-b">
                                                                            {q.ncc || <span className="text-gray-400 italic">Chưa nhập</span>} 
                                                                            {isCheapest && <span className="ml-2 text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded border border-green-200 shadow-sm">RẺ NHẤT</span>}
                                                                         </td>
                                                                         <td className="p-2 border-b text-right font-mono">
                                                                            {(q.price || 0).toLocaleString('vi-VN')} đ
                                                                         </td>
                                                                         <td className="p-2 border-b text-right font-semibold font-mono">
                                                                             {isSelected ? <span className="text-red-600">{((q.price || 0) * it.shortfall).toLocaleString('vi-VN')} đ</span> : ''}
                                                                         </td>
                                                                     </tr>
                                                                 )
                                                             })}
                                                         </React.Fragment>
                                                     )
                                                 }
                                                 return (
                                                     <tr key={i} className="hover:bg-gray-50">
                                                         <td className="p-2 border">
                                                             <div className="font-medium text-gray-800">{it.name}</div>
                                                             <div className="text-xs text-gray-500">{it.code} {it.spec && `— ${it.spec}`}</div>
                                                         </td>
                                                         <td className="p-2 border text-right font-medium text-blue-700">{it.shortfall} {it.unit}</td>
                                                         <td className="p-2 border font-semibold text-gray-800">{it.ncc}</td>
                                                         <td className="p-2 border text-right text-gray-700">{(it.price || 0).toLocaleString('vi-VN')} đ</td>
                                                         <td className="p-2 border text-right font-semibold text-red-600">{((it.price || 0) * it.shortfall).toLocaleString('vi-VN')} đ</td>
                                                     </tr>
                                                 )
                                             })}
                                         </tbody>
                                     </table>
                                 </div>

                                 {/* Reject Reason Input or Display */}
                                 {(evalState?.action === 'REJECT' || group.status === 'REJECTED') && (
                                     <div className={`mt-4 p-4 rounded-lg border font-medium ${isPending ? 'bg-red-50 border-red-200' : 'bg-red-50 text-red-800 border-red-300'}`}>
                                         {isPending ? (
                                             <div className="flex flex-col gap-2">
                                                 <label className="text-red-800 font-bold text-sm flex items-center gap-1">
                                                     ⚠️ Vui lòng ghi lại phản hồi từ chối cho nhóm này để bộ phận Thương mại có thể cập nhật lại:
                                                 </label>
                                                 <textarea 
                                                     autoFocus
                                                     className="w-full border-red-300 ring-red-100 focus:border-red-500 focus:ring-red-200 rounded p-3 text-sm resize-none shadow-sm"
                                                     placeholder="Ví dụ: Giá chưa tốt, đề nghị tìm thêm NCC khác..."
                                                     rows={2}
                                                     value={evalState?.reason || ''}
                                                     onChange={e => handleReasonChange(group.id, e.target.value)}
                                                 />
                                                 <div className="flex justify-end gap-2 mt-2">
                                                    <button 
                                                       onClick={() => setEvaluations(p => { const next = {...p}; delete next[group.id]; return next; })}
                                                       disabled={isSubmitting}
                                                       className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:underline"
                                                    >
                                                       Hủy
                                                    </button>
                                                    <button 
                                                       onClick={() => submitEvaluations(group.id, 'REJECT', evalState?.reason)}
                                                       disabled={isSubmitting || !(evalState?.reason?.trim())}
                                                       className={`px-5 py-2 font-bold rounded-lg shadow-sm text-sm transition-all ${
                                                          evalState?.reason?.trim() 
                                                          ? 'bg-red-600 hover:bg-red-700 text-white shadow-md' 
                                                          : 'bg-red-200 text-white cursor-not-allowed'
                                                       }`}
                                                    >
                                                       {isSubmitting ? '⏳...' : 'Xác nhận & Gửi phản hồi'}
                                                    </button>
                                                 </div>
                                             </div>
                                         ) : (
                                             <div className="flex items-start gap-2">
                                                 <span>❌</span>
                                                 <div>
                                                     <span className="block text-xs uppercase tracking-wider font-bold mb-1 opacity-70">Lý do từ chối</span>
                                                     {group.rejectedReason || 'Không có phản hồi chi tiết'}
                                                 </div>
                                             </div>
                                         )}
                                     </div>
                                 )}
                             </div>
                         </div>
                     )
                 })}
             </div>
         </div>
      </div>
  )
}
