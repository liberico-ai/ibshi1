'use client'

import { useState, Fragment, type CSSProperties, type ReactNode } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { Modal, Button, SelectField } from '@/components/ui'
import { formatNumber } from '@/lib/utils'
import { WBS_STAGES, WBS_STAGE_LABEL, normWorkshop, woCodeFor, pieceMarkFor, unitTagForRow } from '@/lib/wbs-wo'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

interface ProjectOption { id: string; projectCode: string; projectName: string }
type Row = Record<string, string>
type Edit = { weight: string; teamCode: string; isSub: boolean; start: string; finish: string }
const WORKSHOP_CODES = PRODUCTION_WORKSHOPS.map(w => w.code)

export default function WoFromWbsModal({ open, projects, onClose, onIssued }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onIssued: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [projectCode, setProjectCode] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [issued, setIssued] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [sel, setSel] = useState<{ ri: number; key: string } | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [issuing, setIssuing] = useState(false)

  const reset = () => { setProjectId(''); setProjectCode(''); setRows([]); setIssued(new Set()); setViewOpen(false); setSel(null); setEdit(null) }
  const close = () => { reset(); onClose() }

  // KL riêng của ô công đoạn (`{stageKey}Weight`), else KL cột trái (khoiLuong) làm mặc định
  const stageWeight = (row: Row, key: string) => {
    const s = String(row[`${key}Weight`] ?? '').trim()
    return s || String(row.khoiLuong ?? '')
  }

  // Chọn 1 ô công đoạn → khởi tạo giá trị sửa từ WBS (trọng lượng riêng của ô/xưởng/ngày)
  const selectCell = (ri: number, key: string) => {
    setSel({ ri, key })
    const row = rows[ri] || {}
    const { teamCode, isSub } = normWorkshop(String(row[key] || ''))
    const w = Number(stageWeight(row, key))
    setEdit({
      weight: Number.isFinite(w) && w > 0 ? String(w) : '',
      teamCode: WORKSHOP_CODES.includes(teamCode) ? teamCode : '',
      isSub,
      start: String(row[`${key}Start`] || '').slice(0, 10),
      finish: String(row[`${key}Finish`] || '').slice(0, 10),
    })
  }

  const pickProject = async (id: string) => {
    setProjectId(id); setRows([]); setSel(null); setEdit(null)
    if (!id) return
    setLoading(true)
    const r = await apiFetch(`/api/production/wbs?projectId=${id}`)
    setLoading(false)
    if (r.ok) { setRows(Array.isArray(r.rows) ? r.rows : []); setProjectCode(r.projectCode || ''); setIssued(new Set(r.issuedWoCodes || [])) }
    else notify(r.error || 'Lỗi tải WBS', 'error')
  }

  // Thông tin 1 ô công đoạn (giống các cột bảng WO)
  const cellInfo = (ri: number, key: string) => {
    const row = rows[ri] || {}
    const cellVal = String(row[key] || '').trim()
    const { teamCode, isSub } = normWorkshop(cellVal)
    const hangMuc = String(row.hangMuc || `Dòng ${ri + 1}`).trim()
    const unitTag = unitTagForRow(rows, ri)
    const pieceMark = pieceMarkFor(hangMuc, unitTag)
    const woCode = woCodeFor(projectCode, hangMuc, key, unitTag, String(row.stt || '').trim())
    const weight = Number(stageWeight(row, key))
    return {
      cellVal, teamCode, isSub, hangMuc, pieceMark, woCode,
      stageLabel: WBS_STAGE_LABEL[key] || key,
      description: `${pieceMark} — ${WBS_STAGE_LABEL[key] || key}${isSub ? ' (Thầu phụ)' : ''}`,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 0,
      start: row[`${key}Start`] || '', finish: row[`${key}Finish`] || '',
      already: issued.has(woCode),
    }
  }

  const reloadWbs = async () => {
    const wbs = await apiFetch(`/api/production/wbs?projectId=${projectId}`)
    if (wbs.ok) { setRows(Array.isArray(wbs.rows) ? wbs.rows : []); setIssued(new Set(wbs.issuedWoCodes || [])) }
  }

  // mode='update' = SỬA WO đã phát hành của ô này (thay vì tạo mới). KL độc lập theo công đoạn — không ảnh hưởng ô khác.
  const doIssue = async (mode?: 'update') => {
    if (!sel || !edit) return
    if (!edit.teamCode && !edit.isSub) { notify('Chọn xưởng (hoặc đánh dấu Thầu phụ) trước', 'error'); return }
    setIssuing(true)
    const r = await apiFetch('/api/production/work-orders/from-wbs-cell', { method: 'POST', body: JSON.stringify({
      projectId, rowIndex: sel.ri, stageKey: sel.key,
      teamCode: edit.teamCode, isSub: edit.isSub, weight: edit.weight, start: edit.start, finish: edit.finish, mode,
    }) })
    setIssuing(false)
    if (!r.ok) { notify(r.error || 'Lỗi', 'error'); return }
    if (r.existing) notify(r.message || 'Ô này đã phát hành WO trước đó', 'info')
    else notify(`✓ ${r.message || 'Thành công'}`, 'success')
    setSel(null); setEdit(null)
    await reloadWbs(); onIssued()
  }
  const issue = () => doIssue()
  const updateWo = () => doIssue('update')

  // Xóa WO của ô đang chọn → ô mở lại (chặn nếu đã có SX phía server)
  const deleteWo = async () => {
    if (!sel || !info) return
    if (!await confirmDialog(`Xóa WO của ô này (${info.woCode})? Ô sẽ mở lại để phát hành lại.`)) return
    setIssuing(true)
    const r = await apiFetch('/api/production/work-orders/from-wbs-cell', { method: 'DELETE', body: JSON.stringify({ projectId, rowIndex: sel.ri, stageKey: sel.key }) })
    setIssuing(false)
    if (r.ok) { notify(r.message || 'Đã xóa WO', 'success'); setSel(null); setEdit(null); await reloadWbs(); onIssued() }
    else notify(r.error || 'Lỗi xóa WO', 'error')
  }

  const info = sel ? cellInfo(sel.ri, sel.key) : null

  return (
    <>
      <Modal open={open} onClose={close} title="Tạo WO từ WBS" size="md">
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Chọn dự án → xem WBS đã import → bấm vào ô công đoạn (xưởng) để phát hành lệnh sản xuất (WO) cho hạng mục đó.
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
              <div><h2 style={{ margin: 0, fontSize: '1.05rem', color: '#0c4a6e' }}>WBS — {projectCode}</h2><span style={{ fontSize: '0.72rem', color: '#64748b' }}>Bấm vào ô công đoạn (xưởng) để phát hành WO · ô xanh lá = đã phát hành</span></div>
              <button type="button" onClick={() => setViewOpen(false)} style={{ padding: '5px 14px', fontSize: '0.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>✕ Đóng</button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', fontSize: '0.72rem' }}>
              <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', width: 'max-content' }}>
                <thead>
                  <tr style={{ background: '#c7e2ef', position: 'sticky', top: 0, zIndex: 2 }}>
                    {[['STT', 34], ['Hạng mục', 180], ['ĐVT', 40], ['KL', 80]].map(([h, w]) => <th key={h as string} style={{ ...th, width: w as number }}>{h}</th>)}
                    {WBS_STAGES.map(s => <th key={s.key} style={{ ...th, background: '#fde7e7', borderLeft: '2px solid #999', minWidth: 74 }}>{s.label}</th>)}
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
                          const val = String(r[s.key] || '').trim()
                          if (!val) return <td key={s.key} style={{ ...td, borderLeft: '2px solid #ddd' }} />
                          const wc = woCodeFor(projectCode, String(r.hangMuc || `Dòng ${ri + 1}`).trim(), s.key, unitTagForRow(rows, ri), String(r.stt || '').trim())
                          const done = issued.has(wc)
                          const active = sel?.ri === ri && sel?.key === s.key
                          return (
                            <td key={s.key} style={{ ...td, borderLeft: '2px solid #ddd', padding: 2, textAlign: 'center' }}>
                              <button type="button" onClick={() => selectCell(ri, s.key)}
                                style={{ width: '100%', padding: '3px 4px', fontSize: '0.7rem', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                                  border: active ? '2px solid #2563eb' : '1px solid transparent',
                                  background: done ? '#d1fae5' : '#eff6ff', color: done ? '#166534' : '#1e40af' }}>
                                {done ? '✓ ' : ''}{val}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Panel ô đang chọn — SỬA được Trọng lượng/Xưởng/Ngày trước khi phát hành (✎). Lưu → ghi ngược vào WBS. */}
            {info && edit && (
              <div style={{ flexShrink: 0, borderTop: '2px solid #0ea5e9', background: '#f8fafc', padding: '12px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, auto))', gap: '8px 20px', fontSize: '0.78rem' }}>
                    <Field label="Mã WO"><span style={strong}>{info.woCode}</span></Field>
                    <Field label="Piece-mark"><span style={strong}>{info.pieceMark}</span></Field>
                    <Field label="Mô tả"><span style={strong}>{info.pieceMark} — {info.stageLabel}{edit.isSub ? ' (Thầu phụ)' : ''}</span></Field>
                    <Field label="Dự án"><span style={strong}>{projectCode}</span></Field>
                    <Field label="Trọng lượng (kg) ✎"><input type="number" value={edit.weight} onChange={e => setEdit({ ...edit, weight: e.target.value })} style={inp} placeholder="0" /></Field>
                    <Field label="Xưởng ✎">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select value={edit.teamCode} onChange={e => setEdit({ ...edit, teamCode: e.target.value })} style={{ ...inp, width: 88 }}>
                          <option value="">—</option>
                          {WORKSHOP_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <label style={{ fontSize: '0.72rem', display: 'flex', gap: 3, alignItems: 'center', cursor: info.already ? 'default' : 'pointer' }}>
                          <input type="checkbox" checked={edit.isSub} onChange={e => setEdit({ ...edit, isSub: e.target.checked })} /> Thầu phụ
                        </label>
                      </div>
                    </Field>
                    <Field label="Bắt đầu ✎"><input type="date" value={edit.start} onChange={e => setEdit({ ...edit, start: e.target.value })} style={inp} /></Field>
                    <Field label="Kết thúc ✎"><input type="date" value={edit.finish} min={edit.start || undefined} onChange={e => setEdit({ ...edit, finish: e.target.value })} style={inp} /></Field>
                    <Field label="Trạng thái"><span style={strong}>{info.already ? 'Đã phát hành' : 'Sẽ tạo (Chờ vật tư)'}</span></Field>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" onClick={() => { setSel(null); setEdit(null) }} style={{ padding: '8px 16px', fontSize: '0.8rem', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>Bỏ chọn</button>
                    {info.already ? (
                      <>
                        <Button variant="danger" onClick={deleteWo} loading={issuing}>Xóa WO &amp; mở lại ô</Button>
                        <Button variant="primary" onClick={updateWo} loading={issuing}>Cập nhật WO</Button>
                      </>
                    ) : (
                      <Button variant="primary" onClick={issue} loading={issuing}>Phát hành WO</Button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 6 }}>
                  {info.already
                    ? 'Ô này đã phát hành WO — sửa Trọng lượng/Xưởng/Ngày rồi bấm "Cập nhật WO" để ghi đè, hoặc "Xóa WO & mở lại ô". (Không xóa được nếu WO đã có báo cáo SX / cấp vật tư.)'
                    : 'Sửa Trọng lượng/Xưởng/Ngày nếu cần rồi bấm "Phát hành WO". KL lưu RIÊNG cho công đoạn này (mặc định = KL cột trái), sửa ở đây KHÔNG ảnh hưởng KL công đoạn khác.'}
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
const td: CSSProperties = { padding: '3px 6px', border: '1px solid var(--border)', verticalAlign: 'middle' }
const strong: CSSProperties = { fontWeight: 600, color: '#0f172a' }
const inp: CSSProperties = { fontSize: '0.75rem', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, background: '#fff' }
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><div style={{ fontSize: '0.66rem', color: '#64748b', marginBottom: 2 }}>{label}</div>{children}</div>
}
