'use client'

import { useEffect, useState, use, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MBottomSheet } from '@/components/mobile'
import { Check, X } from 'lucide-react'

interface Checkpoint {
  id: string
  checkpointNo: number
  activity: string
  description: string | null
  standard: string | null
  acceptCriteria: string | null
  inspectionType: string // MONITOR | HOLD | WITNESS
  status: string // PENDING | PASSED | FAILED
  remarks: string | null
}
interface Itp {
  id: string
  itpCode: string
  name: string
  project: { projectCode: string } | null
  checkpoints: Checkpoint[]
}

const TYPE_TAG: Record<string, string> = {
  HOLD: 'm-tag-red',
  WITNESS: 'm-tag-blue',
  MONITOR: 'm-tag-grey',
}
const TYPE_LABEL: Record<string, string> = { HOLD: 'Hold', WITNESS: 'Witness', MONITOR: 'Monitor' }

export default function MobileItpDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [itp, setItp] = useState<Itp | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [failing, setFailing] = useState<Checkpoint | null>(null)
  const [failRemark, setFailRemark] = useState('')
  const [makeNcr, setMakeNcr] = useState(true)

  const load = useCallback(async () => {
    // Không có route detail riêng — lấy từ danh sách (đã kèm checkpoints).
    const res = await apiFetch('/api/qc/itp')
    const found = res.ok ? (res.itps || []).find((x: Itp) => x.id === id) : null
    setItp(found || null)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const setStatus = async (cp: Checkpoint, status: 'PASSED' | 'FAILED', opts?: { remarks?: string; createNcr?: boolean }) => {
    setBusy(cp.id)
    setToast(null)
    const res = await apiFetch(`/api/qc/itp/${id}/checkpoints/${cp.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status, remarks: opts?.remarks || undefined, createNcr: opts?.createNcr || false }),
    })
    setBusy(null)
    setFailing(null)
    setFailRemark('')
    if (res.ok) {
      setToast({
        kind: 'ok',
        text: status === 'PASSED'
          ? `Điểm #${cp.checkpointNo} đã đạt`
          : res.ncrId ? `Đã ghi lỗi #${cp.checkpointNo} + tạo NCR` : `Đã ghi lỗi #${cp.checkpointNo}`,
      })
      load()
    } else {
      setToast({ kind: 'err', text: res.error || 'Không cập nhật được' })
    }
  }

  if (loading) return <><MAppBar title="Kế hoạch kiểm tra" backHref="/m/qc/itp" /><div className="m-spinner" /></>
  if (!itp) {
    return (
      <>
        <MAppBar title="Kế hoạch kiểm tra" backHref="/m/qc/itp" />
        <main className="m-main"><div className="m-empty"><strong>Không tìm thấy ITP</strong></div></main>
      </>
    )
  }

  return (
    <>
      <MAppBar title={itp.name} subtitle={`${itp.itpCode} · ${itp.project?.projectCode || ''}`} backHref="/m/qc/itp" />

      <main className="m-main">
        {toast && (
          <div className={`m-note ${toast.kind === 'ok' ? 'm-note-ok' : 'm-note-err'}`}><span>{toast.text}</span></div>
        )}

        {itp.checkpoints.length === 0 && (
          <div className="m-empty"><strong>ITP chưa có điểm kiểm tra nào</strong></div>
        )}

        {itp.checkpoints.map((cp) => {
          const done = cp.status !== 'PENDING'
          return (
            <div className="m-card" key={cp.id}>
              <div className="m-card-head">
                <span className="m-mono" style={{ fontSize: 13, fontWeight: 700 }}>#{cp.checkpointNo}</span>
                <span className={`m-tag ${TYPE_TAG[cp.inspectionType] || 'm-tag-grey'}`}>
                  {TYPE_LABEL[cp.inspectionType] || cp.inspectionType}
                </span>
                {cp.status === 'PASSED' && <span className="m-tag m-tag-green">Đạt</span>}
                {cp.status === 'FAILED' && <span className="m-tag m-tag-red">Lỗi</span>}
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--m-ink)' }}>{cp.activity}</div>
              {cp.acceptCriteria && (
                <div style={{ fontSize: 12.5, color: 'var(--m-ink-2)' }}>Tiêu chí: {cp.acceptCriteria}</div>
              )}
              {cp.remarks && (
                <div style={{ fontSize: 12, color: 'var(--m-ink-3)', fontStyle: 'italic' }}>{cp.remarks}</div>
              )}

              {!done && (
                <div className="m-btn-row">
                  <button
                    type="button"
                    className="m-btn m-btn-go"
                    style={{ height: 50, fontSize: 15 }}
                    disabled={busy === cp.id}
                    onClick={() => setStatus(cp, 'PASSED')}
                  >
                    <Check size={20} strokeWidth={2.6} /> Đạt
                  </button>
                  <button
                    type="button"
                    className="m-btn m-btn-stop"
                    style={{ height: 50, fontSize: 15 }}
                    disabled={busy === cp.id}
                    onClick={() => { setFailing(cp); setMakeNcr(cp.inspectionType === 'HOLD') }}
                  >
                    <X size={20} strokeWidth={2.4} /> Lỗi
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </main>

      <MBottomSheet open={!!failing} onClose={() => setFailing(null)} title={failing ? `Ghi lỗi điểm #${failing.checkpointNo}?` : ''}>
        {failing && (
          <>
            <textarea
              className="m-input"
              style={{ height: 'auto', minHeight: 72, padding: '10px 14px', resize: 'vertical', lineHeight: 1.4 }}
              placeholder="Mô tả lỗi (khuyến nghị)"
              value={failRemark}
              onChange={(e) => setFailRemark(e.target.value)}
            />
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--m-ink)', padding: '4px 2px' }}
            >
              <input type="checkbox" checked={makeNcr} onChange={(e) => setMakeNcr(e.target.checked)} style={{ width: 20, height: 20 }} />
              Tạo phiếu NCR và giao xử lý
            </label>
            <button
              type="button"
              className="m-btn m-btn-stop"
              disabled={busy === failing.id}
              onClick={() => setStatus(failing, 'FAILED', { remarks: failRemark, createNcr: makeNcr })}
            >
              <X size={22} strokeWidth={2.6} /> Xác nhận lỗi
            </button>
            <button type="button" className="m-btn m-btn-quiet" onClick={() => setFailing(null)}>Quay lại</button>
          </>
        )}
      </MBottomSheet>
    </>
  )
}
