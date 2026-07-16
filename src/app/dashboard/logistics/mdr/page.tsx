'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import {
  PageHeader, KPICard, EmptyState, SelectField,
} from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { ClipboardList, CheckCircle2, XCircle } from 'lucide-react'

interface MDRData {
  project: { projectCode: string; projectName: string };
  canRelease: boolean;
  blockers: string[];
  mrbRelease: { id: string; revision: number; releasedAt: string } | null;
  summary: {
    ncr: { total: number; open: number; closed: number };
    itp: { total: number; passed: number; failed: number; pending: number };
    inspections: { total: number; passed: number; failed: number };
    packing: { total: number; shipped: number };
    shipments: { total: number; received: number };
  };
  openNcrs: Array<{ id: string; ncrCode: string; status: string; severity: string; category: string }>;
  failedCheckpoints: Array<{ id: string; checkpointNo: number; activity: string; itpCode: string }>;
}

interface ProjectOption { id: string; projectCode: string; projectName: string }

export default function MDRPage() {
  const user = useAuthStore(s => s.user)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<MDRData | null>(null)
  const [loading, setLoading] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [releaseMsg, setReleaseMsg] = useState('')
  const [releaseErr, setReleaseErr] = useState(false)

  useEffect(() => {
    apiFetch('/api/projects').then(r => { if (r.ok) setProjects(r.projects) })
  }, [])

  const loadMdr = useCallback(() => {
    if (!projectId) { setData(null); return }
    setLoading(true)
    apiFetch(`/api/logistics/mdr?projectId=${projectId}`).then(r => {
      if (r.ok) setData(r)
      else setData(null)
      setLoading(false)
    })
  }, [projectId])

  useEffect(() => { setReleaseMsg(''); setReleaseErr(false); loadMdr() }, [loadMdr])

  const canRelease = data?.canRelease || false
  // MRB đã phát hành hay chưa — quyết định hiển thị nút phát hành (tránh vòng lặp canRelease).
  const mrbReleased = !!data?.mrbRelease
  // Chỉ QC/BGĐ được phát hành MRB (khớp RBAC POST /api/qc/mrb/release: R01/R09/R09a).
  // Ẩn nút với PM/TM để không bấm rồi nhận 403.
  const canReleaseRole = ['R01', 'R09', 'R09a'].includes(user?.roleCode || '')

  const handleRelease = async () => {
    if (!projectId || releasing) return
    setReleasing(true)
    setReleaseMsg('')
    setReleaseErr(false)
    const r = await apiFetch('/api/qc/mrb/release', { method: 'POST', body: JSON.stringify({ projectId }) })
    setReleasing(false)
    if (r.ok) {
      setReleaseMsg(r.reused
        ? `MRB đã phát hành trước đó (Rev ${r.release?.revision ?? ''})`
        : `Đã phát hành MRB Rev ${r.release?.revision ?? ''}`)
      setReleaseErr(false)
      loadMdr()
    } else {
      // 422 kèm blockers (NCR/ITP/FAT chưa đạt) → API trả chuỗi lỗi liệt kê blocker.
      setReleaseMsg(r.error || 'Không phát hành được MRB')
      setReleaseErr(true)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="MDR — Hồ sơ giao khách"
        subtitle="Tổng hợp hồ sơ nhà sản xuất giao khách hàng"
      />

      <div className="card p-4">
        <SelectField label="Chọn dự án" value={projectId} onChange={e => setProjectId(e.target.value)}
          options={[{ value: '', label: 'Chọn dự án...' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} — ${p.projectName}` }))]} />
      </div>

      {loading && <div className="h-20 skeleton rounded-xl" />}

      {data && (
        <>
          {/* Release gate */}
          <div className="card p-6 text-center" style={{
            borderTop: `4px solid ${canRelease ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.danger.solid}`,
          }}>
            <div className="mb-2">{canRelease ? <CheckCircle2 size={44} style={{ color: '#16a34a' }} /> : <XCircle size={44} style={{ color: '#dc2626' }} />}</div>
            <h2 className="text-lg font-bold" style={{ color: canRelease ? SEMANTIC_COLORS.success.solid : SEMANTIC_COLORS.danger.solid }}>
              {canRelease ? 'SẴN SÀNG PHÁT HÀNH' : 'CHƯA ĐỦ ĐIỀU KIỆN'}
            </h2>

            {/* Blockers từ GET (NCR/ITP/FAT + trạng thái phát hành MRB) */}
            {!canRelease && data.blockers.length > 0 && (
              <div className="mt-3 text-left max-w-md mx-auto">
                {data.blockers.map((b, i) => (
                  <p key={i} className="text-xs flex items-start gap-2 mb-1">
                    <span style={{ color: SEMANTIC_COLORS.danger.solid }}>●</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{b}</span>
                  </p>
                ))}
              </div>
            )}

            {/* MRB đã phát hành → hiển thị revision */}
            {mrbReleased && data.mrbRelease && (
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                MRB Rev {data.mrbRelease.revision} — phát hành {new Date(data.mrbRelease.releasedAt).toLocaleDateString('vi-VN')}
              </p>
            )}

            {/* Nút phát hành MRB: chỉ khi CHƯA phát hành + đúng role (R01/R09/R09a).
                Không phụ thuộc canRelease (tránh chicken-and-egg). API tự kiểm NCR/ITP/FAT
                và trả 422 kèm blocker nếu chưa đạt. */}
            {!mrbReleased && canReleaseRole && (
              <div className="text-center mt-4">
                <button onClick={handleRelease} disabled={releasing}
                  className="px-5 py-2 rounded-lg font-bold text-white disabled:opacity-60"
                  style={{ background: SEMANTIC_COLORS.info.solid }}>
                  {releasing ? 'Đang phát hành…' : 'Phát hành MRB (Quality Dossier)'}
                </button>
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  Hệ thống kiểm tra NCR/ITP/FAT khi phát hành.
                </p>
              </div>
            )}

            {/* Role không được phép phát hành → thông báo thay vì nút để bấm rồi 403 */}
            {!mrbReleased && !canReleaseRole && (
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                Chỉ QC/BGĐ được phát hành MRB (Quality Dossier).
              </p>
            )}

            {releaseMsg && (
              <p className="text-xs mt-3" style={{ color: releaseErr ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid }}>
                {releaseMsg}
              </p>
            )}
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
            <KPICard label="NCR mở" value={data.summary.ncr.open}
              accentColor={data.summary.ncr.open > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
            <KPICard label="ITP đạt" value={`${data.summary.itp.passed}/${data.summary.itp.total}`}
              accentColor={data.summary.itp.failed > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid} />
            <KPICard label="Kiểm tra" value={`${data.summary.inspections.passed}/${data.summary.inspections.total}`}
              accentColor={SEMANTIC_COLORS.info.solid} />
            <KPICard label="Kiện đã xuất" value={`${data.summary.packing.shipped}/${data.summary.packing.total}`}
              accentColor={SEMANTIC_COLORS.warning.solid} />
            <KPICard label="Chuyến KH nhận" value={`${data.summary.shipments.received}/${data.summary.shipments.total}`}
              accentColor={SEMANTIC_COLORS.success.solid} />
          </div>

          {/* Open NCRs */}
          {data.openNcrs.length > 0 && (
            <div className="card p-4">
              <label className="input-label mb-3" style={{ color: SEMANTIC_COLORS.danger.solid }}>NCR mở — cần đóng trước phát hành</label>
              <div className="space-y-2">
                {data.openNcrs.map(ncr => (
                  <div key={ncr.id} className="flex items-center gap-3 p-2 rounded" style={{ background: SEMANTIC_COLORS.danger.bg }}>
                    <span className="font-mono text-xs font-bold" style={{ color: SEMANTIC_COLORS.danger.solid }}>{ncr.ncrCode}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: ncr.severity === 'CRITICAL' ? '#C8372B' : ncr.severity === 'MAJOR' ? '#C97A0E' : '#64748B', color: '#fff' }}>
                      {ncr.severity}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ncr.category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failed checkpoints */}
          {data.failedCheckpoints.length > 0 && (
            <div className="card p-4">
              <label className="input-label mb-3" style={{ color: SEMANTIC_COLORS.danger.solid }}>ITP Checkpoint FAILED</label>
              <div className="space-y-2">
                {data.failedCheckpoints.map(cp => (
                  <div key={cp.id} className="flex items-center gap-3 p-2 rounded" style={{ background: SEMANTIC_COLORS.danger.bg }}>
                    <span className="font-mono text-xs font-bold" style={{ color: SEMANTIC_COLORS.danger.solid }}>{cp.itpCode} #{cp.checkpointNo}</span>
                    <span className="text-xs">{cp.activity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canRelease && (
            <div className="card p-4 text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Tất cả NCR đã đóng, ITP checkpoint đạt, MRB đã phát hành. Hồ sơ sẵn sàng phát hành cho khách hàng.
              </p>
            </div>
          )}
        </>
      )}

      {!projectId && !loading && (
        <EmptyState icon={<ClipboardList />} title="Chọn dự án để kiểm tra điều kiện phát hành MDR" />
      )}
    </div>
  )
}
