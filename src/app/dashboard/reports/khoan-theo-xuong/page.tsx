'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, EmptyState, KPICard, StatusBadge, Button } from '@/components/ui'
import { notify } from '@/components/ui/Toast'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { Hammer } from 'lucide-react'

// Báo cáo khối lượng hoàn thành & giá trị khoán của từng xưởng.
// Ba tầng: Xưởng → Dự án → Lệnh sản xuất. Xưởng chỉ thấy xưởng mình (server chặn).
// Tiền lấy đúng lõi của màn Đơn giá khoán (APL) — không tính lại theo công thức khác.

/** Một công đoạn được giao cho xưởng trong lệnh — làm khâu gì, chủng loại nào, tới đâu */
interface Stage {
  id: string; stageCode: string; name: string; category: string | null; unit: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  unitPrice: number | null
  amount: number | null
}

interface Wo {
  woId: string; woCode: string; item: string | null; status: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  amount: number | null
  /** Công đoạn được giao. Rỗng = lệnh chạy nguyên khối. */
  stages: Stage[]
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

  // ── Bộ lọc ──
  // Màn hình và file Excel dùng CHUNG bộ này: nút Xuất Excel gửi đúng tham số đang lọc,
  // nên file tải về luôn khớp với thứ đang nhìn thấy.
  const [xuong, setXuong] = useState('')
  const [duAn, setDuAn] = useState('')
  const [tuNgay, setTuNgay] = useState('')
  const [denNgay, setDenNgay] = useState('')

  const queryLoc = useCallback(() => {
    const q = new URLSearchParams()
    if (xuong) q.set('xuong', xuong)
    if (duAn) q.set('duAn', duAn)
    if (tuNgay) q.set('tuNgay', tuNgay)
    if (denNgay) q.set('denNgay', denNgay)
    return q.toString()
  }, [xuong, duAn, tuNgay, denNgay])

  const coLoc = !!(xuong || duAn || tuNgay || denNgay)

  // Danh mục cho hai ô chọn. Lấy từ lần nạp KHÔNG lọc đầu tiên — nếu lấy từ dữ liệu đã lọc
  // thì chọn xong một xưởng là danh sách chỉ còn xưởng đó, không quay lại được.
  const [dsXuong, setDsXuong] = useState<{ code: string; name: string }[]>([])
  const [dsDuAn, setDsDuAn] = useState<{ id: string; code: string; name: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const qs = queryLoc()
    const res = await apiFetch(`/api/reports/khoan-theo-xuong${qs ? '?' + qs : ''}`)
    if (res.ok) {
      const list: Shop[] = res.workshops || []
      setShops(list)
      setTotals(res.totals || null)
      setScope(res.scope || null)
      setScopeMissing(!!res.scopeMissing)
      // Chỉ có một xưởng (tài khoản xưởng) thì mở sẵn, khỏi bắt bấm thêm một lần.
      if (list.length === 1) setOpenShop(list[0].teamCode)
      // Chỉ dựng danh mục từ lần nạp KHÔNG có bộ lọc nào.
      if (!qs) {
        setDsXuong(list.map(w => ({ code: w.teamCode, name: w.teamName })))
        const m = new Map<string, { id: string; code: string; name: string }>()
        for (const w of list) for (const pr of w.projects) {
          if (!m.has(pr.projectId)) m.set(pr.projectId, { id: pr.projectId, code: pr.projectCode, name: pr.projectName })
        }
        setDsDuAn([...m.values()].sort((a, b) => a.code.localeCompare(b.code)))
      }
    }
    setLoading(false)
  }, [queryLoc])

  useEffect(() => {
    // Gọi trong microtask để không setState thẳng trong thân effect (gây render dây chuyền).
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  // Xuất Excel — xuất ĐÚNG phần đang lọc, cùng tham số với danh sách trên màn hình.
  const [dangXuat, setDangXuat] = useState(false)

  const xuatExcel = async () => {
    setDangXuat(true)
    try {
      const token = sessionStorage.getItem('ibs_token')
      const qs = queryLoc()
      const res = await fetch(`/api/reports/khoan-theo-xuong/export${qs ? '?' + qs : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        // Lỗi trả về dạng JSON, không phải file — đọc ra để nói đúng chỗ vướng.
        const j = await res.json().catch(() => null)
        notify(j?.error || 'Không xuất được báo cáo')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = decodeURIComponent(
        (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'KhoanTheoXuong.xlsx')
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      notify('Không xuất được báo cáo')
    } finally {
      setDangXuat(false)
    }
  }

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
        subtitle="Bốn tầng: Xưởng → Dự án → Lệnh → Công đoạn. Bấm mũi tên ở xưởng để xổ danh sách dự án, bấm tiếp ở dự án để xem từng lệnh và công đoạn được giao"
        actions={
          <Button variant="outline" disabled={shops.length === 0 || dangXuat} onClick={xuatExcel}
            title="Xuất ra Excel đúng phần đang lọc">
            {dangXuat ? 'Đang xuất…' : 'Xuất Excel'}
          </Button>
        }
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

      {/* ── Bộ lọc ──
          Danh sách bên dưới và nút Xuất Excel đều chạy theo đúng bộ này, nên xuất ra
          luôn khớp với thứ đang nhìn thấy. */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div style={{ minWidth: 170 }}>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Xưởng</label>
            <select className="input-field text-sm w-full" value={xuong} onChange={e => setXuong(e.target.value)}>
              <option value="">Tất cả xưởng</option>
              {dsXuong.map(x => <option key={x.code} value={x.code}>{x.code} — {x.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 240, flex: 1 }}>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Dự án</label>
            <select className="input-field text-sm w-full" value={duAn} onChange={e => setDuAn(e.target.value)}>
              <option value="">Tất cả dự án</option>
              {dsDuAn.map(x => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Từ ngày</label>
            <input type="date" className="input-field text-sm w-full" value={tuNgay} onChange={e => setTuNgay(e.target.value)} />
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Đến ngày</label>
            <input type="date" className="input-field text-sm w-full" value={denNgay} onChange={e => setDenNgay(e.target.value)} />
          </div>
          <Button variant="primary" onClick={() => { void load() }} disabled={loading}>
            {loading ? 'Đang lọc…' : 'Lọc'}
          </Button>
          {coLoc && (
            <Button variant="outline" onClick={() => { setXuong(''); setDuAn(''); setTuNgay(''); setDenNgay('') }}>
              Bỏ lọc
            </Button>
          )}
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
          Khoảng ngày lọc theo <b>ngày báo</b> của phiếu công việc và <b>ngày kiểm</b> của đợt nghiệm thu —
          dùng để chốt khoán theo kỳ. Khối lượng <b>giao</b> không đổi theo ngày.
          {coLoc && <span style={{ color: SEMANTIC_COLORS.info.solid }}> · Nút Xuất Excel sẽ xuất đúng phần đang lọc.</span>}
        </p>
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
                              <Fragment key={o.woId}>
                              <tr style={{ background: 'var(--bg-secondary)' }}>
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

                              {/* Công đoạn được giao trong chính lệnh này — xưởng làm khâu nào,
                                  chủng loại gì, tới đâu. Mỗi công đoạn chạy qua TRỌN khối lượng
                                  của lệnh nên phần trăm là của riêng nó, không cộng lại. */}
                              {o.stages.map(st => (
                                <tr key={st.id} style={{ background: 'var(--bg-primary)' }}>
                                  <td />
                                  <td className="px-2 py-1">
                                    <div style={{ paddingLeft: 68 }}>
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--accent)' }}>{st.stageCode}</span>
                                        <span className="text-[11px] font-medium">{st.name}</span>
                                      </div>
                                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                        {st.category || 'không chia chủng loại'}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono text-[11px]">
                                    {formatNumber(Math.round(st.plannedKg))}
                                    <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{st.unit}</span>
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    {formatNumber(Math.round(st.reportedKg))}
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono text-[11px]"
                                    style={{ color: st.acceptedKg > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                    {formatNumber(Math.round(st.acceptedKg))}
                                  </td>
                                  <td className="px-2 py-1"><Pct value={st.ratio} /></td>
                                  <td className="px-2 py-1 text-right font-mono text-[11px]">
                                    {st.unitPrice === null
                                      ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>chưa có đơn giá</span>
                                      : formatNumber(Math.round(st.amount ?? 0)) + ' ₫'}
                                  </td>
                                </tr>
                              ))}
                              </Fragment>
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
