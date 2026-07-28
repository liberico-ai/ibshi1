'use client'

import { useEffect, useState, Fragment } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatDate, formatNumber } from '@/lib/utils'
import { PageHeader, Button, EmptyState, Modal, KPICard, SelectField } from '@/components/ui'
import { Package, BarChart3, Wrench, CheckCircle2, ChevronRight, ChevronDown } from 'lucide-react'
import MultiFileUpload from '@/components/MultiFileUpload'
import { notify } from '@/components/ui/Toast'

// Hồ sơ nhận hàng bắt buộc: hợp đồng / Mill Cert / chứng chỉ Heat/Lot
const GRN_DOC_ACCEPT = '.pdf,.doc,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.zip,.rar'

interface GRN {
  id: string; type: string; reason: string; quantity: number; referenceNo: string | null;
  heatNumber: string | null; lotNumber: string | null; notes: string | null; createdAt: string;
  material: { materialCode: string; name: string; unit: string } | null
}

interface PO {
  id: string; poCode: string; status: string; vendorId?: string;
  vendor: { name: string } | null;
  items: Array<{
    id: string; materialId: string | null; quantity: number; receivedQty: number;
    material: { materialCode: string; name: string; unit: string; category?: string | null } | null;
    itemCode?: string; description?: string; unit?: string;
  }>
}

interface ReceiveItem {
  poItemId: string; receivedQty: number; heatNumber: string; lotNumber: string; notes: string;
  millCertificateId: string;
  orderedQty: number; maxQty: number; materialName: string; unit: string;
  isConsumable: boolean;
}

interface MillCert {
  id: string; certNumber: string; heatNumber: string; grade: string | null;
  vendorId?: string;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }

// Trạng thái PO có thể nhận hàng (không tính DRAFT/PENDING/REJECTED/CANCELLED)
const NOT_RECEIVABLE = ['DRAFT', 'PENDING', 'REJECTED', 'CANCELLED']

export default function GRNPage() {
  const [receipts, setReceipts] = useState<GRN[]>([])
  const [loading, setLoading] = useState(true)
  const [showReceiveForm, setShowReceiveForm] = useState(false)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectPOs, setProjectPOs] = useState<PO[]>([])
  const [loadingPOs, setLoadingPOs] = useState(false)
  const [checkedPoIds, setCheckedPoIds] = useState<string[]>([])
  const [poItems, setPoItems] = useState<Record<string, ReceiveItem[]>>({})
  const [poMillCerts, setPoMillCerts] = useState<Record<string, MillCert[]>>({})
  const [poMeta, setPoMeta] = useState<Record<string, { poCode: string }>>({})
  const [submitting, setSubmitting] = useState(false)
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set())

  const togglePO = (poCode: string) => {
    setExpandedPOs(prev => {
      const next = new Set(prev)
      if (next.has(poCode)) next.delete(poCode); else next.add(poCode)
      return next
    })
  }

  const loadReceipts = () => {
    apiFetch('/api/grn').then(res => {
      if (res.ok) setReceipts(res.receipts || [])
      setLoading(false)
    })
  }

  useEffect(() => { loadReceipts() }, [])

  const resetReceiveForm = () => {
    setSelectedProjectId(''); setProjectPOs([]); setCheckedPoIds([])
    setPoItems({}); setPoMillCerts({}); setPoMeta({})
  }

  const openReceiveForm = async () => {
    resetReceiveForm()
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(res.projects || res.data || [])
    setShowReceiveForm(true)
  }

  // Chọn dự án → tải tất cả PO (có thể nhận hàng) của dự án đó
  const onSelectProject = async (projectId: string) => {
    setSelectedProjectId(projectId)
    setCheckedPoIds([]); setPoItems({}); setPoMillCerts({}); setPoMeta({}); setProjectPOs([])
    if (!projectId) return
    setLoadingPOs(true)
    const res = await apiFetch(`/api/purchase-orders?projectId=${projectId}`)
    if (res.ok) {
      const list: PO[] = res.purchaseOrders || res.data || []
      setProjectPOs(list.filter(po => !NOT_RECEIVABLE.includes(po.status)))
    }
    setLoadingPOs(false)
  }

  // Tích/bỏ tích 1 PO. Khi tích → tải chi tiết vật tư + Mill Cert của PO đó
  const toggleCheckPO = async (poId: string) => {
    if (checkedPoIds.includes(poId)) {
      setCheckedPoIds(prev => prev.filter(id => id !== poId))
      setPoItems(prev => { const n = { ...prev }; delete n[poId]; return n })
      setPoMillCerts(prev => { const n = { ...prev }; delete n[poId]; return n })
      return
    }
    const po = projectPOs.find(p => p.id === poId)
    if (!po) return
    setCheckedPoIds(prev => [...prev, poId])
    setPoMeta(prev => ({ ...prev, [poId]: { poCode: po.poCode } }))

    const detail = await apiFetch(`/api/purchase-orders/${poId}`)
    const fullPO = detail.ok ? (detail.purchaseOrder || detail.data || po) : po

    const vendorId: string | undefined = fullPO.vendorId
    if (vendorId) {
      const certRes = await apiFetch(`/api/mill-certificates?vendorId=${vendorId}`)
      const certs: MillCert[] = certRes.ok ? (certRes.certificates || []) : []
      setPoMillCerts(prev => ({ ...prev, [poId]: certs.filter(c => !c.vendorId || c.vendorId === vendorId) }))
    } else {
      setPoMillCerts(prev => ({ ...prev, [poId]: [] }))
    }

    const items: ReceiveItem[] = (fullPO.items || []).map((item: PO['items'][0]) => ({
      poItemId: item.id,
      receivedQty: 0,
      heatNumber: '',
      lotNumber: '',
      millCertificateId: '',
      notes: '',
      orderedQty: Number(item.quantity),
      maxQty: Number(item.quantity) - Number(item.receivedQty),
      materialName: item.material ? `${item.material.materialCode} — ${item.material.name}` : (item.itemCode ? `${item.itemCode} — ${item.description || ''}` : item.description || '—'),
      unit: item.material?.unit || item.unit || '',
      isConsumable: (item.material?.category || '').toLowerCase() === 'consumable',
    })).filter((i: ReceiveItem) => i.maxQty > 0)
    setPoItems(prev => ({ ...prev, [poId]: items }))
  }

  const updateItem = (poId: string, idx: number, field: keyof ReceiveItem, value: string | number) => {
    setPoItems(prev => ({ ...prev, [poId]: (prev[poId] || []).map((item, i) => i === idx ? { ...item, [field]: value } : item) }))
  }

  const submitReceive = async () => {
    if (checkedPoIds.length === 0) return notify('Tích chọn ít nhất 1 PO')

    // Chỉ nhận các PO có nhập số lượng > 0
    const posToSubmit = checkedPoIds.filter(poId => (poItems[poId] || []).some(i => i.receivedQty > 0))
    if (posToSubmit.length === 0) return notify('Nhập số lượng nhận cho ít nhất 1 vật tư')

    // Validate từng PO: Heat/Lot bắt buộc (trừ tiêu hao) + hồ sơ đính kèm
    for (const poId of posToSubmit) {
      const validItems = (poItems[poId] || []).filter(i => i.receivedQty > 0)
      const poCode = poMeta[poId]?.poCode || poId
      const missingCert = validItems.filter(i => !i.isConsumable && (!i.heatNumber.trim() || !i.lotNumber.trim()))
      if (missingCert.length > 0) {
        return notify(`[${poCode}] Cần nhập Heat No. + Lot No. (trừ vật tư tiêu hao):\n` + missingCert.map(i => `• ${i.materialName}`).join('\n'), 'error')
      }
      const hasNonConsumable = validItems.some(i => !i.isConsumable)
      if (hasNonConsumable) {
        const att = await apiFetch(`/api/upload?entityType=GRN&entityId=${poId}`)
        if (!att.ok || !(att.attachments?.length > 0)) {
          return notify(`[${poCode}] Bắt buộc đính kèm hồ sơ Heat/Lot/Mill Cert trước khi xác nhận (vật tư tiêu hao thì không cần).`, 'error')
        }
      }
    }

    setSubmitting(true)
    let okCount = 0
    const errors: string[] = []
    for (const poId of posToSubmit) {
      const validItems = (poItems[poId] || []).filter(i => i.receivedQty > 0)
      const poCode = poMeta[poId]?.poCode || poId
      const res = await apiFetch('/api/grn', {
        method: 'POST',
        body: JSON.stringify({
          poId,
          items: validItems.map(i => ({
            poItemId: i.poItemId,
            receivedQty: i.receivedQty,
            heatNumber: i.heatNumber || undefined,
            lotNumber: i.lotNumber || undefined,
            millCertificateId: i.millCertificateId || undefined,
            notes: i.notes || undefined,
          })),
        }),
      })
      if (res.ok) okCount++
      else errors.push(`[${poCode}] ${res.error || res.message || 'lỗi'}`)
    }
    setSubmitting(false)

    if (errors.length === 0) {
      notify(`Đã ghi nhận hàng về cho ${okCount} PO`, 'success')
      setShowReceiveForm(false)
      loadReceipts()
    } else {
      notify(`Xong ${okCount} PO. Lỗi:\n${errors.join('\n')}`, 'error')
      if (okCount > 0) loadReceipts()
    }
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>

  const totalQty = receipts.reduce((s, r) => s + Number(r.quantity), 0)

  // Gộp lịch sử hàng về theo PO (referenceNo) — mỗi PO là 1 dòng, bấm để xổ danh sách vật tư
  const groupedReceipts = (() => {
    const map = new Map<string, GRN[]>()
    for (const r of receipts) {
      const key = r.referenceNo || '—'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return Array.from(map.entries()).map(([poCode, lines]) => ({
      poCode,
      lines,
      totalQty: lines.reduce((s, l) => s + Number(l.quantity), 0),
      latestDate: lines.reduce((mx, l) => (l.createdAt > mx ? l.createdAt : mx), lines[0].createdAt),
    }))
  })()

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Hàng về"
        subtitle={`${groupedReceipts.length} PO · ${receipts.length} lượt vật tư`}
        actions={
          <Button variant="primary" onClick={openReceiveForm}>
            + Ghi nhận hàng về
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KPICard
          label="PO hàng về"
          value={groupedReceipts.length}
          icon={<Package size={20} />}
        />
        <KPICard
          label="Tổng SL nhận"
          value={formatNumber(totalQty)}
          icon={<BarChart3 size={20} />}
          accentColor="var(--success)"
        />
        <KPICard
          label="Vật tư đã nhận"
          value={new Set(receipts.map(r => r.material?.materialCode).filter(Boolean)).size}
          icon={<Wrench size={20} />}
          accentColor="var(--info)"
        />
      </div>

      {/* Receive Form Modal */}
      <Modal
        open={showReceiveForm}
        onClose={() => setShowReceiveForm(false)}
        title="Ghi nhận hàng về"
        size="lg"
        actions={
          checkedPoIds.length > 0 ? (
            <Button variant="primary" onClick={submitReceive} loading={submitting}>
              Xác nhận hàng về ({checkedPoIds.length} PO)
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          {/* Bước 1: Chọn dự án */}
          <SelectField
            label="Chọn dự án"
            value={selectedProjectId}
            onChange={e => onSelectProject(e.target.value)}
            options={[
              { value: '', label: '— Chọn dự án —' },
              ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` })),
            ]}
          />

          {/* Bước 2: Tích chọn các PO của dự án */}
          {selectedProjectId && (
            <div>
              <label className="input-label">PO của dự án — tích để ghi nhận hàng về</label>
              {loadingPOs ? (
                <div className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Đang tải danh sách PO...</div>
              ) : projectPOs.length === 0 ? (
                <div className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Dự án này chưa có PO nào có thể nhận hàng</div>
              ) : (
                <div className="space-y-1.5">
                  {projectPOs.map(po => (
                    <label key={po.id} className="flex items-center gap-2 p-2 rounded-lg cursor-pointer" style={{ border: `1px solid ${checkedPoIds.includes(po.id) ? 'var(--accent)' : 'var(--border)'}` }}>
                      <input type="checkbox" checked={checkedPoIds.includes(po.id)} onChange={() => toggleCheckPO(po.id)} />
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{po.poCode}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {po.vendor?.name || 'N/A'}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>{po.status}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bước 3: Nhập thông tin nhận hàng cho từng PO đã tích */}
          {checkedPoIds.map(poId => {
            const items = poItems[poId]
            const certs = poMillCerts[poId] || []
            const poCode = poMeta[poId]?.poCode || poId
            return (
              <div key={poId} className="space-y-3 rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
                <h3 className="font-heading text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  Vật tư — {poCode}
                </h3>
                {!items ? (
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Đang tải vật tư...</div>
                ) : items.length === 0 ? (
                  <EmptyState icon={<CheckCircle2 />} title="PO đã nhận đủ" description="PO này đã nhận đủ tất cả vật tư." />
                ) : (
                  <>
                    <div className="dt-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Vật tư</th><th>SL Đặt</th><th>Còn lại</th><th>SL Nhận</th>
                            <th>Heat No.</th><th>Lot No.</th><th>Mill Cert</th><th>Ghi chú</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, idx) => (
                            <tr key={item.poItemId}>
                              <td className="text-xs">{item.materialName}</td>
                              <td><span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{item.orderedQty} {item.unit}</span></td>
                              <td><span className="font-mono text-xs font-bold">{item.maxQty} {item.unit}</span></td>
                              <td>
                                <input type="number" min={0} max={item.maxQty} value={item.receivedQty || ''}
                                  onChange={e => updateItem(poId, idx, 'receivedQty', Math.min(Number(e.target.value), item.maxQty))}
                                  className="input font-mono" style={{ width: '80px', padding: '4px 8px', fontSize: '0.8rem' }} />
                              </td>
                              <td>
                                <input type="text" value={item.heatNumber} placeholder={item.isConsumable ? 'Heat' : 'Heat *'}
                                  onChange={e => updateItem(poId, idx, 'heatNumber', e.target.value)}
                                  className="input font-mono" style={{ width: '90px', padding: '4px 8px', fontSize: '0.8rem', borderColor: (!item.isConsumable && item.receivedQty > 0 && !item.heatNumber.trim()) ? 'var(--danger)' : undefined }} />
                              </td>
                              <td>
                                <input type="text" value={item.lotNumber} placeholder={item.isConsumable ? 'Lot' : 'Lot *'}
                                  onChange={e => updateItem(poId, idx, 'lotNumber', e.target.value)}
                                  className="input font-mono" style={{ width: '90px', padding: '4px 8px', fontSize: '0.8rem', borderColor: (!item.isConsumable && item.receivedQty > 0 && !item.lotNumber.trim()) ? 'var(--danger)' : undefined }} />
                              </td>
                              <td>
                                <select value={item.millCertificateId} onChange={e => updateItem(poId, idx, 'millCertificateId', e.target.value)}
                                  className="input font-mono" style={{ width: '140px', padding: '4px 8px', fontSize: '0.8rem' }}>
                                  <option value="">— Không —</option>
                                  {certs.map(c => (<option key={c.id} value={c.id}>{c.certNumber} (Heat {c.heatNumber})</option>))}
                                </select>
                              </td>
                              <td>
                                <input type="text" value={item.notes} placeholder="Ghi chú"
                                  onChange={e => updateItem(poId, idx, 'notes', e.target.value)}
                                  className="input" style={{ width: '120px', padding: '4px 8px', fontSize: '0.8rem' }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)' }}>
                      <MultiFileUpload
                        label={items.some(i => !i.isConsumable)
                          ? `📎 Hồ sơ Heat / Lot / Mill Cert (BẮT BUỘC) — ${poCode}`
                          : `📎 Hồ sơ đính kèm (tiêu hao — không bắt buộc) — ${poCode}`}
                        entityType="GRN"
                        entityId={poId}
                        accept={GRN_DOC_ACCEPT}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Modal>

      {/* Lịch sử hàng về — gộp theo PO, bấm để xổ danh sách vật tư */}
      <div className="dt-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '32px' }}></th>
              <th>PO</th>
              <th>Số vật tư</th>
              <th>Tổng SL</th>
              <th>Ngày gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {groupedReceipts.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={<Package />} title="Chưa có hàng về" description="Chưa ghi nhận PO nào hàng về" />
                </td>
              </tr>
            ) : groupedReceipts.map(g => {
              const open = expandedPOs.has(g.poCode)
              return (
                <Fragment key={g.poCode}>
                  <tr onClick={() => togglePO(g.poCode)} style={{ cursor: 'pointer' }} className="hover:bg-slate-50 transition-colors">
                    <td style={{ textAlign: 'center' }}>
                      {open ? <ChevronDown size={16} stroke="var(--text-muted)" /> : <ChevronRight size={16} stroke="var(--text-muted)" />}
                    </td>
                    <td>
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{g.poCode}</span>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.lines.length} vật tư</td>
                    <td>
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--success)' }}>{formatNumber(g.totalQty)}</span>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(g.latestDate)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Vật tư</th>
                              <th>SL</th>
                              <th>ĐVT</th>
                              <th>Heat No.</th>
                              <th>Lot No.</th>
                              <th>Ghi chú</th>
                              <th>Ngày</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lines.map(r => (
                              <tr key={r.id}>
                                <td className="text-xs" style={{ color: 'var(--text-primary)' }}>
                                  {r.material ? `${r.material.materialCode} — ${r.material.name}` : '—'}
                                </td>
                                <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--success)' }}>{formatNumber(r.quantity)}</span></td>
                                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.material?.unit || '—'}</td>
                                <td><span className="font-mono text-xs" style={{ color: 'var(--info)' }}>{r.heatNumber || '—'}</span></td>
                                <td><span className="font-mono text-xs" style={{ color: 'var(--warning)' }}>{r.lotNumber || '—'}</span></td>
                                <td className="text-xs max-w-32 truncate" style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(r.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
