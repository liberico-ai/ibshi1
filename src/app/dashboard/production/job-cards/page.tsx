'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { formatDate, formatNumber } from '@/lib/utils'
import {
  PageHeader, Button, EmptyState,
  KPICard, Modal, InputField, SelectField, TextareaField,
} from '@/components/ui'
import { ClipboardList, Calendar, BarChart3, CheckCircle2 } from 'lucide-react'
import { notify } from '@/components/ui/Toast'
import { WO_REPORTABLE_STATUSES, WO_STATUS_LABEL } from '@/lib/wo-status'
import { WO_UNITS, DEFAULT_WO_UNIT, unitLabel } from '@/lib/wo-units'

interface JobCard {
  id: string; jobCode: string; workOrderId: string; teamCode: string; workType: string;
  description: string | null; plannedQty: number | null; actualQty: number | null; unit: string;
  workDate: string; manpower: number | null; status: string; notes: string | null; createdAt: string;
  workOrder: {
    woCode: string; description: string; projectId: string; plannedWeight?: number | null
    /** Mọi công đoạn được giao cho lệnh — kể cả công đoạn chưa báo lần nào */
    stages?: Stage[]
  };
  /** Công đoạn được báo; null = phiếu cũ hoặc lệnh chạy nguyên khối */
  stage: Stage | null;
}

/** Một công đoạn của lệnh — mỗi công đoạn chạy qua TRỌN khối lượng của lệnh */
interface Stage {
  id: string; stageCode: string; name: string
  categoryCode: string | null; category: string | null
  qty: number; unit: string
}

interface WO {
  id: string; woCode: string; description: string; status: string; teamCode: string
  plannedWeight: number | null; unit?: string
  stages?: Stage[]
}

/** Một lệnh gom lại: khối lượng, tiến độ, lịch sử báo và tiến độ từng công đoạn */
interface WoGroup {
  woId: string; woCode: string; woDesc: string; teamCode: string
  planned: number; reported: number; done: boolean; entries: JobCard[]
  /** Đã báo theo từng công đoạn — chỉ có khi lệnh được chia công đoạn */
  byStage: Map<string, { st: Stage; qty: number }>
}

/** Nhãn đầy đủ của công đoạn: "S - Sơn · Sơn KC, Thiết bị" */
const stageLabel = (st: Stage) =>
  `${st.stageCode ? st.stageCode + ' - ' : ''}${st.name}${st.category ? ' · ' + st.category : ''}`



export default function JobCardsPage() {
  const [jobCards, setJobCards] = useState<JobCard[]>([])
  const [workOrders, setWorkOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  // WO chọn sẵn khi mở phiếu bằng cách bấm vào thẻ trong danh sách ('' = tạo mới từ đầu)
  const [openWoId, setOpenWoId] = useState('')
  const [filterType] = useState('')
  const user = useAuthStore(s => s.user)

  const loadData = async () => {
    setLoading(true)
    // Lấy rộng: trang này gom phiếu theo WO và phải biết ĐỦ lịch sử của từng lệnh
    // (tổng đã báo, KL còn lại, cảnh báo "lệnh đã được báo cáo"). Mặc định API chỉ trả 20 phiếu
    // gần nhất — lệnh cũ sẽ bị hiểu nhầm là chưa báo lần nào.
    const params = `?limit=500${filterType ? `&workType=${filterType}` : ''}`
    const res = await apiFetch(`/api/production/job-cards${params}`)
    if (res.ok) setJobCards(res.jobCards || [])
    setLoading(false)
  }

  const openForm = async (woId = '') => {
    // Reset state before loading to avoid accumulating WOs (race condition fix)
    setWorkOrders([])
    // Lấy MỌI lệnh còn báo cáo được, không riêng OPEN/IN_PROGRESS: từ khi cắt cổng vật tư,
    // lệnh nằm nguyên ở 'Chờ vật tư' mà xưởng vẫn báo cáo, và lệnh đã nghiệm thu vẫn báo tiếp được.
    // Danh sách trạng thái dùng chung với API tạo phiếu (wo-status.ts) để hai bên không lệch nhau.
    const woRes = await apiFetch(`/api/production?status=${WO_REPORTABLE_STATUSES.join(',')}&limit=100`)
    setWorkOrders(woRes.ok ? (woRes.workOrders || []) : [])
    setOpenWoId(woId)
    setShowForm(true)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData() }, [filterType])

  const canCreate = ['R01', 'R06', 'R06a', 'R06b'].includes(user?.roleCode || '')

  // Gom theo LỆNH SX: một thẻ = một WO, chạy suốt dòng đời của lệnh đó.
  // Mỗi lần báo là một dòng lịch sử bên trong thẻ; khối lượng cộng dồn.
  const groups = (() => {
    const m = new Map<string, WoGroup>()
    for (const j of jobCards) {
      const g: WoGroup = m.get(j.workOrderId) || {
        woId: j.workOrderId,
        woCode: j.workOrder.woCode,
        woDesc: j.workOrder.description,
        teamCode: j.teamCode,
        // Kế hoạch lấy từ WO; lệnh cũ chưa có thì lùi về số kế hoạch ghi trên phiếu.
        planned: j.workOrder.plannedWeight ?? j.plannedQty ?? 0,
        reported: 0, done: false, entries: [],
        // Mở sẵn ĐỦ công đoạn được giao, mỗi cái 0 — công đoạn chưa báo lần nào vẫn phải
        // hiện ra, đó mới là thứ cho biết lệnh còn thiếu việc gì.
        byStage: new Map((j.workOrder.stages || []).map(st => [st.id, { st, qty: 0 }])),
      }
      if (j.stage) {
        const cur = g.byStage.get(j.stage.id) || { st: j.stage, qty: 0 }
        cur.qty += j.actualQty || 0
        g.byStage.set(j.stage.id, cur)
      } else {
        // Phiếu không gắn công đoạn = báo cho cả lệnh; cộng vào phần chung.
        g.reported += j.actualQty || 0
      }
      g.entries.push(j)
      m.set(j.workOrderId, g)
    }
    for (const g of m.values()) {
      g.entries.sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime())
      // Lệnh có công đoạn: mỗi công đoạn chạy qua TRỌN khối lượng của lệnh, nên tiến độ của
      // lệnh là tiến độ công đoạn chậm nhất — cộng các công đoạn lại sẽ ra gấp N lần khối lượng thật.
      if (g.byStage.size > 0) {
        const chung = g.reported
        let thap = Infinity
        for (const { st, qty } of g.byStage.values()) {
          thap = Math.min(thap, st.qty > 0 ? (qty + chung) / st.qty : 0)
        }
        g.reported = Math.min(g.planned, Math.round(g.planned * thap * 100) / 100)
        g.done = thap >= 0.9
      } else {
        g.done = g.planned > 0 && g.reported >= g.planned * 0.9   // ±10% là xong
      }
    }
    return [...m.values()].sort((a, b) =>
      new Date(b.entries[0].workDate).getTime() - new Date(a.entries[0].workDate).getTime())
  })()

  // Stats
  const todayCount = jobCards.filter(j => new Date(j.workDate).toDateString() === new Date().toDateString()).length
  const totalQty = jobCards.reduce((acc, j) => acc + (j.actualQty || 0), 0)
  const completedCount = jobCards.filter(j => j.status === 'COMPLETED').length

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Phiếu Công Việc"
        subtitle="Xưởng báo khối lượng đã làm — báo theo đợt cũng được, chọn đúng ngày báo cáo"
        actions={canCreate ? <Button variant="primary" onClick={() => openForm()}>+ Nhập KL</Button> : undefined}
      />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 stagger-children">
        <KPICard label="Báo hôm nay" value={todayCount} accentColor="var(--info, #2D6CB5)" icon={<Calendar size={20} />} />
        <KPICard label="Tổng KL" value={totalQty.toLocaleString()} accentColor="var(--success, #1E8E5A)" icon={<BarChart3 size={20} />} />
        <KPICard label="Hoàn thành" value={completedCount} accentColor="#059669" icon={<CheckCircle2 size={20} />} />
      </div>

      {/* Job Card list */}
      <div className="space-y-2">
        {jobCards.length === 0 && (
          <EmptyState icon={<ClipboardList />} title="Chưa có phiếu công việc" description="Nhập khối lượng hàng ngày để tạo phiếu mới" />
        )}
        {groups.map(g => {
          const pct = g.planned > 0 ? Math.min(100, Math.round((g.reported / g.planned) * 100)) : 0
          return (
            <div key={g.woId} className="card p-4 transition-all hover:shadow-md"
              style={{ cursor: canCreate ? 'pointer' : 'default' }}
              title={canCreate ? 'Bấm để báo tiếp khối lượng' : undefined}
              onClick={() => canCreate && openForm(g.woId)}>
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{g.woCode}</span>
                    {g.done
                      ? <span className="badge" style={{ background: '#dcfce7', color: '#047857' }}>✓ Đã xong</span>
                      : <span className="badge" style={{ background: '#fef3c7', color: '#b45309' }}>Đang làm</span>}
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Xưởng {g.teamCode}</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.woDesc}</p>
                </div>
                <div className="text-right min-w-[190px]">
                  <p className="text-lg font-mono font-bold" style={{ color: g.done ? '#047857' : 'var(--success, #16a34a)' }}>
                    {formatNumber(Math.round(g.reported))}<span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}> / {formatNumber(Math.round(g.planned))} kg</span>
                  </p>
                  <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--border, #e2e8f0)' }}>
                    <div className="h-full rounded-full" style={{ width: pct + '%', background: g.done ? '#16a34a' : 'var(--warning, #f59e0b)' }} />
                  </div>
                  <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {pct}% · còn {formatNumber(Math.max(0, Math.round((g.planned - g.reported) * 100) / 100))} kg
                  </p>
                  {/* Lệnh chia công đoạn: con số trên là công đoạn CHẬM NHẤT, không phải tổng các
                      công đoạn cộng lại — nói thẳng ra để không ai tưởng hệ tính thiếu. */}
                  {g.byStage.size > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      theo công đoạn chậm nhất
                    </p>
                  )}
                </div>
              </div>

              {/* Công đoạn được giao cho lệnh này — tên công đoạn, chủng loại, và làm tới đâu.
                  Lệnh chỉ xong khi MỌI công đoạn xong, nên phải thấy đủ, kể cả cái chưa báo. */}
              {g.byStage.size > 0 && (
                <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Công đoạn được giao ({g.byStage.size})
                  </p>
                  <div className="space-y-1">
                    {[...g.byStage.values()].map(({ st, qty }) => {
                      const p2 = st.qty > 0 ? Math.min(100, Math.round((qty / st.qty) * 100)) : 0
                      const xong = p2 >= 90
                      return (
                        <div key={st.id} className="flex items-center gap-3 text-xs">
                          <span className="font-mono font-bold" style={{ minWidth: 34, color: 'var(--accent)' }}>{st.stageCode}</span>
                          <span className="font-medium" style={{ minWidth: 96 }}>{st.name}</span>
                          <span className="truncate" style={{ minWidth: 130, color: 'var(--text-muted)' }}>{st.category || '—'}</span>
                          <span className="font-mono" style={{ minWidth: 150, color: qty > 0 ? 'var(--success, #16a34a)' : 'var(--text-muted)' }}>
                            {formatNumber(Math.round(qty))} / {formatNumber(st.qty)} {unitLabel(st.unit)}
                          </span>
                          <div className="h-1.5 rounded-full overflow-hidden flex-1" style={{ background: 'var(--border, #e2e8f0)', maxWidth: 120 }}>
                            <div className="h-full rounded-full" style={{ width: p2 + '%', background: xong ? '#16a34a' : 'var(--warning, #f59e0b)' }} />
                          </div>
                          <span className="font-mono" style={{ minWidth: 38, textAlign: 'right', color: xong ? '#047857' : 'var(--text-muted)' }}>
                            {xong ? '✓ đủ' : p2 + '%'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Lịch sử báo cáo của lệnh này — mỗi lần báo một dòng */}
              <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Lịch sử báo cáo ({g.entries.length})</p>
                {g.entries.map(e => (
                  <div key={e.id} className="flex items-center gap-3 text-xs py-1" style={{ borderBottom: '1px dashed var(--border)' }}>
                    <span className="font-mono" style={{ minWidth: 88 }}>{formatDate(e.workDate)}</span>
                    <span style={{ minWidth: 54 }}>{e.teamCode}</span>
                    <span style={{ minWidth: 150, color: e.stage ? 'var(--text-primary)' : 'var(--text-muted)' }} className="truncate"
                      title={e.stage ? stageLabel(e.stage) : 'Báo cho cả lệnh, không theo công đoạn'}>
                      {e.stage ? stageLabel(e.stage) : '— cả lệnh —'}
                    </span>
                    <span className="font-mono font-bold" style={{ color: 'var(--success, #16a34a)', minWidth: 90 }}>{formatNumber(e.actualQty || 0)} {e.unit}</span>
                    <span style={{ color: 'var(--text-muted)', minWidth: 54 }}>{e.manpower ? e.manpower + ' CN' : ''}</span>
                    <span style={{ color: 'var(--text-muted)' }} className="truncate">{e.notes || ''}</span>
                    <span className="font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>{e.jobCode}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <CreateJobCardModal
        key={showForm ? (openWoId || 'new') : 'closed'}
        initialWoId={openWoId}
        open={showForm}
        workOrders={workOrders}
        jobCards={jobCards}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); loadData() }}
      />
    </div>
  )
}

function CreateJobCardModal({ open, workOrders, jobCards, initialWoId, onClose, onCreated }: {
  open: boolean; workOrders: WO[]; jobCards: JobCard[]; initialWoId?: string
  onClose: () => void; onCreated: () => void
}) {
  // Trang gắn `key` theo WO nên mỗi lần mở là một lần dựng mới → khởi tạo thẳng ở đây,
  // không cần effect đồng bộ (tránh setState trong effect gây render lồng).
  // Khối lượng nhập lần này, theo từng công đoạn: { [stageId]: '1200' }.
  // Lệnh không khai công đoạn thì dùng form.actualQty như cũ.
  const [stageQty, setStageQty] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    workOrderId: initialWoId || '', description: '',
    actualQty: '',
    // Mở sẵn theo một lệnh thì lấy luôn đơn vị của lệnh đó.
    unit: workOrders.find(w => w.id === initialWoId)?.unit || DEFAULT_WO_UNIT,
    workDate: new Date().toISOString().split('T')[0],
    manpower: '', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const selectedWo = workOrders.find(w => w.id === form.workOrderId)
  // Tra nhanh lệnh nào đã có phiếu — dùng để gắn dấu ngay trong dropdown.
  const reportedByWo = jobCards.reduce<Record<string, { count: number; qty: number }>>((acc, j) => {
    const cur = acc[j.workOrderId] || { count: 0, qty: 0 }
    acc[j.workOrderId] = { count: cur.count + 1, qty: cur.qty + (j.actualQty || 0) }
    return acc
  }, {})
  // Một phiếu đại diện cả dòng đời của WO: gom mọi lần đã báo của chính lệnh đang chọn.
  const historyOfWo = jobCards.filter(j => j.workOrderId === form.workOrderId)
    .sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime())
  const plannedOfWo = selectedWo?.plannedWeight || 0

  // ── Công đoạn của lệnh đang chọn ──
  // Mỗi công đoạn chạy qua TRỌN khối lượng của lệnh, nên KHÔNG cộng các công đoạn lại.
  // Xưởng Pha cắt nhận lệnh có 2 công đoạn thì phải báo riêng từng công đoạn.
  const stages = selectedWo?.stages ?? []
  // Phiếu báo cho cả lệnh (không gắn công đoạn) tính cho MỌI công đoạn — phiếu cũ báo trước
  // khi lệnh được chia công đoạn thì vẫn phải được ghi nhận.
  const chungOfWo = historyOfWo.filter(j => !j.stage).reduce((sum, j) => sum + (j.actualQty || 0), 0)
  const daBaoStage = (stageId: string) =>
    historyOfWo.filter(j => j.stage?.id === stageId).reduce((sum, j) => sum + (j.actualQty || 0), 0) + chungOfWo
  const conLaiStage = (st: Stage) => Math.max(0, Math.round((st.qty - daBaoStage(st.id)) * 100) / 100)

  // Đã báo của cả lệnh: có công đoạn thì lấy công đoạn CHẬM NHẤT, không thì cộng dồn như cũ.
  const reported = stages.length > 0
    ? (() => {
      let thap = Infinity
      for (const st of stages) thap = Math.min(thap, st.qty > 0 ? daBaoStage(st.id) / st.qty : 0)
      return Math.min(plannedOfWo, Math.round(plannedOfWo * thap * 100) / 100)
    })()
    : historyOfWo.reduce((sum, j) => sum + (j.actualQty || 0), 0)
  const remaining = Math.max(0, Math.round((plannedOfWo - reported) * 100) / 100)
  // Đạt ≥90% kế hoạch là TỰ xong — không cần bấm nút (biên ±10% do cắt lẻ, hao hụt).
  // Lệnh có công đoạn thì phải MỌI công đoạn đạt ≥90%, vì reported ở trên đã là công đoạn chậm nhất.
  const done = plannedOfWo > 0 && reported >= plannedOfWo * 0.9
  // Lệnh đã nghiệm thu trọn mà báo thêm thì phần thêm là ĐỢT MỚI, phải mời nghiệm thu lại.
  const alreadyAccepted = selectedWo?.status === 'QC_PASSED'

  const update = (field: string, value: string) => setForm({ ...form, [field]: value })

  // Đổi lệnh thì đơn vị chạy theo đơn vị CỦA LỆNH — xưởng sơn nhận lệnh tính m² thì báo m²,
  // không để mặc định kg rồi cộng nhầm hai thứ khác đơn vị vào cùng một lệnh.
  const pickWo = (woId: string) => {
    const w = workOrders.find(x => x.id === woId)
    setStageQty({})
    setForm(f => ({ ...f, workOrderId: woId, unit: w?.unit || DEFAULT_WO_UNIT }))
  }

  // Các công đoạn có nhập số lần này — mỗi công đoạn sẽ thành một phiếu riêng.
  const lines = stages
    .map(st => ({ stageId: st.id, actualQty: parseFloat(stageQty[st.id] || '') }))
    .filter(l => Number.isFinite(l.actualQty) && l.actualQty > 0)

  const submit = async () => {
    if (!form.workOrderId || !form.workDate) return notify('Chọn lệnh sản xuất và ngày báo cáo')
    if (stages.length > 0 && lines.length === 0) {
      return notify('Nhập khối lượng cho ít nhất một công đoạn')
    }
    if (stages.length === 0 && !(parseFloat(form.actualQty) > 0)) {
      return notify('Nhập khối lượng thực tế')
    }
    setSubmitting(true)
    const res = await apiFetch('/api/production/job-cards', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        // Lệnh có công đoạn: gửi từng công đoạn, server tách thành từng phiếu.
        lines: stages.length > 0 ? lines : undefined,
        plannedQty: stages.length === 0 && plannedOfWo > 0 ? plannedOfWo : undefined,
        actualQty: stages.length === 0 && form.actualQty ? parseFloat(form.actualQty) : undefined,
        manpower: form.manpower ? parseInt(form.manpower) : undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) { notify(res.message || 'Đã lưu phiếu'); onCreated() }
    else notify(res.error || 'Lỗi tạo phiếu')
  }

  return (
    <Modal open={open} onClose={onClose} title={initialWoId ? 'Báo tiếp khối lượng' : 'Nhập khối lượng hoàn thành'} size="lg"
      actions={
        <div className="flex gap-3 w-full justify-end">
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button variant="primary" onClick={submit} loading={submitting}>{submitting ? 'Đang lưu...' : 'Lưu phiếu'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* WO selector — đánh dấu ngay trong danh sách lệnh nào đã có phiếu, để khỏi tưởng là báo lần đầu */}
        <SelectField
          label="Lệnh SX (WO) *"
          value={form.workOrderId}
          onChange={e => pickWo(e.target.value)}
          options={[
            { value: '', label: 'Chọn WO...' },
            ...workOrders.map(wo => {
              const r = reportedByWo[wo.id]
              const mark = r ? ` ✓ đã báo ${formatNumber(Math.round(r.qty))} kg` : ''
              const st = WO_STATUS_LABEL[wo.status] || wo.status
              return { value: wo.id, label: `${wo.woCode} [${st}] — ${wo.description}${mark}` }
            }),
          ]}
        />

        {alreadyAccepted && (
          <div className="rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--info, #2563eb)', background: 'rgba(37, 99, 235, 0.08)', color: 'var(--text-primary)' }}>
            <p className="font-semibold">Lệnh này đã nghiệm thu xong khối lượng đã báo</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Báo thêm vẫn được — phần thêm là một đợt mới, QAQC và PM phải nghiệm thu lại đợt đó.
            </p>
          </div>
        )}

        {/* Chọn phải lệnh đã báo rồi → nói rõ, kèm số liệu và lần gần nhất. Không chặn: báo tiếp là hợp lệ. */}
        {historyOfWo.length > 0 && (
          <div
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              border: `1px solid ${done ? 'var(--success, #16a34a)' : 'var(--warning, #f59e0b)'}`,
              background: done ? 'rgba(22, 163, 74, 0.08)' : 'rgba(245, 158, 11, 0.10)',
              color: 'var(--text-primary)',
            }}
          >
            <p className="font-semibold">
              Lệnh này đã được báo cáo {historyOfWo.length} lần — {formatNumber(Math.round(reported))} / {formatNumber(Math.round(plannedOfWo))} kg
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {done
                ? 'Đã đạt kế hoạch — lệnh coi như xong, không nhập thêm khối lượng.'
                : `Còn ${formatNumber(remaining)} kg. Phiếu này sẽ cộng tiếp vào lệnh, không thay thế các lần đã báo.`}
            </p>
            <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
              Gần nhất: {historyOfWo[0].jobCode} · {formatDate(historyOfWo[0].workDate)} — {formatNumber(historyOfWo[0].actualQty || 0)} {historyOfWo[0].unit}
            </p>
          </div>
        )}

        {/* ── Lệnh CÓ công đoạn: báo riêng từng công đoạn ──
            PM giao xưởng này mấy công đoạn thì ở đây có bấy nhiêu dòng. Mỗi công đoạn chạy qua
            TRỌN khối lượng của lệnh (Pha cắt 24.784 kg, Hàn cũng 24.784 kg — hai lượt việc trên
            cùng khối thép), nên tuyệt đối không gộp vào một ô rồi cộng lại. */}
        {stages.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-heading)' }}>
                Công đoạn của lệnh ({stages.length})
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Mỗi công đoạn chạy qua trọn khối lượng của lệnh — chỉ nhập công đoạn đã làm
              </span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs" style={{ background: 'var(--bg-subtle, #f8fafc)', color: 'var(--text-muted)' }}>
                    <th className="px-3 py-2 text-left font-semibold">CÔNG ĐOẠN</th>
                    <th className="px-3 py-2 text-left font-semibold">CHỦNG LOẠI</th>
                    <th className="px-3 py-2 text-right font-semibold">KL GIAO</th>
                    <th className="px-3 py-2 text-right font-semibold">ĐÃ BÁO</th>
                    <th className="px-3 py-2 text-right font-semibold">CÒN LẠI</th>
                    <th className="px-3 py-2 text-right font-semibold" style={{ width: 150 }}>KL LẦN NÀY</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map(st => {
                    const daBao = daBaoStage(st.id)
                    const conLai = conLaiStage(st)
                    const xong = st.qty > 0 && daBao >= st.qty * 0.9
                    const day = st.qty > 0 && daBao >= st.qty
                    return (
                      <tr key={st.id} style={{ borderTop: '1px solid var(--border-light, #eef2f7)' }}>
                        <td className="px-3 py-2 font-medium">
                          {st.stageCode && <span className="font-mono text-xs mr-1" style={{ color: 'var(--accent)' }}>{st.stageCode}</span>}
                          {st.name}
                          {xong && <span className="ml-1.5 text-xs" style={{ color: '#047857' }}>✓ đủ</span>}
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{st.category || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatNumber(st.qty)} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unitLabel(st.unit)}</span></td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatNumber(Math.round(daBao))}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: conLai > 0 ? 'var(--warning, #b45309)' : '#047857' }}>{formatNumber(conLai)}</td>
                        <td className="px-3 py-2">
                          <input
                            className="input-field text-sm text-right w-full"
                            type="number" min="0" step="any"
                            disabled={day}
                            title={day ? 'Công đoạn này đã báo đủ khối lượng giao' : `Còn ${formatNumber(conLai)} ${unitLabel(st.unit)}`}
                            placeholder={day ? 'đã đủ' : '0'}
                            value={stageQty[st.id] || ''}
                            onChange={e => setStageQty(q => ({ ...q, [st.id]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Để trống công đoạn chưa làm. Mỗi công đoạn có nhập số sẽ thành một phiếu riêng.
              Lệnh chỉ xong khi MỌI công đoạn báo đủ.
            </p>
          </div>
        )}

        {/* ── Lệnh chạy nguyên khối (không khai công đoạn) ──
            Thứ tự đọc: kế hoạch → còn lại → nhập thực tế. Hai ô đầu CHỈ ĐỌC, xưởng chỉ gõ ô thứ ba. */}
        {stages.length === 0 && (
        <div className="grid grid-cols-4 gap-3">
          {/* Lấy thẳng từ lệnh, không cho sửa — kế hoạch là do PM phát hành WO quyết. */}
          <InputField
            label="KL kế hoạch"
            value={selectedWo ? `${formatNumber(Math.round(plannedOfWo))} ${form.unit}` : '—'}
            readOnly
            helperText={selectedWo?.plannedWeight ? 'Theo lệnh sản xuất' : 'Lệnh chưa có khối lượng kế hoạch'}
          />
          {/* Hệ tự tính = kế hoạch − đã báo. */}
          <InputField
            label="KL còn lại"
            value={selectedWo ? `${formatNumber(remaining)} ${form.unit}` : '—'}
            readOnly
            helperText={selectedWo ? `Đã báo ${formatNumber(Math.round(reported))} / ${formatNumber(Math.round(plannedOfWo))}` : undefined}
          />
          <InputField
            label={done ? 'Đã xong — không nhập nữa' : 'KL thực tế *'}
            type="number"
            disabled={done}
            value={form.actualQty}
            onChange={e => update('actualQty', e.target.value)}
            placeholder="0"
          />
          <SelectField
            label="Đơn vị"
            value={form.unit}
            onChange={e => update('unit', e.target.value)}
            options={WO_UNITS.map(u => ({ value: u.value, label: u.label }))}
          />
        </div>
        )}

        {/* Date + Manpower */}
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Ngày báo cáo *"
            type="date"
            value={form.workDate}
            onChange={e => update('workDate', e.target.value)}
          />
          <InputField
            label="Số CN"
            type="number"
            value={form.manpower}
            onChange={e => update('manpower', e.target.value)}
            placeholder="Số công nhân"
          />
        </div>

        {/* Notes */}
        <TextareaField
          label="Ghi chú"
          value={form.notes}
          onChange={e => update('notes', e.target.value)}
          rows={2}
          placeholder="Ghi chú..."
        />

      </div>
    </Modal>
  )
}
