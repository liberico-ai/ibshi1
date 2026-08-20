'use client'

import { useEffect, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button, Badge } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Proj { id: string; projectCode: string; projectName: string }
interface PS {
  id: string; supplier: string; saleContract: string | null; value: number; currency: string; paymentMethod: string | null
  signDate: string | null; lcDate: string | null; etd: string | null; eta: string | null; documentDate: string | null
  lcDeadline: string | null; paymentMonth: string | null; status: string; paidDate: string | null; paidAmount: number | null; poCode: string | null; notes: string | null
}
const STATUS: Record<string, { label: string; color: 'default' | 'info' | 'success' | 'danger' }> = {
  PLANNED: { label: 'Kế hoạch', color: 'default' }, DUE: { label: 'Sắp đến hạn', color: 'info' },
  PAID: { label: 'Đã thanh toán', color: 'success' }, OVERDUE: { label: 'Quá hạn', color: 'danger' },
}
const dt = (s: string | null) => (s ? formatDate(s) : '—')
const isOverdue = (p: PS) => p.status !== 'PAID' && p.lcDeadline != null && new Date(p.lcDeadline) < new Date(new Date().toDateString())

export default function PaymentSchedulePage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [rows, setRows] = useState<PS[]>([])
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])
  const load = useCallback(() => {
    if (!projectId) { setRows([]); return }
    apiFetch(`/api/procurement/payment-schedules?projectId=${projectId}`).then(r => { if (r.ok) setRows(r.schedules || []) })
  }, [projectId])
  useEffect(() => { load() }, [load])

  const setStatus = async (id: string, status: string) => {
    const r = await apiFetch(`/api/procurement/payment-schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    if (r.ok) load(); else notify(r.error || 'Lỗi', 'error')
  }
  const del = async (id: string) => {
    if (!await confirmDialog('Xoá dòng lịch thanh toán này?')) return
    const r = await apiFetch(`/api/procurement/payment-schedules/${id}`, { method: 'DELETE' })
    if (r.ok) load(); else notify(r.error || 'Lỗi', 'error')
  }
  const importPS = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const pick = (r: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return '' }
      const rows = raw.map(r => ({
        supplier: pick(r, 'NCC', 'Nhà cung cấp', 'supplier'),
        saleContract: pick(r, 'Số HĐ', 'Hợp đồng', 'saleContract'),
        value: pick(r, 'Giá trị', 'Value', 'value'),
        currency: pick(r, 'Tiền tệ', 'Currency', 'currency'),
        paymentMethod: pick(r, 'Hình thức', 'Phương thức', 'paymentMethod'),
        signDate: pick(r, 'Ngày ký', 'signDate'), lcDate: pick(r, 'Ngày LC', 'lcDate'),
        etd: pick(r, 'ETD', 'etd'), eta: pick(r, 'ETA', 'eta'),
        documentDate: pick(r, 'Ngày CT', 'Ngày chứng từ', 'documentDate'),
        lcDeadline: pick(r, 'Hạn TT', 'Hạn LC', 'lcDeadline'),
        paymentMonth: pick(r, 'Tháng TT', 'paymentMonth'), notes: pick(r, 'Ghi chú', 'notes'),
      }))
      if (rows.length === 0) { notify('File không có dòng nào', 'error'); return }
      const res = await apiFetch('/api/procurement/payment-schedules/import', { method: 'POST', body: JSON.stringify({ projectId, rows }) })
      if (res.ok) { notify(res.message || 'Đã nhập', 'success'); load() } else notify(res.error || 'Lỗi nhập', 'error')
    } catch (e) { console.error(e); notify('Không đọc được file Excel (cần cột "NCC" + "Giá trị")', 'error') }
  }

  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const totalPaid = rows.filter(r => r.status === 'PAID').reduce((s, r) => s + r.value, 0)
  const unpaid = rows.filter(r => r.status !== 'PAID')
  const nccCanTT = new Set(unpaid.map(r => r.supplier)).size
  const thangCanTT = new Set(unpaid.map(r => r.paymentMonth).filter(Boolean)).size

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Lịch thanh toán" subtitle="Theo dõi thanh toán theo mốc (T/T · LC) cho PO/HĐ nhập khẩu & nội địa" />
      <div className="flex gap-3 items-center flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {projectId && <Button variant="primary" onClick={() => setShowAdd(true)}>+ Thêm dòng</Button>}
        {projectId && (
          <label className="text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer" style={{ border: '1px solid #16a34a', color: '#166534', background: '#f0fdf4' }} title='Cột: NCC · Số HĐ · Giá trị · Tiền tệ · Hình thức · Ngày ký · ETD · ETA · Hạn TT · Tháng TT'>
            ⬆ Nhập Excel
            <input type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importPS(f); e.currentTarget.value = '' }} />
          </label>
        )}
      </div>

      {projectId && (
        <>
          <div className="flex gap-2 flex-wrap">
            {[['Số dòng', String(rows.length)], ['Tổng giá trị', formatCurrency(totalValue)], ['Đã trả', formatCurrency(totalPaid)], ['Còn lại', formatCurrency(totalValue - totalPaid)], ['NCC cần TT', String(nccCanTT)], ['Số tháng cần TT', String(thangCanTT)]].map(([l, v], i) => (
              <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minWidth: 130 }}>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
                <div className="text-sm font-bold font-mono" style={{ color: i === 2 ? '#166534' : 'var(--text-primary)' }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                <th className="text-center px-2 py-1.5">STT</th><th className="text-left px-2 py-1.5">NCC</th><th className="text-left px-2 py-1.5">HĐ / PO</th><th className="text-right px-2 py-1.5">Giá trị</th>
                <th className="text-left px-2 py-1.5">PT thanh toán</th><th className="text-center px-2 py-1.5">Ngày ký</th><th className="text-center px-2 py-1.5">LC</th>
                <th className="text-center px-2 py-1.5">ETD</th><th className="text-center px-2 py-1.5">ETA</th><th className="text-center px-2 py-1.5">Doc</th><th className="text-center px-2 py-1.5">Hạn LC</th>
                <th className="text-center px-2 py-1.5">Tháng TT</th><th className="text-center px-2 py-1.5">Trạng thái</th><th className="text-left px-2 py-1.5">Ghi chú</th><th></th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={15} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Chưa có dòng nào — bấm &quot;+ Thêm dòng&quot;</td></tr>
                ) : rows.map((p, i) => {
                  const overdue = isOverdue(p)
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)', background: overdue ? 'rgba(220,38,38,0.05)' : undefined }}>
                      <td className="px-2 py-1 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td className="px-2 py-1 font-semibold">{p.supplier}</td>
                      <td className="px-2 py-1">{p.saleContract || p.poCode || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{formatCurrency(p.value)} <span style={{ color: 'var(--text-muted)' }}>{p.currency !== 'VND' ? p.currency : ''}</span></td>
                      <td className="px-2 py-1">{p.paymentMethod || '—'}</td>
                      <td className="px-2 py-1 text-center">{dt(p.signDate)}</td>
                      <td className="px-2 py-1 text-center">{dt(p.lcDate)}</td>
                      <td className="px-2 py-1 text-center">{dt(p.etd)}</td>
                      <td className="px-2 py-1 text-center">{dt(p.eta)}</td>
                      <td className="px-2 py-1 text-center">{dt(p.documentDate)}</td>
                      <td className="px-2 py-1 text-center" style={{ color: overdue ? '#dc2626' : undefined, fontWeight: overdue ? 700 : 400 }}>{dt(p.lcDeadline)}</td>
                      <td className="px-2 py-1 text-center">{p.paymentMonth || '—'}</td>
                      <td className="px-2 py-1 text-center">
                        <select value={overdue && p.status !== 'PAID' ? 'OVERDUE' : p.status} onChange={e => setStatus(p.id, e.target.value)} className="input text-[11px]" style={{ minWidth: 96 }}>
                          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        {p.status === 'PAID' && p.paidDate && <div className="text-[10px] mt-0.5" style={{ color: '#166534' }}>{dt(p.paidDate)}</div>}
                      </td>
                      <td className="px-2 py-1" style={{ color: 'var(--text-muted)', maxWidth: 160 }}>{p.notes || ''}</td>
                      <td className="px-2 py-1 text-right"><button onClick={() => del(p.id)} className="text-[11px]" style={{ color: '#dc2626' }}>Xoá</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showAdd && <AddModal projectId={projectId} onCancel={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

function AddModal({ projectId, onCancel, onSaved }: { projectId: string; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ currency: 'VND', paymentMethod: 'T/T', status: 'PLANNED' })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))
  const save = async () => {
    if (!f.supplier?.trim()) { notify('Nhập tên NCC', 'error'); return }
    setSaving(true)
    const r = await apiFetch('/api/procurement/payment-schedules', { method: 'POST', body: JSON.stringify({ ...f, projectId, value: Number(f.value) || 0 }) })
    setSaving(false)
    if (r.ok) { notify('Đã thêm', 'success'); onSaved() } else notify(r.error || 'Lỗi', 'error')
  }
  const fld = (k: string, label: string, type = 'text') => (
    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}
      <input type={type} value={f[k] || ''} onChange={e => set(k, e.target.value)} className="input text-sm w-full mt-0.5" />
    </label>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onCancel}>
      <div className="card p-5 space-y-3" style={{ maxWidth: 720, width: '100%', maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Thêm dòng lịch thanh toán</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {fld('supplier', 'NCC *')}
          {fld('saleContract', 'Số HĐ')}
          {fld('value', 'Giá trị', 'number')}
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Tiền tệ
            <select value={f.currency} onChange={e => set('currency', e.target.value)} className="input text-sm w-full mt-0.5"><option value="VND">VND</option><option value="USD">USD</option></select>
          </label>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>PT thanh toán
            <select value={f.paymentMethod} onChange={e => set('paymentMethod', e.target.value)} className="input text-sm w-full mt-0.5"><option>T/T</option><option>LC 100%</option><option>LC at sight</option><option>D/P</option><option>D/A</option></select>
          </label>
          {fld('paymentMonth', 'Tháng TT (vd 06/2026)')}
          {fld('signDate', 'Ngày ký', 'date')}
          {fld('lcDate', 'Ngày mở LC', 'date')}
          {fld('etd', 'ETD', 'date')}
          {fld('eta', 'ETA', 'date')}
          {fld('lcDeadline', 'Hạn LC', 'date')}
          {fld('documentDate', 'Ngày chứng từ', 'date')}
        </div>
        {fld('notes', 'Ghi chú')}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Huỷ</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button></div>
      </div>
    </div>
  )
}
