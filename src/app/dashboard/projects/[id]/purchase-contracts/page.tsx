'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch, openAuthedFile } from '@/hooks/useAuth'
import { PageHeader, Badge } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { formatCurrency, formatDate } from '@/lib/utils'

// T1 — Hợp đồng mua (Purchase Contract)

interface SignedFile {
  id: string
  fileName: string
  fileUrl: string
  mimeType: string | null
}
interface LinkedOrder {
  id: string
  poCode: string
  totalValue: number | string | null
  status: string
}
interface Contract {
  id: string
  contractCode: string
  contractType: string
  title: string
  value: number | null
  currency: string
  status: string
  signedDate: string | null
  effectiveDate: string | null
  paymentTerms: string | null
  deliveryTerms: string | null
  signedFileId: string | null
  notes: string | null
  vendor: { id: string; vendorCode: string; name: string } | null
  orders: LinkedOrder[]
  linkedPoTotal: number
  linkedPoCount: number
  overBudget: boolean
  signedFile: SignedFile | null
}
interface LoadData {
  project: { projectCode: string; projectName: string }
  contracts: Contract[]
  canWrite: boolean
}
interface Vendor { id: string; vendorCode: string; name: string }
interface ProjectPO { id: string; poCode: string; vendorId: string; totalValue: number; contractId: string | null }

const CONTRACT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'HDMB', label: 'HĐ mua bán (HDMB)' },
  { value: 'HDKT', label: 'HĐ kinh tế (HDKT)' },
  { value: 'KHAC', label: 'Khác' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(CONTRACT_TYPE_OPTIONS.map(o => [o.value, o.label]))
const TYPE_VARIANT: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  HDMB: 'info', HDKT: 'warning', KHAC: 'default',
}

const STATUS_OPTIONS = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp', ACTIVE: 'Hiệu lực', COMPLETED: 'Hoàn tất', CANCELLED: 'Huỷ',
}
const STATUS_VARIANT: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default', ACTIVE: 'success', COMPLETED: 'info', CANCELLED: 'danger',
}

const ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.zip']

export default function PurchaseContractsPage() {
  const params = useParams()
  const projectId = params.id as string

  const [data, setData] = useState<LoadData | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [projectPOs, setProjectPOs] = useState<ProjectPO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filterStatus, setFilterStatus] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    contractCode: '', contractType: 'HDMB', vendorId: '', title: '', value: '',
    signedDate: '', effectiveDate: '', paymentTerms: '', deliveryTerms: '', notes: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // gắn PO
  const [linkTarget, setLinkTarget] = useState<Contract | null>(null)
  const [linkPoId, setLinkPoId] = useState('')
  const [linkMsg, setLinkMsg] = useState('')
  const [linking, setLinking] = useState(false)

  const load = useCallback(() => {
    if (!projectId) return
    const qs = new URLSearchParams()
    if (filterStatus) qs.set('status', filterStatus)
    const url = `/api/projects/${projectId}/purchase-contracts${qs.toString() ? `?${qs}` : ''}`
    apiFetch(url).then(r => {
      if (r.ok) { setData(r); setError('') }
      else setError(r.error || 'Không tải được danh sách hợp đồng mua')
      setLoading(false)
    })
  }, [projectId, filterStatus])

  useEffect(() => { load() }, [load])

  // vendors + POs cho form/gắn (chỉ tải một lần)
  useEffect(() => {
    if (!projectId) return
    apiFetch('/api/vendors').then(r => { if (r.ok) setVendors(r.vendors || []) })
    apiFetch(`/api/purchase-orders?projectId=${projectId}`).then(r => {
      if (r.ok) {
        const list = (r.purchaseOrders || []).map((p: Record<string, unknown>) => ({
          id: p.id, poCode: p.poCode, vendorId: p.vendorId,
          totalValue: Number(p.totalValue || 0), contractId: (p.contractId as string) || null,
        }))
        setProjectPOs(list)
      }
    })
  }, [projectId])

  const canWrite = data?.canWrite ?? false

  const uploadFile = async (f: File): Promise<string | null> => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData()
    fd.append('file', f)
    fd.append('entityType', 'PurchaseContract')
    fd.append('entityId', projectId)
    const res = await fetch('/api/upload', {
      method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json()).catch(() => ({ ok: false, error: 'Lỗi mạng' }))
    if (res.ok && res.attachment) return res.attachment.id as string
    throw new Error(res.error || 'Lỗi upload file')
  }

  const handleSubmit = async () => {
    if (saving) return
    setFormMsg('')
    if (!form.contractCode.trim()) { setFormMsg('Nhập số hợp đồng'); return }
    if (!form.vendorId) { setFormMsg('Chọn nhà cung cấp'); return }
    if (!form.title.trim()) { setFormMsg('Nhập tiêu đề hợp đồng'); return }
    if (file) {
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
      if (!ALLOWED_EXTS.includes(ext)) { setFormMsg(`Định dạng không hỗ trợ. Chấp nhận: ${ALLOWED_EXTS.join(', ')}`); return }
    }
    setSaving(true)
    try {
      let signedFileId: string | null = null
      if (file) signedFileId = await uploadFile(file)

      const res = await apiFetch(`/api/projects/${projectId}/purchase-contracts`, {
        method: 'POST',
        body: JSON.stringify({
          contractCode: form.contractCode.trim(),
          contractType: form.contractType,
          vendorId: form.vendorId,
          title: form.title.trim(),
          value: form.value.trim() || null,
          signedDate: form.signedDate || null,
          effectiveDate: form.effectiveDate || null,
          paymentTerms: form.paymentTerms.trim() || null,
          deliveryTerms: form.deliveryTerms.trim() || null,
          notes: form.notes.trim() || null,
          signedFileId,
        }),
      })
      if (res.ok) {
        setForm({ contractCode: '', contractType: 'HDMB', vendorId: '', title: '', value: '', signedDate: '', effectiveDate: '', paymentTerms: '', deliveryTerms: '', notes: '' })
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        setShowForm(false)
        load()
      } else {
        setFormMsg(res.error || 'Không lưu được hợp đồng')
      }
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : 'Lỗi không xác định')
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (c: Contract, status: string) => {
    const res = await apiFetch(`/api/purchase-contracts/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    if (res.ok) load()
    else alert(res.error || 'Không cập nhật được trạng thái')
  }

  // PO có thể gắn vào HĐ đang chọn: chưa có HĐ + cùng NCC của HĐ
  const linkablePOs = useMemo(() => {
    if (!linkTarget) return []
    return projectPOs.filter(p => !p.contractId && (!linkTarget.vendor || p.vendorId === linkTarget.vendor.id))
  }, [projectPOs, linkTarget])

  const handleLinkPo = async () => {
    if (!linkTarget || !linkPoId || linking) return
    setLinking(true); setLinkMsg('')
    const res = await apiFetch(`/api/purchase-contracts/${linkTarget.id}/link-po`, {
      method: 'POST', body: JSON.stringify({ poId: linkPoId }),
    })
    setLinking(false)
    if (res.ok) {
      setLinkTarget(null); setLinkPoId('')
      // reload POs + contracts
      apiFetch(`/api/purchase-orders?projectId=${projectId}`).then(r => {
        if (r.ok) setProjectPOs((r.purchaseOrders || []).map((p: Record<string, unknown>) => ({
          id: p.id, poCode: p.poCode, vendorId: p.vendorId, totalValue: Number(p.totalValue || 0), contractId: (p.contractId as string) || null,
        })))
      })
      load()
    } else {
      setLinkMsg(res.error || 'Không gắn được PO')
    }
  }

  const contracts = useMemo(() => data?.contracts ?? [], [data])

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>
  if (error || !data) return <div className="card p-6 text-center" style={{ color: SEMANTIC_COLORS.danger.solid }}>{error || 'Lỗi'}</div>

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm border bg-transparent'
  const inputStyle = { borderColor: 'var(--border)', color: 'var(--text-primary)' } as React.CSSProperties

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Hợp đồng mua — ${data.project.projectCode}`}
        subtitle={data.project.projectName}
        actions={canWrite ? (
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: SEMANTIC_COLORS.info.solid }}
          >
            {showForm ? 'Đóng' : '+ Lập hợp đồng'}
          </button>
        ) : undefined}
      />

      {/* Form lập HĐ */}
      {showForm && canWrite && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Lập hợp đồng mua</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="input-label mb-1 block">Số hợp đồng *</label>
              <input className={inputCls} style={inputStyle} value={form.contractCode}
                onChange={e => setForm(f => ({ ...f, contractCode: e.target.value }))} placeholder="VD: HDMB-2025-HH-095" />
            </div>
            <div>
              <label className="input-label mb-1 block">Loại hợp đồng *</label>
              <select className={inputCls} style={inputStyle} value={form.contractType}
                onChange={e => setForm(f => ({ ...f, contractType: e.target.value }))}>
                {CONTRACT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label mb-1 block">Nhà cung cấp *</label>
              <select className={inputCls} style={inputStyle} value={form.vendorId}
                onChange={e => setForm(f => ({ ...f, vendorId: e.target.value }))}>
                <option value="">— Chọn NCC —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.vendorCode} — {v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label mb-1 block">Giá trị HĐ (VND)</label>
              <input className={inputCls} style={inputStyle} value={form.value} inputMode="numeric"
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="VD: 1500000000" />
            </div>
            <div className="md:col-span-2">
              <label className="input-label mb-1 block">Tiêu đề *</label>
              <input className={inputCls} style={inputStyle} value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tên/nội dung hợp đồng" />
            </div>
            <div>
              <label className="input-label mb-1 block">Ngày ký</label>
              <input type="date" className={inputCls} style={inputStyle} value={form.signedDate}
                onChange={e => setForm(f => ({ ...f, signedDate: e.target.value }))} />
            </div>
            <div>
              <label className="input-label mb-1 block">Ngày hiệu lực</label>
              <input type="date" className={inputCls} style={inputStyle} value={form.effectiveDate}
                onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div>
              <label className="input-label mb-1 block">Điều khoản thanh toán</label>
              <input className={inputCls} style={inputStyle} value={form.paymentTerms}
                onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} placeholder="VD: 30% tạm ứng, 70% sau giao" />
            </div>
            <div>
              <label className="input-label mb-1 block">Điều khoản giao hàng</label>
              <input className={inputCls} style={inputStyle} value={form.deliveryTerms}
                onChange={e => setForm(f => ({ ...f, deliveryTerms: e.target.value }))} placeholder="VD: giao tại kho, 15 ngày" />
            </div>
            <div className="md:col-span-2">
              <label className="input-label mb-1 block">Ghi chú</label>
              <input className={inputCls} style={inputStyle} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="input-label mb-1 block">File hợp đồng ký (tùy chọn)</label>
              <input ref={fileInputRef} type="file" className={inputCls} style={inputStyle}
                accept={ALLOWED_EXTS.join(',')}
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          {formMsg && <p className="text-xs" style={{ color: SEMANTIC_COLORS.danger.solid }}>{formMsg}</p>}
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60"
              style={{ background: SEMANTIC_COLORS.success.solid }}>
              {saving ? 'Đang lưu…' : 'Lưu hợp đồng'}
            </button>
            <button onClick={() => { setShowForm(false); setFormMsg('') }}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Huỷ</button>
          </div>
        </div>
      )}

      {/* Bộ lọc */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="input-label mb-1 block">Lọc theo trạng thái</label>
            <select className={inputCls} style={inputStyle} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Tất cả trạng thái</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          {filterStatus && (
            <button onClick={() => setFilterStatus('')}
              className="px-3 py-2 rounded-lg text-xs font-bold"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Xoá lọc</button>
          )}
          <div className="ml-auto text-xs self-center" style={{ color: 'var(--text-muted)' }}>{contracts.length} hợp đồng</div>
        </div>
      </div>

      {/* Bảng HĐ */}
      <div className="card p-0 overflow-hidden">
        {contracts.length === 0 ? (
          <div className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>
            <p className="text-sm">Chưa có hợp đồng mua nào cho dự án này.</p>
            {canWrite && <p className="text-xs mt-1">Bấm “+ Lập hợp đồng” để bắt đầu.</p>}
          </div>
        ) : (
          <div className="dt-wrapper">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>Số HĐ</th>
                  <th>NCC</th>
                  <th>Loại</th>
                  <th className="text-right">Giá trị</th>
                  <th className="text-right">Đã đặt PO</th>
                  <th>Trạng thái</th>
                  <th>Ngày ký</th>
                  <th>File ký</th>
                  {canWrite && <th>Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id}>
                    <td className="font-mono font-bold" style={{ color: 'var(--accent)' }} title={c.title}>{c.contractCode}</td>
                    <td>{c.vendor?.name || '—'}</td>
                    <td><Badge variant={TYPE_VARIANT[c.contractType] || 'default'}>{TYPE_LABEL[c.contractType] || c.contractType}</Badge></td>
                    <td className="text-right font-mono">{c.value != null ? formatCurrency(c.value, c.currency) : '—'}</td>
                    <td className="text-right font-mono">
                      <span style={{ color: c.overBudget ? SEMANTIC_COLORS.danger.solid : 'var(--text-primary)' }}
                        title={c.overBudget ? 'Tổng PO đã gắn vượt giá trị hợp đồng' : `${c.linkedPoCount} PO đã gắn`}>
                        {formatCurrency(c.linkedPoTotal, c.currency)}
                      </span>
                      {c.overBudget && <span className="ml-1" title="Vượt giá trị HĐ">⚠️</span>}
                      <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({c.linkedPoCount})</span>
                    </td>
                    <td><Badge variant={STATUS_VARIANT[c.status] || 'default'}>{STATUS_LABEL[c.status] || c.status}</Badge></td>
                    <td className="font-mono">{c.signedDate ? formatDate(c.signedDate) : '—'}</td>
                    <td>
                      {c.signedFile ? (
                        <button onClick={() => openAuthedFile(c.signedFile!.id, c.signedFile!.fileName, c.signedFile!.mimeType)}
                          className="underline" style={{ color: SEMANTIC_COLORS.info.solid }} title={c.signedFile.fileName}>Mở</button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="flex flex-wrap gap-1 items-center">
                          <button onClick={() => { setLinkTarget(c); setLinkPoId(''); setLinkMsg('') }}
                            className="px-2 py-1 rounded text-xs font-bold text-white"
                            style={{ background: SEMANTIC_COLORS.info.solid }}>+ Gắn PO</button>
                          <select className="px-1 py-1 rounded text-xs border bg-transparent" style={inputStyle}
                            value={c.status} onChange={e => updateStatus(c, e.target.value)} title="Đổi trạng thái">
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PO đã gắn — chi tiết dưới mỗi HĐ (đơn giản: liệt kê) */}
      {contracts.some(c => c.linkedPoCount > 0) && (
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>PO đã gắn theo hợp đồng</h3>
          {contracts.filter(c => c.linkedPoCount > 0).map(c => (
            <div key={c.id} className="text-xs">
              <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{c.contractCode}</span>
              <span style={{ color: 'var(--text-muted)' }}> — </span>
              {c.orders.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ', '}
                  <span className="font-mono">{o.poCode}</span>
                  <span style={{ color: 'var(--text-muted)' }}> ({formatCurrency(Number(o.totalValue || 0), c.currency)})</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Modal gắn PO */}
      {linkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="card p-5 w-full max-w-md space-y-3">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Gắn PO vào {linkTarget.contractCode}
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Chỉ hiện PO của dự án chưa gắn hợp đồng{linkTarget.vendor ? ` và cùng NCC ${linkTarget.vendor.name}` : ''}.
            </p>
            {linkablePOs.length === 0 ? (
              <p className="text-xs" style={{ color: SEMANTIC_COLORS.warning.solid }}>Không có PO phù hợp để gắn.</p>
            ) : (
              <select className={inputCls} style={inputStyle} value={linkPoId} onChange={e => setLinkPoId(e.target.value)}>
                <option value="">— Chọn PO —</option>
                {linkablePOs.map(p => <option key={p.id} value={p.id}>{p.poCode} — {formatCurrency(p.totalValue)}</option>)}
              </select>
            )}
            {linkMsg && <p className="text-xs" style={{ color: SEMANTIC_COLORS.danger.solid }}>{linkMsg}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setLinkTarget(null); setLinkMsg('') }}
                className="px-4 py-2 rounded-lg text-sm font-bold"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Đóng</button>
              <button onClick={handleLinkPo} disabled={!linkPoId || linking}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60"
                style={{ background: SEMANTIC_COLORS.success.solid }}>
                {linking ? 'Đang gắn…' : 'Gắn PO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
