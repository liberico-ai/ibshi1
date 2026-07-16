'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { MAppBar, MPhotoCapture } from '@/components/mobile'
import { StatusBadge } from '@/components/ui'
import { Plus, X, Check } from 'lucide-react'

interface Inspection {
  id: string
  inspectionCode: string
  type: string
  status: string
  remarks: string | null
  pieceMark: string | null
  project: { projectCode: string } | null
}

export default function MobileDftPad({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [insp, setInsp] = useState<Inspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [spec, setSpec] = useState('')          // chuẩn tối thiểu (µm)
  const [points, setPoints] = useState<string[]>(['', '', ''])
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    apiFetch(`/api/qc/${id}`).then((res) => {
      if (res.ok) setInsp(res.inspection)
      setLoading(false)
    })
  }, [id])

  const specNum = parseFloat(spec)
  const nums = points.map((p) => parseFloat(p)).filter((n) => !Number.isNaN(n))
  const hasSpec = !Number.isNaN(specNum) && specNum > 0
  const below = hasSpec ? nums.filter((n) => n < specNum) : []
  const minVal = nums.length ? Math.min(...nums) : null
  const verdict: 'PASSED' | 'FAILED' | null =
    !hasSpec || nums.length === 0 ? null : below.length === 0 ? 'PASSED' : 'FAILED'

  const submit = async () => {
    if (!verdict) { setToast({ kind: 'err', text: 'Nhập chuẩn và ít nhất một số đo' }); return }
    setSaving(true)
    setToast(null)
    const remarks = `DFT/NDT — chuẩn ≥ ${specNum} µm | số đo: ${nums.join(', ')} µm | thấp nhất ${minVal} µm${
      below.length ? ` | ${below.length} điểm dưới chuẩn` : ' | tất cả đạt'
    }`
    const res = await apiFetch(`/api/qc/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: verdict, remarks }),
    })
    setSaving(false)
    if (res.ok) {
      setToast({ kind: 'ok', text: 'Đã lưu kết quả đo' })
      setTimeout(() => router.push('/m/qc/dft'), 900)
    } else {
      setToast({ kind: 'err', text: res.error || 'Không lưu được' })
    }
  }

  if (loading) return <><MAppBar title="Đo DFT" backHref="/m/qc/dft" /><div className="m-spinner" /></>
  if (!insp) {
    return (
      <>
        <MAppBar title="Đo DFT" backHref="/m/qc/dft" />
        <main className="m-main"><div className="m-empty"><strong>Không tìm thấy biên bản</strong></div></main>
      </>
    )
  }

  const done = insp.status !== 'PENDING'

  return (
    <>
      <MAppBar title={insp.type} subtitle={insp.inspectionCode} backHref="/m/qc/dft" />

      <main className="m-main">
        <div className="m-card">
          <div className="m-card-head">
            <span className="m-code">{insp.inspectionCode}</span>
            <StatusBadge category="qc" status={insp.status} />
          </div>
          <dl className="m-facts">
            <div className="m-fact"><dt>Dự án · Piece-mark</dt><dd className="m-mono">{insp.project?.projectCode || '—'} · {insp.pieceMark || '—'}</dd></div>
          </dl>
        </div>

        {done ? (
          <div className="m-note m-note-ok"><span>Đã chốt: {insp.remarks || insp.status}</span></div>
        ) : (
          <>
            <div className="m-card">
              <label className="m-label">Chuẩn tối thiểu (µm)</label>
              <input
                className="m-input m-mono"
                inputMode="decimal"
                placeholder="vd 240"
                value={spec}
                onChange={(e) => setSpec(e.target.value.replace(',', '.'))}
              />
            </div>

            <div className="m-section-title">Số đo các điểm (µm)</div>
            <div className="m-card">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {points.map((p, idx) => {
                  const n = parseFloat(p)
                  const bad = hasSpec && !Number.isNaN(n) && n < specNum
                  return (
                    <div key={idx} style={{ position: 'relative' }}>
                      <input
                        className="m-input m-mono"
                        inputMode="decimal"
                        value={p}
                        placeholder="—"
                        style={{
                          textAlign: 'center', paddingRight: 22,
                          borderColor: bad ? 'var(--m-red)' : undefined,
                          color: bad ? 'var(--m-red-ink)' : undefined,
                        }}
                        onChange={(e) => {
                          const v = e.target.value.replace(',', '.')
                          setPoints((arr) => arr.map((x, i) => (i === idx ? v : x)))
                        }}
                      />
                      {points.length > 1 && (
                        <button
                          type="button"
                          aria-label="Xóa điểm"
                          onClick={() => setPoints((arr) => arr.filter((_, i) => i !== idx))}
                          style={{ position: 'absolute', top: 4, right: 4, border: 0, background: 'none', color: 'var(--m-ink-3)', cursor: 'pointer', padding: 2 }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="m-btn m-btn-dashed"
                  style={{ minHeight: 52, borderRadius: 13 }}
                  onClick={() => setPoints((arr) => [...arr, ''])}
                >
                  <Plus size={20} />
                </button>
              </div>

              {verdict && (
                <div className={`m-note ${verdict === 'PASSED' ? 'm-note-ok' : 'm-note-warn'}`}>
                  <span>
                    {verdict === 'PASSED'
                      ? `Tất cả ${nums.length} điểm đạt (thấp nhất ${minVal} µm)`
                      : `${below.length} điểm dưới chuẩn (thấp nhất ${minVal} < ${specNum})`}
                  </span>
                  <span style={{ fontWeight: 600 }}>{verdict === 'PASSED' ? 'ĐẠT' : 'LỖI'}</span>
                </div>
              )}
            </div>

            <div className="m-card">
              <MPhotoCapture entityId={`inspection_${insp.id}`} label="Ảnh máy đo" />
            </div>

            {toast && (
              <div className={`m-note ${toast.kind === 'ok' ? 'm-note-ok' : 'm-note-err'}`}><span>{toast.text}</span></div>
            )}

            <button
              type="button"
              className={verdict === 'FAILED' ? 'm-btn m-btn-stop' : 'm-btn m-btn-go'}
              disabled={saving || !verdict}
              onClick={submit}
            >
              {verdict === 'FAILED' ? <><X size={22} strokeWidth={2.6} /> Lưu — LỖI</> : <><Check size={22} strokeWidth={2.6} /> Lưu kết quả đo</>}
            </button>
          </>
        )}
      </main>
    </>
  )
}
