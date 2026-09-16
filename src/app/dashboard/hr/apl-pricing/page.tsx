'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, Button, EmptyState, SelectField, InputField, KPICard, StatusBadge } from '@/components/ui'
import { formatCurrency, formatNumber } from '@/lib/utils'
// Lệnh giao cả dự án đứng thành dòng riêng, không mang mã ITEM nào.
import { tenHangMuc } from '@/lib/hang-muc'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { unitLabel } from '@/lib/wo-units'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'
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
  categoryCode: string
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
  id: string; stageCode: string; categoryCode: string | null; name: string; category: string | null; unit: string
  plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
  unitPrice: number | null
  amount: number | null
  plannedAmount: number | null
}

interface Totals {
  plannedKg: number; acceptedKg: number; totalAmount: number; plannedAmount: number
  itemsTotal: number; itemsPriced: number; itemsAccepted: number
  itemsOverCap: number
  linesWithoutPrice: number; plannedMissing: number; canComplete: boolean
}

const WO_LABEL: Record<string, string> = {
  OPEN: 'Mở', IN_PROGRESS: 'Đang SX', QC_PENDING: 'Chờ nghiệm thu', QC_PASSED: 'Đã nghiệm thu',
  QC_FAILED: 'Không đạt', COMPLETED: 'Xong', ON_HOLD: 'Tạm dừng', PENDING_MATERIAL: 'Chờ VT',
}

/** Một dòng đơn giá trong bảng rà soát theo xưởng */
interface PbRow {
  item: string; itemLabel: string
  stageCode: string; stageName: string
  categoryCode: string; categoryName: string
  unitPrice: number | null
}
/** Đơn giá của một xưởng — gom từ toàn bộ ô được phép đặt giá */
interface PbWorkshop {
  teamCode: string; teamName: string; kind: string
  filled: number; total: number; rows: PbRow[]
}

/** Chủng loại đã gom: nhiều hạng mục về một dòng khi cùng giá. */
interface PbCatGroup {
  stageCode: string; categoryCode: string; categoryName: string
  rows: PbRow[]
  filled: number; total: number
  /** Mọi hạng mục đã nhập và CÙNG một giá → hiện một số duy nhất */
  uniformPrice: number | null
  /** Có từ 2 mức giá trở lên giữa các hạng mục */
  mixed: boolean
  min: number | null; max: number | null
}
interface PbStageGroup { stageCode: string; stageName: string; cats: PbCatGroup[] }

/** Gom rows của một xưởng: Công đoạn → Chủng loại (gộp hạng mục cùng giá). */
function groupPbRows(rows: PbRow[]): PbStageGroup[] {
  const stages = new Map<string, { stageName: string; cats: Map<string, PbRow[]> }>()
  for (const r of rows) {
    const s = stages.get(r.stageCode) || { stageName: r.stageName, cats: new Map<string, PbRow[]>() }
    const arr = s.cats.get(r.categoryCode) || []
    arr.push(r); s.cats.set(r.categoryCode, arr)
    stages.set(r.stageCode, s)
  }
  return [...stages.entries()].map(([stageCode, s]) => ({
    stageCode, stageName: s.stageName,
    cats: [...s.cats.entries()].map(([categoryCode, catRows]): PbCatGroup => {
      const prices = catRows.map(r => r.unitPrice).filter((n): n is number => n !== null)
      const filled = prices.length
      const distinct = [...new Set(prices)]
      const uniformPrice = filled === catRows.length && distinct.length === 1 ? distinct[0] : null
      return {
        stageCode, categoryCode, categoryName: catRows[0].categoryName,
        rows: catRows, filled, total: catRows.length,
        uniformPrice,
        mixed: distinct.length > 1,
        min: prices.length ? Math.min(...prices) : null,
        max: prices.length ? Math.max(...prices) : null,
      }
    }),
  }))
}

export default function AplPricingPage() {
  const [projects, setProjects] = useState<{ id: string; projectCode: string; projectName: string }[]>([])
  const [projectId, setProjectId] = useState('')
  const [apl, setApl] = useState<{ fileName: string } | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  // Tổng giá trị giao khoán dự án — KTKT tải file, BGĐ duyệt (thay cho nguồn dự toán DT06).
  const [budget, setBudget] = useState<{ total: number; status: string; fileUrl: string | null; approvedAt: string | null }>({ total: 0, status: 'NONE', fileUrl: null, approvedAt: null })
  const [budgetBusy, setBudgetBusy] = useState(false)
  const [pricing, setPricing] = useState<{ status: string; completedAt: string | null } | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Xưởng chọn để Export/Import (chỉ dùng cho KTKH/BGĐ/Admin; Xưởng thì server tự lấy xưởng mình).
  const [expTeam, setExpTeam] = useState('')
  // Chế độ xem: theo hạng mục (mặc định) | bảng đơn giá gom theo xưởng (KTKT rà soát đơn giá).
  const [view, setView] = useState<'byitem' | 'pricebook'>('byitem')
  const [priceBook, setPriceBook] = useState<PbWorkshop[]>([])
  const [pbTotals, setPbTotals] = useState<{ filled: number; total: number }>({ filled: 0, total: 0 })
  const [pbLoading, setPbLoading] = useState(false)
  const [pbOpen, setPbOpen] = useState<Record<string, boolean>>({})
  // Chủng loại đang xổ chi tiết từng hạng mục (chỉ khi các hạng mục khác giá nhau).
  const [pbExpand, setPbExpand] = useState<Record<string, boolean>>({})

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
      setBudget(res.budget || { total: 0, status: 'NONE', fileUrl: null, approvedAt: null })
      setPricing(res.pricing)
      setCanEdit(!!res.canEdit)
    } else notify(res.error || 'Không tải được bảng đơn giá')
    setLoading(false)
  }, [])

  const loadPriceBook = useCallback(async (pid: string) => {
    if (!pid) return
    setPbLoading(true)
    const res = await apiFetch(`/api/hr/apl-pricing/price-book?projectId=${pid}`)
    if (res.ok) {
      setPriceBook(res.workshops || [])
      setPbTotals({ filled: res.totalFilled || 0, total: res.totalCells || 0 })
    } else notify(res.error || 'Không tải được bảng đơn giá xưởng')
    setPbLoading(false)
  }, [])

  // Không dùng effect đồng bộ: mỗi thao tác tự gọi load với tham số của chính nó,
  // tránh setState trong effect gây render lồng.
  const onProject = (pid: string) => {
    setProjectId(pid); setDraft({}); setExpanded(null); setShops([]); setSearch('')
    setPriceBook([]); setPbOpen({})
    if (pid) { load(pid, ''); if (view === 'pricebook') loadPriceBook(pid) }
  }
  const switchView = (v: 'byitem' | 'pricebook') => {
    setView(v)
    if (v === 'pricebook' && projectId) loadPriceBook(projectId)
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

  // Khoá draft của một chủng loại trong lệnh của xưởng: shop:item::team::stage::category.
  // stage+category rỗng = lệnh nguyên khối; category='KHAC' = giá "Khác".
  const shopK = (item: string, team: string | null, stage = '', cat = '') =>
    `shop:${item}::${team || ''}::${stage}::${cat}`

  const save = async () => {
    if (dirtyCount === 0) return notify('Chưa có thay đổi nào để lưu')
    setSaving(true)
    const itemPrices: { item: string; unitPrice: number | null }[] = []
    const linePrices: { aplLineId: string; unitPrice: number | null }[] = []
    const shopPrices: { item: string; teamCode: string; stageCode: string; categoryCode: string; unitPrice: number | null }[] = []
    for (const [key, v] of Object.entries(draft)) {
      const price = v.trim() === '' ? null : Number(v)
      if (key.startsWith('item:')) itemPrices.push({ item: key.slice(5), unitPrice: price })
      // shop:<item>::<teamCode>::<stageCode>::<categoryCode> — đơn giá của MỘT chủng loại trong
      // lệnh của xưởng. stageCode+categoryCode rỗng = lệnh nguyên khối; categoryCode='KHAC' = giá "Khác".
      else if (key.startsWith('shop:')) {
        const rest = key.slice(5)
        const cat = rest.lastIndexOf('::')
        const stg = rest.lastIndexOf('::', cat - 1)
        const team = rest.lastIndexOf('::', stg - 1)
        shopPrices.push({
          item: rest.slice(0, team), teamCode: rest.slice(team + 2, stg),
          stageCode: rest.slice(stg + 2, cat), categoryCode: rest.slice(cat + 2), unitPrice: price,
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
  const isShop = ['R06', 'R06a', 'R06b'].includes(user?.roleCode || '')
  const isPm = ['R02', 'R02a'].includes(user?.roleCode || '') // PM — chỉ phần Thầu phụ

  // ── Export / Import file đơn giá theo xưởng ──
  // Xưởng: server tự lấy xưởng của mình (expTeam bỏ trống). KTKH/BGĐ/Admin: chọn xưởng ở expTeam.
  const exportFile = async () => {
    if (!projectId) return
    if (!isShop && !expTeam) { notify('Chọn xưởng cần xuất file', 'error'); return }
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const qs = new URLSearchParams({ projectId }); if (!isShop && expTeam) qs.set('teamCode', expTeam)
    const res = await fetch(`/api/hr/apl-pricing/export?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) { const j = await res.json().catch(() => ({})); notify(j.error || 'Lỗi xuất file', 'error'); return }
    const blob = await res.blob()
    const dispo = res.headers.get('Content-Disposition') || ''
    const fname = /filename="([^"]+)"/.exec(dispo)?.[1] || 'Don-gia-khoan.xlsx'
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = href; a.download = fname; a.click(); URL.revokeObjectURL(href)
  }
  const importFile = async (file: File) => {
    if (!projectId) return
    if (!isShop && !expTeam) { notify('Chọn xưởng trước khi nhập file (nhập hộ xưởng nào)', 'error'); return }
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData(); fd.append('file', file); fd.append('projectId', projectId)
    if (!isShop && expTeam) fd.append('teamCode', expTeam)
    const res = await fetch('/api/hr/apl-pricing/import', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json()).catch(() => ({ ok: false }))
    if (res.ok) { notify(res.message || 'Đã nhập đơn giá', 'success'); load(projectId, search); loadPriceBook(projectId) }
    else notify(res.error || 'Lỗi nhập file', 'error')
  }

  // ── Tổng giá trị giao khoán dự án: KTKT tải file → BGĐ duyệt ──
  const uploadBudget = async (file: File) => {
    if (!projectId) return
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData(); fd.append('file', file); fd.append('projectId', projectId)
    setBudgetBusy(true)
    const res = await fetch('/api/hr/apl-pricing/budget', { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json()).catch(() => ({ ok: false }))
    setBudgetBusy(false)
    if (res.ok) { notify(res.message || 'Đã tải tổng giá trị', 'success'); load(projectId, search) } else notify(res.error || 'Lỗi tải file', 'error')
  }
  const approveBudget = async () => {
    if (!(await confirmDialog('Duyệt Tổng giá trị giao khoán? Sau khi duyệt, các Xưởng mới nhập được đơn giá.'))) return
    const res = await apiFetch('/api/hr/apl-pricing/budget/approve', { method: 'POST', body: JSON.stringify({ projectId }) })
    if (res.ok) { notify(res.message || 'Đã duyệt', 'success'); load(projectId, search) } else notify(res.error || 'Lỗi', 'error')
  }
  const reopenBudget = async () => {
    if (!(await confirmDialog('Mở lại Tổng giá trị để KTKT tải lại file khác?'))) return
    const res = await apiFetch('/api/hr/apl-pricing/budget/approve', { method: 'DELETE', body: JSON.stringify({ projectId }) })
    if (res.ok) { notify(res.message || 'Đã mở lại', 'success'); load(projectId, search) } else notify(res.error || 'Lỗi', 'error')
  }
  const canUploadBudget = isR03 || user?.roleCode === 'R10'   // KTKT/BGĐ/Admin
  const canApproveBudget = ['R01', 'R10'].includes(user?.roleCode || '') // BGĐ (BOM)/Admin
  const budgetApproved = budget.status === 'APPROVED'

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
        {/* Export/Import file đơn giá theo xưởng — chỉ mở khi BGĐ đã duyệt Tổng giá trị. */}
        {apl && (isShop || isR03 || isPm) && !budgetApproved && (
          <div className="text-xs mt-3 pt-3" style={{ borderTop: '1px solid var(--border)', color: '#b45309' }}>
            ⏳ Chờ BGĐ duyệt <b>Tổng giá trị giao khoán dự án</b> — sau đó mới tải/nhập được file đơn giá.
          </div>
        )}
        {apl && (isShop || isR03 || isPm) && budgetApproved && (
          <div className="flex items-center gap-2 flex-wrap mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
            {!isShop && (
              <select className="input-field text-sm" style={{ maxWidth: 220 }} value={expTeam} onChange={e => setExpTeam(e.target.value)}>
                <option value="">— Chọn xưởng —</option>
                {/* PM chỉ thấy phần Thầu phụ; quản lý thấy mọi xưởng + Thầu phụ. */}
                {!isPm && PRODUCTION_WORKSHOPS.map(w => <option key={w.code} value={w.code}>{w.name} ({w.code})</option>)}
                <option value="THAUPHU">Thầu phụ (THAUPHU)</option>
              </select>
            )}
            <Button variant="outline" size="sm" onClick={exportFile}>⬇ Xuất file đơn giá {isShop ? '(xưởng của tôi)' : ''}</Button>
            {!locked && (
              <label className="text-xs px-3 py-1.5 rounded cursor-pointer font-semibold" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                📥 Nhập đơn giá từ file
                <input type="file" accept=".xlsx" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.currentTarget.value = '' }} />
              </label>
            )}
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {isShop ? 'Xuất file → điền cột Đơn giá → nhập lại.' : 'Chọn xưởng → Xuất/Nhập hộ xưởng đó.'} Chủng loại lạ điền vào dòng &quot;Khác&quot;.
            </span>
          </div>
        )}
      </div>

      {!projectId && <EmptyState icon={<Calculator />} title="Chọn dự án" description="Chọn dự án đã import APL để nhập đơn giá khoán" />}

      {projectId && !apl && !loading && (
        <EmptyState icon={<Calculator />} title="Dự án chưa có APL" description="Thiết kế phải import file APL trước khi nhập đơn giá khoán" />
      )}

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Con số từ file KTKT (BGĐ duyệt) — ngân sách khoán của cả dự án. */}
          <KPICard label="Tổng giá trị giao khoán dự án" value={budget.total > 0 ? formatCurrency(budget.total) : '—'} accentColor="#7c3aed" />
          {/* KẾ HOẠCH = Σ (đơn giá × KL GIAO) — có ngay khi xưởng nhập đơn giá. KTKT rà soát cái này. */}
          <KPICard label="Giá trị giao khoán (kế hoạch)" value={formatCurrency(totals.plannedAmount)} accentColor={SEMANTIC_COLORS.info.solid} />
          {/* HOÀN THÀNH = Σ (đơn giá × KL ĐÃ NGHIỆM THU) — tính dần khi nghiệm thu, KHÁC kế hoạch. */}
          <KPICard label="Giá trị hoàn thành (đã nghiệm thu)" value={formatCurrency(totals.totalAmount)} accentColor={SEMANTIC_COLORS.success.solid} />
          <KPICard label="ITEM đã có đơn giá" value={`${totals.itemsPriced}/${totals.itemsTotal}`} accentColor={SEMANTIC_COLORS.neutral.solid} />
          <KPICard label="ITEM đã nghiệm thu" value={`${totals.itemsAccepted}/${totals.itemsTotal}`} accentColor={SEMANTIC_COLORS.warning.solid} />
        </div>
      )}

      {/* ── Tổng giá trị giao khoán dự án: KTKT tải file → BGĐ (BOM) duyệt → mở khoá nhập đơn giá ── */}
      {apl && (
        <div className="card p-3 flex items-center gap-3 flex-wrap" style={{ borderLeft: `4px solid ${budgetApproved ? SEMANTIC_COLORS.success.solid : '#b45309'}` }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Tổng giá trị giao khoán dự án:</span>
          <span className="text-base font-mono font-bold" style={{ color: '#7c3aed' }}>{budget.total > 0 ? formatCurrency(budget.total) : 'chưa có'}</span>
          <span className="text-xs px-2 py-0.5 rounded font-bold" style={{
            background: budgetApproved ? '#ecfdf5' : budget.status === 'PENDING' ? '#fffbeb' : '#f1f5f9',
            color: budgetApproved ? '#166534' : budget.status === 'PENDING' ? '#b45309' : '#64748b',
          }}>{budgetApproved ? '✅ BGĐ đã duyệt' : budget.status === 'PENDING' ? '⏳ Chờ BGĐ duyệt' : 'Chưa có file'}</span>
          {budget.fileUrl && <a href={budget.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>📎 File gốc</a>}
          <div className="flex-1" />
          {canUploadBudget && !budgetApproved && (
            <label className="text-xs px-3 py-1.5 rounded cursor-pointer font-semibold" style={{ border: '1px solid #7c3aed', color: '#7c3aed' }}>
              {budgetBusy ? 'Đang tải…' : '⬆ Tải Tổng giá trị (KTKT)'}
              <input type="file" accept=".xlsx" hidden disabled={budgetBusy} onChange={e => { const f = e.target.files?.[0]; if (f) uploadBudget(f); e.currentTarget.value = '' }} />
            </label>
          )}
          {canApproveBudget && budget.status === 'PENDING' && <Button variant="primary" size="sm" onClick={approveBudget}>Duyệt tổng giá trị</Button>}
          {canApproveBudget && budgetApproved && <Button variant="outline" size="sm" onClick={reopenBudget}>Mở lại</Button>}
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

      {/* KTKT rà soát: Giá trị giao khoán KẾ HOẠCH (Σ đơn giá × KL giao) so với Tổng giá trị BGĐ duyệt. */}
      {totals && budget.total > 0 && totals.plannedAmount > budget.total && (
        <div className="card p-3 text-sm" style={{ borderLeft: `4px solid ${SEMANTIC_COLORS.danger.solid}`, color: 'var(--text-primary)' }}>
          <b style={{ color: SEMANTIC_COLORS.danger.solid }}>Giá trị giao khoán (kế hoạch) VƯỢT Tổng giá trị dự án</b>
          {' '}— kế hoạch <b>{formatCurrency(totals.plannedAmount)}</b> &gt; tổng <b>{formatCurrency(budget.total)}</b>
          {' '}(vượt {formatCurrency(totals.plannedAmount - budget.total)}). KTKT rà soát lại đơn giá các xưởng trước khi chốt.
        </div>
      )}

      {/* Chọn chế độ xem: theo hạng mục | bảng đơn giá gom theo xưởng (KTKT rà soát đơn giá). */}
      {apl && (
        <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
          <button onClick={() => switchView('byitem')}
            className="px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors"
            style={{ borderColor: view === 'byitem' ? 'var(--accent)' : 'transparent', color: view === 'byitem' ? 'var(--accent)' : 'var(--text-muted)' }}>
            Theo hạng mục
          </button>
          <button onClick={() => switchView('pricebook')}
            className="px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors"
            style={{ borderColor: view === 'pricebook' ? 'var(--accent)' : 'transparent', color: view === 'pricebook' ? 'var(--accent)' : 'var(--text-muted)' }}>
            Bảng đơn giá các xưởng
          </button>
        </div>
      )}

      {/* ── Bảng đơn giá gom theo xưởng — KTKT rà soát TẤT CẢ đơn giá các xưởng đã upload ── */}
      {apl && view === 'pricebook' && (
        <div className="space-y-3">
          <div className="card p-3 flex items-center gap-3 flex-wrap text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>
              Toàn bộ đơn giá các xưởng đã nhập — không phụ thuộc đã phân giao/nghiệm thu.
            </span>
            <div className="flex-1" />
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Đã nhập <b style={{ color: SEMANTIC_COLORS.success.solid }}>{pbTotals.filled}</b>/{pbTotals.total} ô đơn giá
            </span>
          </div>
          {pbLoading && <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Đang tải…</div>}
          {!pbLoading && priceBook.length === 0 && (
            <EmptyState icon={<Calculator />} title="Chưa có xưởng nào" description="Dự án chưa có hạng mục/lệnh để lập đơn giá" />
          )}
          {!pbLoading && priceBook.map(ws => {
            const open = pbOpen[ws.teamCode] ?? true
            const done = ws.total > 0 && ws.filled === ws.total
            return (
              <div key={ws.teamCode} className="card overflow-hidden">
                <button
                  onClick={() => setPbOpen(o => ({ ...o, [ws.teamCode]: !open }))}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  style={{ background: 'var(--bg-secondary)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{open ? '▼' : '▶'}</span>
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{ws.teamName}</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{ws.teamCode}</span>
                  {ws.kind === 'whole-project' && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#eef2ff', color: '#4338ca' }}>Cả dự án</span>}
                  {ws.kind === 'subcontract' && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#b45309' }}>Thầu phụ</span>}
                  <div className="flex-1" />
                  <span className="text-xs font-semibold" style={{ color: done ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.warning.solid }}>
                    {done ? '✓ ' : ''}{ws.filled}/{ws.total} ô có đơn giá
                  </span>
                </button>
                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                          <th className="px-3 py-2 text-left">Công đoạn</th>
                          <th className="px-3 py-2 text-left">Chủng loại</th>
                          <th className="px-3 py-2 text-right" style={{ minWidth: 150 }}>Đơn giá</th>
                          <th className="px-3 py-2 text-left" style={{ minWidth: 120 }}>Áp dụng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupPbRows(ws.rows).map(sg => (
                          <Fragment key={sg.stageCode}>
                            {/* Đầu công đoạn — gộp mọi chủng loại của nó bên dưới. */}
                            <tr style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
                              <td colSpan={4} className="px-3 py-1.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{sg.stageName}</td>
                            </tr>
                            {sg.cats.map(cat => {
                              const ek = `${ws.teamCode}::${cat.stageCode}::${cat.categoryCode}`
                              const ex = pbExpand[ek] ?? false
                              return (
                                <Fragment key={ek}>
                                  <tr style={{ borderTop: '1px solid var(--border-light)' }}>
                                    <td className="px-3 py-1.5"></td>
                                    <td className="px-3 py-1.5">
                                      <span style={{ color: cat.categoryCode === 'KHAC' ? SEMANTIC_COLORS.info.solid : 'var(--text-primary)' }}>{cat.categoryName}</span>
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono">
                                      {cat.uniformPrice !== null
                                        ? <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatNumber(cat.uniformPrice)} ₫</span>
                                        : cat.mixed
                                          ? <span className="font-semibold" style={{ color: SEMANTIC_COLORS.info.solid }}>{formatNumber(cat.min!)}–{formatNumber(cat.max!)} ₫</span>
                                          : cat.filled === 0
                                            ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>— chưa nhập</span>
                                            // đã nhập một phần, phần còn lại trống → coi như chưa đủ
                                            : <span style={{ color: SEMANTIC_COLORS.warning.solid }}>{formatNumber(cat.min!)} ₫ · thiếu {cat.total - cat.filled}</span>}
                                    </td>
                                    <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>
                                      {cat.total === 1
                                        ? <span>{cat.rows[0].itemLabel}</span>
                                        : (cat.mixed || cat.filled < cat.total)
                                          ? <button onClick={() => setPbExpand(o => ({ ...o, [ek]: !ex }))} style={{ color: 'var(--accent)' }}>
                                              {ex ? '▼' : '▶'} {cat.total} hạng mục{cat.mixed ? ' (giá khác nhau)' : ''}
                                            </button>
                                          : <span>{cat.total} hạng mục</span>}
                                    </td>
                                  </tr>
                                  {ex && cat.rows.map((r, i) => (
                                    <tr key={`${ek}::${r.item}::${i}`} style={{ background: 'var(--bg-tertiary)' }}>
                                      <td className="px-3 py-1"></td>
                                      <td className="px-3 py-1"></td>
                                      <td className="px-3 py-1 text-right font-mono">
                                        {r.unitPrice === null
                                          ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>— chưa nhập</span>
                                          : <span style={{ color: 'var(--text-primary)' }}>{formatNumber(r.unitPrice)} ₫</span>}
                                      </td>
                                      <td className="px-3 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.itemLabel}</td>
                                    </tr>
                                  ))}
                                </Fragment>
                              )
                            })}
                          </Fragment>
                        ))}
                        {ws.rows.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-3 text-center" style={{ color: 'var(--text-muted)' }}>Không có ô đơn giá nào</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
          {/* KTKT rà soát & chốt ngay từ bảng này — chốt khi mọi phần việc đã giao đều có đơn giá. */}
          {!pbLoading && priceBook.length > 0 && totals && (
            <div className="card p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--bg-secondary)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Rà soát ĐƠN GIÁ các xưởng ở trên. Chốt được khi mọi phần việc đã giao đều có đơn giá
                (không cần đợi nghiệm thu).
              </span>
              {isR03 && locked && <span className="text-xs" style={{ color: SEMANTIC_COLORS.success.solid }}>✓ Đã chốt bảng đơn giá</span>}
              {isR03 && !locked && totals.canComplete && dirtyCount === 0 &&
                <Button variant="primary" onClick={complete} loading={saving}>Rà soát &amp; chốt</Button>}
              {isR03 && !locked && !totals.canComplete && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Chưa chốt được: còn {totals.plannedMissing ?? 0} phần việc đã giao chưa có đơn giá
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {apl && view === 'byitem' && (
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
                                              value={cellValue(shopK(r.item, w.teamCode), w.unitPrice)}
                                              onChange={e => setDraft(d => ({ ...d, [shopK(r.item, w.teamCode)]: e.target.value }))}
                                              placeholder="0"
                                              title={`Lệnh chạy nguyên khối — đơn giá cho cả lệnh, đồng trên mỗi ${unitLabel(w.unit)}`}
                                            />}
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono">
                                          {w.stages.length > 0
                                            ? tienVND(w.stages.reduce((sum, st) =>
                                              sum + (liveAmount(shopK(r.item, w.teamCode, st.stageCode, st.categoryCode || ''), st.unitPrice, st.acceptedKg) ?? 0), 0))
                                            : liveAmount(shopK(r.item, w.teamCode), w.unitPrice, w.acceptedKg) === null
                                              ? <span style={{ color: SEMANTIC_COLORS.warning.solid }}>chưa có đơn giá</span>
                                              : tienVND(liveAmount(shopK(r.item, w.teamCode), w.unitPrice, w.acceptedKg)!)}
                                        </td>
                                      </tr>

                                      {/* ── Công đoạn của lệnh ──
                                          Nơi nhập ĐƠN GIÁ KHOÁN. Hiện đúng như lúc phát hành lệnh:
                                          mã công đoạn, tên, chủng loại, khối lượng giao. */}
                                      {w.stages.map(st => {
                                        const k = shopK(r.item, w.teamCode, st.stageCode, st.categoryCode || '')
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
                                          const dot = w.batches.filter(b => b.stageCode === st.stageCode && (b.categoryCode || '') === (st.categoryCode || ''))
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
                {/* Xưởng: lưu đơn giá phần việc của mình. */}
                {editable && <Button variant="primary" onClick={save} loading={saving} disabled={dirtyCount === 0}>Lưu</Button>}
                {/* KTKT/BGĐ: chỉ XEM + rà soát & CHỐT (không sửa đơn giá).
                    Chốt được ngay khi mọi phần việc đã giao đều có đơn giá — không cần đợi nghiệm thu. */}
                {isR03 && locked && <span className="text-xs" style={{ color: SEMANTIC_COLORS.success.solid }}>✓ Đã chốt bảng đơn giá</span>}
                {isR03 && !locked && totals.canComplete && dirtyCount === 0 &&
                  <Button variant="primary" onClick={complete} loading={saving}>Rà soát &amp; chốt</Button>}
                {isR03 && !locked && !totals.canComplete && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Chưa chốt được: còn {totals.plannedMissing ?? 0} phần việc đã giao chưa có đơn giá
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
