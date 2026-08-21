'use client'

import { useState, Fragment, type CSSProperties } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { Modal, Button, SelectField } from '@/components/ui'
import { formatNumber } from '@/lib/utils'
import { WBS_STAGES, WBS_STAGE_LABEL, woCodeFor, pieceMarkFor, unitTagForRow, allocTags, readAlloc, stageBaseQty, stageUnit } from '@/lib/wbs-wo'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

interface ProjectOption { id: string; projectCode: string; projectName: string }
type Row = Record<string, string>
// wTouched: người dùng có TỰ GÕ khối lượng không. Khi phát hành cho nhiều ô, ô không phải ô đang
// hiện sẽ bỏ qua khối lượng điền sẵn (của ô kia) và dùng khối lượng của chính nó — trừ khi bị gõ đè.
type AllocRow = { teamCode: string; isSub: boolean; weight: string; start: string; finish: string; wTouched?: boolean }
const WORKSHOP_CODES = PRODUCTION_WORKSHOPS.map(w => w.code)
// Nhãn hiển thị ô: ưu tiên giá trị gốc từ file (raw, VD "XHAN"/"N/A"); else theo mã xưởng đã chuẩn hoá.
const allocLabel = (a: { teamCode: string; isSub: boolean; raw?: string }) => (a.raw ? a.raw : (a.teamCode ? (a.isSub ? `${a.teamCode} TP` : a.teamCode) : 'Thầu phụ'))

export default function WoFromWbsModal({ open, projects, onClose, onIssued }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onIssued: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [projectCode, setProjectCode] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [issued, setIssued] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  // Chọn NHIỀU ô công đoạn để phát hành một lượt. Bấm ô = chọn, bấm lại = bỏ chọn.
  // `sels` = các ô đang chọn (tô xám). `sel` = ô VỪA BẤM — panel dưới luôn hiện thông tin ô này.
  const [sels, setSels] = useState<{ ri: number; key: string }[]>([])
  const [sel, setSel] = useState<{ ri: number; key: string } | null>(null)
  const [edit, setEdit] = useState<AllocRow[] | null>(null)
  const [issuing, setIssuing] = useState(false)

  const isSelected = (ri: number, key: string) => sels.some(s => s.ri === ri && s.key === key)

  const reset = () => { setProjectId(''); setProjectCode(''); setRows([]); setIssued(new Set()); setViewOpen(false); setSels([]); setEdit(null) }
  const close = () => { reset(); onClose() }

  /** Phân giao đã lưu của 1 ô → dạng dòng sửa được. */
  const allocRowsOf = (ri: number, key: string): AllocRow[] => {
    const row = rows[ri] || {}
    const list = readAlloc(row, key)
    return list.length
      ? list.map(a => ({ teamCode: WORKSHOP_CODES.includes(a.teamCode) ? a.teamCode : '', isSub: a.isSub, weight: a.weight, start: String(a.start || '').slice(0, 10), finish: String(a.finish || '').slice(0, 10) }))
      : [{ teamCode: '', isSub: false, weight: stageBaseQty(row, key).value, start: '', finish: '' }]
  }

  // Bấm ô:
  //  • Ô chưa chọn  → thêm vào danh sách chọn VÀ hiện thông tin của chính ô đó ở panel dưới.
  //  • Ô đang chọn  → bỏ chọn (mất màu xám). Panel không nhảy về ô vừa bỏ; nếu ô đó đang hiện
  //    thì chuyển sang ô còn lại được bấm gần nhất, hết ô thì đóng panel.
  const selectCell = (ri: number, key: string) => {
    const exists = isSelected(ri, key)
    if (exists) {
      const next = sels.filter(s => !(s.ri === ri && s.key === key))
      setSels(next)
      if (sel?.ri === ri && sel?.key === key) {
        const fallback = next[next.length - 1] || null
        setSel(fallback)
        setEdit(fallback ? allocRowsOf(fallback.ri, fallback.key) : null)
      }
      return
    }
    setSels([...sels, { ri, key }])
    setSel({ ri, key })
    setEdit(allocRowsOf(ri, key))
  }

  const pickProject = async (id: string) => {
    setProjectId(id); setRows([]); setSels([]); setEdit(null)
    if (!id) return
    setLoading(true)
    const r = await apiFetch(`/api/production/wbs?projectId=${id}`)
    setLoading(false)
    if (r.ok) { setRows(Array.isArray(r.rows) ? r.rows : []); setProjectCode(r.projectCode || ''); applyIssued(r) }
    else notify(r.error || 'Lỗi tải WBS', 'error')
  }

  // Thông tin 1 ô công đoạn: danh sách phân giao + trạng thái phát hành từng xưởng
  const cellInfo = (ri: number, key: string) => {
    const row = rows[ri] || {}
    const hangMuc = String(row.hangMuc || `Dòng ${ri + 1}`).trim()
    const unitTag = unitTagForRow(rows, ri)
    const stt = String(row.stt || '').trim()
    const pieceMark = pieceMarkFor(hangMuc, unitTag)
    const list = readAlloc(row, key)
    const tags = allocTags(list)
    const allocs = list.map((a, i) => {
      const wc = woCodeFor(projectCode, hangMuc, key, unitTag, stt, tags[i])
      return { ...a, klShow: String(a.weight || '').trim() || stageBaseQty(row, key).value, unit: stageUnit(key), woCode: wc, done: issued.has(wc) }
    })
    return { hangMuc, pieceMark, stageLabel: WBS_STAGE_LABEL[key] || key, allocs, anyIssued: allocs.some(a => a.done), allIssued: allocs.length > 0 && allocs.every(a => a.done) }
  }

  // Nạp trạng thái phát hành + id WO từ một phản hồi /api/production/wbs.
  // (Đề nghị cấp vật tư giờ làm ở DANH SÁCH LỆNH SẢN XUẤT — xưởng phụ trách, không phải ở đây.)
  const applyIssued = (r: { issuedWoCodes?: string[]; issuedWos?: { id: string; woCode: string }[] }) => {
    setIssued(new Set(r.issuedWoCodes || []))

  }

  const reloadWbs = async () => {
    const wbs = await apiFetch(`/api/production/wbs?projectId=${projectId}`)
    if (wbs.ok) { setRows(Array.isArray(wbs.rows) ? wbs.rows : []); applyIssued(wbs) }
  }

  // Áp danh sách phân giao xưởng → mỗi xưởng 1 WO (tạo/cập nhật + xóa xưởng đã bỏ).
  // Chọn nhiều ô thì áp CÙNG một phân giao cho từng ô; KL để trống → mỗi ô dùng KL của chính nó.
  const applyWo = async () => {
    if (sels.length === 0 || !edit) return
    const clean = edit.filter(a => a.teamCode || a.isSub)
    if (clean.length === 0) { notify('Chọn ít nhất 1 xưởng (hoặc đánh dấu Thầu phụ)', 'error'); return }

    setIssuing(true)
    const fails: string[] = []
    let done = 0
    for (const s of sels) {
      // Ô đang hiện dùng đúng khối lượng trên form. Ô khác: chỉ nhận khối lượng nếu người dùng
      // tự gõ; không thì để trống để máy chủ lấy khối lượng của chính ô đó.
      const isFocused = sel?.ri === s.ri && sel?.key === s.key
      const payload = clean.map(a => ({
        teamCode: a.teamCode, isSub: a.isSub, start: a.start, finish: a.finish,
        weight: isFocused || a.wTouched ? a.weight : '',
      }))
      const r = await apiFetch('/api/production/work-orders/from-wbs-cell', {
        method: 'POST',
        body: JSON.stringify({ projectId, rowIndex: s.ri, stageKey: s.key, allocations: payload }),
      })
      if (r.ok) done++
      else fails.push(`${rows[s.ri]?.hangMuc || `Dòng ${s.ri + 1}`} · ${WBS_STAGE_LABEL[s.key] || s.key}: ${r.error || 'lỗi'}`)
    }
    setIssuing(false)

    if (done > 0) notify(`✓ Đã phát hành WO cho ${done}/${sels.length} ô công đoạn`, 'success')
    if (fails.length > 0) notify(fails.join(' — '), 'error')
    if (done > 0) { setSels([]); setEdit(null); await reloadWbs(); onIssued() }
  }

  // Xóa TẤT CẢ WO của ô đang chọn → ô mở lại (chặn nếu đã có SX phía server)
  const deleteWo = async () => {
    if (!sel) return
    if (!await confirmDialog('Xóa tất cả WO của ô này? Ô sẽ mở lại để phát hành lại.')) return
    setIssuing(true)
    const r = await apiFetch('/api/production/work-orders/from-wbs-cell', { method: 'DELETE', body: JSON.stringify({ projectId, rowIndex: sel.ri, stageKey: sel.key }) })
    setIssuing(false)
    if (r.ok) { notify(r.message || 'Đã xóa WO', 'success'); setSels([]); setEdit(null); await reloadWbs(); onIssued() }
    else notify(r.error || 'Lỗi xóa WO', 'error')
  }

  // thao tác dòng phân giao
  const setAlloc = (i: number, patch: Partial<AllocRow>) => setEdit(e => (e ? e.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) : e))
  const addAlloc = () => setEdit(e => [...(e || []), { teamCode: '', isSub: false, weight: '', start: '', finish: '' }])
  const removeAlloc = (i: number) => setEdit(e => (e && e.length > 1 ? e.filter((_, idx) => idx !== i) : e))

  const info = sel ? cellInfo(sel.ri, sel.key) : null
  const selUnit = sel ? stageUnit(sel.key) : 'kg'

  return (
    <>
      <Modal open={open} onClose={close} title="Tạo WO từ WBS" size="md">
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Chọn dự án → xem WBS đã import → bấm vào ô công đoạn (xưởng) để chọn; bấm lại để bỏ chọn.
            Chọn được nhiều ô rồi phát hành lệnh sản xuất (WO) một lượt.
          </p>
          <SelectField label="Dự án *" value={projectId} onChange={e => pickProject(e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
          {loading && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Đang tải WBS…</p>}
          {projectId && !loading && (
            rows.length > 0
              ? <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Đã có <b>{rows.length}</b> hạng mục WBS · {WBS_STAGES.length} công đoạn</span>
                  <Button variant="primary" onClick={() => setViewOpen(true)}>XEM WBS & chọn ô</Button>
                </div>
              : <p className="text-xs rounded-lg p-2.5" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>Dự án này chưa có WBS import (bước P1.2A). Vào bước lập kế hoạch để import WBS trước.</p>
          )}
        </div>
        <div className="flex mt-5"><Button variant="outline" className="flex-1" onClick={close}>Đóng</Button></div>
      </Modal>

      {/* Overlay lưới WBS toàn màn hình */}
      {viewOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setViewOpen(false) }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '12px 20px', borderBottom: '2px solid #0ea5e9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#f0f9ff' }}>
              <div><h2 style={{ margin: 0, fontSize: '1.05rem', color: '#0c4a6e' }}>WBS — {projectCode}</h2><span style={{ fontSize: '0.72rem', color: '#64748b' }}>Bấm ô để chọn (bấm lại = bỏ chọn) · ô xám = đang chọn · ô xanh lá = đã phát hành</span></div>
              <button type="button" onClick={() => setViewOpen(false)} style={{ padding: '5px 14px', fontSize: '0.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>✕ Đóng</button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', fontSize: '0.72rem' }}>
              <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', width: 'max-content' }}>
                <thead>
                  {/* Tầng 1: cột cơ bản (gộp 2 dòng) + tên công đoạn (gộp 4 cột con) */}
                  <tr style={{ background: '#c7e2ef' }}>
                    {[['STT', 34], ['Hạng mục', 180], ['ĐVT', 40], ['KL', 80]].map(([h, w]) => (
                      <th key={h as string} rowSpan={2} style={{ ...th, width: w as number, zIndex: 3, background: '#c7e2ef' }}>{h}</th>
                    ))}
                    {WBS_STAGES.map(s => (
                      <th key={s.key} colSpan={4} style={{ ...th, zIndex: 3, background: '#fde7e7', borderLeft: '2px solid #999' }}>{s.label}</th>
                    ))}
                  </tr>
                  {/* Tầng 2: 4 cột con mỗi công đoạn — KL · Đơn vị · Bắt đầu · Kết thúc (giống Excel + cột KL) */}
                  <tr>
                    {WBS_STAGES.map(s => (
                      <Fragment key={s.key}>
                        <th style={{ ...subTh, borderLeft: '2px solid #999', color: stageUnit(s.key) === 'm²' ? '#7c3aed' : undefined }}>KL {stageUnit(s.key) === 'm²' ? '(m²)' : '(kg)'}</th>
                        <th style={subTh}>Đơn vị</th>
                        <th style={subTh}>BĐ</th>
                        <th style={subTh}>KT</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => {
                    const isGroup = !r.khoiLuong && !r.batDau && !r.cutting && !r.welding
                    return (
                      <tr key={ri} style={{ borderBottom: '1px solid var(--border)', background: isGroup ? '#eef4f8' : undefined, fontWeight: isGroup ? 700 : 400 }}>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{r.stt || ri + 1}</td>
                        <td style={{ ...td, fontWeight: 500 }}>{r.hangMuc}</td>
                        <td style={td}>{r.dvt}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{r.khoiLuong ? formatNumber(r.khoiLuong) : ''}</td>
                        {WBS_STAGES.map(s => {
                          const ci = cellInfo(ri, s.key)
                          if (!ci.allocs.length) return (
                            <Fragment key={s.key}>
                              <td style={{ ...td, borderLeft: '2px solid #999' }} /><td style={td} /><td style={td} /><td style={td} />
                            </Fragment>
                          )
                          // Ô ĐANG CHỌN → xám (bấm lần nữa để bỏ chọn). Chưa chọn thì giữ màu theo
                          // trạng thái phát hành: xanh lá = đã phát hành đủ, vàng = một phần, xanh dương = chưa.
                          const active = isSelected(ri, s.key)
                          const bg = active ? '#e2e8f0' : ci.allIssued ? '#d1fae5' : ci.anyIssued ? '#fef9c3' : '#eff6ff'
                          const fg = active ? '#334155' : ci.allIssued ? '#166534' : ci.anyIssued ? '#854d0e' : '#1e40af'
                          const line: CSSProperties = { lineHeight: '1.5', whiteSpace: 'nowrap' }
                          return (
                            <Fragment key={s.key}>
                              <td style={{ ...td, borderLeft: '2px solid #999', textAlign: 'right', color: 'var(--text-muted)' }}>{ci.allocs.map((a, i) => <div key={i} style={line}>{a.klShow ? formatNumber(a.klShow) : ''}</div>)}</td>
                              <td style={{ ...td, padding: 2, textAlign: 'center' }}>
                                <button type="button" onClick={() => selectCell(ri, s.key)}
                                  style={{ width: '100%', padding: '3px 4px', fontSize: '0.7rem', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                                    border: active ? '2px solid #2563eb' : '1px solid transparent', background: bg, color: fg }}>
                                  {ci.allocs.map((a, i) => <div key={i} style={line}>{a.done ? '✓ ' : ''}{allocLabel(a)}</div>)}
                                </button>
                              </td>
                              <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.66rem' }}>{ci.allocs.map((a, i) => <div key={i} style={line}>{fmtD(a.start)}</div>)}</td>
                              <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.66rem' }}>{ci.allocs.map((a, i) => <div key={i} style={line}>{fmtD(a.finish)}</div>)}</td>
                            </Fragment>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Panel ô đang chọn — phân giao 1 công đoạn cho NHIỀU xưởng (mỗi xưởng KL + ngày riêng → 1 WO) */}
            {info && edit && (
              <div style={{ flexShrink: 0, borderTop: '2px solid #0ea5e9', background: '#f8fafc', padding: '10px 20px', maxHeight: '46vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ fontSize: '0.82rem' }}>
                    <span style={strong}>{info.pieceMark} — {info.stageLabel}</span>
                    <span style={{ marginLeft: 8, fontSize: '0.72rem', fontWeight: 700, color: selUnit === 'm²' ? '#7c3aed' : '#0f172a' }}>· tính theo {selUnit}</span>
                    <span style={{ color: '#64748b', marginLeft: 12 }}>Dự án: {projectCode}</span>
                    <span style={{ marginLeft: 12, color: info.anyIssued ? '#166534' : '#64748b' }}>
                      {info.anyIssued ? `Đã phát hành ${info.allocs.filter(a => a.done).length}/${info.allocs.length} xưởng` : 'Chưa phát hành'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" onClick={() => { setSels([]); setSel(null); setEdit(null) }} style={{ padding: '8px 16px', fontSize: '0.8rem', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>Bỏ chọn</button>
                    {info.anyIssued && <Button variant="danger" onClick={deleteWo} loading={issuing}>Xóa tất cả &amp; mở lại</Button>}
                    <Button variant="primary" onClick={applyWo} loading={issuing}>
                      {sels.length > 1 ? `Phát hành WO cho ${sels.length} ô` : info.anyIssued ? 'Cập nhật WO' : 'Phát hành WO'}
                    </Button>
                  </div>
                </div>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', maxWidth: 760 }}>
                  <thead><tr style={{ color: '#64748b' }}>
                    <th style={pTh}>Xưởng</th><th style={pTh}>Thầu phụ</th><th style={{ ...pTh, color: selUnit === 'm²' ? '#7c3aed' : undefined }}>{selUnit === 'm²' ? 'Diện tích (m²)' : 'Trọng lượng (kg)'}</th><th style={pTh}>Bắt đầu</th><th style={pTh}>Kết thúc</th><th style={{ ...pTh, width: 30 }} />
                  </tr></thead>
                  <tbody>
                    {edit.map((a, i) => (
                      <tr key={i}>
                        <td style={pTd}>
                          <select value={a.teamCode} onChange={e => setAlloc(i, { teamCode: e.target.value })} style={{ ...inp, width: 104 }}>
                            <option value="">— (thầu phụ)</option>
                            {WORKSHOP_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ ...pTd, textAlign: 'center' }}><input type="checkbox" checked={a.isSub} onChange={e => setAlloc(i, { isSub: e.target.checked })} /></td>
                        <td style={pTd}><input type="number" value={a.weight} onChange={e => setAlloc(i, { weight: e.target.value, wTouched: true })}
                          style={{ ...inp, width: 116 }} placeholder="0"
                          title={sels.length > 1 ? 'Các ô khác dùng khối lượng của chính nó, trừ khi bạn gõ đè số ở đây' : ''} /></td>
                        <td style={pTd}><input type="date" value={a.start} onChange={e => setAlloc(i, { start: e.target.value })} style={inp} /></td>
                        <td style={pTd}><input type="date" value={a.finish} min={a.start || undefined} onChange={e => setAlloc(i, { finish: e.target.value })} style={inp} /></td>
                        <td style={{ ...pTd, textAlign: 'center' }}>{edit.length > 1 && <button type="button" onClick={() => removeAlloc(i)} title="Bỏ xưởng" style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={addAlloc} style={{ marginTop: 6, padding: '4px 12px', fontSize: '0.76rem', border: '1px dashed #2563eb', borderRadius: 6, background: '#eff6ff', color: '#1e40af', cursor: 'pointer', fontWeight: 600 }}>+ Thêm xưởng</button>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 6 }}>
                  {sels.length > 1 && (
                    <><b style={{ color: '#334155' }}>Đang chọn {sels.length} ô</b> — bấm &quot;Phát hành WO cho {sels.length} ô&quot; sẽ áp xưởng &amp; thời gian trên form cho cả {sels.length} ô;
                    khối lượng thì mỗi ô dùng của chính nó (trừ ô đang hiện, hoặc ô bạn gõ đè số).<br /></>
                  )}
                  1 công đoạn có thể chia cho nhiều xưởng — mỗi xưởng nhập KL &amp; thời gian riêng, mỗi xưởng tạo 1 WO. KL cột trái chỉ là tham chiếu (không ép).
                  <br />Phát hành xong, <b>Xưởng</b> vào danh sách lệnh sản xuất bấm <b>Vật tư</b> để đề nghị cấp (chọn nhiều lệnh làm chung một lượt được).
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const th: CSSProperties = { padding: '4px 6px', textAlign: 'center', border: '1px solid #b7c9d4', fontWeight: 600, color: '#1f3a4d', position: 'sticky', top: 0 }
// Tiêu đề cột con của công đoạn (tầng 2), dính dưới tầng 1.
const subTh: CSSProperties = { padding: '2px 5px', textAlign: 'center', border: '1px solid #b7c9d4', fontWeight: 600, color: '#7a3a3a', background: '#fdecec', fontSize: '0.64rem', position: 'sticky', top: 25, zIndex: 1, minWidth: 46 }
const td: CSSProperties = { padding: '3px 6px', border: '1px solid var(--border)', verticalAlign: 'middle' }
// yyyy-mm-dd → dd/mm/yyyy (hiển thị gọn). Giá trị khác giữ nguyên.
const fmtD = (v?: string) => { const s = String(v ?? '').trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s }
const strong: CSSProperties = { fontWeight: 600, color: '#0f172a' }
const inp: CSSProperties = { fontSize: '0.75rem', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, background: '#fff' }
// Bảng phân giao xưởng trong panel
const pTh: CSSProperties = { padding: '2px 8px', textAlign: 'left', fontWeight: 600, fontSize: '0.7rem' }
const pTd: CSSProperties = { padding: '2px 8px' }
