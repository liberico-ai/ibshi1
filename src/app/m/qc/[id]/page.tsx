'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MSegmented, MPhotoCapture, MBottomSheet } from '@/components/mobile'
import type { MSegmentOption } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { Check, X } from 'lucide-react'

interface ChecklistItem {
  id: string
  checkItem: string
  standard: string | null
  result: string | null
  notes: string | null
}
interface Inspection {
  id: string
  inspectionCode: string
  type: string
  stepCode: string | null
  status: string
  remarks: string | null
  pieceMark: string | null
  checklistItems: ChecklistItem[]
}

type Verdict = 'PASSED' | 'FAILED' | 'CONDITIONAL'
const VERDICTS: MSegmentOption<Verdict>[] = [
  { value: 'PASSED', label: 'ĐẠT', tone: 'success' },
  { value: 'CONDITIONAL', label: 'ĐẠT ĐK', tone: 'warning' },
  { value: 'FAILED', label: 'LỖI', tone: 'danger' },
]
const CHECK: MSegmentOption<'PASS' | 'FAIL'>[] = [
  { value: 'PASS', label: 'Đạt', tone: 'success' },
  { value: 'FAIL', label: 'Lỗi', tone: 'danger' },
]

export default function MobileQcDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [insp, setInsp] = useState<Inspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checks, setChecks] = useState<Record<string, 'PASS' | 'FAIL'>>({})
  const [remarks, setRemarks] = useState('')
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmFail, setConfirmFail] = useState(false)

  useEffect(() => {
    apiFetch(`/api/qc/${id}`).then((res) => {
      if (res.ok) {
        const i: Inspection = res.inspection
        setInsp(i)
        if (i.status !== 'PENDING') setVerdict(i.status as Verdict)
        setRemarks(i.remarks || '')
        const c: Record<string, 'PASS' | 'FAIL'> = {}
        i.checklistItems.forEach((it) => { if (it.result === 'PASS' || it.result === 'FAIL') c[it.id] = it.result })
        setChecks(c)
      }
      setLoading(false)
    })
  }, [id])

  const submit = async () => {
    if (!verdict) { setToast({ kind: 'err', text: 'Chọn kết quả ĐẠT / ĐẠT ĐK / LỖI' }); return }
    setSaving(true)
    setToast(null)
    const res = await apiFetch(`/api/qc/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: verdict,
        remarks: remarks || undefined,
        checklistResults: Object.entries(checks).map(([itemId, result]) => ({ id: itemId, result })),
      }),
    })
    setSaving(false)
    setConfirmFail(false)
    if (res.ok) {
      setToast({ kind: 'ok', text: res.message || 'Đã lưu kết quả' })
      setTimeout(() => router.push('/m/qc'), 900)
    } else {
      setToast({ kind: 'err', text: res.error || 'Không lưu được' })
    }
  }

  if (loading) {
    return <><MAppBar title="Nghiệm thu" backHref="/m/qc" /><div className="m-spinner" /></>
  }
  if (!insp) {
    return (
      <>
        <MAppBar title="Nghiệm thu" backHref="/m/qc" />
        <main className="m-main"><div className="m-empty"><strong>Không tìm thấy biên bản</strong></div></main>
      </>
    )
  }

  const done = insp.status !== 'PENDING'

  return (
    <>
      <MAppBar title={insp.type} subtitle={`${insp.inspectionCode}`} backHref="/m/qc" />

      <main className="m-main">
        <div className="m-card">
          <div className="m-card-head">
            <span className="m-code">{insp.inspectionCode}</span>
            <StatusBadge category="qc" status={insp.status} />
          </div>
          <div className="m-card-title">{insp.type}</div>
          <dl className="m-facts">
            <div className="m-fact"><dt>Piece-mark</dt><dd className="m-mono">{insp.pieceMark || '—'}</dd></div>
            <div className="m-fact"><dt>Bước</dt><dd>{insp.stepCode || '—'}</dd></div>
          </dl>
        </div>

        {insp.checklistItems.length > 0 && (
          <>
            <div className="m-section-title">Hạng mục kiểm tra</div>
            {insp.checklistItems.map((it) => (
              <div className="m-card" key={it.id}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--m-ink)' }}>{it.checkItem}</div>
                {it.standard && <div style={{ fontSize: 12.5, color: 'var(--m-ink-3)' }}>Chuẩn: {it.standard}</div>}
                <MSegmented
                  options={CHECK}
                  value={checks[it.id] || null}
                  onChange={(v) => setChecks((c) => ({ ...c, [it.id]: v }))}
                  disabled={done || saving}
                />
              </div>
            ))}
          </>
        )}

        <div className="m-section-title">Kết quả nghiệm thu</div>
        <div className="m-card">
          <MSegmented options={VERDICTS} value={verdict} onChange={setVerdict} disabled={done || saving} />
          <textarea
            className="m-input"
            style={{ height: 'auto', minHeight: 72, padding: '10px 14px', resize: 'vertical', lineHeight: 1.4 }}
            placeholder="Ghi chú (tùy chọn)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={done || saving}
          />
        </div>

        <div className="m-card">
          <MPhotoCapture entityId={`inspection_${insp.id}`} disabled={done} />
        </div>

        {toast && (
          <div className={`m-note ${toast.kind === 'ok' ? 'm-note-ok' : 'm-note-err'}`}><span>{toast.text}</span></div>
        )}

        {!done && (
          <button
            type="button"
            className={verdict === 'FAILED' ? 'm-btn m-btn-stop' : 'm-btn m-btn-go'}
            disabled={saving}
            onClick={() => (verdict === 'FAILED' ? setConfirmFail(true) : submit())}
          >
            {verdict === 'FAILED' ? <><X size={22} strokeWidth={2.6} /> Ghi LỖI</> : <><Check size={22} strokeWidth={2.6} /> Lưu kết quả</>}
          </button>
        )}

        {done && (
          <div className="m-note m-note-ok"><span>Biên bản đã chốt kết quả, không sửa được nữa.</span></div>
        )}
      </main>

      <MBottomSheet open={confirmFail} onClose={() => setConfirmFail(false)} title="Ghi kết quả LỖI?">
        <p style={{ margin: 0, fontSize: 14, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
          Biên bản <b className="m-mono">{insp.inspectionCode}</b> sẽ được đánh dấu <b>không đạt</b>.
          Hãy chắc chắn đã chụp ảnh và ghi chú lý do trước khi lưu.
        </p>
        <button type="button" className="m-btn m-btn-stop" disabled={saving} onClick={submit}>
          <X size={22} strokeWidth={2.6} /> Xác nhận LỖI
        </button>
        <button type="button" className="m-btn m-btn-quiet" onClick={() => setConfirmFail(false)}>Quay lại</button>
      </MBottomSheet>
    </>
  )
}
