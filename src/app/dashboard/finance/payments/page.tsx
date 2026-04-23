'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import CreateDrawdownForm from './components/CreateDrawdownForm'
import * as XLSX from 'xlsx'

interface Payment {
  id: string; amount: string; paymentDate: string; method: string; reference: string | null; notes: string | null;
  invoice: { invoiceCode: string; type: string; clientName: string; totalAmount: string }
}

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<'ACTUAL' | 'DRAWDOWN'>('ACTUAL')
  
  // Tab 1 States
  const [payments, setPayments] = useState<Payment[]>([])
  const [totalPaid, setTotalPaid] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [invoices, setInvoices] = useState<{ id: string; invoiceCode: string; clientName: string; totalAmount: string; paidAmount: string }[]>([])

  // Tab 2 States
  const [drawdowns, setDrawdowns] = useState<any[]>([])
  const [loadingDrawdowns, setLoadingDrawdowns] = useState(true)
  const [showDrawdownForm, setShowDrawdownForm] = useState(false)
  const [userRole, setUserRole] = useState('')

  useEffect(() => { 
    if (activeTab === 'ACTUAL') load() 
    else loadDrawdowns()
  }, [page, activeTab])

  useEffect(() => {
    // Get user role for SoD check
    const usr = sessionStorage.getItem('ibs_user')
    if (usr) setUserRole(JSON.parse(usr).roleCode)
  }, [])

  const load = () => {
    setLoading(true)
    apiFetch(`/api/finance/payments?page=${page}`).then(res => {
      if (res.ok) {
        setPayments(res.payments); setTotalPages(res.totalPages)
        setTotalPaid(res.summary?.totalPaid || 0)
      }
      setLoading(false)
    })
  }

  const loadDrawdowns = () => {
    setLoadingDrawdowns(true)
    apiFetch(`/api/finance/payments/drawdown`).then(res => {
      if (res.ok) setDrawdowns(res.drawdowns)
      setLoadingDrawdowns(false)
    })
  }

  const handleApproveDrawdown = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn duyệt Hồ sơ giải ngân này?')) return
    const res = await apiFetch(`/api/finance/payments/drawdown/${id}/approve`, { method: 'POST' })
    if (res.ok) { alert('Đã duyệt thành công!'); loadDrawdowns() }
    else alert(res.error || 'Lỗi phân quyền')
  }

  const handleExecuteDrawdown = async (id: string) => {
    if (!confirm('Xác nhận CHỐT GIẢI NGÂN? Hành động này sẽ cập nhật toàn bộ trạng thái Hợp đồng (PO) về Đã Thanh Toán.')) return
    const res = await apiFetch(`/api/finance/payments/drawdown/${id}/execute`, { method: 'POST' })
    if (res.ok) { alert('Chốt giải ngân thành công! Đã lật trạng thái PO.'); loadDrawdowns() }
    else alert(res.error || 'Lỗi phân quyền')
  }

  const handleExportVPBank = async (id: string, code: string) => {
    const res = await apiFetch(`/api/finance/payments/drawdown/${id}/export`)
    if (res.ok) {
      // Generate Excel file
      const ws = XLSX.utils.json_to_sheet(res.data)
      // Thêm header format
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "VPBank Export")
      XLSX.writeFile(wb, res.filename)
      loadDrawdowns() // refresh status
    } else alert(res.error || 'Lỗi export')
  }

  const handleMisaSync = async (id: string, drawdownNo: string) => {
    if (!confirm(`Xác nhận đồng bộ hồ sơ ${drawdownNo} lên phần mềm Misa AMIS?`)) return
    
    // Call real synchronization API
    const res = await apiFetch(`/api/finance/payments/drawdown/${id}/sync-misa`, { method: 'POST' })
    if (res.ok) {
      alert(`Đồng bộ sơ ${drawdownNo} sang Misa AMIS thành công! Bút toán tự động đã được ghi sổ hệ thống.`)
      loadDrawdowns() // refresh to update 'misaSynced' status
    } else {
      alert(res.error || 'Lỗi đồng bộ')
    }
  }

  // Submit actual payment (old flow)
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const data = {
      invoiceId: formData.get('invoiceId'),
      amount: Number(formData.get('amount')),
      paymentDate: formData.get('paymentDate'),
      method: formData.get('method'),
      reference: formData.get('reference') || "",
      notes: formData.get('notes') || "",
    }
    const res = await apiFetch('/api/finance/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (res.ok) { setShowForm(false); load() }
    else alert(res.error || 'Lỗi')
  }

  const openForm = async () => {
    const res = await apiFetch('/api/finance/invoices?page=1&limit=100')
    if (res.ok) setInvoices(res.invoices.filter((i: { status: string }) => i.status !== 'PAID'))
    setShowForm(true)
  }

  const fmt = (v: number | string) => Number(v).toLocaleString('vi-VN')
  const methodLabel: Record<string, string> = { BANK_TRANSFER: 'Chuyển khoản', CASH: 'Tiền mặt', CHECK: 'Séc' }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>💳 Quản lý thanh toán & Giải ngân</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Phê duyệt hồ sơ thanh toán nhà cung cấp và kết nối ngân hàng</p>
        </div>
      </div>

      <div className="border-b" style={{ borderColor: 'var(--border-light)' }}>
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('ACTUAL')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'ACTUAL' ? 'border-[#8b5cf6]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
             style={{ color: activeTab === 'ACTUAL' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            Thanh toán nhỏ lẻ (Thường)
          </button>
          <button
            onClick={() => setActiveTab('DRAWDOWN')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'DRAWDOWN' ? 'border-[#8b5cf6]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
             style={{ color: activeTab === 'DRAWDOWN' ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            Hồ sơ Giải ngân (VPBank / Dự án)
          </button>
        </nav>
      </div>

      {activeTab === 'ACTUAL' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex justify-between">
            <p className="text-sm font-semibold">Tổng đã thanh toán lẻ: {fmt(totalPaid)} đ</p>
            <button onClick={openForm} className="btn-primary text-sm px-4 py-2 rounded-lg">+ Ghi nhận thanh toán</button>
          </div>
          
          {showForm && (
            <form onSubmit={handleSubmit} className="card p-5 space-y-3 bg-gray-50">
               <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                 <select name="invoiceId" required className="input-field text-sm">
                   <option value="">— Chọn hóa đơn —</option>
                   {invoices.map(inv => (
                     <option key={inv.id} value={inv.id}>
                       {inv.invoiceCode} • {inv.clientName} (Còn: {fmt(Number(inv.totalAmount) - Number(inv.paidAmount))})
                     </option>
                   ))}
                 </select>
                 <input name="amount" type="number" placeholder="Số tiền" required className="input-field text-sm" />
                 <input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input-field text-sm" />
                 <select name="method" className="input-field text-sm">
                   <option value="BANK_TRANSFER">Chuyển khoản</option>
                   <option value="CASH">Tiền mặt</option>
                   <option value="CHECK">Séc</option>
                 </select>
                 <input name="reference" placeholder="Mã GD ngân hàng" className="input-field text-sm" />
                 <input name="notes" placeholder="Ghi chú" className="input-field text-sm" />
               </div>
               <div className="flex gap-2 mt-3">
                 <button type="submit" className="btn-primary text-sm px-4 py-2 rounded-lg">Lưu</button>
                 <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm px-4 py-2 rounded-lg">Hủy</button>
               </div>
            </form>
          )}

          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Hóa đơn</th><th>Khách hàng</th><th className="text-right">Số tiền</th>
                  <th>Ngày TT</th><th>Phương thức</th><th>Mã GD</th><th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="text-center py-4">Đang tải...</td></tr> : 
                  payments.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có thanh toán</td></tr>
                ) : payments.map(p => (
                  <tr key={p.id}>
                    <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{p.invoice.invoiceCode}</span></td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.invoice.clientName}</td>
                    <td className="text-right font-mono text-xs font-bold" style={{ color: '#16a34a' }}>+{fmt(p.amount)}</td>
                    <td className="text-xs">{new Date(p.paymentDate).toLocaleDateString('vi-VN')}</td>
                    <td><span className="badge">{methodLabel[p.method] || p.method}</span></td>
                    <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{p.reference || '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-xs px-3 py-1 rounded">← Trước</button>
              <span className="text-xs py-1" style={{ color: 'var(--text-muted)' }}>Trang {page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn-secondary text-xs px-3 py-1 rounded">Sau →</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'DRAWDOWN' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold">Danh sách Khế ước & Hồ sơ trình duyệt</h2>
            {!showDrawdownForm && (
              <button onClick={() => setShowDrawdownForm(true)} className="btn-accent px-4 py-2 text-sm">+ Lập Hồ sơ Cụm</button>
            )}
          </div>

          {showDrawdownForm && (
            <CreateDrawdownForm 
              onSuccess={() => { setShowDrawdownForm(false); loadDrawdowns() }} 
              onCancel={() => setShowDrawdownForm(false)} 
            />
          )}

          <div className="grid gap-4">
            {loadingDrawdowns ? <p className="text-center py-4 text-sm">Đang tải hồ sơ...</p> : drawdowns.map(dd => (
              <div key={dd.id} className="card p-5 border-l-4" style={{ 
                borderLeftColor: dd.status === 'APPROVED' ? '#16a34a' : dd.status === 'PENDING_APPROVAL' ? '#eab308' : '#6b7280'
              }}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-lg font-mono text-gray-800">{dd.drawdownNo}</h3>
                    <p className="text-xs text-gray-500 mt-1">Lập ngày: {new Date(dd.requestDate).toLocaleString('vi-VN')} | Người lập: {dd.createdBy}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold font-mono text-[#8b5cf6]">{fmt(Number(dd.amountFundedVnd))} {dd.currency || 'VND'}</p>
                    <span className="badge mt-1 inline-block" style={{
                      backgroundColor: dd.status === 'APPROVED' ? '#dcfce7' : dd.status === 'EXECUTED' ? '#dbeafe' : '#fef9c3',
                      color: dd.status === 'APPROVED' ? '#166534' : dd.status === 'EXECUTED' ? '#1e40af' : '#854d0e',
                    }}>{dd.status === 'PENDING_APPROVAL' ? '⚠️ Đang chờ KTT duyệt' : dd.status === 'EXECUTED' ? '✅ Đã Giải Ngân' : '✅ Đã Phê duyệt'}</span>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 mt-4 text-xs">
                  <p className="font-semibold mb-2">Chi tiết đối tượng thụ hưởng ({dd.beneficiaryLines.length} món):</p>
                  <table className="w-full text-left">
                    <thead><tr className="text-gray-400 border-b border-gray-200"><th>Đơn vị</th><th>Số TK</th><th>Ngân hàng</th><th className="text-right">Số tiền</th></tr></thead>
                    <tbody className="text-gray-600 font-mono">
                      {dd.beneficiaryLines.map((l: any) => (
                        <tr key={l.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-100">
                          <td className="py-1 font-sans">{l.vendor?.name || 'N/A'}</td>
                          <td className="py-1">{l.bankAccountNo}</td>
                          <td className="py-1">{l.bankName}</td>
                          <td className="text-right py-1 text-black">{fmt(Number(l.amountVnd))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex gap-3 pt-3 border-t border-gray-100">
                  {dd.status === 'PENDING_APPROVAL' && (
                    <button 
                      onClick={() => handleApproveDrawdown(dd.id)} 
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold shadow transition-colors"
                    >
                      KTT Ký duyệt Hồ sơ
                    </button>
                  )}
                  {dd.status === 'APPROVED' && (
                    <>
                      {dd.misaSynced ? (
                        <button 
                          disabled
                          className="px-4 py-2 bg-gray-300 text-gray-500 rounded text-sm font-bold flex items-center gap-2 shadow cursor-not-allowed"
                        >
                          ✔ Khóa Misa
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleMisaSync(dd.id, dd.drawdownNo)} 
                          className="px-4 py-2 bg-[#1d4ed8] hover:bg-[#1e40af] text-white rounded text-sm font-bold flex items-center gap-2 shadow transition-colors"
                        >
                          ☁️ Đồng bộ Misa SME
                        </button>
                      )}

                      <button 
                        onClick={() => handleExecuteDrawdown(dd.id)} 
                        className="px-4 py-2 bg-[#8b5cf6] hover:bg-[#7e22ce] text-white rounded text-sm font-bold flex items-center gap-2 shadow"
                      >
                        ✅ Chốt Giải Ngân
                      </button>

                      <button 
                        onClick={() => handleExportVPBank(dd.id, dd.drawdownNo)} 
                        className="px-4 py-2 bg-[#00a859] hover:bg-[#008f4c] text-white rounded text-sm font-bold flex items-center gap-2 shadow"
                      >
                        📊 Export form VPBank 
                        {dd.exportStatus && <span className="text-xs font-normal opacity-80">(Đã xuất)</span>}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!loadingDrawdowns && drawdowns.length === 0 && (
              <p className="text-center py-8 text-gray-400">Chưa có Hồ sơ giải ngân nào.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
