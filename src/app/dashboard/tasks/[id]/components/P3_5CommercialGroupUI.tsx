'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'

interface P3_5Props {
  task: any
  previousStepData: any
  isActive: boolean
  currentUser?: any
  rejectionInfo?: { reason: string; rejectedBy: string; rejectedAt: string; fromStep?: string } | null
}

export default function P3_5CommercialGroupUI({ task, previousStepData, isActive, currentUser, rejectionInfo }: P3_5Props) {
  const router = useRouter()
  const prItems = previousStepData?.prItems || []
  const fromStock = previousStepData?.fromStock || []
  const toPurchase = previousStepData?.toPurchase || []
  
  const rd = task.resultData || {}
  
  const [localGroups, setLocalGroups] = useState<any[]>(rd.submittedGroups || [])
  const rdGroupsRaw = JSON.stringify(rd.submittedGroups || [])
  
  React.useEffect(() => {
    setLocalGroups(JSON.parse(rdGroupsRaw) || []);
  }, [rdGroupsRaw])

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<any>(null)
  
  // Current editing state in Modal
  const [groupName, setGroupName] = useState('')
  const [selectedItems, setSelectedItems] = useState<any[]>([])
  
  const [submitting, setSubmitting] = useState(false)
  const [vendors, setVendors] = useState<any[]>([])

  React.useEffect(() => {
    apiFetch('/api/vendors').then(res => {
      if (res.vendors) setVendors(res.vendors)
    }).catch(console.error)
  }, [])

  const getItemKey = (item: any) => `${item.name}|${item.code}|${item.spec}|${item.shortfall}`

  const lockedItemsMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const g of localGroups) {
      if (g.status === 'REJECTED' || g.status === 'REJECTED_DRAFT') continue
      if (editingGroup && g.id === editingGroup.id) continue
      for (const item of g.items) {
        map.set(getItemKey(item), true)
      }
    }
    return map
  }, [localGroups, editingGroup])

  const availableItems = useMemo(() => {
     return toPurchase.filter((item: any) => !lockedItemsMap.has(getItemKey(item)))
  }, [toPurchase, lockedItemsMap])

  // Calculate completion
  const totalItemsCount = toPurchase.length
  // Count items in groups that are NOT rejected
  const submittedItemsCount = localGroups
    .filter((g: any) => g.status !== 'REJECTED')
    .reduce((count: number, g: any) => count + g.items.length, 0)
  const is100Percent = totalItemsCount > 0 && submittedItemsCount >= totalItemsCount

  const handleOpenModal = (groupToEdit?: any) => {
    if (groupToEdit) {
      setEditingGroup(groupToEdit)
      setGroupName(groupToEdit.name)
      setSelectedItems([...groupToEdit.items])
    } else {
      setEditingGroup(null)
      setGroupName(`Nhóm Báo Giá ${localGroups.length + 1}`)
      setSelectedItems([])
    }
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingGroup(null)
  }

  const toggleItemSelection = (item: any) => {
    const exists = selectedItems.find(x => getItemKey(x) === getItemKey(item))
    if (exists) {
      setSelectedItems(selectedItems.filter(x => getItemKey(x) !== getItemKey(item)))
    } else {
      setSelectedItems([...selectedItems, {
        ...item,
        quotes: [
          { ncc: '', price: 0 },
          { ncc: '', price: 0 },
          { ncc: '', price: 0 }
        ],
        selectedQuoteIndex: 0
      }])
    }
  }

  const updateItemDetails = (itemIndex: number, quoteIndex: number, field: string, value: any) => {
    const updated = [...selectedItems]
    const quotes = [...updated[itemIndex].quotes]
    quotes[quoteIndex] = { ...quotes[quoteIndex], [field]: value }
    updated[itemIndex] = { ...updated[itemIndex], quotes }
    setSelectedItems(updated)
  }

  const selectWinningQuote = (itemIndex: number, quoteIndex: number) => {
    const updated = [...selectedItems]
    updated[itemIndex] = { ...updated[itemIndex], selectedQuoteIndex: quoteIndex }
    setSelectedItems(updated)
  }

  const handleSaveGroup = async () => {
    if (!groupName.trim()) return alert("Vui lòng nhập tên nhóm")
    if (selectedItems.length === 0) return alert("Vui lòng chọn ít nhất 1 vật tư")
    
    // Check if supplier/price are filled for all 3 quotes of all items
    for (const item of selectedItems) {
      for (let i = 0; i < 3; i++) {
        if (!item.quotes[i].ncc || item.quotes[i].ncc.trim() === '') return alert(`Vui lòng nhập Nhà cung cấp #${i+1} cho vật tư: ${item.name}`)
        if (item.quotes[i].price <= 0) return alert(`Vui lòng nhập đơn giá #${i+1} cho vật tư: ${item.name}`)
      }
    }

    const payloadGroup = {
      id: editingGroup ? editingGroup.id : `GROUP_${Date.now()}`,
      name: groupName,
      items: selectedItems,
      totalValue: selectedItems.reduce((sum, item) => sum + ((item.quotes?.[item.selectedQuoteIndex || 0]?.price || 0) * item.shortfall), 0),
      status: 'DRAFT' // Local draft before sending to boss
    }

    // Save draft group to task.resultData
    let updatedGroups = [...localGroups]
    if (editingGroup) {
      const idx = updatedGroups.findIndex(g => g.id === editingGroup.id)
      if (idx !== -1) updatedGroups[idx] = { ...payloadGroup, status: editingGroup.status === 'REJECTED' ? 'REJECTED_DRAFT' : 'DRAFT' }
    } else {
      updatedGroups.push(payloadGroup)
    }

    setSubmitting(true)
    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          action: 'save',
          resultData: { ...rd, submittedGroups: updatedGroups }
        })
      })
      setIsModalOpen(false)
      setLocalGroups(updatedGroups)
      router.refresh()
    } catch (e: any) {
      alert("Lỗi: " + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitGroups = async (groups: any[]) => {
    if (!confirm(`Xác nhận trình duyệt ${groups.length} nhóm báo giá này cho BGĐ?`)) return
    setSubmitting(true)
    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          action: 'p35_submit_groups',
          resultData: { 
             groupsToSubmit: groups,
             totalItemsCount,
             submittedItemsCount: submittedItemsCount + groups.reduce((acc, g) => acc + g.items.length, 0)
          }
        })
      })
      alert("✅ Đã trình duyệt thành công!")
      
      const updatedLocal = [...localGroups]
      for (const g of groups) {
          const idx = updatedLocal.findIndex((x: any) => x.id === g.id)
          if (idx !== -1) updatedLocal[idx] = { ...updatedLocal[idx], status: 'SUBMITTED', rejectedReason: null }
      }
      setLocalGroups(updatedLocal)
      router.refresh()
    } catch (e: any) {
      alert("Lỗi: " + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // UI rendering
  return (
    <div className="space-y-6">
      {/* 1. View Stock vs Purchase */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>⚖️</span> Đối soát tồn kho (Tự động)
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Tổng quát: <strong className="text-emerald-600">{fromStock.length}</strong> vật tư đủ kho, <strong className="text-rose-600">{toPurchase.length}</strong> vật tư cần mua sắm.
          </p>
        </div>
        
        <div className="p-5 divide-y divide-slate-100">
          {fromStock.length > 0 && (
            <div className="pb-5">
              <h4 className="font-bold text-[13px] uppercase tracking-wider text-emerald-600 mb-3 flex items-center gap-2">
                📦 Xuất thẳng từ kho ({fromStock.length})
              </h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-sm text-left relative">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-3 bg-slate-50">Mã</th>
                        <th className="px-4 py-3 bg-slate-50">Tên / Quy cách</th>
                        <th className="px-4 py-3 text-right bg-slate-50">Yêu cầu</th>
                        <th className="px-4 py-3 text-right bg-slate-50">Tồn kho</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fromStock.map((item: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{item.code || '—'}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">
                            {item.name} {item.spec && <span className="text-slate-400 font-normal block text-xs mt-0.5">{item.spec}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{item.requestedQty} {item.unit}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-emerald-600">{item.inStock} {item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className={fromStock.length > 0 ? "pt-5" : ""}>
            <h4 className="font-bold text-[13px] uppercase tracking-wider text-rose-600 mb-3 flex items-center gap-2">
              🛒 Cần mua sắm ({toPurchase.length})
            </h4>
            <div className="border border-slate-200 rounded-lg overflow-hidden flex flex-col">
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-sm text-left relative">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-3 bg-slate-50">Mã</th>
                      <th className="px-4 py-3 bg-slate-50">Tên / Quy cách</th>
                      <th className="px-4 py-3 text-right bg-slate-50">Lượng cần mua</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {toPurchase.map((item: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{item.code || '—'}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {item.name} {item.spec && <span className="text-slate-400 font-normal block text-xs mt-0.5">{item.spec}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-rose-500 font-bold">{item.shortfall} {item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Group Management */}
      <div className="bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden">
        <div className="p-5 border-b border-blue-50 bg-blue-50/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h3 className="text-lg font-bold text-blue-800 flex items-center gap-2">
              <span>📑</span> Quản lý Nhóm Báo Giá
            </h3>
            <p className="text-sm text-slate-500 mt-1">Tiến độ gom nhóm: <strong className="text-blue-600">{submittedItemsCount}/{totalItemsCount}</strong> vật tư</p>
          </div>
          {isActive && (
            <div className="flex flex-wrap gap-2.5">
               <button className="text-sm px-4 py-2 bg-white text-blue-600 border border-blue-200 hover:border-blue-300 hover:bg-blue-50 font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5" onClick={() => handleOpenModal()}>
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                 Thêm Nhóm Báo Giá
               </button>
               {localGroups.some((g: any) => g.status === 'DRAFT' || g.status === 'REJECTED_DRAFT') && (
                 <button className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md shadow-blue-500/20 transition-colors flex items-center gap-1.5" onClick={() => handleSubmitGroups(localGroups.filter((g: any) => g.status === 'DRAFT' || g.status === 'REJECTED_DRAFT'))}>
                    🚀 Trình duyệt tất cả
                 </button>
               )}
            </div>
          )}
        </div>

        <div className="p-5 bg-slate-50/50">
          {localGroups.length === 0 ? (
            <div className="text-center p-10 bg-white rounded-xl border border-dashed border-slate-300 text-slate-400">
               <span className="text-4xl block mb-3 opacity-60">📋</span>
               Chưa có nhóm báo giá nào được tạo.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {localGroups.map((group: any) => (
                <div key={group.id} className={`p-4 rounded-xl border-l-[4px] shadow-sm bg-white hover:shadow-md transition-shadow relative overflow-hidden ${
                  group.status === 'APPROVED' ? 'border-l-emerald-500 border-y border-r border-emerald-100' : 
                  group.status === 'REJECTED' ? 'border-l-rose-500 border-y border-r border-rose-100' : 
                  group.status === 'SUBMITTED' ? 'border-l-blue-500 border-y border-r border-blue-100' : 
                  'border-l-slate-400 border-y border-r border-slate-200'
                }`}>
                  {group.status === 'APPROVED' && <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none"><div className="absolute transform translate-y-2 translate-x-4 rotate-45 bg-emerald-500 text-white text-[10px] font-bold py-1 px-8 text-center shadow-sm">ĐÃ DUYỆT</div></div>}
                  
                  <div className="flex justify-between items-start mb-3 pr-10">
                    <h4 className="font-bold text-slate-800 text-[15px]">{group.name}</h4>
                    {group.status !== 'APPROVED' && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        group.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' : 
                        group.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' : 
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {group.status === 'REJECTED' ? 'Bị từ chối' : 
                         group.status === 'SUBMITTED' ? 'Chờ BGĐ duyệt' : 'Bản nháp'}
                      </span>
                    )}
                  </div>
                  
                  <p className="text-[13px] text-slate-500 mb-3 flex items-center gap-2">
                    <span className="bg-slate-100 px-2 py-0.5 rounded font-medium">{group.items.length} vật tư</span>
                    <span className="text-slate-300">•</span>
                    Tổng trị giá: <strong className="text-slate-800">{group.totalValue.toLocaleString('vi-VN')} <span className="text-xs font-normal">đ</span></strong>
                  </p>
                  
                  {group.status === 'REJECTED' && group.rejectedReason && (
                     <div className="mb-4 p-3 bg-rose-50/80 border border-rose-100 rounded-lg text-rose-700 text-[13px]">
                        <strong className="block mb-1">Phản hồi từ BGĐ:</strong> {group.rejectedReason}
                     </div>
                  )}

                  <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
                    {(group.status === 'DRAFT' || group.status === 'REJECTED' || group.status === 'REJECTED_DRAFT') && isActive && (
                       <>
                          <button className="text-[13px] font-semibold px-4 py-1.5 border border-slate-200 hover:bg-slate-50 hover:text-blue-600 rounded-lg text-slate-600 transition-colors" onClick={() => handleOpenModal(group)}>
                            ✏️ Chỉnh sửa
                          </button>
                          <button className="text-[13px] font-bold px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors" onClick={() => handleSubmitGroups([group])}>
                            🚀 Trình duyệt
                          </button>
                       </>
                    )}
                    {group.status === 'APPROVED' && (
                       <div className="w-full text-center text-[13px] font-bold text-emerald-600 bg-emerald-50 rounded-lg py-2 border border-emerald-100">Đã chốt hợp đồng thành công</div>
                    )}
                    {group.status === 'SUBMITTED' && (
                       <div className="w-full text-center text-[13px] font-medium text-slate-500 bg-slate-50 rounded-lg py-2 border border-slate-200 italic">Đang chờ Giám đốc duyệt...</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isActive && is100Percent && (
         <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-lg text-center font-medium">
           🎉 Bạn đã gom nhóm và trình duyệt đủ 100% vật tư cần mua! Task sẽ tự hoàn thành khi các trạng thái được BGĐ phản hồi.
         </div>
      )}

      {/* Web-in-web Modal for Drag-Drop Grouping */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
              <h2 className="text-xl font-bold text-slate-800">
                {editingGroup ? '✏️ Chỉnh sửa Nhóm Báo Giá' : '✨ Tạo Nhóm Báo Giá Mới'}
              </h2>
              <button onClick={handleCloseModal} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-rose-500 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            {/* Name Input area */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
               <input 
                 value={groupName} onChange={e => setGroupName(e.target.value)}
                 className="w-full text-xl font-bold bg-transparent border-0 border-b-2 border-slate-200 focus:border-blue-500 focus:ring-0 px-0 py-2 outline-none transition-colors text-slate-800 placeholder-slate-300"
                 placeholder="Nhập tên nhóm báo giá (VD: Báo giá ván khuôn - Hòa Phát)..."
               />
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row bg-slate-50">
              {/* Left Side: Available Items */}
              <div className="w-full md:w-5/12 border-r border-slate-200 flex flex-col bg-white/50 backdrop-blur-sm">
                 <div className="px-5 py-3 font-semibold text-slate-700 border-b border-slate-200 flex justify-between items-center bg-slate-100/50">
                   <span>Danh sách chờ xử lý</span>
                   <span className="text-xs bg-slate-200 text-slate-600 px-2.5 py-1 rounded-full font-bold shadow-sm">{availableItems.length} vật tư</span>
                 </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const key = e.dataTransfer.getData('text/plain')
                        const item = selectedItems.find((x: any) => getItemKey(x) === key)
                        if (item) {
                          setSelectedItems(selectedItems.filter(x => getItemKey(x) !== key))
                        }
                      }}>
                    {availableItems.length === 0 ? (
                       <div className="flex flex-col items-center justify-center h-full text-slate-400 p-6 space-y-3 opacity-60">
                         <span className="text-4xl">📭</span>
                         <p className="italic text-sm">Không còn vật tư nào chờ xử lý.</p>
                       </div>
                    ) : availableItems.map((item: any, i: number) => {
                       const isSelected = selectedItems.find(x => getItemKey(x) === getItemKey(item))
                       const details = [item.code, item.spec].filter(Boolean).join(' • ')
                       
                       return (
                         <div key={i} 
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', getItemKey(item))
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onClick={() => toggleItemSelection(item)}
                              className={`p-3.5 rounded-xl border-2 cursor-grab active:cursor-grabbing transition-all duration-200 ${isSelected ? 'border-blue-500 bg-blue-50/50 shadow-md ring-2 ring-blue-500/20 opacity-60 scale-[0.98]' : 'border-slate-100 bg-white hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5'}`}>
                            <div className="flex justify-between items-start gap-3">
                               <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-[13px] text-slate-800 leading-snug">{item.name}</div>
                                  {details && <div className="text-[11px] text-slate-500 mt-1.5 font-medium truncate">{details}</div>}
                               </div>
                               <div className="text-right whitespace-nowrap shrink-0 bg-rose-50 px-2 py-1 rounded-md border border-rose-100">
                                  <span className="font-bold text-rose-600 text-[13px]">{item.shortfall} <span className="text-xs font-normal text-rose-500">{item.unit}</span></span>
                               </div>
                            </div>
                         </div>
                       )
                    })}
                 </div>
              </div>

              {/* Right Side: Selected Items with Inputs */}
              <div className="w-full md:w-7/12 flex flex-col bg-white"
                   onDragOver={(e) => {
                     e.preventDefault()
                     e.dataTransfer.dropEffect = 'move'
                   }}
                   onDrop={(e) => {
                     e.preventDefault()
                     const key = e.dataTransfer.getData('text/plain')
                     const item = availableItems.find((x: any) => getItemKey(x) === key)
                     if (item) {
                       const exists = selectedItems.find(x => getItemKey(x) === key)
                       if (!exists) {
                         setSelectedItems([...selectedItems, { ...item, ncc: '', price: 0 }])
                       }
                     }
                   }}>
                 <div className="px-5 py-3 font-semibold text-blue-700 bg-blue-50/80 border-b border-blue-100 flex justify-between items-center">
                   <span className="flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg> Vật tư trong giỏ</span>
                   <span className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded-full font-bold shadow-sm">{selectedItems.length} đã chọn</span>
                 </div>
                 <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50">
                    {selectedItems.length === 0 ? (
                       <div className="h-full flex items-center justify-center">
                         <div className="text-center p-10 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50 opacity-80 flex flex-col w-full max-w-sm">
                           <span className="text-5xl mb-4">🛒</span>
                           <h4 className="text-slate-600 font-bold mb-2">Giỏ hàng trống</h4>
                           <p className="text-slate-400 text-sm">Bấm chọn hoặc kéo thả các vật tư từ danh sách bên trái vào khu vực này để bắt đầu tạo nhóm báo giá.</p>
                         </div>
                       </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                          <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200">
                               <tr>
                                 <th className="px-4 py-3 text-center w-12">Chọn</th>
                                 <th className="px-4 py-3 w-28">Đối Tác</th>
                                 <th className="px-4 py-3">Tên Nhà Cung Cấp</th>
                                 <th className="px-4 py-3 text-right w-44">Đơn giá (VNĐ)</th>
                                 <th className="px-4 py-3 w-16"></th>
                               </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                               {selectedItems.map((item, i) => {
                                  const renderDetails = [item.code, item.spec].filter(Boolean).join(' • ')
                                  return (
                                    <React.Fragment key={i}>
                                      <tr className="bg-slate-100/80 group cursor-grab active:cursor-grabbing border-b border-slate-200"
                                          draggable
                                          onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', getItemKey(item))
                                            e.dataTransfer.effectAllowed = 'move'
                                          }}>
                                         <td colSpan={2} className="px-4 py-2.5">
                                            <div className="font-bold text-slate-800 text-[13px]">{i + 1}. {item.name}</div>
                                            {renderDetails && <div className="text-xs text-slate-500 font-normal mt-0.5">{renderDetails}</div>}
                                         </td>
                                         <td className="px-4 py-2.5 text-right flex justify-end items-center gap-2">
                                            <span className="text-xs uppercase font-semibold text-slate-400">Số lượng:</span>
                                            <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{item.shortfall} {item.unit}</span>
                                         </td>
                                         <td colSpan={2} className="px-4 py-2.5 text-right">
                                            <button onClick={() => toggleItemSelection(item)} className="text-rose-500 hover:text-white font-semibold px-3 py-1 border border-rose-200 hover:bg-rose-500 bg-white rounded shadow-sm text-xs transition-colors flex items-center justify-center gap-1 ml-auto">
                                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                              Loại bỏ
                                            </button>
                                         </td>
                                      </tr>
                                  {/* 3 rows for 3 quotes */}
                                  {[0,1,2].map(qIdx => {
                                     // Find if this is the cheapest
                                     const validPrices = item.quotes.map((q: any) => q.price).filter((p: number) => p > 0);
                                     const isCheapest = item.quotes[qIdx].price > 0 && item.quotes[qIdx].price === Math.min(...validPrices);
                                     const isSelected = item.selectedQuoteIndex === qIdx;
                                     
                                     return (
                                     <tr key={qIdx} className={`hover:bg-blue-50/30 transition-colors ${isSelected ? 'bg-blue-50/40 border-l-[3px] border-l-blue-500' : 'border-l-[3px] border-l-transparent bg-white'}`}>
                                        <td className="px-4 py-2.5 text-center">
                                           <input type="radio" 
                                                  name={`quote_${i}`} 
                                                  checked={isSelected}
                                                  onChange={() => selectWinningQuote(i, qIdx)} 
                                                  className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                                           />
                                        </td>
                                        <td className="px-4 py-2.5 text-[12px] font-semibold text-slate-500 whitespace-nowrap">
                                           <span className={`px-2 py-1 rounded-md ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>Báo giá {qIdx + 1}</span>
                                        </td>
                                        <td className="px-4 py-2.5 relative">
                                           <select 
                                              className={`w-full border-slate-300 rounded-md px-3 py-2 text-[13px] bg-white transition-all hover:border-blue-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none ${isSelected ? 'border-blue-300 shadow-sm' : ''}`} 
                                              value={item.quotes[qIdx].ncc || ''} 
                                              onChange={(e) => updateItemDetails(i, qIdx, 'ncc', e.target.value)} 
                                           >
                                             <option value="">-- Chọn Nhà cung cấp --</option>
                                             {vendors.map(v => (
                                               <option key={v.id} value={v.name}>{v.name}</option>
                                             ))}
                                           </select>
                                           {isCheapest && <span className="absolute -top-[5px] -right-[5px] bg-emerald-500 text-white text-[9px] px-1.5 py-0.5 rounded shadow-sm z-10 animate-pulse font-bold tracking-wide border border-emerald-400">RẺ NHẤT</span>}
                                        </td>
                                        <td className="px-4 py-2.5">
                                           <div className="relative">
                                             <input 
                                                className={`w-full rounded-md pl-3 pr-8 py-2 text-[13px] text-right outline-none transition-all focus:ring-2 focus:ring-blue-500/20 font-mono focus:border-blue-500 border hover:border-blue-400 ${isSelected ? 'border-blue-400 bg-blue-50/30 font-bold text-blue-700 shadow-inner' : 'border-slate-300 bg-white text-slate-700'}`} 
                                                type="number" min="0" step="1000"
                                                value={item.quotes[qIdx].price || ''} onChange={e => updateItemDetails(i, qIdx, 'price', Number(e.target.value))}
                                                placeholder="0"
                                             />
                                             <span className={`absolute right-3 py-2 text-xs font-semibold select-none pointer-events-none top-0 bottom-0 flex items-center ${isSelected ? 'text-blue-500' : 'text-slate-400'}`}>đ</span>
                                           </div>
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                           {isSelected && <span className="text-blue-500">✅</span>}
                                        </td>
                                     </tr>
                                     )
                                  })}
                                </React.Fragment>
                              )
                           })}
                          </tbody>
                        </table>
                      </div>
                    )}
                 </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-200 flex justify-between items-center bg-slate-50 mt-auto shrink-0 z-10">
              <div className="text-xl font-bold font-mono text-slate-800 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-3">
                 <span className="text-sm font-medium text-slate-500 uppercase font-sans tracking-wide">Tổng dự toán giỏ:</span> 
                 <span className="text-blue-700">{selectedItems.reduce((sum, item) => sum + ((item.quotes?.[item.selectedQuoteIndex || 0]?.price || 0) * (item.shortfall || 0)), 0).toLocaleString('vi-VN')} <span className="text-base text-blue-500/70 relative -top-0.5">₫</span></span>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCloseModal} className="px-6 py-2.5 font-bold bg-white text-slate-600 rounded-lg hover:bg-slate-100 border border-slate-300 transition-colors">
                  Hủy bỏ
                </button>
                <button onClick={handleSaveGroup} disabled={submitting} className="px-8 py-2.5 font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:bg-blue-400 transition-colors flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                  {submitting ? 'Đang tải...' : 'Lưu Giỏ Báo Giá'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
