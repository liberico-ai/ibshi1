'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { PageHeader, StatusBadge, Button, EmptyState, Modal, InputField, SelectField, KPICard } from '@/components/ui'
import { formatDate, formatNumber } from '@/lib/utils'
import { STATUS_COLORS, SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ClipboardList } from 'lucide-react'
import { notify, confirmDialog } from '@/components/ui/Toast'

interface Attachment { id: string; fileName: string; fileUrl: string; createdAt: string }

interface Checkpoint {
  id: string; checkpointNo: number; activity: string; description: string;
  inspectionType: string; status: string; remarks: string | null; ncrId: string | null;
  // Biên bản nghiệm thu — bắt buộc có ít nhất 1 file mới chấm Đạt được
  attachments: Attachment[];
  // Hai chữ ký song song; đủ cả hai thì status mới là PASSED
  qcConfirmedAt: string | null; qcConfirmedName: string | null;
  pmConfirmedAt: string | null; pmConfirmedName: string | null;
}

interface Acceptance {
  plannedKg: number; reportedKg: number; acceptedKg: number
  pendingKg: number; availableKg: number; fullyAccepted: boolean; hasFailed: boolean
  blockReason: string | null
}

interface ITP {
  id: string; itpCode: string; projectId: string; name: string; revision: string;
  status: string; createdAt: string; totalCheckpoints: number;
  passedCheckpoints: number; failedCheckpoints: number;
  inspectionDate: string | null;
  // KL của riêng ĐỢT nghiệm thu này (ITP cũ chưa ghi đợt → null)
  acceptedQty: number | null;
  // Tình hình nghiệm thu cộng dồn của cả lệnh
  acceptance: Acceptance | null;
  // Người đang xem ký được vai nào (server quyết, FE không tự suy theo role).
  // canFlagFail rộng hơn canQcSign: kiểm tra viên chấm được Lỗi nhưng không ký nghiệm thu.
  canQcSign: boolean; canPmSign: boolean; canFlagFail: boolean;
  project: { projectCode: string; projectName: string };
  // Lệnh sản xuất mà ITP này kiểm tra (ITP cũ chưa gắn lệnh → null)
  workOrder: {
    id: string; woCode: string; description: string; pieceMark: string | null; teamCode: string;
    plannedWeight: number | null; reportedQty: number; lastReportDate: string | null; reportCount: number;
  } | null;
  checkpoints: Checkpoint[];
}

interface Project { id: string; projectCode: string; projectName: string }

const INSP_TYPE: Record<string, { label: string; color: string }> = {
  HOLD:    { label: 'H', color: SEMANTIC_COLORS.danger.solid },
  WITNESS: { label: 'W', color: SEMANTIC_COLORS.warning.solid },
  MONITOR: { label: 'M', color: SEMANTIC_COLORS.info.solid },
  REVIEW:  { label: 'R', color: SEMANTIC_COLORS.neutral.solid },
}

export default function ITPPage() {
  const [itps, setItps] = useState<ITP[]>([])
  // Biên bản có bắt buộc hay không do server quyết (cổng ff_itp_require_minutes), FE không tự đoán.
  const [requireMinutes, setRequireMinutes] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [uploadingCp, setUploadingCp] = useState<string | null>(null)
  const user = useAuthStore(s => s.user)

  const loadData = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/qc/itp')
    if (res.ok) {
      setItps(res.itps || [])
      setRequireMinutes(!!res.requireMinutes)
    }
    setLoading(false)
  }, [])

  const openForm = async () => {
    const pRes = await apiFetch('/api/projects/options')
    if (pRes.ok) setProjects(pRes.projects || [])
    setShowForm(true)
  }

  useEffect(() => { loadData() }, [loadData])

  const canInspect = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')
  const canCreate = canInspect

  // Đính biên bản nghiệm thu vào một điểm kiểm. Dùng fetch thô vì apiFetch ép JSON,
  // còn upload phải gửi multipart/form-data.
  const uploadMinutes = async (cpId: string, file: File) => {
    setUploadingCp(cpId)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('entityType', 'ITPCheckpoint')
    fd.append('entityId', cpId)
    const token = sessionStorage.getItem('ibs_token')
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json()).catch(() => ({ ok: false, error: 'Lỗi tải file lên' }))
    setUploadingCp(null)
    if (res.ok) { notify(`Đã đính ${res.attachment.fileName}`); loadData() }
    else notify(res.error || 'Lỗi tải file lên')
  }

  const removeMinutes = async (attId: string, fileName: string) => {
    if (!(await confirmDialog(`Gỡ biên bản "${fileName}"?`))) return
    const res = await apiFetch(`/api/upload/${attId}`, { method: 'DELETE' })
    if (res.ok) loadData()
    else notify(res.error || 'Không gỡ được file')
  }

  const updateCheckpoint = async (
    itpId: string, cpId: string, status: 'PASSED' | 'FAILED',
    createNcr?: boolean, side?: 'QC' | 'PM',
  ) => {
    const remarks = status === 'FAILED' ? prompt('Ghi chú lỗi:') : null
    if (status === 'FAILED' && remarks === null) return

    const res = await apiFetch(`/api/qc/itp/${itpId}/checkpoints/${cpId}`, {
      method: 'PUT',
      body: JSON.stringify({ status, remarks: remarks || undefined, createNcr, side }),
    })
    if (res.ok) {
      loadData()
      if (res.ncrId) notify(`Đã tạo NCR tự động (${res.ncrId.slice(0, 8)}…)`)
      else if (res.waitingFor) notify(`Đã ghi xác nhận ${res.side === 'QC' ? 'TP QAQC' : 'PM'} — còn chờ ${res.waitingFor === 'PM' ? 'PM dự án' : 'TP QAQC'} xác nhận`)
      else if (res.bothConfirmed) notify('Đủ hai chữ ký PM + TP QAQC — điểm kiểm đã Đạt')
      // Nghiệm thu xong thì lệnh sản xuất tự đổi trạng thái — báo để khỏi phải sang màn WO kiểm lại
      if (res.woSync) notify(`Lệnh ${res.woSync.woCode} tự chuyển ${res.woSync.to === 'QC_PASSED' ? 'QC Đạt' : 'QC Không đạt'}`)
      else if (res.woBlocked) notify(`Đủ chữ ký nhưng lệnh chưa chuyển QC Đạt: ${res.woBlocked}`)
    } else {
      notify(res.error || 'Lỗi cập nhật')
    }
  }

  if (loading) return <div className="space-y-4 animate-fade-in">{[1,2,3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>

  const totalCheckpoints = itps.reduce((s, i) => s + i.totalCheckpoints, 0)
  const totalPassed = itps.reduce((s, i) => s + i.passedCheckpoints, 0)
  const totalFailed = itps.reduce((s, i) => s + i.failedCheckpoints, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kế hoạch Kiểm tra (ITP)"
        subtitle="Lập và theo dõi kế hoạch kiểm tra"
        actions={canCreate ? <Button variant="primary" onClick={openForm}>+ Tạo ITP</Button> : undefined}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KPICard label="Tổng ITP" value={itps.length} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Tổng điểm kiểm" value={totalCheckpoints} accentColor={SEMANTIC_COLORS.neutral.solid} />
        <KPICard label="Đạt" value={totalPassed} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard
          label="Lỗi"
          value={totalFailed}
          accentColor={totalFailed > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid}
        />
      </div>

      <div className="space-y-3">
        {itps.length === 0 && (
          <EmptyState icon={<ClipboardList />} title="Chưa có ITP nào" description="Tạo ITP đầu tiên để bắt đầu quản lý kiểm tra" />
        )}
        {itps.map(itp => {
          const progress = itp.totalCheckpoints ? Math.round((itp.passedCheckpoints / itp.totalCheckpoints) * 100) : 0
          const isExpanded = expanded === itp.id
          const itpColors = STATUS_COLORS.itp[itp.status as keyof typeof STATUS_COLORS.itp]
          return (
            <div key={itp.id} className="card overflow-hidden transition-all hover:shadow-md">
              <div className="p-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : itp.id)}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-lg"
                    style={{
                      background: itpColors?.bg || SEMANTIC_COLORS.neutral.bg,
                      color: itpColors?.text || SEMANTIC_COLORS.neutral.solid,
                    }}>
                    {progress}%
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono font-bold" style={{ color: 'var(--accent)' }}>{itp.itpCode}</span>
                      <StatusBadge category="itp" status={itp.status} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>Rev {itp.revision}</span>
                    </div>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{itp.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>DA: <span className="font-mono">{itp.project.projectCode}</span></p>
                    {/* ITP gắn với lệnh nào, xưởng đã báo bao nhiêu, kiểm ngày nào */}
                    {itp.workOrder && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-mono">{itp.workOrder.woCode}</span>
                        {itp.workOrder.pieceMark ? ` · ${itp.workOrder.pieceMark}` : ''}
                        {' · '}
                        <span className="font-mono" style={{ color: SEMANTIC_COLORS.success.solid }}>
                          {formatNumber(Math.round(itp.workOrder.reportedQty))} kg đã báo
                        </span>
                        {itp.workOrder.lastReportDate ? ` · báo ${formatDate(itp.workOrder.lastReportDate)}` : ''}
                        {itp.inspectionDate ? ` · kiểm ${formatDate(itp.inspectionDate)}` : ''}
                      </p>
                    )}
                    {/* ĐỢT nghiệm thu này bao nhiêu, và cả lệnh đã nghiệm thu tới đâu */}
                    {itp.acceptedQty !== null && itp.acceptedQty !== undefined && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        Đợt này: <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>
                          {formatNumber(Math.round(itp.acceptedQty))} kg
                        </span>
                        {itp.acceptance && (
                          <>
                            {' · lệnh đã nghiệm thu '}
                            <span className="font-mono">
                              {formatNumber(Math.round(itp.acceptance.acceptedKg))}
                              {itp.acceptance.plannedKg > 0 ? `/${formatNumber(Math.round(itp.acceptance.plannedKg))}` : ''} kg
                            </span>
                            {itp.acceptance.availableKg > 0
                              ? ` · còn ${formatNumber(Math.round(itp.acceptance.availableKg))} kg chờ mời`
                              : itp.acceptance.fullyAccepted ? ' · đã nghiệm thu trọn lệnh' : ''}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    <p><span className="font-mono">{itp.totalCheckpoints}</span> điểm kiểm</p>
                    <p className="font-semibold" style={{ color: SEMANTIC_COLORS.success.solid }}>&#10003; {itp.passedCheckpoints}</p>
                    {itp.failedCheckpoints > 0 && <p className="font-semibold" style={{ color: SEMANTIC_COLORS.danger.solid }}>&#10007; {itp.failedCheckpoints}</p>}
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</span>
                </div>
              </div>
              {isExpanded && itp.checkpoints.length > 0 && (
                <div className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <div className="p-3 space-y-1">
                    {itp.checkpoints.map(cp => {
                      const ins = INSP_TYPE[cp.inspectionType] || INSP_TYPE.MONITOR
                      const isPending = cp.status === 'PENDING'
                      // Biên bản nghiệm thu chỉ CHẶN khi cổng đang bật; tắt thì ký Đạt trước, đính sau.
                      const hasMinutes = cp.attachments.length > 0
                      const minutesOk = hasMinutes || !requireMinutes
                      const canSignQc = itp.canQcSign
                      const canSignPm = itp.canPmSign
                      const canFlagFail = itp.canFlagFail
                      return (
                        <div key={cp.id} className="py-2 px-3 rounded-lg" style={{ background: 'var(--bg-primary)' }}>
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold text-white" style={{ background: ins.color }}>{ins.label}</span>
                          <span className="font-mono text-xs w-6" style={{ color: 'var(--text-muted)' }}>#{cp.checkpointNo}</span>
                          <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
                            {cp.description}
                            {cp.remarks && <span className="ml-2 italic" style={{ color: 'var(--text-muted)' }}>— {cp.remarks}</span>}
                          </span>
                          {cp.ncrId && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: SEMANTIC_COLORS.danger.bg, color: SEMANTIC_COLORS.danger.solid }}>NCR</span>}
                          <StatusBadge category="qc" status={cp.status === 'PENDING' ? 'PENDING' : cp.status === 'PASSED' ? 'PASSED' : 'FAILED'} />
                          {isPending && (canSignQc || canSignPm || canFlagFail) && (
                            <div className="flex gap-1">
                              {/* Hai vai ký độc lập, không phân thứ tự — ai xong trước bấm trước */}
                              {canSignQc && !cp.qcConfirmedAt && (
                                <button
                                  className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                  title={minutesOk ? 'Trưởng phòng QAQC xác nhận đạt' : 'Phải đính biên bản nghiệm thu trước'}
                                  style={{
                                    background: SEMANTIC_COLORS.success.solid,
                                    opacity: minutesOk ? 1 : 0.4,
                                    cursor: minutesOk ? 'pointer' : 'not-allowed',
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!minutesOk) return notify('Phải đính kèm biên bản nghiệm thu trước khi chấm Đạt')
                                    updateCheckpoint(itp.id, cp.id, 'PASSED', undefined, 'QC')
                                  }}
                                >TP QAQC xác nhận</button>
                              )}
                              {canSignPm && !cp.pmConfirmedAt && (
                                <button
                                  className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                  title={minutesOk ? 'PM phụ trách dự án xác nhận đạt' : 'Phải đính biên bản nghiệm thu trước'}
                                  style={{
                                    background: SEMANTIC_COLORS.info.solid,
                                    opacity: minutesOk ? 1 : 0.4,
                                    cursor: minutesOk ? 'pointer' : 'not-allowed',
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!minutesOk) return notify('Phải đính kèm biên bản nghiệm thu trước khi chấm Đạt')
                                    updateCheckpoint(itp.id, cp.id, 'PASSED', undefined, 'PM')
                                  }}
                                >PM dự án xác nhận</button>
                              )}
                              {canFlagFail && (
                                <button
                                  className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                  style={{ background: SEMANTIC_COLORS.danger.solid }}
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    const wantNcr = (cp.inspectionType === 'HOLD' || cp.inspectionType === 'WITNESS')
                                      ? await confirmDialog('Tạo NCR tự động cho lỗi này?')
                                      : false
                                    updateCheckpoint(itp.id, cp.id, 'FAILED', wantNcr)
                                  }}
                                >Lỗi</button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Hai chữ ký song song — đủ cả hai thì điểm kiểm mới Đạt */}
                        <div className="flex items-center gap-2 flex-wrap mt-2 pl-9">
                          <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Xác nhận:</span>
                          {([
                            { key: 'TP QAQC', at: cp.qcConfirmedAt, who: cp.qcConfirmedName },
                            { key: 'PM dự án', at: cp.pmConfirmedAt, who: cp.pmConfirmedName },
                          ] as const).map(s => (
                            <span key={s.key} className="text-[10px] px-2 py-0.5 rounded font-medium"
                              style={s.at
                                ? { background: SEMANTIC_COLORS.success.bg, color: SEMANTIC_COLORS.success.solid }
                                : { background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
                              {/* Có mốc mà không có tên = điểm kiểm cũ, chấm trước khi có quy định hai chữ ký */}
                              {s.at
                                ? `✓ ${s.key} · ${s.who || 'dữ liệu cũ'} · ${formatDate(s.at)}`
                                : `○ ${s.key} chưa xác nhận`}
                            </span>
                          ))}
                        </div>

                        {/* Biên bản nghiệm thu — hồ sơ gốc của lần chấm này */}
                        <div className="flex items-center gap-2 flex-wrap mt-2 pl-9">
                          <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>Biên bản nghiệm thu:</span>
                          {cp.attachments.map(a => (
                            <span key={a.id} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded"
                              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                              <a href={`/api/upload/${a.id}`} target="_blank" rel="noopener noreferrer"
                                className="font-mono hover:underline" style={{ color: 'var(--accent)' }}
                                onClick={e => e.stopPropagation()}>{a.fileName}</a>
                              {canInspect && isPending && (
                                <button
                                  onClick={e => { e.stopPropagation(); removeMinutes(a.id, a.fileName) }}
                                  style={{ color: SEMANTIC_COLORS.danger.solid }}
                                  title="Gỡ file"
                                >&#10005;</button>
                              )}
                            </span>
                          ))}
                          {cp.attachments.length === 0 && (
                            <span className="text-[10px] italic"
                              style={{ color: requireMinutes ? SEMANTIC_COLORS.warning.solid : 'var(--text-muted)' }}>
                              {requireMinutes ? 'chưa có — chưa chấm Đạt được' : 'chưa có (không bắt buộc)'}
                            </span>
                          )}
                          {canInspect && isPending && (
                            <label className="text-[10px] px-2 py-0.5 rounded cursor-pointer font-semibold"
                              style={{ border: '1px dashed var(--border)', color: 'var(--text-secondary)' }}
                              onClick={e => e.stopPropagation()}>
                              {uploadingCp === cp.id ? 'Đang tải...' : '+ Đính file'}
                              <input
                                type="file"
                                className="hidden"
                                disabled={uploadingCp === cp.id}
                                onChange={e => {
                                  const f = e.target.files?.[0]
                                  e.target.value = ''
                                  if (f) uploadMinutes(cp.id, f)
                                }}
                              />
                            </label>
                          )}
                        </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <CreateITPModal
        open={showForm}
        projects={projects}
        onClose={() => setShowForm(false)}
        onCreated={() => { setShowForm(false); loadData() }}
      />
    </div>
  )
}


interface WOOption {
  id: string; woCode: string; description: string; pieceMark: string | null
  teamCode: string; status: string; plannedWeight: number | null
}

/** Phiếu xưởng đã báo cho một lệnh — nguồn để QC biết đã làm xong bao nhiêu, ngày nào. */
interface JCOption {
  id: string; jobCode: string; workOrderId: string; actualQty: number | null
  unit: string; workDate: string; teamCode: string; notes: string | null
  workOrder: {
    woCode: string; description: string; pieceMark: string | null
    teamCode: string; status: string; plannedWeight: number | null
  }
}

const WO_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Mở', IN_PROGRESS: 'Đang SX', QC_PENDING: 'Chờ QC', QC_PASSED: 'QC Đạt',
  QC_FAILED: 'QC Lỗi', COMPLETED: 'Xong', ON_HOLD: 'Tạm dừng', PENDING_MATERIAL: 'Chờ VT',
}

function CreateITPModal({ open, projects, onClose, onCreated }: {
  open: boolean; projects: Project[]; onClose: () => void; onCreated: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [workOrderId, setWorkOrderId] = useState('')
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().split('T')[0])
  const [jobCards, setJobCards] = useState<JCOption[]>([])
  // Tình hình nghiệm thu từng lệnh: đã ký bao nhiêu, còn mời được bao nhiêu.
  const [acceptance, setAcceptance] = useState<Record<string, Acceptance>>({})
  const [batchQty, setBatchQty] = useState('')
  const [loadingWO, setLoadingWO] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function onProjectChange(pid: string) {
    setProjectId(pid)
    setWorkOrderId('')
    setJobCards([])
    if (!pid) return
    setLoadingWO(true)
    // Chỉ cần phiếu báo cáo: mỗi phiếu đã kèm thông tin lệnh của nó. Không gọi /api/production
    // vì API đó chặn limit tối đa 100 — dự án nhiều lệnh (sinh từ APL) sẽ trả lỗi, dropdown rỗng.
    const [jcRes, accRes] = await Promise.all([
      apiFetch(`/api/production/job-cards?projectId=${pid}&limit=500`),
      apiFetch(`/api/production/acceptance?projectId=${pid}`),
    ])
    if (jcRes.ok) setJobCards(jcRes.jobCards || [])
    setAcceptance(accRes.ok ? (accRes.acceptance || {}) : {})
    setLoadingWO(false)
  }

  // Chỉ những lệnh ĐÃ có phiếu báo cáo mới đem đi kiểm tra được — chưa làm thì chưa có gì để kiểm.
  const cardsByWo = jobCards.reduce<Record<string, JCOption[]>>((acc, jc) => {
    (acc[jc.workOrderId] ||= []).push(jc)
    return acc
  }, {})
  const reportedWOs: WOOption[] = Object.entries(cardsByWo).map(([woId, cards]) => ({
    id: woId,
    woCode: cards[0].workOrder.woCode,
    description: cards[0].workOrder.description,
    pieceMark: cards[0].workOrder.pieceMark,
    teamCode: cards[0].workOrder.teamCode,
    status: cards[0].workOrder.status,
    plannedWeight: cards[0].workOrder.plannedWeight,
  })).sort((a, b) => a.woCode.localeCompare(b.woCode))

  const selectedWo = reportedWOs.find(w => w.id === workOrderId)
  const selectedCards = (cardsByWo[workOrderId] || [])
    .slice()
    .sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime())
  const reportedQty = selectedCards.reduce((s, c) => s + (c.actualQty || 0), 0)
  const lastDate = selectedCards[0]?.workDate
  const plannedQty = selectedWo?.plannedWeight || 0
  const pct = plannedQty > 0 ? Math.round((reportedQty / plannedQty) * 100) : 0
  const acc = workOrderId ? acceptance[workOrderId] : undefined
  // Còn mời nghiệm thu được bao nhiêu — server chốt lại lần nữa lúc tạo.
  const availableKg = acc?.availableKg ?? 0
  const blocked = acc?.blockReason ?? null

  function onWoChange(id: string) {
    setWorkOrderId(id)
    // Mặc định nghiệm thu trọn phần xưởng đã báo mà chưa nghiệm thu; sửa nhỏ hơn nếu chỉ nhận một phần.
    const a = acceptance[id]
    setBatchQty(a && a.availableKg > 0 ? String(a.availableKg) : '')
    // Tên ITP điền sẵn theo lệnh cho đỡ gõ; vẫn sửa được.
    const wo = reportedWOs.find(w => w.id === id)
    if (wo && !name.trim()) setName(`Kiểm tra ${wo.woCode}`)
  }

  const submit = async () => {
    if (!projectId) return notify('Chọn dự án')
    if (!workOrderId) return notify('Chọn lệnh sản xuất cần kiểm tra')
    if (!name.trim()) return notify('Nhập tên ITP')
    if (!inspectionDate) return notify('Chọn ngày kiểm tra')
    if (blocked) return notify(blocked)
    const qty = parseFloat(batchQty)
    if (!(qty > 0)) return notify('Nhập khối lượng nghiệm thu đợt này')
    if (qty > availableKg) return notify(`Chỉ còn ${formatNumber(availableKg)} kg chưa nghiệm thu`)
    setSubmitting(true)
    const res = await apiFetch('/api/qc/itp', {
      method: 'POST',
      body: JSON.stringify({ projectId, name: name.trim(), workOrderId, inspectionDate, acceptedQty: qty }),
    })
    setSubmitting(false)
    if (res.ok) onCreated()
    else notify(res.error || 'Lỗi tạo ITP')
  }

  const woOptions = [
    {
      value: '',
      label: !projectId ? 'Chọn dự án trước'
        : loadingWO ? 'Đang tải...'
        : reportedWOs.length === 0 ? 'Dự án chưa có lệnh nào được báo khối lượng'
        : 'Chọn lệnh...',
    },
    ...reportedWOs.map(wo => {
      const qty = (cardsByWo[wo.id] || []).reduce((s, c) => s + (c.actualQty || 0), 0)
      const a = acceptance[wo.id]
      // Nói ngay trong danh sách còn bao nhiêu để mời — khỏi chọn xong mới biết là hết.
      const tail = a
        ? a.availableKg > 0
          ? ` · còn ${formatNumber(Math.round(a.availableKg))} kg chờ nghiệm thu`
          : ' · đã nghiệm thu hết phần đã báo'
        : ` · đã báo ${formatNumber(Math.round(qty))} kg`
      return {
        value: wo.id,
        label: `${wo.woCode}${wo.pieceMark ? ` — ${wo.pieceMark}` : ''}${tail}`,
      }
    }),
  ]

  return (
    <Modal open={open} onClose={onClose} title="Tạo ITP mới" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Dự án *"
            value={projectId}
            onChange={e => onProjectChange(e.target.value)}
            options={[{ value: '', label: 'Chọn...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]}
          />
          <InputField
            label="Ngày kiểm tra *"
            type="date"
            value={inspectionDate}
            onChange={e => setInspectionDate(e.target.value)}
          />
        </div>

        <SelectField
          label={`Lệnh sản xuất cần kiểm tra *${loadingWO ? ' (đang tải...)' : ''}`}
          value={workOrderId}
          onChange={e => onWoChange(e.target.value)}
          options={woOptions}
        />
        {projectId && !loadingWO && reportedWOs.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: -8 }}>
            Chỉ hiện lệnh đã có phiếu báo khối lượng của xưởng — dự án này chưa có lệnh nào được báo.
          </p>
        )}

        {/* Chọn xong thì QC thấy ngay xưởng đã làm được gì, ngày nào — không phải mở màn khác để tra */}
        {selectedWo && (
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono font-bold text-sm" style={{ color: 'var(--accent)' }}>{selectedWo.woCode}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{selectedWo.description}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
                {WO_STATUS_LABEL[selectedWo.status] || selectedWo.status}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3 mt-3">
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Xưởng đã báo</p>
                <p className="font-mono font-bold" style={{ color: 'var(--success, #16a34a)' }}>
                  {formatNumber(Math.round(reportedQty))} kg
                </p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  KH {plannedQty > 0 ? `${formatNumber(Math.round(plannedQty))} kg (${pct}%)` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Đã nghiệm thu</p>
                <p className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formatNumber(Math.round(acc?.acceptedKg ?? 0))} kg
                </p>
                {(acc?.pendingKg ?? 0) > 0 && (
                  <p className="text-[10px]" style={{ color: SEMANTIC_COLORS.warning.solid }}>
                    {formatNumber(Math.round(acc!.pendingKg))} kg đang chờ ký
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Ngày báo gần nhất</p>
                <p className="font-mono" style={{ color: 'var(--text-primary)' }}>{lastDate ? formatDate(lastDate) : '—'}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Xưởng · Piece Mark</p>
                <p className="font-mono" style={{ color: 'var(--text-primary)' }}>
                  {selectedWo.teamCode}{selectedWo.pieceMark ? ` · ${selectedWo.pieceMark}` : ''}
                </p>
              </div>
            </div>

            <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
                Phiếu báo cáo ({selectedCards.length})
              </p>
              {selectedCards.map(c => (
                <div key={c.id} className="flex items-center gap-3 text-xs py-1" style={{ borderBottom: '1px dashed var(--border)' }}>
                  <span className="font-mono" style={{ color: 'var(--text-muted)', minWidth: 80 }}>{c.jobCode}</span>
                  <span style={{ color: 'var(--text-secondary)', minWidth: 90 }}>{formatDate(c.workDate)}</span>
                  <span className="font-mono font-bold" style={{ color: 'var(--success, #16a34a)', minWidth: 80 }}>
                    {formatNumber(c.actualQty || 0)} {c.unit}
                  </span>
                  <span className="truncate" style={{ color: 'var(--text-muted)' }}>{c.notes || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ĐỢT nghiệm thu — nghiệm thu phần đã báo, không phải chờ trọn lệnh */}
        {selectedWo && (blocked ? (
          <div className="rounded-lg px-3 py-2 text-sm"
            style={{ border: `1px solid ${SEMANTIC_COLORS.warning.solid}`, background: SEMANTIC_COLORS.warning.bg, color: 'var(--text-primary)' }}>
            <p className="font-semibold">Chưa mời nghiệm thu được</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{blocked}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <InputField
              label="KL nghiệm thu đợt này (kg) *"
              type="number"
              value={batchQty}
              onChange={e => setBatchQty(e.target.value)}
              placeholder={String(availableKg)}
            />
            <div className="flex flex-col justify-center">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Còn chờ nghiệm thu</p>
              <p className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{formatNumber(availableKg)} kg</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Nhận một phần thì sửa nhỏ lại; phần còn lại mời đợt sau.
              </p>
            </div>
          </div>
        ))}

        <InputField
          label="Tên ITP *"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="VD: Kiểm tra WO-26-001"
        />
      </div>
      <div className="flex gap-3 mt-5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Hủy</Button>
        <Button variant="primary" className="flex-1" onClick={submit} loading={submitting}>
          {submitting ? 'Đang tạo...' : 'Tạo ITP'}
        </Button>
      </div>
    </Modal>
  )
}
