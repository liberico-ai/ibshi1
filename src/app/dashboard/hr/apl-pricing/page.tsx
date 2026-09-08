'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, Button, EmptyState, SelectField, InputField, KPICard, StatusBadge } from '@/components/ui'
import { formatCurrency, formatNumber } from '@/lib/utils'
// Lệnh giao cả dự án đứng thành dòng riêng, không mang mã ITEM nào.
import { tenHangMuc } from '@/lib/hang-muc'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { unitLabel } from '@/lib/wo-units'
import { Calculator } from 'lucide-react'
import { notify, confirmDialog } from '@/components/ui/Toast'

// Bảng tổng hợp & thanh toán lương khoán.
// Nhập đơn giá theo ITEM. Một ITEM giao được cho NHIỀU xưởng — mỗi xưởng một lệnh, mỗi lệnh
// mang TRỌN khối lượng của ITEM (xưởng cắt cắt hết, xưởng hàn hàn hết).
// Dòng ITEM KHÔNG hiện KL đã nghiệm thu: một ITEM qua nhiều công đoạn nên con số đó là tổng
// cộng dồn, vượt KL thiết kế và gây hiểu nhầm. Xổ ITEM ra mới thấy KL nghiệm thu của TỪNG
// công đoạn — đó mới là con số đọc được.
// Thành tiền luôn tính trên KHỐI LƯỢNG ĐÃ NGHIỆM THU, không phải KL thiết kế, và CỘNG DỒN
// qua mọi xưởng — nghiệm thu tới đâu tính tiền tới đó.

interface Row {
  item: string; blocks: number; detailLines: number
  plannedKg: number; acceptedKg: number
  woCode: string | null; woStatus: string | null; teamCode: string | null
  shops: { teamCode: string | null; woCode: string; status: string }[]
  /** % hoàn thành của hạng mục — trung bình các phần việc ĐANG được giao */
  ratio: number
  /** Số phần việc đang giao — mẫu số của ratio, đổi khi giao thêm hoặc bớt xưởng */
  woCount: number
  unitPrice: number | null; overrides: number; amount: number | null
  /** Trần của hạng mục = đơn giá ITEM × KL thiết kế */
  cap: number | null
  /** Đã nghiệm thu xong ở mọi xưởng mà tiền vượt trần */
  overCap: boolean
  /** Số xưởng đã có KL nghiệm thu nhưng chưa đặt đơn giá (tiền của họ đang là 0) */
  shopsWithoutPrice: number
}

/** Một ĐỢT nghiệm thu của một lệnh — xưởng báo nhiều lần thì nhiều đợt */
interface Batch {
  itpCode: string; qty: number; date: string | null
  /** Công đoạn của dòng này; null = lệnh chạy nguyên khối */
  stage: string | null
  stageCode: string
  signed: boolean; failed: boolean; amount: number | null
}

/** Một xưởng được giao ITEM này */
interface Shop {
  woCode: string; teamCode: string | null; status: string
  /** Đơn vị đo của lệnh — kg, m², mét… Đơn giá xưởng tính trên đơn vị này, không phải đồng/kg. */
  unit: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  /** Chỉ dùng cho lệnh KHÔNG chia công đoạn; lệnh có công đoạn thì giá nằm ở từng công đoạn */
  unitPrice: number | null
  amount: number | null
  /** Công đoạn của lệnh — ĐƠN GIÁ KHOÁN nhập ở đây */
  stages: ShopStage[]
  batches: Batch[]
}

/** Một công đoạn trong lệnh của xưởng — đơn vị nhỏ nhất có đơn giá khoán */
interface ShopStage {
  id: string; stageCode: string; name: string; category: string | null; unit: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  unitPrice: number | null
  amount: number | null
  plannedAmount: number | null
}

interface Totals {
  plannedKg: number; acceptedKg: number; totalAmount: number; plannedAmount: number
  itemsTotal: number; itemsPriced: number; itemsAccepted: number
  itemsOverCap: number
  linesWithoutPrice: number; canComplete: boolean
}

const WO_LABEL: Record<string, string> = {
  OPEN: 'Mở', IN_PROGRESS: 'Đang SX', QC_PENDING: 'Chờ nghiệm thu', QC_PASSED: 'Đã nghiệm thu',
  QC_FAILED: 'Không đạt', COMPLETED: 'Xong', ON_HOLD: 'Tạm dừng', PENDING_MATERIAL: 'Chờ VT',
}

export default function AplPricingPage() {
  const [projects, setProjects] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [projectId, setProjectId] = useState('')
  const [apl, setApl] = useState<{ fileName: string } | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [pricing, setPricing] = useState<{ status: string; completedAt: string | null } | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Đơn giá vừa gõ, chưa lưu. Khoá ITEM là `item:<tên>`, khoá dòng chi tiết là id của dòng.
  const [draft, setDraft] = useState<Record<string, string>>({})
  // ITEM đang xổ ra dòng chi tiết
  const [expanded, setExpanded] = useState<string | null>(null)
  // Xổ một ITEM ra = danh sách XƯỞNG được giao, không còn dòng cụm/chi tiết.
  const [shops, setShops] = useState<Shop[]>([])
  const [loadingChildren, setLoadingChildren] = useState(false)

  const user = useAuthStore(s => s.user)
  const locked = pricing?.status === 'COMPLETED'
  const editable = canEdit && !locked

  useEffect(() => {
    apiFetch('/api/projects/options').then(r => { if (r.ok) setProjects(r.projects || []) })
  }, [])

  const load = useCallback(async (pid: string, s: string) => {
    if (!pid) return
    setLoading(true)
    const qs = new URLSearchParams({ projectId: pid })
    if (s) qs.set('search', s)
    const res = await apiFetch(`/api/hr/apl-pricing?${qs}`)
    if (res.ok) {
      setApl(res.apl)
      setRows(res.rows || [])
      setTotals(res.totals)
      setPricing(res.pricing)
      setCanEdit(!!res.canEdit)
    } else notify(res.error || 'Không tải được bảng đơn giá')
    setLoading(false)
  }, [])

  // Không dùng effect đồng bộ: mỗi thao tác tự gọi load với tham số của chính nó,
  // tránh setState trong effect gây render lồng.
  const onProject = (pid: string) => {
    setProjectId(pid); setDraft({}); setExpanded(null); setShops([]); setSearch('')
    if (pid) load(pid, '')
  }
  const onSearch = (v: string) => { setSearch(v); setExpanded(null); load(projectId, v) }

  const loadShops = async (item: string) => {
    setLoadingChildren(true)
    const res = await apiFetch(`/api/hr/apl-pricing?projectId=${projectId}&item=${encodeURIComponent(item)}`)
    setShops(res.ok ? (res.workshops || []) : [])
    setLoadingChildren(false)
  }

  const toggleItem = async (item: string) => {
    if (expanded === item) { setExpanded(null); setShops([]); return }
    setExpanded(item); setShops([])
    await loadShops(item)
  }

  const dirtyCount = Object.keys(draft).length

  const save = async () => {
    if (dirtyCount === 0) return notify('Chưa có thay đổi nào để lưu')
    setSaving(true)
    const itemPrices: { item: string; unitPrice: number | null }[] = []
    const linePrices: { aplLineId: string; unitPrice: number | null }[] = []
    const shopPrices: { item: string; teamCode: string; stageCode: string; unitPrice: number | null }[] = []
    for (const [key, v] of Object.entries(draft)) {
      const price = v.trim() === '' ? null : Number(v)
      if (key.startsWith('item:')) itemPrices.push({ item: key.slice(5), unitPrice: price })
      // shop:<item>::<teamCode>::<stageCode> — đơn giá của MỘT công đoạn trong lệnh của xưởng.
      // stageCode rỗng = lệnh chạy nguyên khối, giá đặt cho cả lệnh.
      else if (key.startsWith('shop:')) {
        const rest = key.slice(5)
        const j = rest.lastIndexOf('::')
        const i = rest.lastIndexOf('::', j - 1)
        shopPrices.push({
          item: rest.slice(0, i), teamCode: rest.slice(i + 2, j),
          stageCode: rest.slice(j + 2), unitPrice: price,
        })
      }
      else linePrices.push({ aplLineId: key, unitPrice: price })
    }
    const res = await apiFetch('/api/hr/apl-pricing', {
      method: 'POST',
      body: JSON.stringify({ projectId, itemPrices, linePrices, shopPrices }),
    })
    setSaving(false)
    if (res.ok) {
      notify(res.message || 'Đã lưu')
      setDraft({})
      await load(projectId, search)
      if (expanded !== null) await loadShops(expanded)
    } else notify(res.error || 'Lỗi lưu đơn giá')
  }

  const complete = async () => {
    if (dirtyCount > 0) return notify('Còn thay đổi chưa lưu — bấm Lưu trước đã')
    if (!(await confirmDialog('Chốt bảng đơn giá khoán? Sau khi chốt sẽ không sửa được nữa.'))) return
    setSaving(true)
    const res = await apiFetch('/api/hr/apl-pricing/complete', {
      method: 'POST', body: JSON.stringify({ projectId }),
    })
    setSaving(false)
    if (res.ok) { notify(res.message || 'Đã chốt'); load(projectId, search) }
    else notify(res.error || 'Chưa chốt được')
  }

  const reopen = async () => {
    if (!(await confirmDialog('Mở lại bảng đơn giá đã chốt?'))) return
    const res = await apiFetch('/api/hr/apl-pricing/complete', {
      method: 'DELETE', body: JSON.stringify({ projectId }),
    })
    if (res.ok) { notify(res.message || 'Đã mở lại'); load(projectId, search) }
    else notify(res.error || 'Không mở lại được')
  }

  // Tiền hiển thị: formatCurrency(0) trả '-', đọc ra như "chưa tính được" trong khi thật ra là
  // ĐÃ tính và bằng 0 (chưa nghiệm thu đồng nào). Ở bảng khoán phải phân biệt hai chuyện đó.
  const tienVND = (n: number) => formatNumber(Math.round(n)) + ' ₫'

  // Số hiển thị trong ô: ưu tiên bản nháp đang gõ
  const cellValue = (key: string, saved: number | null) =>
    draft[key] !== undefined ? draft[key] : (saved === null ? '' : String(saved))

  // Thành tiền hiện ngay theo số đang gõ, không phải chờ lưu mới thấy
  const liveAmount = (key: string, saved: number | null, acceptedKg: number) => {
    const raw = cellValue(key, saved)
    if (raw.trim() === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? Math.round(acceptedKg * n) : null
  }

  const isR03 = ['R01', 'R03', 'R03a'].includes(user?.roleCode || '')

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Tổng hợp & thanh toán lương khoán"
        subtitle="Nhập đơn giá theo ITEM — thành tiền tính trên khối lượng ĐÃ NGHIỆM THU"
      />

      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectField
            label="Dự án *"
            value={projectId}
            onChange={e => onProject(e.target.value)}
            options={[{ value: '', label: 'Chọn dự án...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]}
          />
          <InputField
            label="Tìm ITEM"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="VD: INLET DUCT"
          />
        </div>
        {apl && <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>APL: <span className="font-mono">{apl.fileName}</span></p>}
      </div>

      {!projectId && <EmptyState icon={<Calculator />} title="Chọn dự án" description="Chọn dự án đã import APL để nhập đơn giá khoán" />}

      {projectId && !apl && !loading && (
        <EmptyState icon={<Calculator />} title="Dự án chưa có APL" description="Thiết kế phải import file APL trước khi nhập đơn giá khoán" />
      )}

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="KL thiết kế" value={`${formatNumber(Math.round(totals.plannedKg))} kg`} accentColor={SEMANTIC_COLORS.neutral.solid} />
          <KPICard label="KL đã nghiệm thu (cộng dồn các công đoạn)" value={`${formatNumber(Math.round(totals.acceptedKg))} kg`} accentColor={SEMANTIC_COLORS.success.solid} />
          <KPICard label="ITEM đã có đơn giá" value={`${totals.itemsPriced}/${totals.itemsTotal}`} accentColor={SEMANTIC_COLORS.info.solid} />
          <KPICard label="ITEM đã nghiệm thu" value={`${totals.itemsAccepted}/${totals.itemsTotal}`} accentColor={SEMANTIC_COLORS.warning.solid} />
        </div>
      )}

      {locked && (
        <div className="card p-3 flex items-center justify-between" style={{ borderLeft: `4px solid ${SEMANTIC_COLORS.success.solid}` }}>
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Bảng đơn giá <b>đã chốt</b>{pricing?.completedAt ? ` ngày ${new Date(pricing.completedAt).toLocaleDateString('vi-VN')}` : ''} — không sửa được nữa.
          </span>
          {isR03 && <Button variant="outline" size="sm" onClick={reopen}>Mở lại</Button>}
        </div>
      )}

      {totals && totals.itemsOverCap > 0 && (
        <div className="card p-3 text-sm" style={{ borderLeft: `4px solid ${SEMANTIC_COLORS.danger.solid}`, color: 'var(--text-primary)' }}>
          <b style={{ color: SEMANTIC_COLORS.danger.solid }}>{totals.itemsOverCap} hạng mục vượt trần khoán</b>
          {' '}— tổng tiền các xưởng lớn hơn (đơn giá hạng mục × khối lượng thiết kế).
          Xem dòng tô đỏ bên dưới và chỉnh lại đơn giá của từng xưởng.
        </div>
      )}

      {apl && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  <th className="px-2 py-2 text-left w-6"></th>
                  <th className="px-2 py-2 text-left">ITEM</th>
                  <th className="px-2 py-2 text-left">Lệnh SX · Xưởng</th>
                  <th className="px-2 py-2 text-right">KL thiết kế</th>
                  <th className="px-2 py-2 text-right" style={{ minWidth: 120 }}>Đơn giá (đ/kg)</th>
                  <th className="px-2 py-2 text-right" style={{ minWidth: 150 }}>Giá trị khoán</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-2 py-6 text-center" style={{ color: 'var(--text-muted)' }}>Đang tải...</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center" style={{ color: 'var(--text-muted)' }}>Không có ITEM nào khớp</td></tr>}
                {rows.map(r => {
                  // Thành tiền của ITEM = TỔNG tiền các xưởng, do server cộng. KHÔNG xem trước
                  // bằng (KL nghiệm thu × đơn giá ITEM) — đó là cách tính cũ, giờ đơn giá ITEM
                  // chỉ còn là TRẦN. Sửa đơn giá xưởng thì bấm Lưu để cộng lại.
                  const amt = r.amount
                  const isOpen = expanded === r.item
                  return (
                    <Fragment key={r.item || '(trống)'}>
                      <tr style={{
                        borderTop: '1px solid var(--border-light)',
                        background: r.overCap ? SEMANTIC_COLORS.danger.bg : isOpen ? 'var(--bg-secondary)' : undefined,
                      }}>
                        <td className="px-2 py-1.5">
                          <button onClick={() => toggleItem(r.item)} title={`${r.detailLines} dòng chi tiết`}
                            style={{ color: 'var(--text-muted)' }}>{isOpen ? '▼' : '▶'}</button>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-bold" style={{ color: 'var(--accent)' }}>{tenHangMuc(r.item)}</span>
                          <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {formatNumber(r.blocks)} cụm · {formatNumber(r.detailLines)} chi tiết
                            {r.overrides > 0 && <span style={{ color: SEMANTIC_COLORS.info.solid }}> · {r.overrides} dòng đặt giá riêng</span>}
                          </span>
                        </td>
                        {/* Một ITEM giao cho nhiều xưởng → liệt kê ĐỦ, không lấy một lệnh đại diện.
                            Chi tiết từng lệnh xem khi xổ ITEM ra. */}
                        <td className="px-2 py-1.5">
                          {(r.shops?.length ?? 0) === 0
                            ? <span style={{ color: 'var(--text-muted)' }}>chưa phát hành</span>
                            : r.shops.length === 1
                              ? <>
                                  <span className="font-mono text-[10px]">{r.shops[0].woCode}</span>
                                  <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                    {r.shops[0].teamCode || '—'} · {WO_LABEL[r.shops[0].status] || r.shops[0].status}
                                  </span>
                                </>
                              : <>
                                  <span className="font-semibold text-[11px]">{r.shops.length} xưởng</span>
                                  {/* % tính trên ĐÚNG số phần việc đang giao — giao thêm xưởng
                                      thì mẫu số tăng, % tụt xuống; bớt đi thì tính lại. */}
                                  <span className="ml-1.5 text-[11px] font-semibold"
                                    style={{ color: r.ratio >= 1 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                    {Math.round(r.ratio * 100)}%
                                  </span>
                                  <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                    {r.shops.map(w => w.teamCode || '—').join(' · ')}
                                  </span>
                                  <span className="block text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                    trung bình {r.woCount} phần việc đang giao
                                  </span>
                                </>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatNumber(Math.round(r.plannedKg))}</td>
                        {/* Không còn đơn giá cho cả hạng mục: pha cắt và bảo ôn là hai phần việc
                            khác nhau, không có một đơn giá chung nào nói đúng cả hai. Giá nhập ở
                            từng CÔNG ĐOẠN — xổ hạng mục ra là thấy. */}
                        <td className="px-2 py-1.5 text-right text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          nhập theo công đoạn
                        </td>
                        {/* Chỉ còn ĐÃ LÀM: Σ (đơn giá công đoạn × KL đã nghiệm thu của công đoạn). */}
                        <td className="px-2 py-1.5 text-right font-mono">
                          <div className="flex items-baseline justify-end gap-1.5">
                            <span className="text-[9px] font-sans" style={{ color: 'var(--text-muted)' }}>Đã làm</span>
                            <span className="font-bold" style={{ color: SEMANTIC_COLORS.success.solid }}>
                              {amt === null ? '—' : tienVND(amt)}
                            </span>
                          </div>
                          {r.shopsWithoutPrice > 0 && (
                            <div className="text-[10px]" style={{ color: SEMANTIC_COLORS.warning.solid }}>
                              {r.shopsWithoutPrice} công đoạn chưa có đơn giá
                            </div>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0, background: 'var(--bg-primary)' }}>
                            {loadingChildren && <div className="px-4 py-3 text-center" style={{ color: 'var(--text-muted)' }}>Đang tải các xưởng…</div>}
                            {!loadingChildren && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr style={{ color: 'var(--text-muted)' }}>
                                      <th className="px-2 py-1 text-left pl-8">XƯỞNG</th>
                                      <th className="px-2 py-1 text-left">LỆNH SX</th>
                                      <th className="px-2 py-1 text-left">TRẠNG THÁI</th>
                                      <th className="px-2 py-1 text-right">KL GIAO</th>
                                      <th className="px-2 py-1 text-right">ĐÃ BÁO</th>
                                      <th className="px-2 py-1 text-right">ĐÃ NGHIỆM THU</th>
                                      <th className="px-2 py-1 text-right" style={{ minWidth: 118 }}>ĐƠN GIÁ CÔNG ĐOẠN</th>
                                      <th className="px-2 py-1 text-right">THÀNH TIỀN</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {shops.map(w => (
                                      <Fragment key={w.woCode}>
                                      <tr style={{ borderTop: '1px dashed var(--border)' }}>
                                        <td className="px-2 py-1 pl-8 font-semibold">
                                          {w.teamCode || <span style={{ color: 'var(--text-muted)' }}>chưa giao xưởng</span>}
                                        </td>
                                        <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-muted)' }}>{w.woCode}</td>
                                        <td className="px-2 py-1"><StatusBadge category="production" status={w.status} /></td>
                                        <td className="px-2 py-1 text-right font-mono">
                                          {formatNumber(Math.round(w.plannedKg))}
                                          <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{unitLabel(w.unit)}</span>
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono"
                                          style={{ color: w.reportedKg > 0 ? SEMANTIC_COLORS.info.solid : 'var(--text-muted)' }}>
                                          {formatNumber(Math.round(w.reportedKg))}
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono"
                                          style={{ color: w.acceptedKg > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                          {formatNumber(Math.round(w.acceptedKg))}
                                          <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                            {Math.round(w.ratio * 100)}%
                                          </span>
                                        </td>
                                        {/* Lệnh chia công đoạn: giá nhập ở TỪNG công đoạn bên dưới,
                                            cấp lệnh không có giá riêng. */}
                                        <td className="px-2 py-1 text-right">
                                          {w.stages.length > 0
                                            ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>theo công đoạn</span>
                                            : <input
                                              type="number" min="0" className="input text-right text-xs"
                                              style={{ width: 108, padding: '2px 6px' }}
                                              disabled={!editable}
                                              value={cellValue(`shop:${r.item}::${w.teamCode || ''}::`, w.unitPrice)}
                                              onChange={e => setDraft(d => ({ ...d, [`shop:${r.item}::${w.teamCode || ''}::`]: e.target.value }))}
                                              placeholder="0"
                                              title={`Lệnh chạy nguyên khối — đơn giá cho cả lệnh, đồng trên mỗi ${unitLabel(w.unit)}`}
                                            />}
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono">
                                          {w.stages.length > 0
                                            ? tienVND(w.stages.reduce((sum, st) =>
                                              sum + (liveAmount(`shop:${r.item}::${w.teamCode || ''}::${st.stageCode}`, st.unitPrice, st.acceptedKg) ?? 0), 0))
                                            : liveAmount(`shop:${r.item}::${w.teamCode || ''}::`, w.unitPrice, w.acceptedKg) === null
                                              ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>chưa có đơn giá</span>
                                              : tienVND(liveAmount(`shop:${r.item}::${w.teamCode || ''}::`, w.unitPrice, w.acceptedKg)!)}
                                        </td>
                                      </tr>

                                      {/* ── Công đoạn của lệnh ──
                                          Nơi nhập ĐƠN GIÁ KHOÁN. Hiện đúng như lúc phát hành lệnh:
                                          mã công đoạn, tên, chủng loại, khối lượng giao. */}
                                      {w.stages.map(st => {
                                        const k = `shop:${r.item}::${w.teamCode || ''}::${st.stageCode}`
                                        const tien = liveAmount(k, st.unitPrice, st.acceptedKg)
                                        // Phần xưởng đã báo mà CHƯA được nghiệm thu — chưa phải tiền phải trả.
                                        const tamTinh = liveAmount(k, st.unitPrice, Math.max(0, st.reportedKg - st.acceptedKg))
                                        return (
                                        <Fragment key={st.id}>
                                        <tr style={{ borderTop: '1px dotted var(--border)' }}>
                                          <td className="px-2 py-1 pl-12 text-[11px]">
                                            <span className="font-mono font-bold mr-1" style={{ color: 'var(--accent)' }}>{st.stageCode}</span>
                                            <span className="font-semibold">{st.name}</span>
                                          </td>
                                          <td className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                            {st.category || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                          </td>
                                          <td className="px-2 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                            {st.ratio >= 1 ? 'xong' : st.reportedKg > 0 ? 'đang làm' : 'chưa báo'}
                                          </td>
                                          <td className="px-2 py-1 text-right font-mono text-[11px]">
                                            {formatNumber(Math.round(st.plannedKg))}
                                            <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{unitLabel(st.unit)}</span>
                                          </td>
                                          <td className="px-2 py-1 text-right font-mono text-[11px]"
                                            style={{ color: st.reportedKg > 0 ? SEMANTIC_COLORS.info.solid : 'var(--text-muted)' }}>
                                            {formatNumber(Math.round(st.reportedKg))}
                                          </td>
                                          <td className="px-2 py-1 text-right font-mono text-[11px]"
                                            style={{ color: st.acceptedKg > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                            {formatNumber(Math.round(st.acceptedKg))}
                                            <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                              {Math.round(st.ratio * 100)}%
                                            </span>
                                          </td>
                                          <td className="px-2 py-1 text-right">
                                            <input
                                              type="number" min="0" className="input text-right text-xs"
                                              style={{ width: 108, padding: '2px 6px' }}
                                              disabled={!editable}
                                              value={cellValue(k, st.unitPrice)}
                                              onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                                              placeholder="0"
                                              title={`Đơn giá khoán của công đoạn ${st.stageCode} ${st.name} — đồng trên mỗi ${unitLabel(st.unit)}`}
                                            />
                                          </td>
                                          <td className="px-2 py-1 text-right font-mono text-[11px]">
                                            {/* Tiền chỉ tính trên phần ĐÃ NGHIỆM THU. Phần mới báo mà chưa
                                                ai ký thì hiện riêng là "tạm tính" — nhìn thấy giá trị công
                                                việc đang chờ ký, nhưng không cộng vào tiền phải trả. */}
                                            {tien === null
                                              ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>chưa có đơn giá</span>
                                              : <>
                                                <span style={{ color: tien > 0 ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                                  {tienVND(tien)}
                                                </span>
                                                {tamTinh !== null && tamTinh > 0 && (
                                                  <span className="block text-[10px]" style={{ color: SEMANTIC_COLORS.warning.solid }}>
                                                    tạm tính {tienVND(tamTinh)} · chờ nghiệm thu
                                                  </span>
                                                )}
                                              </>}
                                          </td>
                                        </tr>
                                        {/* Đợt nghiệm thu của riêng công đoạn này */}
                                        {(() => {
                                          const dot = w.batches.filter(b => b.stageCode === st.stageCode)
                                          return dot.map((b, bi) => (
                                          <tr key={`${st.id}-${b.itpCode}-${bi}`} style={{ background: 'var(--bg-secondary)' }}>
                                            <td className="px-2 py-0.5 pl-16 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                              {b.date ? new Date(b.date).toLocaleDateString('vi-VN') : '—'}
                                            </td>
                                            <td className="px-2 py-0.5 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                              {b.itpCode}
                                              {/* Nhiều đợt thì mới cần tách rõ đợt nào bao nhiêu; một đợt thì
                                                  số đã nằm ở dòng công đoạn rồi, ghi lại là thừa. */}
                                              {dot.length > 1 && (
                                                <span className="ml-1.5" style={{ color: 'var(--text-secondary)' }}>
                                                  {formatNumber(Math.round(b.qty))} {unitLabel(st.unit)}
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-2 py-0.5 text-[11px]" style={{
                                              color: b.failed ? SEMANTIC_COLORS.danger.solid
                                                : b.signed ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.warning.solid,
                                            }}>
                                              {b.failed ? 'lỗi' : b.signed ? 'đủ hai chữ ký' : 'chờ ký'}
                                            </td>
                                            {/* Số liệu chỉ điền ở dòng công đoạn — xem chú thích phía trên */}
                                            <td /><td /><td /><td /><td />
                                          </tr>
                                          ))
                                        })()}
                                        </Fragment>
                                        )
                                      })}

                                      {/* Lệnh chạy nguyên khối: đợt nghiệm thu nằm thẳng dưới lệnh */}
                                      {w.stages.length === 0 && w.batches.map((b, bi) => (
                                        <tr key={`${b.itpCode}-${bi}`} style={{ background: 'var(--bg-secondary)' }}>
                                          <td className="px-2 py-0.5 pl-12 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                            {b.date ? new Date(b.date).toLocaleDateString('vi-VN') : '—'}
                                          </td>
                                          <td className="px-2 py-0.5 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{b.itpCode}</td>
                                          <td className="px-2 py-0.5 text-[11px]" style={{
                                            color: b.failed ? SEMANTIC_COLORS.danger.solid
                                              : b.signed ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.warning.solid,
                                          }}>
                                            {b.failed ? 'lỗi' : b.signed ? 'đủ hai chữ ký' : 'chờ ký'}
                                          </td>
                                          <td />
                                          <td />
                                          <td className="px-2 py-0.5 text-right font-mono text-[11px]"
                                            style={{ color: b.signed ? SEMANTIC_COLORS.success.solid : 'var(--text-muted)' }}>
                                            {formatNumber(Math.round(b.qty))}
                                          </td>
                                          <td />
                                          <td className="px-2 py-0.5 text-right font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                            {b.amount === null ? '—' : formatCurrency(b.amount)}
                                          </td>
                                        </tr>
                                      ))}
                                      {w.stages.length === 0 && w.batches.length === 0 && (
                                        <tr style={{ background: 'var(--bg-secondary)' }}>
                                          <td colSpan={8} className="px-2 py-0.5 pl-12 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                            chưa có phiếu nghiệm thu nào
                                          </td>
                                        </tr>
                                      )}
                                      </Fragment>
                                    ))}
                                    {shops.length === 0 && (
                                      <tr><td colSpan={7} className="px-2 py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                                        ITEM này chưa phát hành lệnh cho xưởng nào
                                      </td></tr>
                                    )}
                                  </tbody>
                                </table>
                                {shops.length > 0 && (
                                  <div className="px-3 py-2 text-[11px]" style={{ borderTop: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                                    Mỗi xưởng nhận trọn khối lượng của hạng mục và làm theo các công đoạn được giao.
                                    <b> Đơn giá khoán đặt theo từng công đoạn</b>: tiền của công đoạn = KL ĐÃ NGHIỆM THU
                                    × đơn giá của công đoạn đó. Phần xưởng mới báo mà chưa ai ký chỉ hiện là
                                    <b> tạm tính</b>, chưa phải tiền phải trả. Dòng nhỏ dưới mỗi công đoạn là từng phiếu
                                    nghiệm thu của công đoạn đó. Công đoạn chưa nhập đơn giá thì tiền tính bằng 0.
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Tổng tiền tính trên TOÀN BỘ bảng */}
          {totals && (
            <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Giá trị khoán ĐÃ LÀM (toàn bộ {totals.itemsTotal} hạng mục)
                </p>
                <p className="text-2xl font-mono font-bold" style={{ color: SEMANTIC_COLORS.success.solid }}>
                  {formatCurrency(totals.totalAmount)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Chỉ tính phần đã nghiệm thu — phần mới báo chưa ký không cộng vào đây.
                  {totals.itemsPriced < totals.itemsTotal && <> · <span style={{ color: SEMANTIC_COLORS.warning.solid }}>{totals.itemsTotal - totals.itemsPriced} hạng mục chưa có đủ đơn giá công đoạn</span></>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {dirtyCount > 0 && <span className="text-xs" style={{ color: SEMANTIC_COLORS.warning.solid }}>{dirtyCount} ô chưa lưu</span>}
                {editable && (
                  totals.canComplete && dirtyCount === 0
                    ? <Button variant="primary" onClick={complete} loading={saving}>Hoàn thành</Button>
                    : <Button variant="primary" onClick={save} loading={saving} disabled={dirtyCount === 0}>Lưu</Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
