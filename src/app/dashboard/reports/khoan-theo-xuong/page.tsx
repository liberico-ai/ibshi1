'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, EmptyState, KPICard, StatusBadge } from '@/components/ui'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Hammer } from 'lucide-react'

// Báo cáo khối lượng hoàn thành & giá trị khoán của từng xưởng.
// Ba tầng: Xưởng → Dự án → Lệnh sản xuất. Xưởng chỉ thấy xưởng mình (server chặn).
// Tiền lấy đúng lõi của màn Đơn giá khoán (APL) — không tính lại theo công thức khác.

interface Wo {
  woId: string; woCode: string; item: string | null; status: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  amount: number | null
}
interface Proj {
  projectId: string; projectCode: string; projectName: string
  woCount: number; plannedKg: number; reportedKg: number; acceptedKg: number
  ratio: number; amount: number; woWithoutPrice: number
  wos: Wo[]
}
/** Tổng toàn báo cáo — mỗi ITEM đếm MỘT lần, không cộng ngang các xưởng */
interface Totals { plannedKg: number; reportedKg: number; acceptedKg: number; workloadKg: number }

interface Shop {
  teamCode: string; teamName: string
  projectCount: number; woCount: number
  plannedKg: number; reportedKg: number; acceptedKg: number
  ratio: number; amount: number; woWithoutPrice: number
  projects: Proj[]
}

function Pct({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="h-1.5 rounded-full" style={{ width: 56, background: 'var(--border-light)' }}>
        <div className="h-full rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, background: SEMANTIC_COLORS.success.solid }} />
      </div>
      <span className="font-mono text-[11px]" style={{ minWidth: 30, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

/** Tầng xưởng/dự án đếm SỐ LỆNH đã xong — không quy ra phần trăm của dự án. */
function DoneCount({ done, total }: { done: number; total: number }) {
  return (
    <div className="text-right text-[11px] font-mono" style={{ color: done > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
      {done}/{total} lệnh xong
    </div>
  )
}

export default function KhoanTheoXuongPage() {
  const [shops, setShops] = useState<Shop[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [scope, setScope] = useState<{ code: string; name: string } | null>(null)
  const [scopeMissing, setScopeMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [openShop, setOpenShop] = useState<string | null>(null)
  const [openProject, setOpenProject] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/reports/khoan-theo-xuong')
    if (res.ok) {
      const list: Shop[] = res.workshops || []
      setShops(list)
      setTotals(res.totals || null)
      setScope(res.scope || null)
      setScopeMissing(!!res.scopeMissing)
      // Chỉ có một xưởng (tài khoản xưởng) thì mở sẵn, khỏi bắt bấm thêm một lần.
      if (list.length === 1) setOpenShop(list[0].teamCode)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Gọi trong microtask để không setState thẳng trong thân effect (gây render dây chuyền).
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  const totalAmount = shops.reduce((s, w) => s + w.amount, 0)
  const noPrice = shops.reduce((s, w) => s + w.woWithoutPrice, 0)
  // KL của dự án = cộng các dòng ITEM, mỗi ITEM MỘT lần. Một ITEM giao 5 xưởng vẫn là một
  // lượng thép — cộng ngang các xưởng là nhân lên 5 lần. Số cộng ngang để riêng ở dòng dưới.
  const totalPlanned = totals?.plannedKg ?? 0
  const totalAccepted = totals?.acceptedKg ?? 0
  const workloadKg = totals?.workloadKg ?? 0

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Khoán theo xưởng"
        subtitle="Ba tầng: Xưởng → Dự án → Lệnh. Bấm mũi tên ở xưởng để xổ danh sách dự án, bấm tiếp ở dự án để xem từng lệnh được giao"
      />

      {scope && (
        <div className="card p-3 text-sm" style={{ borderLeft: `4px solid ${SEMANTIC_COLORS.info.solid}` }}>
          Bạn đang xem số liệu của <b>{scope.name}</b> ({scope.code}) — xưởng chỉ thấy phần việc của xưởng mình.
        </div>
      )}
      {scopeMissing && (
        <div className="card p-3 text-sm" style={{ borderLeft: `4px solid ${SEMANTIC_COLORS.warning.solid}` }}>
          Tài khoản của bạn chưa được gắn xưởng nên chưa có số liệu — nhờ Hành chính Nhân sự gắn phòng/xưởng.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Xưởng có việc" value={String(shops.length)} accentColor={SEMANTIC_COLORS.neutral.solid} />
        <KPICard label="KL giao (mỗi ITEM 1 lần)" value={`${formatNumber(Math.round(totalPlanned))} kg`} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="KL đã nghiệm thu" value={`${formatNumber(Math.round(totalAccepted))} kg`} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard label="Giá trị khoán" value={formatCurrency(totalAmount)} accentColor={SEMANTIC_COLORS.warning.solid} />
      </div>

      {workloadKg > totalPlanned && (
        <div className="card p-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Cộng cột <b>KL GIAO</b> của các xưởng ra <b>{formatNumber(Math.round(workloadKg))} kg</b> — lớn hơn
          khối lượng thật <b>{formatNumber(Math.round(totalPlanned))} kg</b>, vì một ITEM giao cho nhiều xưởng
          thì xưởng nào cũng nhận trọn khối lượng của ITEM đó. Đó là <b>khối lượng việc</b> của từng xưởng,
          không phải số tấn thép cộng thêm.
        </div>
      )}

      {noPrice > 0 && (
        <div className="card p-3 text-xs" style={{ borderLeft: `4px solid ${SEMANTIC_COLORS.warning.solid}`, color: 'var(--text-secondary)' }}>
          Có <b>{noPrice}</b> lệnh chưa tính được tiền vì ITEM chưa có đơn giá khoán — số tiền bên dưới chưa đủ.
          KTKH nhập ở màn <b>Đơn giá khoán (APL)</b>.
        </div>
      )}

      {!loading && shops.length === 0 && (
        <EmptyState icon={<Hammer />} title="Chưa có số liệu"
          description="Chưa có lệnh sản xuất nào được giao cho xưởng, hoặc chưa xưởng nào báo khối lượng" />
      )}

      {shops.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  <th className="px-2 py-2 text-left w-6"></th>
                  <th className="px-2 py-2 text-left">XƯỞNG / DỰ ÁN / LỆNH</th>
                  <th className="px-2 py-2 text-right">KL GIAO</th>
                  <th className="px-2 py-2 text-right">ĐÃ BÁO</th>
                  <th className="px-2 py-2 text-right">ĐÃ NGHIỆM THU</th>
                  <th className="px-2 py-2 text-right" style={{ minWidth: 118 }}>HOÀN THÀNH</th>
                  <th className="px-2 py-2 text-right">GIÁ TRỊ KHOÁN</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="px-2 py-6 text-center" style={{ color: 'var(--text-muted)' }}>Đang tải…</td></tr>}

                {shops.map(w => {
                  const shopOpen = openShop === w.teamCode
                  // Chỉ đếm LỆNH đã nghiệm thu xong. KHÔNG lấy phần trăm của lệnh làm phần trăm
                  // của dự án — xưởng chỉ giữ một phần việc, con số đó không nói gì về dự án.
                  const shopDone = w.projects.reduce((n, pr) => n + pr.wos.filter(x => x.ratio >= 1).length, 0)
                  return (
                    <Fragment key={w.teamCode}>
                      <tr style={{ borderTop: '1px solid var(--border-light)', background: shopOpen ? 'var(--bg-secondary)' : undefined }}>
                        <td className="px-2 py-2">
                          <button onClick={() => { setOpenShop(shopOpen ? null : w.teamCode); setOpenProject(null) }}
                            style={{ color: 'var(--text-muted)' }}>{shopOpen ? '▼' : '▶'}</button>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0"
                              style={{ background: 'var(--accent)', color: '#fff', letterSpacing: '0.04em' }}>Xưởng</span>
                            <span className="font-bold" style={{ color: 'var(--accent)' }}>{w.teamName}</span>
                          </div>
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {w.teamCode} · {w.projectCount} dự án · {w.woCount} lệnh
                            {w.woWithoutPrice > 0 && (
                              <span style={{ color: SEMANTIC_COLORS.warning.solid }}> · {w.woWithoutPrice} lệnh chưa có đơn giá</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{formatNumber(Math.round(w.plannedKg))}</td>
                        <td className="px-2 py-2 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{formatNumber(Math.round(w.reportedKg))}</td>
                        <td className="px-2 py-2 text-right font-mono font-bold"
                          style={{ color: w.acceptedKg > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                          {formatNumber(Math.round(w.acceptedKg))}
                        </td>
                        <td className="px-2 py-2"><DoneCount done={shopDone} total={w.woCount} /></td>
                        <td className="px-2 py-2 text-right font-mono font-bold">{formatCurrency(w.amount)}</td>
                      </tr>

                      {shopOpen && w.projects.map(p => {
                        const projOpen = openProject === `${w.teamCode}:${p.projectId}`
                        return (
                          <Fragment key={p.projectId}>
                            <tr style={{ background: 'var(--bg-primary)' }}>
                              <td className="px-2 py-1.5 text-right">
                                <button onClick={() => setOpenProject(projOpen ? null : `${w.teamCode}:${p.projectId}`)}
                                  style={{ color: 'var(--text-muted)' }}>{projOpen ? '▼' : '▶'}</button>
                              </td>
                              <td className="px-2 py-1.5">
                                <div style={{ paddingLeft: 20 }}>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0"
                                      style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', letterSpacing: '0.04em' }}>Dự án</span>
                                    <span className="font-mono font-semibold">{p.projectCode}</span>
                                  </div>
                                  <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)', maxWidth: 340 }}>
                                    {p.projectName} · {p.woCount} lệnh — bấm để xem từng lệnh
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">{formatNumber(Math.round(p.plannedKg))}</td>
                              <td className="px-2 py-1.5 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{formatNumber(Math.round(p.reportedKg))}</td>
                              <td className="px-2 py-1.5 text-right font-mono"
                                style={{ color: p.acceptedKg > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                {formatNumber(Math.round(p.acceptedKg))}
                              </td>
                              <td className="px-2 py-1.5"><DoneCount done={p.wos.filter(x => x.ratio >= 1).length} total={p.woCount} /></td>
                              <td className="px-2 py-1.5 text-right font-mono font-semibold">{formatCurrency(p.amount)}</td>
                            </tr>

                            {projOpen && p.wos.map(o => (
                              <tr key={o.woId} style={{ background: 'var(--bg-secondary)' }}>
                                <td />
                                <td className="px-2 py-1">
                                  <div style={{ paddingLeft: 44 }}>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[9px] font-semibold uppercase shrink-0" style={{ color: 'var(--text-muted)' }}>Lệnh</span>
                                      <span className="font-mono text-[11px] truncate" style={{ maxWidth: 300 }}>{o.woCode}</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{o.item || 'không gắn ITEM'}</span>
                                      <StatusBadge category="production" status={o.status} />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-2 py-1 text-right font-mono text-[11px]">{formatNumber(Math.round(o.plannedKg))}</td>
                                <td className="px-2 py-1 text-right font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatNumber(Math.round(o.reportedKg))}</td>
                                <td className="px-2 py-1 text-right font-mono text-[11px]"
                                  style={{ color: o.acceptedKg > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                  {formatNumber(Math.round(o.acceptedKg))}
                                </td>
                                <td className="px-2 py-1"><Pct value={o.ratio} /></td>
                                <td className="px-2 py-1 text-right font-mono text-[11px]">
                                  {o.amount === null
                                    ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>chưa có đơn giá</span>
                                    : formatCurrency(o.amount)}
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
