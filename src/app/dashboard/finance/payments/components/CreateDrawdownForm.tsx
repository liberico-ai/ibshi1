'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface CreateDrawdownFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export default function CreateDrawdownForm({ onSuccess, onCancel }: CreateDrawdownFormProps) {
  const [contracts, setContracts] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  
  const [selectedContract, setSelectedContract] = useState('')
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // We should fetch loan contracts
    // For now we mock it or fetch from an API if we had one. Let's assume we fetch all active invoices.
    apiFetch('/api/finance/purchase-orders').then(res => {
      if (res.ok) {
        setInvoices(res.purchaseOrders || [])
      }
    })
    
    // We mock a loan contract since we don't have a UI to create them yet
    setContracts([
      { id: 'mock-contract-1', code: 'HDV-VPBANK-01', bank: 'VPBank', limit: 5000000000 }
    ])
    setSelectedContract('mock-contract-1')
  }, [])

  const fmt = (v: number) => v.toLocaleString('vi-VN')

  const toggleInvoice = (id: string) => {
    const newSelected = new Set(selectedInvoices)
    if (newSelected.has(id)) newSelected.delete(id)
    else newSelected.add(id)
    setSelectedInvoices(newSelected)
  }

  const selectedTotal = invoices
    .filter(i => selectedInvoices.has(i.id))
    .reduce((sum, i) => sum + (Number(i.totalValue) || 0), 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedContract || selectedInvoices.size === 0) {
      setError('Vui lòng chọn Hợp đồng và ít nhất 1 hóa đơn')
      return
    }

    setLoading(true)
    setError('')

    const payloadInvoices = invoices
      .filter(i => selectedInvoices.has(i.id))
      .map(i => ({
        id: i.id, // This is the PO id
        poCode: i.poCode, // Send poCode to backend
        totalAmount: Number(i.totalValue) || 0,
        vendorId: i.vendorId, // Important to link to existing Vendor
        vendorName: i.vendor?.name || 'N/A',
        bankAccount: '123456789', // Mocks
        bankName: 'VPBank'
      }))

    const res = await apiFetch('/api/finance/payments/drawdown', {
      method: 'POST',
      body: JSON.stringify({
        contractId: selectedContract,
        invoices: payloadInvoices
      })
    })

    setLoading(false)
    if (res.ok) {
      onSuccess()
    } else {
      setError(res.error || 'Có lỗi xảy ra')
    }
  }

  return (
    <div className="card p-5 animate-fade-in mb-6 border border-[#8b5cf6]">
      <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Lập Hồ sơ Giải ngân mới</h2>
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Chọn Hợp đồng khoản vay / Hạn mức</label>
          <select 
            className="input-field w-full max-w-md" 
            value={selectedContract}
            onChange={(e) => setSelectedContract(e.target.value)}
          >
            <option value="">-- Chọn Khế ước --</option>
            {contracts.map(c => (
              <option key={c.id} value={c.id}>{c.code} - {c.bank} (Hạn mức: {fmt(c.limit)}đ)</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Chọn Đơn đặt hàng (PO) cần tạm ứng giải ngân</label>
          <div className="border rounded-lg max-h-60 overflow-y-auto" style={{ borderColor: 'var(--border-light)' }}>
            <table className="data-table text-xs m-0">
              <thead className="sticky top-0 bg-[var(--bg-primary)]">
                <tr>
                  <th className="w-10 text-center">Chọn</th>
                  <th>Mã Hợp đồng/PO</th>
                  <th>Nhà cung cấp / Đối tác</th>
                  <th className="text-right">Giá trị (VNĐ)</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const remaining = Number(inv.totalValue) || 0
                  return (
                    <tr key={inv.id} className={selectedInvoices.has(inv.id) ? 'bg-blue-50' : ''} onClick={() => toggleInvoice(inv.id)}>
                      <td className="text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedInvoices.has(inv.id)} 
                          onChange={() => toggleInvoice(inv.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="font-mono font-bold text-[#8b5cf6]">{inv.poCode}</td>
                      <td>{inv.vendor?.name || 'N/A'}</td>
                      <td className="text-right font-mono font-medium">{fmt(remaining)}</td>
                    </tr>
                  )
                })}
                {invoices.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-4 text-gray-500">Không có Đơn hàng nào đang chờ tạm ứng.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg mb-4">
          <span className="text-sm font-semibold text-gray-600">Tổng tiền đề nghị giải ngân:</span>
          <span className="text-xl font-bold font-mono text-green-600">{fmt(selectedTotal)} VNĐ</span>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="btn-primary px-6">
            {loading ? 'Đang xử lý...' : 'Trình duyệt Lưu hồ sơ'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary px-6">Hủy</button>
        </div>
      </form>
    </div>
  )
}
