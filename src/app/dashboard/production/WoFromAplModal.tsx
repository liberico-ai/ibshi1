'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { Modal, Button, SelectField } from '@/components/ui'
import { formatNumber } from '@/lib/utils'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

// Phát hành lệnh sản xuất từ APL.
//   chọn dự án → danh sách ITEM → chọn 1 ITEM → giao xưởng + thời gian → phát hành.
//
// MỘT ITEM = MỘT WO = MỘT XƯỞNG (chốt nghiệp vụ 2026-08). Trước đây giao theo từng dòng vàng,
// ra tới 2.930 lệnh — quá vụn để phân giao, nên nâng lên mức ITEM.
//   • Khối lượng = cột kg của ITEM (tổng các cụm bên trong)
//   • Vật tư     = gom mọi dòng chi tiết trong ITEM, trùng quy cách thì cộng dồn kg
//   • Thời gian  = PM nhập tay

interface ProjectOption { id: string; projectCode: string; projectName: string }
interface AplInfo { id: string; fileName: string; sheetName: string; revision: string | null; totalRows: number }
interface Assign { teamCode: string; plannedStart: string; plannedEnd: string }

interface ItemRow {
  item: string; blocks: number; weightKg: number
  issuedWoCode: string | null; issuedTeamCode: string | null; issuedStatus: string | null
  /** Mọi lệnh đã phát hành của ITEM — một ITEM giao được cho nhiều xưởng */
  issuedWos?: { woCode: string; teamCode: string | null; status: string }[]
  issuedTeams?: string[]
}
interface MatRow { label: string; weightKg: number; lines: number }
interface Preview {
  item: string; blocks: number; detailLines: number; weightKg: number
  materials: MatRow[]
  alreadyIssued: { woCode: string; teamCode: string; status: string } | null
  issuedWos?: { woCode: string; teamCode: string | null; status: string }[]
}

export default function WoFromAplModal({ open, projects, onClose, onIssued }: {
  open: boolean; projects: ProjectOption[]; onClose: () => void; onIssued: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [apl, setApl] = useState<AplInfo | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [msg, setMsg] = useState('')
  // Bản APL nhập trước khi có phần gộp khối → mọi dòng dồn vào "(không có ITEM)", 0 kg.
  const [needsRepair, setNeedsRepair] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [item, setItem] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Giao MỘT LƯỢT cho nhiều xưởng: mỗi dòng là một lệnh, xưởng nào làm khâu nào thì đặt
  // ngày riêng của khâu đó (cắt trước, hàn sau) — không bắt PM hôm nay giao một xưởng,
  // mai mở lại giao thêm xưởng nữa.
  const [assigns, setAssigns] = useState<Assign[]>([{ teamCode: '', plannedStart: '', plannedEnd: '' }])
  const setAssign = (i: number, patch: Partial<Assign>) =>
    setAssigns(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const addAssign = () => setAssigns(rs => [...rs, { teamCode: '', plannedStart: '', plannedEnd: '' }])
  const removeAssign = (i: number) => setAssigns(rs => (rs.length === 1 ? rs : rs.filter((_, k) => k !== i)))
  const resetAssigns = () => setAssigns([{ teamCode: '', plannedStart: '', plannedEnd: '' }])
  const [issuing, setIssuing] = useState(false)

  const reset = () => {
    setProjectId(''); setApl(null); setItems([]); setItem(null); setPreview(null); setMsg('')
    resetAssigns()
  }
  const close = () => { reset(); onClose() }

  const loadItems = useCallback(() => {
    if (!projectId) { setApl(null); setItems([]); setNeedsRepair(false); return }
    setLoadingItems(true); setMsg(''); setItem(null); setPreview(null)
    apiFetch(`/api/design/apl/items?projectId=${projectId}`)
      .then(r => {
        if (!r.ok) { setMsg(r.error || 'Không đọc được APL'); return }
        setApl(r.apl as AplInfo | null)
        setItems((r.items || []) as ItemRow[])
        setNeedsRepair(!!r.needsRepair)
        if (!r.apl) setMsg(r.message || 'Dự án này chưa nhập APL. Vào bước Thiết kế → biểu mẫu "Assembly Part List (APL)" để nhập trước.')
      })
      .catch(() => setMsg('Không đọc được APL'))
      .finally(() => setLoadingItems(false))
  }, [projectId])

  // Chọn dự án → nạp bản APL mới nhất + danh sách ITEM
  useEffect(() => { loadItems() }, [loadItems])

  // Chọn ITEM → xem trước khối lượng và vật tư đã cộng dồn, TRƯỚC khi phát hành
  const pickItem = async (it: ItemRow) => {
    if (!apl) return
    setItem(it.item); setPreview(null); setLoadingPreview(true)
    try {
      const r = await apiFetch(`/api/production/work-orders/from-apl?importId=${apl.id}&item=${encodeURIComponent(it.item)}`)
      if (r?.ok) setPreview(r as unknown as Preview)
      else notify(r?.error || 'Không xem trước được ITEM', 'error')
    } finally {
      setLoadingPreview(false)
    }
  }

  // Xuất bảng phân giao ra Excel để điền ngoài file rồi nhập lại.
  // Không dùng apiFetch vì đây là file nhị phân, nhưng vẫn phải tự gắn Bearer token.
  const exportExcel = async () => {
    if (!apl) return
    setExporting(true)
    try {
      const token = sessionStorage.getItem('ibs_token')
      const qs = item !== null ? `?item=${encodeURIComponent(item)}` : ''
      const res = await fetch(`/api/design/apl/${apl.id}/export${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        notify(j.error || 'Xuất file thất bại', 'error')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = decodeURIComponent((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'PhanGiao.xlsx')
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const repair = async () => {
    if (!apl) return
    setRepairing(true)
    try {
      const r = await apiFetch(`/api/design/apl/${apl.id}/repair`, { method: 'POST' })
      if (!r?.ok) { notify(r?.error || 'Sửa dữ liệu thất bại', 'error'); return }
      notify(r.message || 'Đã sửa dữ liệu APL', 'success')
      loadItems()
    } finally {
      setRepairing(false)
    }
  }

  const issue = async () => {
    if (!apl || item === null) return
    // Để trống xưởng vẫn phát hành được (lệnh chưa giao) — nhưng chỉ khi đó là dòng DUY NHẤT.
    const rows = assigns.length === 1 ? assigns : assigns.filter(a => a.teamCode)
    if (rows.length === 0) { notify('Chọn ít nhất một xưởng', 'error'); return }
    setIssuing(true)
    try {
      // Phát hành lần lượt, mỗi xưởng một lệnh. Một dòng hỏng không kéo đổ các dòng còn lại —
      // báo rõ cái nào được, cái nào không, để PM làm lại đúng chỗ.
      const done: string[] = []
      const failed: string[] = []
      for (const a of rows) {
        const r = await apiFetch('/api/production/work-orders/from-apl', {
          method: 'POST',
          body: JSON.stringify({
            projectId, importId: apl.id, item,
            teamCode: a.teamCode || undefined,
            plannedStart: a.plannedStart || undefined,
            plannedEnd: a.plannedEnd || undefined,
          }),
        })
        if (r?.ok) done.push(`${a.teamCode || 'chưa giao'} · ${r.workOrder?.woCode ?? ''}`)
        else failed.push(`${a.teamCode || 'chưa giao'}: ${r?.error || 'lỗi'}`)
      }
      if (done.length) notify(`Đã phát hành ${done.length} lệnh — ${done.join(' | ')}`, 'success')
      if (failed.length) notify(`Không phát hành được ${failed.length} lệnh — ${failed.join(' | ')}`, 'error')
      if (done.length === 0) return
      setItem(null); setPreview(null); resetAssigns()
      loadItems()
      onIssued()
    } finally {
      setIssuing(false)
    }
  }

  // Các lệnh đã phát hành của ITEM đang xem — để nhắc PM khỏi giao trùng xưởng, KHÔNG chặn.
  const issuedWos = preview?.issuedWos ?? []
  const issuedTeams = issuedWos.map(w => w.teamCode).filter(Boolean) as string[]
  // Cùng một xưởng không nhận hai lệnh cho cùng ITEM — server chặn, ở đây chặn trước cho êm.
  // Chặn cả trùng NGAY TRONG form: hai dòng cùng chọn một xưởng thì dòng sau chắc chắn hỏng.
  const takenInForm = (i: number, code: string) =>
    !!code && assigns.some((a, k) => k !== i && a.teamCode === code)
  const rowBad = (i: number) => {
    const code = assigns[i].teamCode
    if (issuedTeams.includes(code)) return `${code} đã có lệnh cho ITEM này`
    if (takenInForm(i, code)) return `${code} bị chọn hai lần`
    if (!code && assigns.length > 1) return 'Chọn xưởng cho dòng này'
    if (!code && issuedWos.length > 0) return 'ITEM đã giao cho xưởng khác — chọn xưởng nhận'
    return null
  }
  const badRows = assigns.map((_, i) => rowBad(i)).filter(Boolean) as string[]
  const willIssue = assigns.length === 1 ? 1 : assigns.filter(a => a.teamCode).length

  return (
    <Modal open={open} onClose={close} title="Tạo WO từ APL" size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Trên cùng chỉ hỏi DỰ ÁN. Giao xưởng và ngày để xuống dưới, sau khi đã chọn ITEM —
            lúc đó mới là việc cần quyết, hỏi trước thì rối mà lại hay quên đổi. */}
        <div style={{ maxWidth: 460 }}>
          <SelectField label="Dự án" value={projectId} onChange={e => setProjectId(e.target.value)}
            options={[{ value: '', label: '— Chọn dự án —' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
        </div>

        {msg && <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, fontSize: '0.82rem' }}>{msg}</div>}

        {apl && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1, minWidth: 240 }}>
              APL: <b>{apl.fileName}</b>{apl.revision ? ` · ${apl.revision}` : ''} · sheet &quot;{apl.sheetName}&quot; · {formatNumber(apl.totalRows)} dòng
            </div>
            <Button variant="outline" onClick={exportExcel} disabled={exporting}>
              {exporting ? 'Đang xuất…' : 'Xuất Excel phân giao'}
            </Button>
          </div>
        )}

        {needsRepair && (
          <div style={{ padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', color: '#92400e', flex: 1, minWidth: 260 }}>
              Bản APL này nhập trước khi có phần tách theo ITEM nên mọi dòng đang dồn vào một nhóm.
              Bấm sửa để tính lại — không phải nhập lại file.
            </span>
            <Button onClick={repair} disabled={repairing}>{repairing ? 'Đang sửa…' : 'Sửa dữ liệu APL'}</Button>
          </div>
        )}

        {loadingItems && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Đang tải danh sách ITEM…</div>}

        {/* Danh sách ITEM — mỗi ITEM là một lệnh sản xuất */}
        {!loadingItems && items.length > 0 && item === null && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
              Chọn ITEM ({items.length}) <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— một ITEM giao được cho nhiều xưởng, mỗi xưởng một lệnh mang trọn khối lượng</span>
            </div>
            <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {items.map(it => (
                <button key={it.item || '(trống)'} type="button"
                  onClick={() => pickItem(it)}
                  title={(it.issuedTeams || []).length
                    ? `Đã giao: ${(it.issuedTeams || []).join(', ')} — chọn để giao thêm xưởng khác`
                    : 'Chọn để phát hành lệnh'}
                  style={{
                    width: '100%', display: 'grid', gridTemplateColumns: '1fr 120px 110px 160px', gap: 8,
                    padding: '9px 12px', borderBottom: '1px solid var(--border)',
                    background: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: '0.83rem', alignItems: 'center',
                  }}>
                  <span style={{ fontWeight: 600 }}>{it.item || '(không có ITEM)'}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatNumber(it.blocks)} cụm</span>
                  <span style={{ textAlign: 'right', fontWeight: 600, color: '#0f766e' }}>{formatNumber(Math.round(it.weightKg))} kg</span>
                  <span style={{ textAlign: 'right', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {(it.issuedTeams || []).length
                      ? `đã giao · ${(it.issuedTeams || []).join(', ')}`
                      : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ITEM đã chọn — xem trước rồi giao */}
        {item !== null && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <Button variant="outline" onClick={() => { setItem(null); setPreview(null) }}>← ITEM khác</Button>
              <b style={{ fontSize: '0.9rem' }}>{item || '(không có ITEM)'}</b>
            </div>

            {loadingPreview && <div style={{ padding: 16, textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Đang gom khối lượng và vật tư…</div>}

            {issuedWos.length > 0 && (
              <div style={{ padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: '0.82rem', color: '#1e40af', marginBottom: 8 }}>
                ITEM này đã giao cho {issuedWos.length} xưởng:{' '}
                {issuedWos.map(w => `${w.teamCode || '(chưa gán xưởng)'} · ${w.woCode}`).join('  |  ')}.
                <div style={{ fontSize: '0.76rem', marginTop: 2, color: '#1e40af' }}>
                  Giao thêm xưởng khác được — mỗi xưởng làm một khâu và nhận trọn khối lượng của ITEM.
                  Cùng một xưởng thì không giao hai lần.
                </div>
              </div>
            )}

            {preview && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '10px 12px', background: 'var(--bg-secondary)' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Khối lượng</div>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#0f766e' }}>{formatNumber(Math.round(preview.weightKg))} kg</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Gồm</div>
                    <div style={{ fontWeight: 600 }}>{formatNumber(preview.blocks)} cụm · {formatNumber(preview.detailLines)} chi tiết</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Vật tư</div>
                    <div style={{ fontWeight: 600 }}>{formatNumber(preview.materials.length)} loại</div>
                  </div>
                </div>

                {/* Vật tư đã gom: trùng quy cách thì cộng dồn — đây là số đi vào đề nghị cấp vật tư */}
                <div style={{ maxHeight: 230, overflow: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px', gap: 8, padding: '6px 12px', background: 'var(--bg-secondary)', fontSize: '0.72rem', fontWeight: 700, position: 'sticky', top: 0 }}>
                    <span>Vật tư (quy cách + mác)</span>
                    <span style={{ textAlign: 'right' }}>Khối lượng</span>
                    <span style={{ textAlign: 'right' }}>Gom từ</span>
                  </div>
                  {preview.materials.map(m => (
                    <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px', gap: 8, padding: '5px 12px', borderTop: '1px solid var(--border)', fontSize: '0.79rem' }}>
                      <span style={{ color: '#4338ca', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.label}>{m.label}</span>
                      <span style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(Math.round(m.weightKg))} kg</span>
                      <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatNumber(m.lines)} dòng</span>
                    </div>
                  ))}
                  {preview.materials.length === 0 && (
                    <div style={{ padding: 14, textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Các dòng chi tiết của ITEM này không ghi quy cách/mác vật tư.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Giao một lượt cho nhiều xưởng — mỗi dòng thành một lệnh, ngày đặt riêng theo khâu. */}
      {item !== null && preview && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>
            Giao cho những xưởng nào, làm khi nào{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
              — mỗi dòng là một lệnh, đều nhận trọn {formatNumber(Math.round(preview.weightKg))} kg của ITEM
            </span>
          </div>

          {assigns.map((a, i) => {
            const bad = rowBad(i)
            return (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 34px', gap: 10, alignItems: 'end' }}>
                  <SelectField label={i === 0 ? 'Xưởng nhận' : ''} value={a.teamCode}
                    onChange={e => setAssign(i, { teamCode: e.target.value })}
                    options={[
                      { value: '', label: issuedWos.length > 0 || assigns.length > 1 ? '— Chọn xưởng —' : '— Chưa giao —' },
                      ...PRODUCTION_WORKSHOPS.map(w => ({
                        value: w.code,
                        label: issuedTeams.includes(w.code) ? `${w.name} (đã giao)`
                          : takenInForm(i, w.code) ? `${w.name} (đã chọn ở dòng khác)`
                          : w.name,
                      })),
                    ]} />
                  <div>
                    {i === 0 && <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Bắt đầu</label>}
                    <input type="date" className="input-field text-sm" value={a.plannedStart}
                      onChange={e => setAssign(i, { plannedStart: e.target.value })} />
                  </div>
                  <div>
                    {i === 0 && <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text-secondary)' }}>Kết thúc</label>}
                    <input type="date" className="input-field text-sm" value={a.plannedEnd}
                      onChange={e => setAssign(i, { plannedEnd: e.target.value })} />
                  </div>
                  <button type="button" onClick={() => removeAssign(i)} disabled={assigns.length === 1}
                    title={assigns.length === 1 ? 'Phải còn ít nhất một dòng' : 'Bỏ dòng này'}
                    style={{
                      height: 34, border: 'none', background: 'none', fontWeight: 700, fontSize: '1rem',
                      color: assigns.length === 1 ? 'var(--text-muted)' : '#dc2626',
                      cursor: assigns.length === 1 ? 'not-allowed' : 'pointer',
                      opacity: assigns.length === 1 ? 0.4 : 1,
                    }}>&times;</button>
                </div>
                {bad && <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: 2 }}>{bad}</div>}
              </div>
            )
          })}

          <button type="button" onClick={addAssign}
            style={{
              marginTop: 2, padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
              border: '1px dashed var(--border)', background: 'none', color: 'var(--primary)', cursor: 'pointer',
            }}>+ Xưởng</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.82rem' }}>
          {!preview
            ? <span style={{ color: 'var(--text-muted)' }}>Chọn một ITEM để phát hành</span>
            : badRows.length > 0
              ? <span style={{ color: '#b45309' }}>{badRows[0]}</span>
              : <>Phát hành <b>{willIssue}</b> lệnh · mỗi lệnh <b>{formatNumber(Math.round(preview.weightKg))}</b> kg · <b>{preview.materials.length}</b> loại vật tư</>}
        </span>
        <div style={{ flex: 1 }} />
        <Button variant="outline" onClick={close}>Đóng</Button>
        <Button onClick={issue} disabled={!preview || badRows.length > 0 || issuing}>
          {issuing ? 'Đang phát hành…' : `Phát hành ${willIssue > 1 ? `${willIssue} WO` : 'WO'}`}
        </Button>
      </div>
    </Modal>
  )
}
