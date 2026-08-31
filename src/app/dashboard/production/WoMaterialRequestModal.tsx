'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { Button, Modal } from '@/components/ui'
import { formatNumber } from '@/lib/utils'
import QuickCreateMaterialDialog, { type PickedMaterial } from '@/app/dashboard/tasks/[id]/components/QuickCreateMaterialDialog'
import { confirmDialog } from '@/components/ui/Toast'
import { MR_EDITABLE, MR_STATUS_LABEL as MR_LABEL } from '@/lib/wo-materials-constants'

// Xưởng lập ĐỀ NGHỊ CẤP VẬT TƯ cho một hoặc NHIỀU lệnh sản xuất cùng lúc.
//
// Hai chế độ xem trên CÙNG một dữ liệu (đổi qua lại không mất số đã nhập):
//   • Thu gọn (mặc định): mỗi vật tư MỘT ô nhập + cách áp cho các lệnh
//       - "Theo BOM": mỗi lệnh lấy đúng định mức piece-mark của chính nó (máy điền, khỏi gõ)
//       - "Mỗi lệnh": gõ 1 số, lệnh nào cũng nhận đúng số đó (hợp vật tư tiêu hao)
//       - "Chia đều": gõ tổng, chia cho các lệnh đã chọn
//     Cột cuối hiện phân bổ ra từng lệnh để soát.
//   • Bảng đầy đủ: ma trận vật tư × lệnh, sửa tay từng ô — dùng khi cần cân theo tồn kho.
//
// Lưu xong hệ ghi đề nghị RIÊNG cho từng WO ⟹ Kho vẫn nhận mỗi lệnh một phiếu.

type Mode = 'BOM' | 'EACH' | 'SPLIT' | 'MANUAL'

interface WoInfo {
  id: string; woCode: string; description: string; status: string; teamCode: string
  pieceMark: string | null; plannedWeight: number | null
  project: { projectCode: string; projectName: string }
}
interface BomRow {
  materialId: string; materialCode: string; name: string; specification: string | null
  unit: string; currentStock: number; perWo: Record<string, number>
}
interface PrRow {
  key: string; materialId: string | null; materialCode: string; name: string
  specification: string | null; unit: string; currentStock: number; prQuantity: number; needsCode: boolean
}
interface AplRow {
  key: string; materialId: string | null; materialCode: string; name: string
  specification: string | null; unit: string; currentStock: number
  perWo: Record<string, number>; needsCode: boolean; via: string | null
  available: number; state: 'READY' | 'WAITING' | 'NO_CODE'
}
interface ExistingLine { materialId: string; materialCode: string; name: string; unit: string; requested: number; issued: number }

interface DraftRow {
  materialId: string
  materialCode: string
  name: string
  unit: string
  currentStock: number
  origin: 'BOM' | 'PR' | 'MANUAL'
  bomPerWo: Record<string, number>   // định mức BOM của từng WO (rỗng nếu không có trong BOM)
  mode: Mode
  input: string                       // số nhập ở chế độ EACH/SPLIT
  perWo: Record<string, number>       // phân bổ thực tế — nguồn sự thật khi lưu
  issued: Record<string, number>      // đã cấp theo từng WO (không cho hạ thấp hơn)
}

const MODE_LABEL: Record<Mode, string> = {
  BOM: 'Theo BOM', EACH: 'Mỗi lệnh', SPLIT: 'Chia đều', MANUAL: 'Sửa tay',
}

/** Tính lại phân bổ theo cách áp đang chọn. MANUAL giữ nguyên số người đã sửa. */
function recalc(row: DraftRow, woIds: string[]): DraftRow {
  const val = Number(row.input) || 0
  if (row.mode === 'BOM') return { ...row, perWo: Object.fromEntries(woIds.map(id => [id, row.bomPerWo[id] || 0])) }
  if (row.mode === 'EACH') return { ...row, perWo: Object.fromEntries(woIds.map(id => [id, val])) }
  if (row.mode === 'SPLIT') {
    const each = woIds.length ? Math.round((val / woIds.length) * 100) / 100 : 0
    return { ...row, perWo: Object.fromEntries(woIds.map(id => [id, each])) }
  }
  return row
}

export default function WoMaterialRequestModal({ woIds, onClose, onSaved }: {
  woIds: string[]; onClose: () => void; onSaved?: () => void
}) {
  const [wos, setWos] = useState<WoInfo[]>([])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [bom, setBom] = useState<BomRow[]>([])
  const [pr, setPr] = useState<PrRow[]>([])
  const [apl, setApl] = useState<AplRow[]>([])
  const [canEdit, setCanEdit] = useState(true)
  const [outOfScope, setOutOfScope] = useState<string[]>([])
  const [order, setOrder] = useState<{ id: string; code: string; status: string; rejectReason: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [matrix, setMatrix] = useState(false)
  const [showPicker, setShowPicker] = useState<PrRow | 'new' | null>(null)

  const ids = useMemo(() => wos.map(w => w.id), [wos])

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/production/material-requests?woIds=${woIds.join(',')}`)
    if (!r.ok) { notify(r.error || 'Không tải được dữ liệu vật tư', 'error'); setLoading(false); return }
    const list: WoInfo[] = r.workOrders || []
    const bomRows: BomRow[] = r.bom || []
    const existing: Record<string, ExistingLine[]> = r.existing || {}
    setWos(list); setBom(bomRows); setPr(r.pr || []); setApl(r.apl || [])
    setCanEdit(r.canEdit !== false); setOutOfScope(r.outOfScope || []); setOrder(r.order || null)

    // Dựng sẵn danh mục: ưu tiên những gì ĐÃ lập; chưa có gì thì lấy trọn gợi ý BOM.
    const woIdList = list.map(w => w.id)
    const draft = new Map<string, DraftRow>()
    const bomById = new Map(bomRows.map(b => [b.materialId, b]))

    for (const [woId, lines] of Object.entries(existing)) {
      for (const l of lines) {
        const b = bomById.get(l.materialId)
        const row = draft.get(l.materialId) || {
          materialId: l.materialId, materialCode: l.materialCode, name: l.name, unit: l.unit,
          currentStock: b?.currentStock ?? 0, origin: b ? 'BOM' : 'MANUAL',
          bomPerWo: b?.perWo || {}, mode: 'MANUAL' as Mode, input: '',
          perWo: Object.fromEntries(woIdList.map(id => [id, 0])),
          issued: Object.fromEntries(woIdList.map(id => [id, 0])),
        }
        row.perWo[woId] = l.requested
        row.issued[woId] = l.issued
        draft.set(l.materialId, row)
      }
    }
    if (draft.size === 0) {
      for (const b of bomRows) {
        draft.set(b.materialId, recalc({
          materialId: b.materialId, materialCode: b.materialCode, name: b.name, unit: b.unit,
          currentStock: b.currentStock, origin: 'BOM', bomPerWo: b.perWo, mode: 'BOM', input: '',
          perWo: {}, issued: Object.fromEntries(woIdList.map(id => [id, 0])),
        }, woIdList))
      }
    }
    setRows([...draft.values()])
    setLoading(false)
  }, [woIds])

  useEffect(() => { void load() }, [load])

  const setRow = (materialId: string, patch: Partial<DraftRow>) =>
    setRows(rs => rs.map(r => (r.materialId === materialId ? recalc({ ...r, ...patch }, ids) : r)))

  const setCell = (materialId: string, woId: string, value: string) =>
    setRows(rs => rs.map(r => (r.materialId === materialId
      ? { ...r, mode: 'MANUAL' as Mode, perWo: { ...r.perWo, [woId]: Number(value) || 0 } }
      : r)))

  const addRow = (m: { materialId: string; materialCode: string; name: string; unit: string; currentStock?: number; origin: DraftRow['origin']; bomPerWo?: Record<string, number> }) => {
    setRows(rs => {
      if (rs.some(r => r.materialId === m.materialId)) { notify(`${m.materialCode} đã có trong danh mục`, 'error'); return rs }
      const base: DraftRow = {
        materialId: m.materialId, materialCode: m.materialCode, name: m.name, unit: m.unit,
        currentStock: m.currentStock ?? 0, origin: m.origin, bomPerWo: m.bomPerWo || {},
        mode: m.bomPerWo && Object.keys(m.bomPerWo).length ? 'BOM' : 'EACH', input: '',
        perWo: {}, issued: Object.fromEntries(ids.map(id => [id, 0])),
      }
      return [...rs, recalc(base, ids)]
    })
  }

  // submit=false → lưu nháp (sửa tiếp được); submit=true → gửi PM duyệt, khoá sửa.
  const save = async (submit: boolean) => {
    const allocations: Record<string, { materialId: string; quantity: number; unit: string; source: string }[]> = {}
    for (const id of ids) {
      allocations[id] = rows
        .map(r => ({ materialId: r.materialId, quantity: r.perWo[id] || 0, unit: r.unit, source: r.origin === 'BOM' ? 'BOM' : 'MANUAL' }))
        .filter(x => x.quantity > 0)
    }
    if (submit) {
      const totalLines = Object.values(allocations).reduce((s, l) => s + l.length, 0)
      if (totalLines === 0) { notify('Chưa có vật tư nào để gửi duyệt', 'error'); return }
      if (!await confirmDialog(`Gửi duyệt phiếu cho ${ids.length} lệnh (${totalLines} dòng vật tư)?\n\nPhiếu qua PM phụ trách dự án rồi tới BGĐ. Duyệt xong Kho mới cấp được, và bạn không sửa được nữa cho tới khi bị trả lại.`)) return
    }
    setSaving(true)
    const r = await apiFetch('/api/production/material-requests', {
      method: 'POST',
      body: JSON.stringify({ allocations, submit, requestId: order?.id }),
    })
    setSaving(false)
    // LỖI  → giữ nguyên modal để người dùng sửa tiếp; thông báo nổi đè lên modal.
    // XONG → đóng modal TRƯỚC rồi mới báo, để thông báo không bị lớp phủ che.
    if (!r.ok) { notify(r.error || 'Lỗi lưu đề nghị', 'error'); return }
    onClose()
    onSaved?.()
    notify(r.message || 'Đã lưu', 'success')
  }

  // Sửa được khi: đúng vai xưởng, mọi lệnh thuộc xưởng mình, và phiếu chưa gửi (hoặc bị trả lại).
  const editable = !loading && canEdit && outOfScope.length === 0 && (!order || MR_EDITABLE.includes(order.status))

  const woLabel = (w: WoInfo) => `${w.pieceMark || w.woCode} · ${w.teamCode || 'Thầu phụ'}`
  const usedIds = new Set(rows.map(r => r.materialId))
  const bomLeft = bom.filter(b => !usedIds.has(b.materialId))
  const prLeft = pr.filter(p => !p.materialId || !usedIds.has(p.materialId))
  // Dòng CHƯA CÓ MÃ vẫn hiện để biết còn thiếu gì, nhưng không lấy vào phiếu được.
  const aplLeft = apl.filter(a => !a.materialId || !usedIds.has(a.materialId))
  const aplReady = aplLeft.filter(a => a.state === 'READY')
  const aplMissing = aplLeft.filter(a => a.state !== 'READY')

  return (
    <Modal open onClose={onClose} size="lg" overlayZIndex={10050}
      title={`Đề nghị cấp vật tư — ${woIds.length} lệnh sản xuất`}>
      <div className="space-y-4">
        {loading ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Đang tải…</p> : (
          <>
            {/* Các lệnh đang lập */}
            <div className="flex flex-wrap gap-2 items-center">
              {wos.map(w => (
                <span key={w.id} className="badge" style={{ background: 'var(--bg-secondary)', fontSize: '0.72rem' }}>
                  {woLabel(w)}{w.plannedWeight ? ` · ${formatNumber(w.plannedWeight)} kg` : ''}
                </span>
              ))}
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {wos[0]?.project.projectCode}</span>
            </div>

            {!canEdit && (
              <div className="text-xs rounded-lg p-3" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                Chỉ Xưởng sản xuất (quản đốc / nhân viên / tổ trưởng) mới lập được đề nghị. Bạn đang xem ở chế độ chỉ đọc.
              </div>
            )}
            {order && (
              <div className="text-xs rounded-lg p-3" style={{
                background: order.status === 'REJECTED' ? '#fef2f2' : 'var(--bg-secondary)',
                border: `1px solid ${order.status === 'REJECTED' ? '#fecaca' : 'var(--border)'}`,
                color: order.status === 'REJECTED' ? '#991b1b' : 'var(--text-secondary)',
              }}>
                Phiếu <b>{order.code}</b> — {MR_LABEL[order.status] || order.status}
                {order.status === 'REJECTED' && order.rejectReason && <> · Lý do trả lại: <b>{order.rejectReason}</b>. Sửa rồi gửi duyệt lại.</>}
              </div>
            )}
            {outOfScope.length > 0 && (
              <div className="text-xs rounded-lg p-3" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                Lệnh thuộc xưởng khác, không lập hộ được: <b>{outOfScope.join(', ')}</b>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-sm font-semibold">Danh mục vật tư ({rows.length})</h4>
              <Button variant="outline" size="sm" onClick={() => setMatrix(m => !m)}>
                {matrix ? '← Xem thu gọn' : 'Xem dạng bảng đầy đủ →'}
              </Button>
            </div>

            {/* ── Bảng chính ── */}
            <div className="card overflow-x-auto">
              {rows.length === 0 ? (
                <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  Chưa có vật tư nào — lấy từ gợi ý bên dưới.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    {matrix ? (
                      <tr>
                        <th>Mã VT</th><th>Tên</th><th className="text-right">Tồn kho</th>
                        {wos.map(w => <th key={w.id} className="text-right" style={{ whiteSpace: 'nowrap' }}>{woLabel(w)}</th>)}
                        <th className="text-right">Tổng</th><th />
                      </tr>
                    ) : (
                      <tr>
                        <th>Mã VT</th><th>Tên</th><th className="text-right">Tồn kho</th>
                        <th>Cách áp</th><th className="text-right">Số lượng</th><th>Phân bổ từng lệnh</th><th />
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const total = ids.reduce((s, id) => s + (r.perWo[id] || 0), 0)
                      const overStock = total > r.currentStock
                      return (
                        <tr key={r.materialId}>
                          <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
                            {r.materialCode}
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{r.origin === 'BOM' ? 'BOM' : r.origin === 'PR' ? 'PR' : 'thêm tay'}</div>
                          </td>
                          <td className="text-xs">{r.name}</td>
                          <td className="text-right text-xs" style={{ color: r.currentStock > 0 ? '#16a34a' : '#dc2626' }}>{formatNumber(r.currentStock)}</td>

                          {matrix ? (
                            <>
                              {ids.map(id => (
                                <td key={id} className="text-right">
                                  <input type="number" min="0" className="input" disabled={!editable}
                                    value={r.perWo[id] ?? 0} onChange={e => setCell(r.materialId, id, e.target.value)}
                                    style={{ width: 92, textAlign: 'right', padding: '3px 6px', fontSize: '0.8rem' }} />
                                  {r.issued[id] > 0 && <div style={{ fontSize: '0.6rem', color: '#0ea5e9' }}>đã cấp {formatNumber(r.issued[id])}</div>}
                                </td>
                              ))}
                              <td className="text-right text-xs" style={{ fontWeight: 700, color: overStock ? '#b45309' : undefined }}>{formatNumber(total)} {r.unit}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <select className="input" disabled={!editable} value={r.mode}
                                  onChange={e => setRow(r.materialId, { mode: e.target.value as Mode })}
                                  style={{ fontSize: '0.78rem', padding: '3px 6px', width: 108 }}>
                                  {Object.keys(r.bomPerWo).length > 0 && <option value="BOM">{MODE_LABEL.BOM}</option>}
                                  <option value="EACH">{MODE_LABEL.EACH}</option>
                                  <option value="SPLIT">{MODE_LABEL.SPLIT}</option>
                                  <option value="MANUAL">{MODE_LABEL.MANUAL}</option>
                                </select>
                              </td>
                              <td className="text-right">
                                {r.mode === 'BOM' ? (
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>theo định mức</span>
                                ) : r.mode === 'MANUAL' ? (
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>sửa ở bảng đầy đủ</span>
                                ) : (
                                  <input type="number" min="0" className="input" disabled={!editable}
                                    value={r.input} onChange={e => setRow(r.materialId, { input: e.target.value })}
                                    style={{ width: 100, textAlign: 'right', padding: '4px 8px', fontSize: '0.82rem' }} />
                                )}
                              </td>
                              <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {ids.map(id => formatNumber(r.perWo[id] || 0)).join(' · ')}
                                <b style={{ marginLeft: 8, color: overStock ? '#b45309' : 'var(--text-primary)' }}>= {formatNumber(total)} {r.unit}</b>
                                {overStock && <span style={{ color: '#b45309' }}> (vượt tồn)</span>}
                              </td>
                            </>
                          )}

                          <td className="text-right">
                            {ids.some(id => (r.issued[id] || 0) > 0)
                              ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}>khoá</span>
                              : canEdit && <button type="button" onClick={() => setRows(rs => rs.filter(x => x.materialId !== r.materialId))}
                                  style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>×</button>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Gợi ý ── */}
            {editable && (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                {/* Vật tư của lệnh, chia HAI BÊN theo tình trạng kho.
                    SẴN SÀNG = có mã kho và còn tồn khả dụng → lấy vào phiếu rồi gửi duyệt.
                    CHƯA CÓ  = hết hàng (chờ Thương mại mua, Kho nhập xong TỰ chuyển sang sẵn
                               sàng vì phân loại theo tồn ngay lúc mở) hoặc kho chưa có mã.
                    Xưởng KHÔNG có quyền tạo mã (MATERIAL_CODE_ADMIN không gồm R06*), nên ở đây
                    chỉ nhắc báo Kho/Thương mại — báo miệng, chưa nối vào hệ thống. */}
                {apl.length > 0 && (
                  <div className="card overflow-hidden" style={{ borderColor: '#a7f3d0' }}>
                    <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', background: '#ecfdf5' }}>
                      <h4 className="text-sm font-semibold" style={{ color: '#047857' }}>Vật tư sẵn sàng ({aplReady.length})</h4>
                      {aplReady.length > 0 && <Button variant="outline" size="sm"
                        onClick={() => aplReady.forEach(a => addRow({ ...a, materialId: a.materialId!, origin: 'BOM', bomPerWo: a.perWo }))}>Lấy tất cả</Button>}
                    </div>
                    <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                      {aplReady.length === 0 ? <p className="text-xs p-3 text-center" style={{ color: 'var(--text-muted)' }}>{apl.some(x => x.state === 'READY') ? 'Đã lấy hết.' : 'Chưa có vật tư nào sẵn trong kho.'}</p> : (
                        <table className="data-table">
                          <tbody>
                            {aplReady.map(a => {
                              const need = Object.values(a.perWo).reduce((s, v) => s + v, 0)
                              return (
                                <tr key={a.key}>
                                  <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{a.materialCode}</td>
                                  <td className="text-xs">
                                    {a.specification}
                                    {a.via === 'history' && <span className="text-[10px] block" style={{ color: '#0369a1' }}>khớp từ PR/BOM cũ</span>}
                                    {a.via === 'alias' && <span className="text-[10px] block" style={{ color: '#047857' }}>đã chỉ tay</span>}
                                  </td>
                                  <td className="text-xs text-right">
                                    {formatNumber(Math.round(need))} {a.unit}
                                    <span className="text-[10px] block" style={{ color: a.available >= need ? '#047857' : '#b45309' }}>
                                      kho có {formatNumber(Math.round(a.available))}
                                    </span>
                                  </td>
                                  <td className="text-right"><Button variant="outline" size="sm"
                                    onClick={() => addRow({ ...a, materialId: a.materialId!, origin: 'BOM', bomPerWo: a.perWo })}>Lấy</Button></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                {aplMissing.length > 0 && (
                  <div className="card overflow-hidden" style={{ borderColor: '#fde68a' }}>
                    <div className="p-3" style={{ borderBottom: '1px solid var(--border)', background: '#fffbeb' }}>
                      <h4 className="text-sm font-semibold" style={{ color: '#92400e' }}>Vật tư chưa có ({aplMissing.length})</h4>
                      <p className="text-[11px] mt-0.5" style={{ color: '#92400e' }}>
                        Mua hàng xong và Kho nhập kho xong thì tự chuyển sang bên sẵn sàng.
                      </p>
                    </div>
                    <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                      <table className="data-table">
                        <tbody>
                          {aplMissing.map(a => (
                            <tr key={a.key}>
                              <td className="font-mono text-xs" style={{ color: a.state === 'NO_CODE' ? '#b45309' : 'var(--accent)' }}>{a.materialCode}</td>
                              <td className="text-xs">
                                {a.specification}
                                <span className="text-[10px] block" style={{ color: '#92400e' }}>
                                  {a.state === 'NO_CODE' ? 'kho chưa có mã — báo Kho / Thương mại lập mã' : 'hết hàng — chờ mua'}
                                </span>
                              </td>
                              <td className="text-xs text-right">{formatNumber(Math.round(Object.values(a.perWo).reduce((s, v) => s + v, 0)))} {a.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="card overflow-hidden">
                  <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                    <h4 className="text-sm font-semibold">Từ BOM ({bomLeft.length})</h4>
                    {bomLeft.length > 0 && <Button variant="outline" size="sm"
                      onClick={() => bomLeft.forEach(b => addRow({ ...b, origin: 'BOM', bomPerWo: b.perWo }))}>Lấy tất cả</Button>}
                  </div>
                  <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                    {bomLeft.length === 0 ? <p className="text-xs p-3 text-center" style={{ color: 'var(--text-muted)' }}>Đã lấy hết.</p> : (
                      <table className="data-table">
                        <tbody>
                          {bomLeft.map(b => (
                            <tr key={b.materialId}>
                              <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{b.materialCode}</td>
                              <td className="text-xs">{b.name}</td>
                              <td className="text-xs text-right">{formatNumber(Object.values(b.perWo).reduce((s, v) => s + v, 0))} {b.unit}</td>
                              <td className="text-right"><Button variant="outline" size="sm" onClick={() => addRow({ ...b, origin: 'BOM', bomPerWo: b.perWo })}>Lấy</Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="card overflow-hidden">
                  <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                    <h4 className="text-sm font-semibold">Từ PR của dự án ({prLeft.length})</h4>
                    <Button variant="outline" size="sm" onClick={() => setShowPicker('new')}>+ Vật tư khác</Button>
                  </div>
                  <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                    {prLeft.length === 0 ? <p className="text-xs p-3 text-center" style={{ color: 'var(--text-muted)' }}>Không có dòng PR nào khác.</p> : (
                      <table className="data-table">
                        <tbody>
                          {prLeft.map(p => (
                            <tr key={p.key}>
                              <td className="font-mono text-xs" style={{ color: p.needsCode ? '#b45309' : 'var(--accent)' }}>{p.materialCode}</td>
                              <td className="text-xs">{p.name}</td>
                              <td className="text-xs text-right">{formatNumber(p.prQuantity)} {p.unit}</td>
                              <td className="text-right">
                                {p.needsCode ? (
                                  /* Xưởng KHÔNG nằm trong MATERIAL_CODE_ADMIN → không hiện nút tạo mã,
                                     chỉ nhắc báo Kho/Thương mại. */
                                  <span className="text-[11px]" style={{ color: '#b45309' }}>báo Kho/TM lập mã</span>
                                ) : (
                                  <Button variant="outline" size="sm"
                                    onClick={() => addRow({ materialId: p.materialId!, materialCode: p.materialCode, name: p.name, unit: p.unit, currentStock: p.currentStock, origin: 'PR' })}>Lấy</Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end items-center gap-2 flex-wrap">
          {order && !MR_EDITABLE.includes(order.status) && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Phiếu {order.code} đang <b>{MR_LABEL[order.status] || order.status}</b> — chỉ xem
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          <Button variant="outline" onClick={() => save(false)} loading={saving} disabled={!editable}>Lưu nháp</Button>
          <Button variant="primary" onClick={() => save(true)} loading={saving} disabled={!editable}>
            Gửi duyệt ({woIds.length} lệnh)
          </Button>
        </div>
      </div>

      {showPicker && (
        <QuickCreateMaterialDialog
          open
          initialName={showPicker === 'new' ? '' : showPicker.name}
          initialUnit={showPicker === 'new' ? '' : showPicker.unit}
          initialSpec={showPicker === 'new' ? '' : (showPicker.specification || '')}
          onClose={() => setShowPicker(null)}
          onPicked={(m: PickedMaterial) => {
            addRow({ materialId: m.id, materialCode: m.materialCode, name: m.name, unit: m.unit, origin: showPicker === 'new' ? 'MANUAL' : 'PR' })
            setShowPicker(null)
          }}
        />
      )}
    </Modal>
  )
}
