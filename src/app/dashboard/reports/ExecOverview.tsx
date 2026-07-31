'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { formatNumber } from '@/lib/utils'
import { Button, Modal } from '@/components/ui'
import { notify } from '@/components/ui/Toast'
import { EXEC_INDICATORS } from '@/lib/exec-indicators'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const C_KH = '#b45309', C_TH = '#15803d', C_LK = '#1d4ed8'   // KH · TH · Lũy kế (khớp màu prototype)

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

interface Row {
  stt: string; key: string; label: string; unit: string; owner: string; deadline: string
  source: 'auto' | 'manual'; note?: string
  kh: number | null; th: number | null; luyKe: number | null
}
interface ExecData { year: number; month: number; annual: Record<string, number>; rows: Row[]; canEdit: boolean }

function fmt(v: number | null, unit: string): string {
  if (v == null) return '—'
  if (unit === '%') return `${formatNumber(v)}%`
  return formatNumber(v)
}
function short(v: number | null): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} tỷ`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} tr`
  return formatNumber(v)
}

// Tab "Điều hành" — 13 chỉ số báo cáo tháng (KH · TH · Lũy kế) + KPI kế hoạch năm.
export default function ExecOverview() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<ExecData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [actualOpen, setActualOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/reports/exec-monthly?period=${year}-${month}`).then(res => {
      if (res.ok) { setData(res as ExecData); setErr('') }
      else setErr(res.error || 'Không tải được dữ liệu báo cáo')
      setLoading(false)
    }).catch(() => { setErr('Lỗi mạng khi tải báo cáo'); setLoading(false) })
  }, [year, month])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* Kỳ + hành động */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Kỳ:</span>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input" style={{ padding: '4px 8px', fontSize: '0.85rem' }}>
            {MONTHS.map(m => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input" style={{ padding: '4px 8px', fontSize: '0.85rem' }}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {data?.canEdit && (
          <>
            <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)}>Nhập Kế hoạch</Button>
            <Button variant="outline" size="sm" onClick={() => setActualOpen(true)}>Nhập TH tay</Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
      ) : err || !data ? (
        <div className="card p-6 text-center" style={{ color: 'var(--danger)' }}>{err || 'Không có dữ liệu'}</div>
      ) : (
        <>
          {/* KPI Kế hoạch năm */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { lb: 'Doanh số ký mới (KH năm)', v: data.annual.doanhSoKyMoi_ty, u: 'tỷ' },
              { lb: 'Sản lượng (KH năm)', v: data.annual.sanLuong_tan, u: 'tấn' },
              { lb: 'LNTT (KH năm)', v: data.annual.lntt_ty, u: 'tỷ' },
              { lb: 'Tổng doanh thu (KH năm)', v: data.annual.tongDoanhThu_ty, u: 'tỷ' },
            ].map(k => (
              <div key={k.lb} className="card p-4">
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>{k.lb}</div>
                <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {k.v != null ? `${formatNumber(k.v)} ${k.u}` : '—'}
                </div>
              </div>
            ))}
          </div>

          {/* 2 biểu đồ (giống prototype) */}
          {mounted && (() => {
            const g = (key: string) => data.rows.find(r => r.key === key)
            const ty = (v: number | null | undefined) => (v == null ? 0 : +(v / 1e9).toFixed(2))
            const tan = (v: number | null | undefined) => (v == null ? 0 : +(v / 1000).toFixed(1))
            const kyMoi = g('contract_new_value'), thuHoi = g('capital_recovery')
            const chartA = [
              { name: 'Ký mới', 'KH tháng': ty(kyMoi?.kh), 'TH tháng': ty(kyMoi?.th), 'Lũy kế': ty(kyMoi?.luyKe) },
              { name: 'Thu hồi vốn', 'KH tháng': ty(thuHoi?.kh), 'TH tháng': ty(thuHoi?.th), 'Lũy kế': ty(thuHoi?.luyKe) },
            ]
            const nhaMay = g('volume_factory'), thauPhu = g('volume_subcontractor')
            const chartB = [
              { name: 'Nhà máy', 'KH tháng': tan(nhaMay?.kh), 'TH tháng': tan(nhaMay?.th) },
              { name: 'Thầu phụ', 'KH tháng': tan(thauPhu?.kh), 'TH tháng': tan(thauPhu?.th) },
            ]
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="card p-4">
                  <h3 className="font-heading text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Ký mới &amp; Thu hồi vốn — Tháng {month}/{year} (tỷ đồng)</h3>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>KH tháng · TH tháng · Lũy kế</p>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartA} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [`${v} tỷ`]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="KH tháng" fill={C_KH} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="TH tháng" fill={C_TH} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Lũy kế" fill={C_LK} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card p-4">
                  <h3 className="font-heading text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Khối lượng thực hiện — Nhà máy vs Thầu phụ (tấn)</h3>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>KH tháng vs TH tháng · kỳ Tháng {month}/{year}</p>
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartB} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [`${v} tấn`]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="KH tháng" fill={C_KH} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="TH tháng" fill={C_TH} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Bảng 13 chỉ số */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 pb-2">
              <h3 className="font-heading text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Chỉ số báo cáo tháng — kỳ Tháng {month}/{year}</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Ô &quot;—&quot; = chưa có nguồn / chưa nhập. Chỉ số <b>auto</b> tự sinh từ ERP; <b>manual</b> nhập tay.</p>
            </div>
            <div className="dt-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>STT</th><th>Chỉ số</th><th>ĐV</th>
                    <th style={{ textAlign: 'right' }}>KH tháng</th>
                    <th style={{ textAlign: 'right' }}>TH tháng</th>
                    <th style={{ textAlign: 'right' }}>Lũy kế</th>
                    <th>Phụ trách</th><th>Nguồn</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => {
                    const money = r.unit === 'VND' || r.unit === 'VND/tháng'
                    const disp = (v: number | null) => money ? short(v) : fmt(v, r.unit)
                    const behind = r.kh != null && r.th != null && r.th < r.kh
                    return (
                      <tr key={r.key}>
                        <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{r.stt}</td>
                        <td className="text-xs" style={{ color: 'var(--text-primary)' }}>
                          {r.label}
                          {r.note && <span title={r.note} className="ml-1" style={{ color: 'var(--warning)', cursor: 'help' }}>ⓘ</span>}
                        </td>
                        <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.unit}</td>
                        <td className="font-mono text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{disp(r.kh)}</td>
                        <td className="font-mono text-xs font-bold" style={{ textAlign: 'right', color: behind ? 'var(--danger)' : 'var(--success)' }}>{disp(r.th)}</td>
                        <td className="font-mono text-xs" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{disp(r.luyKe)}</td>
                        <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.owner}</td>
                        <td>
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: r.source === 'auto' ? 'var(--success)' : 'var(--warning)' }}>
                            {r.source === 'auto' ? 'auto' : 'tay'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {planOpen && <PlanModal year={year} month={month} onClose={() => setPlanOpen(false)} onSaved={() => { setPlanOpen(false); load() }} />}
      {actualOpen && data && <ActualModal year={year} month={month} rows={data.rows} onClose={() => setActualOpen(false)} onSaved={() => { setActualOpen(false); load() }} />}
    </div>
  )
}

// ── Nhập Kế hoạch (KH tháng đang chọn + KPI năm) ──
function PlanModal({ year, month, onClose, onSaved }: { year: number; month: number; onClose: () => void; onSaved: () => void }) {
  const [annual, setAnnual] = useState<Record<string, number | ''>>({})
  const [monthly, setMonthly] = useState<Record<string, number | ''>>({})
  const [full, setFull] = useState<{ annual: Record<string, number>; indicators: Record<string, { monthly?: Record<string, number> }> }>({ annual: {}, indicators: {} })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch(`/api/reports/exec-plan?year=${year}`).then(res => {
      if (res.ok) {
        const p = res.plan || { annual: {}, indicators: {} }
        setFull({ annual: p.annual || {}, indicators: p.indicators || {} })
        setAnnual(p.annual || {})
        const mo: Record<string, number | ''> = {}
        for (const ind of EXEC_INDICATORS) mo[ind.key] = p.indicators?.[ind.key]?.monthly?.[String(month)] ?? ''
        setMonthly(mo)
      }
    })
  }, [year, month])

  const save = async () => {
    setSaving(true)
    const indicators = { ...full.indicators }
    for (const ind of EXEC_INDICATORS) {
      const v = monthly[ind.key]
      const cur = indicators[ind.key]?.monthly || {}
      if (v === '' || v == null) { delete cur[String(month)] } else { cur[String(month)] = Number(v) }
      indicators[ind.key] = { monthly: cur }
    }
    const annualClean: Record<string, number> = {}
    for (const [k, v] of Object.entries(annual)) if (v !== '' && v != null) annualClean[k] = Number(v)
    const res = await apiFetch('/api/reports/exec-plan', { method: 'PUT', body: JSON.stringify({ year, annual: annualClean, indicators }) })
    setSaving(false)
    if (res.ok) { notify('Đã lưu kế hoạch', 'success'); onSaved() } else notify(res.error || 'Lỗi lưu', 'error')
  }

  const annualFields = [
    { k: 'doanhSoKyMoi_ty', lb: 'Doanh số ký mới (tỷ)' }, { k: 'sanLuong_tan', lb: 'Sản lượng (tấn)' },
    { k: 'lntt_ty', lb: 'LNTT (tỷ)' }, { k: 'tongDoanhThu_ty', lb: 'Tổng doanh thu (tỷ)' },
  ]
  const cell = { width: '100%', padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--bg-primary)', fontSize: '0.8rem' }

  return (
    <Modal open onClose={onClose} title={`Nhập Kế hoạch — Tháng ${month}/${year}`} size="lg"
      actions={<Button variant="primary" onClick={save} loading={saving}>Lưu kế hoạch</Button>}>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Kế hoạch năm {year}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {annualFields.map(f => (
              <div key={f.k}>
                <label className="text-xs" style={{ color: 'var(--text-muted)' }}>{f.lb}</label>
                <input type="number" value={annual[f.k] ?? ''} onChange={e => setAnnual(p => ({ ...p, [f.k]: e.target.value === '' ? '' : Number(e.target.value) }))} style={cell} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Chỉ tiêu Tháng {month} (KH tháng)</div>
          <div className="dt-wrapper">
            <table className="data-table">
              <thead><tr><th>Chỉ số</th><th>ĐV</th><th style={{ width: 160 }}>KH tháng</th></tr></thead>
              <tbody>
                {EXEC_INDICATORS.map(ind => (
                  <tr key={ind.key}>
                    <td className="text-xs">{ind.stt} · {ind.label}</td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{ind.unit}</td>
                    <td><input type="number" value={monthly[ind.key] ?? ''} onChange={e => setMonthly(p => ({ ...p, [ind.key]: e.target.value === '' ? '' : Number(e.target.value) }))} style={cell} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Nhập TH tay (chỉ chỉ số manual) ──
function ActualModal({ year, month, rows, onClose, onSaved }: { year: number; month: number; rows: Row[]; onClose: () => void; onSaved: () => void }) {
  const manualRows = rows.filter(r => r.source === 'manual')
  const [vals, setVals] = useState<Record<string, number | ''>>(() => {
    const o: Record<string, number | ''> = {}
    for (const r of manualRows) o[r.key] = r.th ?? ''
    return o
  })
  const [saving, setSaving] = useState(false)
  const cell = { width: '100%', padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--bg-primary)', fontSize: '0.8rem' }

  const save = async () => {
    setSaving(true)
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(vals)) if (v !== '' && v != null) values[k] = Number(v)
    const res = await apiFetch('/api/reports/exec-monthly', { method: 'POST', body: JSON.stringify({ year, month, values }) })
    setSaving(false)
    if (res.ok) { notify('Đã lưu số liệu thực hiện', 'success'); onSaved() } else notify(res.error || 'Lỗi lưu', 'error')
  }

  return (
    <Modal open onClose={onClose} title={`Nhập Thực hiện (tay) — Tháng ${month}/${year}`} size="md"
      actions={<Button variant="primary" onClick={save} loading={saving}>Lưu</Button>}>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Chỉ các chỉ số chưa có nguồn tự sinh. Chỉ số auto lấy từ ERP, không nhập ở đây.</p>
      <div className="dt-wrapper">
        <table className="data-table">
          <thead><tr><th>Chỉ số</th><th>ĐV</th><th style={{ width: 160 }}>TH tháng</th></tr></thead>
          <tbody>
            {manualRows.map(r => (
              <tr key={r.key}>
                <td className="text-xs">{r.stt} · {r.label}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.unit}</td>
                <td><input type="number" value={vals[r.key] ?? ''} onChange={e => setVals(p => ({ ...p, [r.key]: e.target.value === '' ? '' : Number(e.target.value) }))} style={cell} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
