'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatCurrency } from '@/lib/utils'

// QT19 bước 10-11 — Đề nghị thanh toán (FIN-F01) + duyệt 3 chữ ký (QLDA → TP.TM/KTT → GĐ dự án).
interface Docs { contract: boolean; invoice: boolean; vendorReq: boolean; handover: boolean }
interface PayReq {
  id: string; code: string; amount: number; currency: string; description: string | null; status: string
  docs: Docs; approval: { qldaAt: string | null; tmkttAt: string | null; gddaAt: string | null; rejectReason: string | null; paidAt: string | null }
  vendorName: string; projectCode: string | null; contractCode: string | null; createdAt: string
}
interface VOpt { id: string; name: string }
interface POpt { id: string; projectCode: string }
interface COpt { id: string; contractCode: string; vendorName: string; value: number; currency: string; projectCode: string | null }
interface DocFile { id: string; fileName: string; fileUrl: string }

const ST: Record<string, { l: string; bg: string; tx: string }> = {
  DRAFT: { l: 'Nháp', bg: '#f1f5f9', tx: '#64748b' }, PENDING: { l: 'Chờ duyệt', bg: '#fffbeb', tx: '#b45309' },
  APPROVED: { l: 'Đã duyệt', bg: '#eef2ff', tx: '#4338ca' }, REJECTED: { l: 'Từ chối', bg: '#fef2f2', tx: '#dc2626' },
  PAID: { l: 'Đã trả', bg: '#ecfdf5', tx: '#166534' },
}
const DOC_TYPES: Array<{ k: keyof Docs; label: string }> = [
  { k: 'contract', label: 'HĐ / Đơn hàng / Báo giá' },
  { k: 'invoice', label: 'Hoá đơn GTGT' },
  { k: 'vendorReq', label: 'YCTT của NCC' },
  { k: 'handover', label: 'Biên bản / phiếu giao có ký' },
]
const fmt = (n: number, c: string) => `${formatCurrency(n)}${c !== 'VND' ? ' ' + c : ''}`

export default function DeNghiThanhToanPage() {
  const [rows, setRows] = useState<PayReq[]>([])
  const [kpi, setKpi] = useState<{ total: number; pending: number; approved: number; paid: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [vendors, setVendors] = useState<VOpt[]>([])
  const [projects, setProjects] = useState<POpt[]>([])
  const [contracts, setContracts] = useState<COpt[]>([])
  const [openDocs, setOpenDocs] = useState<string | null>(null)
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
    apiFetch('/api/purchase-contracts?limit=200').then(r => { if (r.ok) setContracts((r.contracts || []).map((c: COpt) => ({ id: c.id, contractCode: c.contractCode, vendorName: c.vendorName, value: c.value, currency: c.currency, projectCode: c.projectCode }))) })
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
      <PageHeader title="Đề nghị thanh toán" subtitle="QT19 bước 10-11 — đính kèm đủ 4 chứng từ (HĐ đi cùng) → duyệt 3 chữ ký (QLDA → TP.TM/KTT → GĐ dự án) → Kế toán chi trả" />

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
                  {['Mã', 'NCC', 'Dự án', 'Số tiền', 'Chứng từ', 'Trạng thái', '3 chữ ký', ''].map(h => <th key={h} className="px-2 py-2 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const s = ST[r.status] || ST.DRAFT
                    const cnt = [r.docs.contract, r.docs.invoice, r.docs.vendorReq, r.docs.handover].filter(Boolean).length
                    const docsOk = cnt === 4
                    const sign = (at: string | null) => at ? '✅' : '⏳'
                    const isOpen = openDocs === r.id
                    return (
                      <Fragment key={r.id}>
                        <tr style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-2 py-1.5 font-mono font-bold" style={{ color: 'var(--accent)' }}>{r.code}</td>
                          <td className="px-2 py-1.5">{r.vendorName}{r.contractCode && <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.contractCode}</span>}</td>
                          <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{r.projectCode || '—'}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(r.amount, r.currency)}</td>
                          <td className="px-2 py-1.5">
                            <button onClick={() => setOpenDocs(isOpen ? null : r.id)} className="font-bold" style={{ color: docsOk ? '#166534' : '#b45309' }} title="Mở/đóng chứng từ đính kèm">📎 {cnt}/4 {isOpen ? '▲' : '▼'}</button>
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
                        {isOpen && <tr><td colSpan={8} style={{ padding: 0, borderTop: '1px solid var(--border)' }}><DocsPanel pr={r} canEdit={canCreate} onChange={load} /></td></tr>}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div></div>
          )}

      {showForm && <CreateForm vendors={vendors} projects={projects} contracts={contracts} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load() }} />}
    </div>
  )
}

// Panel đính kèm 4 loại chứng từ — mọi vai trò mở/tải file (để Kế toán soát HĐ/hoá đơn trước khi chi).
function DocsPanel({ pr, canEdit, onChange }: { pr: PayReq; canEdit: boolean; onChange: () => void }) {
  const [docs, setDocs] = useState<Record<string, DocFile[]>>({})
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/procurement/payment-requests/${pr.id}/docs`)
    if (r.ok) { setDocs(r.docs || {}); setLoaded(true) }
  }, [pr.id])
  useEffect(() => { load() }, [load])
  const editable = canEdit && pr.status !== 'APPROVED' && pr.status !== 'PAID'
  const upload = async (k: string, file: File) => {
    if (file.size > 25 * 1024 * 1024) { notify('File quá lớn (>25MB)', 'error'); return }
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData(); fd.append('file', file); fd.append('docType', k)
    const r = await fetch(`/api/procurement/payment-requests/${pr.id}/docs`, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(x => x.json()).catch(() => ({ ok: false }))
    if (r.ok) { notify('Đã đính kèm chứng từ', 'success'); load(); onChange() } else notify(r.error || 'Lỗi', 'error')
  }
  const del = async (fileId: string) => {
    const r = await apiFetch(`/api/procurement/payment-requests/${pr.id}/docs?fileId=${fileId}`, { method: 'DELETE' })
    if (r.ok) { notify('Đã gỡ', 'success'); load(); onChange() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3" style={{ background: 'var(--bg-secondary)' }}>
      {DOC_TYPES.map(({ k, label }) => {
        const list = docs[k] || []
        return (
          <div key={k} className="rounded-lg p-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold" style={{ color: list.length ? '#166534' : '#b45309' }}>{list.length ? '✅' : '⏳'} {label}</span>
              {editable && <label className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer font-semibold whitespace-nowrap" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>+ File<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(k, f); e.currentTarget.value = '' }} /></label>}
            </div>
            {!loaded ? <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>
              : list.length === 0 ? <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Chưa có file</div>
                : list.map(f => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-[10px] mt-1">
                    <a href={f.fileUrl} target="_blank" rel="noreferrer" className="font-semibold truncate" style={{ color: 'var(--accent)' }}>{f.fileName}</a>
                    {editable && <button onClick={() => del(f.id)} style={{ color: 'var(--danger)' }}>🗑</button>}
                  </div>
                ))}
          </div>
        )
      })}
    </div>
  )
}

function CreateForm({ vendors, projects, contracts, onClose, onCreated }: { vendors: VOpt[]; projects: POpt[]; contracts: COpt[]; onClose: () => void; onCreated: () => void }) {
  const [contractId, setContractId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const ct = contracts.find(c => c.id === contractId)
  // Chọn HĐ → tự điền số tiền (server tự kéo NCC/dự án từ HĐ). Bỏ chọn HĐ → nhập tay NCC.
  const onPickContract = (id: string) => {
    setContractId(id)
    const c = contracts.find(x => x.id === id)
    if (c) { setAmount(String(c.value || '')); setVendorId(''); setProjectId('') }
  }
  const submit = async () => {
    if (!contractId && !vendorId) { notify('Chọn hợp đồng hoặc nhà cung cấp', 'error'); return }
    if (!(Number(amount) > 0)) { notify('Nhập số tiền > 0', 'error'); return }
    setBusy(true)
    const r = await apiFetch('/api/procurement/payment-requests', { method: 'POST', body: JSON.stringify({ contractId: contractId || undefined, vendorId: vendorId || undefined, projectId: projectId || undefined, amount: Number(amount), description }) })
    setBusy(false)
    if (r.ok) { notify(r.message || 'Đã tạo', 'success'); onCreated() } else notify(r.error || 'Lỗi', 'error')
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 520, width: '100%' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold">Lập đề nghị thanh toán</h3>
        <div>
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Hợp đồng (khuyến nghị — tự kéo NCC + số tiền + đính kèm file HĐ)</label>
          <select value={contractId} onChange={e => onPickContract(e.target.value)} className="input text-sm w-full">
            <option value="">— Không chọn HĐ (nhập tay) —</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractCode} · {c.vendorName} · {formatCurrency(c.value)}{c.currency !== 'VND' ? ' ' + c.currency : ''}</option>)}
          </select>
        </div>
        {ct
          ? <div className="text-[11px] rounded p-2" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>Theo HĐ <b>{ct.contractCode}</b> — NCC <b>{ct.vendorName}</b>{ct.projectCode ? ` · Dự án ${ct.projectCode}` : ''}. File HĐ đã ký sẽ tự đính kèm.</div>
          : <>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} className="input text-sm w-full"><option value="">— Nhà cung cấp * —</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm w-full"><option value="">— Dự án (tùy chọn) —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectCode}</option>)}</select>
          </>}
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Số tiền *" className="input text-sm w-full" />
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Diễn giải" className="input text-sm w-full" />
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Sau khi tạo, mở dòng phiếu → bấm 📎 để đính kèm đủ 4 chứng từ (HĐ · hoá đơn · YCTT NCC · biên bản giao). Đủ 4 mới trình duyệt được.</div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Huỷ</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo'}</Button></div>
      </div>
    </div>
  )
}
