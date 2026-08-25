'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/utils'

// QT19 bước 10-11 — Đề nghị thanh toán (FIN-F01) + duyệt 3 chữ ký (QLDA → TP.TM/KTT → GĐ dự án).
interface Docs { contract: boolean; invoice: boolean; vendorReq: boolean; handover: boolean }
interface PayReq {
  id: string; code: string; amount: number; currency: string; description: string | null; status: string
  docs: Docs; approval: { qldaAt: string | null; tmkttAt: string | null; gddaAt: string | null; rejectReason: string | null; paidAt: string | null }
  vendorName: string; projectCode: string | null; contractCode: string | null; createdAt: string
}
interface VOpt { id: string; name: string }
interface POpt { id: string; projectCode: string }

const ST: Record<string, { l: string; bg: string; tx: string }> = {
  DRAFT: { l: 'Nháp', bg: '#f1f5f9', tx: '#64748b' }, PENDING: { l: 'Chờ duyệt', bg: '#fffbeb', tx: '#b45309' },
  APPROVED: { l: 'Đã duyệt', bg: '#eef2ff', tx: '#4338ca' }, REJECTED: { l: 'Từ chối', bg: '#fef2f2', tx: '#dc2626' },
  PAID: { l: 'Đã trả', bg: '#ecfdf5', tx: '#166534' },
}
const fmt = (n: number, c: string) => `${formatCurrency(n)}${c !== 'VND' ? ' ' + c : ''}`

export default function DeNghiThanhToanPage() {
  const [rows, setRows] = useState<PayReq[]>([])
  const [kpi, setKpi] = useState<{ total: number; pending: number; approved: number; paid: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [vendors, setVendors] = useState<VOpt[]>([])
  const [projects, setProjects] = useState<POpt[]>([])
  const roleCode = useAuthStore(s => s.user?.roleCode)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await apiFetch('/api/procurement/payment-requests')
    setLoading(false)
    if (r.ok) { setRows(r.paymentRequests || []); setKpi(r.kpi || null) } else notify(r.error || 'Lỗi tải', 'error')
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiFetch('/api/vendors?limit=500').then(r => { if (r.ok) setVendors((r.vendors || []).map((v: VOpt) => ({ id: v.id, name: v.name }))) })
    apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) })
  }, [])

  const act = async (id: string, action: string) => {
    let reason: string | undefined
    if (action === 'reject') { const s = window.prompt('Lý do từ chối:'); if (!s) return; reason = s }
    if (action === 'pay' && !await confirmDialog('Ghi nhận đã thanh toán cho đề nghị này?')) return
    const r = await apiFetch(`/api/procurement/payment-requests/${id}`, { method: 'POST', body: JSON.stringify({ action, reason }) })
    if (r.ok) { notify(r.message || 'Đã cập nhật', 'success'); load() } else notify(r.error || 'Lỗi', 'error')
  }

  const canSign = (slot: 'qlda' | 'tmktt' | 'gdda') =>
    (slot === 'qlda' && ['R02', 'R02a'].includes(roleCode || '')) ||
    (slot === 'tmktt' && ['R07', 'R07a', 'R08'].includes(roleCode || '')) ||
    (slot === 'gdda' && roleCode === 'R01')
  const canPay = ['R08', 'R08a', 'R01', 'R10'].includes(roleCode || '')
  const canCreate = ['R01', 'R02', 'R02a', 'R07', 'R07a', 'R10'].includes(roleCode || '')

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Đề nghị thanh toán" subtitle="QT19 bước 10-11 — lập phiếu đủ 4 chứng từ → duyệt 3 chữ ký (QLDA → TP.TM/KTT → GĐ dự án) → Tài chính chi trả" />

      <div className="flex items-center gap-3 flex-wrap">
        {canCreate && <Button variant="primary" onClick={() => setShowForm(true)}>+ Lập đề nghị thanh toán</Button>}
        {kpi && ([['Tổng', kpi.total, 'var(--text-primary)'], ['Chờ duyệt', kpi.pending, '#b45309'], ['Đã duyệt', kpi.approved, '#4338ca'], ['Đã trả', kpi.paid, '#166534']] as const).map(([l, v, c]) => (
          <div key={l} className="flex items-center gap-1.5"><span className="text-lg font-bold" style={{ color: c }}>{v}</span><span className="text-xs text-slate-500">{l}</span></div>
        ))}
      </div>

      {loading ? <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>
        : rows.length === 0 ? <div className="text-center py-16 text-slate-400 text-sm">Chưa có đề nghị thanh toán nào.</div>
          : (
            <div className="card p-0 overflow-hidden"><div style={{ overflowX: 'auto' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                  {['Mã', 'NCC', 'Dự án', 'Số tiền', '4 chứng từ', 'Trạng thái', '3 chữ ký', ''].map(h => <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const s = ST[r.status] || ST.DRAFT
                    const docsOk = r.docs.contract && r.docs.invoice && r.docs.vendorReq && r.docs.handover
                    const sign = (at: string | null) => at ? '✅' : '⏳'
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-2 py-1.5 font-mono font-bold" style={{ color: 'var(--accent)' }}>{r.code}</td>
                        <td className="px-2 py-1.5">{r.vendorName}{r.contractCode && <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.contractCode}</span>}</td>
                        <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{r.projectCode || '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(r.amount, r.currency)}</td>
                        <td className="px-2 py-1.5" title="HĐ/báo giá · Hoá đơn · YCTT NCC · Biên bản giao">
                          <span style={{ color: docsOk ? '#166534' : '#b45309', fontWeight: 700 }}>{[r.docs.contract, r.docs.invoice, r.docs.vendorReq, r.docs.handover].filter(Boolean).length}/4</span>
                        </td>
                        <td className="px-2 py-1.5"><span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: s.bg, color: s.tx }}>{s.l}</span>{r.status === 'REJECTED' && r.approval.rejectReason && <span className="block text-[10px]" style={{ color: '#dc2626' }}>{r.approval.rejectReason}</span>}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-[11px]" title="QLDA · TP.TM/KTT · GĐ dự án">{sign(r.approval.qldaAt)}{sign(r.approval.tmkttAt)}{sign(r.approval.gddaAt)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <div className="flex gap-1.5 flex-wrap">
                            {r.status === 'DRAFT' && canCreate && <button onClick={() => act(r.id, 'submit')} className="text-[11px] font-semibold" style={{ color: '#4f46e5' }}>Trình duyệt</button>}
                            {r.status === 'PENDING' && (['qlda', 'tmktt', 'gdda'] as const).some(canSign) && <>
                              <button onClick={() => act(r.id, 'approve')} className="text-[11px] font-semibold" style={{ color: '#166534' }}>✓ Ký</button>
                              <button onClick={() => act(r.id, 'reject')} className="text-[11px] font-semibold" style={{ color: '#dc2626' }}>Từ chối</button>
                            </>}
                            {r.status === 'APPROVED' && canPay && <button onClick={() => act(r.id, 'pay')} className="text-[11px] font-semibold" style={{ color: '#166534' }}>💰 Ghi đã trả</button>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div></div>
          )}

      {showForm && <CreateForm vendors={vendors} projects={projects} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load() }} />}
    </div>
  )
}

function CreateForm({ vendors, projects, onClose, onCreated }: { vendors: VOpt[]; projects: POpt[]; onClose: () => void; onCreated: () => void }) {
  const [vendorId, setVendorId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [docs, setDocs] = useState<Docs>({ contract: false, invoice: false, vendorReq: false, handover: false })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!vendorId || !(Number(amount) > 0)) { notify('Chọn NCC + nhập số tiền > 0', 'error'); return }
    setBusy(true)
    const r = await apiFetch('/api/procurement/payment-requests', { method: 'POST', body: JSON.stringify({ vendorId, projectId: projectId || undefined, amount: Number(amount), description, docs }) })
    setBusy(false)
    if (r.ok) { notify(r.message || 'Đã tạo', 'success'); onCreated() } else notify(r.error || 'Lỗi', 'error')
  }
  const DOC_LABEL: Array<[keyof Docs, string]> = [['contract', 'Đơn hàng/HĐ/báo giá'], ['invoice', 'Hoá đơn'], ['vendorReq', 'YCTT của NCC'], ['handover', 'Biên bản/phiếu giao có ký']]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 520, width: '100%' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold">Lập đề nghị thanh toán</h3>
        <select value={vendorId} onChange={e => setVendorId(e.target.value)} className="input text-sm w-full"><option value="">— Nhà cung cấp * —</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm w-full"><option value="">— Dự án (tùy chọn) —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}</select>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Số tiền *" className="input text-sm w-full" />
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Diễn giải" className="input text-sm w-full" />
        <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Đủ 4 chứng từ (đánh dấu đã có):</div>
        <div className="grid grid-cols-2 gap-1.5">
          {DOC_LABEL.map(([k, l]) => (
            <label key={k} className="text-xs flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={docs[k]} onChange={e => setDocs({ ...docs, [k]: e.target.checked })} />{l}</label>
          ))}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Huỷ</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo'}</Button></div>
      </div>
    </div>
  )
}
