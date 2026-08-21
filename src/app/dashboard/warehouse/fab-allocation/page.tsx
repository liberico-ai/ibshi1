'use client'

import { useEffect, useState, useCallback, Fragment, type CSSProperties } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'
import { formatNumber, formatDate } from '@/lib/utils'

interface Proj { id: string; projectCode: string; projectName: string }
interface Cat { id: string; code: string; name: string; sortOrder: number }
interface Cell { qty: number; weight: number; ngayCan: string | null }
interface Row {
  prItemId: string; prCode: string | null; itemCode: string | null; itemName: string | null
  profile: string | null; grade: string | null; uom: string | null
  reqQty: number; toBuyQty: number; tongQty: number; conLai: number; vuotTran: boolean; khongCoTran: boolean
  ngayCanSomNhat: string | null; ngayHangVe: string | null; soDongHD: number; soDongDaVe: number
  o: Record<string, Cell>
}

// Tiến độ: so ngày cần tại công trường với ngày hàng thực về (khớp Commerce).
function tienDo(r: Row): { label: string; color: string } | null {
  if (!r.ngayCanSomNhat) return null
  const day = 86400000, today = new Date(new Date().toDateString()).getTime()
  const can = new Date(r.ngayCanSomNhat).getTime()
  const veDu = r.soDongHD > 0 && r.soDongDaVe === r.soDongHD && r.ngayHangVe
  if (veDu) {
    const ve = new Date(r.ngayHangVe!).getTime(); const dd = Math.round((can - ve) / day)
    if (dd > 0) return { label: `Về sớm ${dd} ngày`, color: '#166534' }
    if (dd < 0) return { label: `Về muộn ${-dd} ngày`, color: '#dc2626' }
    return { label: 'Về đúng hạn', color: '#166534' }
  }
  const dd = Math.round((can - today) / day)
  if (dd < 0) return { label: `Quá hạn ${-dd} ngày`, color: '#dc2626' }
  if (dd === 0) return { label: 'Cần hôm nay', color: '#b45309' }
  return { label: `Còn ${dd} ngày`, color: '#64748b' }
}
interface Grid { duAn: { projectCode: string; projectName: string }; hangMucs: Cat[]; soVatTu: number; soHangMuc: number; soODaPhanBo: number; items: Row[] }

type Edit = { qty: string; weight: string; ngay: string }
const key = (prItemId: string, catId: string) => `${prItemId}|${catId}`
const nn = (v: number) => (v ? formatNumber(v) : '')

export default function FabAllocationPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [grid, setGrid] = useState<Grid | null>(null)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [limit, setLimit] = useState(80)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState<'all' | 'un' | 'done'>('all')

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const load = useCallback(() => {
    if (!projectId) { setGrid(null); return }
    setEdits({}); setLimit(80)
    apiFetch(`/api/procurement/fab-allocations?projectId=${projectId}`).then(r => { if (r.ok) setGrid(r as unknown as Grid); else notify(r.error || 'Lỗi tải lưới', 'error') })
  }, [projectId])
  useEffect(() => { load() }, [load])

  // Giá trị hiện tại của 1 ô (ưu tiên đang sửa → gốc)
  const cellOf = (row: Row, catId: string): Edit => {
    const k = key(row.prItemId, catId)
    if (edits[k]) return edits[k]
    const o = row.o[catId]
    return { qty: o?.qty ? String(o.qty) : '', weight: o?.weight ? String(o.weight) : '', ngay: o?.ngayCan ? String(o.ngayCan).slice(0, 10) : '' }
  }
  const setCell = (row: Row, catId: string, patch: Partial<Edit>) => {
    const k = key(row.prItemId, catId)
    setEdits(p => ({ ...p, [k]: { ...cellOf(row, catId), ...patch } }))
  }
  // Tổng phân bổ live theo dòng (gộp ô đang sửa + ô gốc chưa động tới)
  const rowTong = (row: Row) => {
    let s = 0
    for (const c of grid!.hangMucs) { const v = cellOf(row, c.id).qty; s += Number(v) || 0 }
    return s
  }

  const save = async () => {
    const cells = Object.entries(edits).map(([k, v]) => {
      const [prItemId, fabricationCategoryId] = k.split('|')
      return { prItemId, fabricationCategoryId, qty: Number(v.qty) || 0, weight: Number(v.weight) || 0, ngayCanTaiCongTruong: v.ngay || null }
    })
    if (cells.length === 0) { notify('Chưa sửa ô nào', 'error'); return }
    setSaving(true)
    const r = await apiFetch(`/api/procurement/fab-allocations/bulk?projectId=${projectId}`, { method: 'POST', body: JSON.stringify({ cells }) })
    setSaving(false)
    if (r.ok) {
      notify(r.message || 'Đã lưu', 'success')
      if (Array.isArray(r.canhBao) && r.canhBao.length) notify(`${r.canhBao.length} vật tư chưa có SL yêu cầu mua (không đối chiếu được trần)`, 'info')
      load()
    } else notify(r.error || 'Lỗi lưu', 'error')
  }

  const dirtyCount = Object.keys(edits).length

  // Lọc theo tìm kiếm + trạng thái phân bổ (dựa trên tồn phân bổ đã lưu tongQty)
  const filteredItems = (grid?.items || []).filter(row => {
    if (statusF === 'un' && row.tongQty > 0) return false
    if (statusF === 'done' && !(row.tongQty > 0)) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = `${row.itemCode || ''} ${row.profile || ''} ${row.grade || ''} ${row.itemName || ''} ${row.prCode || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Phân bổ chế tạo" subtitle="Phân bổ vật tư PR cho từng hạng mục chế tạo của dự án — SL · khối lượng · ngày cần tại công trường" />

      <div className="flex gap-3 items-center flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {grid && <Button variant="primary" onClick={save} disabled={saving || dirtyCount === 0}>{saving ? 'Đang lưu…' : `Lưu lưới${dirtyCount ? ` (${dirtyCount} ô)` : ''}`}</Button>}
      </div>

      {grid && grid.hangMucs.length === 0 && (
        <div className="card p-4 text-sm" style={{ color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a' }}>
          Dự án chưa khai <b>hạng mục chế tạo</b>. Vào trang <a href="/dashboard/warehouse/fab-categories" className="underline" style={{ color: 'var(--accent)' }}>Hạng mục chế tạo</a> để khai trước.
        </div>
      )}

      {grid && grid.hangMucs.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="text-xs flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text-muted)' }}>
            <span>Dự án <b>{grid.duAn.projectCode}</b></span>
            <span>{grid.soVatTu} vật tư · {grid.soHangMuc} hạng mục · {grid.soODaPhanBo} ô đã phân bổ</span>
            <span>Trần mỗi vật tư = <b>SL yêu cầu mua (reqQty)</b>; tổng phân bổ không vượt trần.</span>
          </div>

          {/* Tìm kiếm + lọc trạng thái */}
          <div className="flex gap-2 items-center flex-wrap">
            <input value={search} onChange={e => { setSearch(e.target.value); setLimit(80) }} placeholder="Tìm mã VT / quy cách / mác / phiếu…" className="input text-xs" style={{ maxWidth: 280 }} />
            <div className="flex gap-1">
              {([['all', 'Tất cả'], ['un', 'Chưa phân bổ'], ['done', 'Đã phân bổ']] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setStatusF(k); setLimit(80) }} className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ border: `1px solid ${statusF === k ? 'var(--accent)' : 'var(--border)'}`, color: statusF === k ? 'var(--accent)' : 'var(--text-muted)', background: statusF === k ? 'var(--surface-hover)' : 'var(--surface)' }}>{l}</button>
              ))}
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{filteredItems.length}/{grid.items.length} vật tư</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', width: '100%' }}>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', width: 'max-content', fontSize: '0.72rem' }}>
              <thead>
                <tr style={{ background: '#c7e2ef', position: 'sticky', top: 0, zIndex: 2 }}>
                  {[['Phiếu', 90], ['Mã VT', 110], ['Quy cách / Mác', 140], ['ĐVT', 44], ['SL cần mua', 78], ['Đã phân bổ', 80], ['Còn lại', 78], ['Tiến độ (ngày về)', 130]].map(([h, w]) => (
                    <th key={h as string} rowSpan={2} style={{ ...th, width: w as number }}>{h}</th>
                  ))}
                  {grid.hangMucs.map(c => <th key={c.id} colSpan={3} style={{ ...th, background: '#fde7e7', borderLeft: '2px solid #999' }} title={c.name}>{c.code}</th>)}
                </tr>
                <tr style={{ background: '#dcecf5', position: 'sticky', top: 22, zIndex: 2 }}>
                  {grid.hangMucs.map(c => (
                    <Fragment key={c.id}>
                      <th style={{ ...th, borderLeft: '2px solid #999', fontWeight: 500, width: 66 }}>SL</th>
                      <th style={{ ...th, fontWeight: 500, width: 66 }}>KL(kg)</th>
                      <th style={{ ...th, fontWeight: 500, width: 120 }}>Ngày cần</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredItems.slice(0, limit).map(row => {
                  const tong = rowTong(row)
                  const conLai = row.reqQty - tong
                  const vuot = row.reqQty > 0 && tong > row.reqQty + 0.001
                  return (
                    <tr key={row.prItemId} style={{ borderTop: '1px solid var(--border)', background: vuot ? '#fef2f2' : undefined }}>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{row.prCode || '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace', color: 'var(--accent)' }}>{row.itemCode || '—'}</td>
                      <td style={td}>{row.profile || '—'}{row.grade ? ` / ${row.grade}` : ''}</td>
                      <td style={td}>{row.uom || ''}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{row.reqQty ? nn(row.reqQty) : <span style={{ color: '#d97706' }} title="Chưa có SL yêu cầu mua — không có trần">0</span>}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: vuot ? '#dc2626' : 'var(--text-primary)' }}>{nn(tong)}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', color: conLai < -0.001 ? '#dc2626' : 'var(--text-muted)' }}>{nn(conLai)}</td>
                      <td style={{ ...td, fontSize: '0.68rem' }}>
                        {(() => {
                          const t = tienDo(row)
                          if (!t) return <span style={{ color: 'var(--text-muted)' }}>—</span>
                          return (
                            <span title={`Ngày cần: ${row.ngayCanSomNhat ? formatDate(row.ngayCanSomNhat) : '—'}${row.ngayHangVe ? ` · Hàng về: ${formatDate(row.ngayHangVe)}` : ''}${row.soDongHD ? ` · HĐ về ${row.soDongDaVe}/${row.soDongHD} dòng` : ' · chưa có HĐ'}`}>
                              <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
                              {row.soDongHD > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({row.soDongDaVe}/{row.soDongHD})</span>}
                            </span>
                          )
                        })()}
                      </td>
                      {grid.hangMucs.map(c => {
                        const e = cellOf(row, c.id)
                        const has = !!(e.qty || e.weight || e.ngay)
                        return (
                          <Fragment key={c.id}>
                            <td style={{ ...td, borderLeft: '2px solid #ddd', background: has ? '#fff7f7' : undefined }}>
                              <input type="number" value={e.qty} onChange={ev => setCell(row, c.id, { qty: ev.target.value })} style={cellInput} placeholder="0" />
                            </td>
                            <td style={td}><input type="number" value={e.weight} onChange={ev => setCell(row, c.id, { weight: ev.target.value })} style={cellInput} placeholder="0" /></td>
                            <td style={td}><input type="date" value={e.ngay} onChange={ev => setCell(row, c.id, { ngay: ev.target.value })} style={{ ...cellInput, width: 116 }} /></td>
                          </Fragment>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
          {filteredItems.length > limit && (
            <div className="text-center">
              <button onClick={() => setLimit(l => l + 120)} className="text-xs px-4 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--accent)' }}>
                Xem thêm ({filteredItems.length - limit} vật tư còn lại)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const th: CSSProperties = { padding: '4px 6px', textAlign: 'center', border: '1px solid #b7c9d4', fontWeight: 600, color: '#1f3a4d' }
const td: CSSProperties = { padding: '2px 6px', border: '1px solid var(--border)', verticalAlign: 'middle' }
const cellInput: CSSProperties = { width: 60, fontSize: '0.72rem', textAlign: 'right', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)' }
