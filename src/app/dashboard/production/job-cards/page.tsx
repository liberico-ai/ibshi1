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

interface JobCard {
  id: string; jobCode: string; workOrderId: string; teamCode: string; workType: string;
  description: string | null; plannedQty: number | null; actualQty: number | null; unit: string;
  workDate: string; manpower: number | null; status: string; notes: string | null; createdAt: string;
  workOrder: { woCode: string; description: string; projectId: string; plannedWeight?: number | null };
}

interface WO { id: string; woCode: string; description: string; status: string; teamCode: string; plannedWeight: number | null }



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
    const m = new Map<string, {
      woId: string; woCode: string; woDesc: string; teamCode: string
      planned: number; reported: number; done: boolean; entries: JobCard[]
    }>()
    for (const j of jobCards) {
      const g = m.get(j.workOrderId) || {
        woId: j.workOrderId,
        woCode: j.workOrder.woCode,
        woDesc: j.workOrder.description,
        teamCode: j.teamCode,
        // Kế hoạch lấy từ WO; lệnh cũ chưa có thì lùi về số kế hoạch ghi trên phiếu.
        planned: j.workOrder.plannedWeight ?? j.plannedQty ?? 0,
        reported: 0, done: false, entries: [],
      }
      g.reported += j.actualQty || 0
      g.entries.push(j)
      m.set(j.workOrderId, g)
    }
    for (const g of m.values()) {
      g.entries.sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime())
      g.done = g.planned > 0 && g.reported >= g.planned * 0.9   // ±10% là xong
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
                </div>
              </div>

              {/* Lịch sử báo cáo của lệnh này — mỗi lần báo một dòng */}
              <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Lịch sử báo cáo ({g.entries.length})</p>
                {g.entries.map(e => (
                  <div key={e.id} className="flex items-center gap-3 text-xs py-1" style={{ borderBottom: '1px dashed var(--border)' }}>
                    <span className="font-mono" style={{ minWidth: 88 }}>{formatDate(e.workDate)}</span>
                    <span style={{ minWidth: 54 }}>{e.teamCode}</span>
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
  const [form, setForm] = useState({
    workOrderId: initialWoId || '', description: '',
    actualQty: '', unit: 'kg',
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
  const reported = historyOfWo.reduce((sum, j) => sum + (j.actualQty || 0), 0)
  const plannedOfWo = selectedWo?.plannedWeight || 0
  const remaining = Math.max(0, Math.round((plannedOfWo - reported) * 100) / 100)
  // Đạt ≥90% kế hoạch là TỰ xong — không cần bấm nút (biên ±10% do cắt lẻ, hao hụt).
  const done = plannedOfWo > 0 && reported >= plannedOfWo * 0.9
  // Lệnh đã nghiệm thu trọn mà báo thêm thì phần thêm là ĐỢT MỚI, phải mời nghiệm thu lại.
  const alreadyAccepted = selectedWo?.status === 'QC_PASSED'

  const update = (field: string, value: string) => setForm({ ...form, [field]: value })

  const submit = async () => {
    // Công đoạn đã bỏ khỏi form — server tự đặt workType='production' cho phiếu báo khối lượng.
    if (!form.workOrderId || !form.workDate) return notify('Chọn lệnh sản xuất và ngày báo cáo')
    setSubmitting(true)
    const res = await apiFetch('/api/production/job-cards', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        plannedQty: plannedOfWo > 0 ? plannedOfWo : undefined,
        actualQty: form.actualQty ? parseFloat(form.actualQty) : undefined,
        manpower: form.manpower ? parseInt(form.manpower) : undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
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
          onChange={e => update('workOrderId', e.target.value)}
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

        {/* KHÔNG chọn công đoạn: APL không ghi công đoạn nào cả (đã soi hết 47 cột), và một WO
            được hiểu là việc của MỘT công đoạn mà xưởng nhận đã biết. Xưởng chỉ báo khối lượng. */}

        {/* Thứ tự đọc: kế hoạch → còn lại → nhập thực tế. Hai ô đầu CHỈ ĐỌC, xưởng chỉ gõ ô thứ ba. */}
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
            options={[
              { value: 'kg', label: 'kg' },
              { value: 'm', label: 'mét' },
              { value: 'm2', label: 'm²' },
              { value: 'cái', label: 'cái' },
              { value: 'bộ', label: 'bộ' },
            ]}
          />
        </div>

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
