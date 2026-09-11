'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button, EmptyState, KPICard, SelectField } from '@/components/ui'
import { formatCurrency, formatNumber, formatDate } from '@/lib/utils'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { FileCheck } from 'lucide-react'

// Duyệt báo giá nhà cung cấp.
//
// Từ 10/09/2026 Thương mại làm việc bên ibs-commerce, BGĐ làm việc bên ERP. Màn này là chỗ
// BGĐ nhìn thấy TRỌN bảng so giá mà Thương mại đã chốt, rồi duyệt hoặc trả lại — không phải
// mở hệ thứ hai.
//
// Dữ liệu là BẢN GƯƠNG chỉ đọc từ Thương mại. ERP chỉ ghi đúng quyết định + lý do.

interface Dot {
  id: string; bidCode: string; subject: string
  projectCode: string; projectName: string | null; chuaGanDuAn: boolean
  selectionMode: string | null; currency: string; totalValue: number
  fileUrl: string | null; lineCount: number
  submittedBy: string | null; submittedAt: string
  status: string; decidedBy: string | null; decidedAt: string | null; reason: string | null
  daBaoVeTM: boolean
}
interface Dong {
  id: string; lineNo: number; itemCode: string; itemName: string
  profile: string | null; grade: string | null; uom: string; quantity: number
  vendorName: string | null; unitPrice: number; totalPrice: number
  estUnitPrice: number | null; vuotDuToanPct: number | null
  offers: Record<string, number> | null; notes: string | null
}

const NHAN_TRANG_THAI: Record<string, string> = {
  PENDING: 'Chờ BGĐ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Đã trả lại',
}
const MAU_TRANG_THAI: Record<string, string> = {
  PENDING: SEMANTIC_COLORS.warning.solid,
  APPROVED: SEMANTIC_COLORS.success.solid,
  REJECTED: SEMANTIC_COLORS.danger.solid,
}
const NHAN_CHE_DO: Record<string, string> = {
  PER_ITEM: 'Chọn NCC theo từng dòng',
  PER_BID: 'Một NCC cho cả đợt',
  AUTO_MIN_PRICE: 'Tự động giá thấp nhất',
  PER_GROUP: 'Chọn theo nhóm vật tư',
  MANUAL_WEIGHTED: 'Chấm điểm đa tiêu chí',
}

export default function DuyetBaoGiaPage() {
  const user = useAuthStore(s => s.user)
  // null = chưa nạp xong. Suy cờ "đang tải" từ chính dữ liệu, khỏi phải giữ thêm một biến
  // state chỉ để bật/tắt — và nhờ thế effect không phải đặt state nào trong thân nó.
  const [dsDot, setDsDot] = useState<Dot[] | null>(null)
  const [loc, setLoc] = useState('PENDING')
  const [moId, setMoId] = useState<string | null>(null)
  const [chiTiet, setChiTiet] = useState<{ approval: Dot; lines: Dong[]; soDongVuotDuToan: number } | null>(null)
  const [dangTaiCT, setDangTaiCT] = useState(false)
  const [dangQuyet, setDangQuyet] = useState(false)
  const [lyDo, setLyDo] = useState('')

  const duocDuyet = ['R01', 'R10'].includes(user?.roleCode || '')

  const tai = useCallback(async () => {
    const r = await apiFetch(`/api/procurement/commerce-approvals?status=${loc}`)
    if (r?.ok) return (r.approvals || []) as Dot[]
    notify(r?.error || 'Không tải được danh sách', 'error')
    return [] as Dot[]
  }, [loc])

  useEffect(() => {
    let huy = false
    // Đổi bộ lọc lúc lượt nạp cũ chưa xong thì bỏ kết quả cũ đi, khỏi đè lên kết quả mới.
    tai().then(ds => { if (!huy) setDsDot(ds) }).catch(() => { if (!huy) setDsDot([]) })
    return () => { huy = true }
  }, [tai])

  const dangTai = dsDot === null
  const ds = dsDot ?? []

  const moChiTiet = async (id: string) => {
    if (moId === id) { setMoId(null); setChiTiet(null); return }
    setMoId(id); setChiTiet(null); setDangTaiCT(true); setLyDo('')
    const r = await apiFetch(`/api/procurement/commerce-approvals/${id}`)
    if (r?.ok) setChiTiet(r as unknown as { approval: Dot; lines: Dong[]; soDongVuotDuToan: number })
    else notify(r?.error || 'Không tải được chi tiết', 'error')
    setDangTaiCT(false)
  }

  const quyet = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !lyDo.trim()) {
      notify('Ghi lý do trả lại để Thương mại biết đường sửa', 'error'); return
    }
    const hoi = decision === 'APPROVE'
      ? 'Duyệt đợt báo giá này? Thương mại sẽ được báo để phát hành đơn hàng.'
      : 'Trả lại đợt báo giá này cho Thương mại làm lại?'
    if (!await confirmDialog(hoi)) return
    setDangQuyet(true)
    const r = await apiFetch(`/api/procurement/commerce-approvals/${id}/decide`, {
      method: 'POST', body: JSON.stringify({ decision, reason: lyDo.trim() || undefined }),
    })
    setDangQuyet(false)
    if (!r?.ok) { notify(r?.error || 'Lỗi ghi quyết định', 'error'); return }
    notify(r.message as string, 'success')
    setMoId(null); setChiTiet(null); setLyDo('')
    setDsDot(await tai())
  }

  const cho = ds.filter(d => d.status === 'PENDING')
  const tongTien = cho.reduce((s, d) => s + d.totalValue, 0)
  const chuaBaoVe = ds.filter(d => d.status !== 'PENDING' && !d.daBaoVeTM).length

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Duyệt báo giá nhà cung cấp"
        subtitle="Thương mại chốt nhà cung cấp bên hệ Thương mại — BGĐ duyệt tại đây"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Chờ duyệt" value={cho.length} accentColor={SEMANTIC_COLORS.warning.solid} />
        <KPICard label="Giá trị chờ duyệt" value={formatCurrency(tongTien)} accentColor={SEMANTIC_COLORS.info.solid} />
        <KPICard label="Đã duyệt" value={ds.filter(d => d.status === 'APPROVED').length} accentColor={SEMANTIC_COLORS.success.solid} />
        <KPICard
          label="Chưa báo được về Thương mại"
          value={chuaBaoVe}
          accentColor={chuaBaoVe > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.neutral.solid}
        />
      </div>

      {/* Quyết định đã ghi mà chưa đẩy về được là dấu hiệu đường đồng bộ đang tắc — nói ngay,
          vì Thương mại vẫn đang chờ mà BGĐ tưởng xong rồi. */}
      {chuaBaoVe > 0 && (
        <div className="rounded-lg px-4 py-3 text-sm"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          Có <b>{chuaBaoVe}</b> quyết định chưa báo được sang hệ Thương mại — đường đồng bộ đang tắc.
          Kiểm tra tiến trình đồng bộ hoặc báo Quản trị.
        </div>
      )}

      <div style={{ maxWidth: 280 }}>
        <SelectField label="Trạng thái" value={loc}
          onChange={e => { setDsDot(null); setLoc(e.target.value) }}
          options={[
            { value: 'PENDING', label: 'Chờ duyệt' },
            { value: 'APPROVED', label: 'Đã duyệt' },
            { value: 'REJECTED', label: 'Đã trả lại' },
            { value: 'ALL', label: 'Tất cả' },
          ]} />
      </div>

      {dangTai && <div className="h-32 skeleton rounded-xl" />}

      {!dangTai && ds.length === 0 && (
        <EmptyState icon={<FileCheck />} title="Không có đợt nào"
          description="Thương mại chốt nhà cung cấp xong sẽ trình sang đây" />
      )}

      <div className="space-y-3">
        {ds.map(d => (
          <div key={d.id} className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <button type="button" onClick={() => moChiTiet(d.id)}
              className="w-full flex items-center gap-4 px-4 py-3 text-left">
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)', width: 12 }}>
                {moId === d.id ? '▼' : '▶'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold" style={{ color: 'var(--accent)' }}>{d.bidCode}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ color: MAU_TRANG_THAI[d.status], border: `1px solid ${MAU_TRANG_THAI[d.status]}` }}>
                    {NHAN_TRANG_THAI[d.status] || d.status}
                  </span>
                  {d.chuaGanDuAn && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: SEMANTIC_COLORS.danger.solid, border: `1px solid ${SEMANTIC_COLORS.danger.solid}` }}>
                      chưa khớp dự án
                    </span>
                  )}
                </div>
                <div className="text-sm truncate mt-0.5">{d.subject}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {d.projectCode}{d.projectName ? ` — ${d.projectName}` : ''} · {d.lineCount} dòng ·
                  {' '}{d.submittedBy || 'Thương mại'} trình {formatDate(d.submittedAt)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-sm">{formatCurrency(d.totalValue)}</div>
                {d.selectionMode && (
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {NHAN_CHE_DO[d.selectionMode] || d.selectionMode}
                  </div>
                )}
              </div>
            </button>

            {moId === d.id && (
              <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                {dangTaiCT && <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Đang tải bảng so giá…</div>}

                {!dangTaiCT && chiTiet && (
                  <div className="p-4 space-y-4">
                    {chiTiet.soDongVuotDuToan > 0 && (
                      <div className="rounded-lg px-3 py-2 text-sm"
                        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                        <b>{chiTiet.soDongVuotDuToan}</b> dòng có đơn giá <b>vượt dự toán</b> — xem cột cuối trước khi duyệt.
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 900 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                            <th className="text-left px-2 py-1.5">#</th>
                            <th className="text-left px-2 py-1.5">Vật tư</th>
                            <th className="text-right px-2 py-1.5">Số lượng</th>
                            <th className="text-left px-2 py-1.5">NCC được chọn</th>
                            <th className="text-right px-2 py-1.5">Đơn giá</th>
                            <th className="text-right px-2 py-1.5">Thành tiền</th>
                            <th className="text-left px-2 py-1.5">Báo giá NCC khác</th>
                            <th className="text-right px-2 py-1.5">So với dự toán</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chiTiet.lines.map(l => (
                            <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                              <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{l.lineNo}</td>
                              <td className="px-2 py-1.5">
                                <div className="font-medium">{l.itemName || l.itemCode}</div>
                                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                  {[l.itemCode, l.profile, l.grade].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">{formatNumber(l.quantity)} {l.uom}</td>
                              <td className="px-2 py-1.5 font-medium">{l.vendorName || '—'}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{formatNumber(l.unitPrice)}</td>
                              <td className="px-2 py-1.5 text-right font-mono font-bold">{formatCurrency(l.totalPrice)}</td>
                              <td className="px-2 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                {l.offers
                                  ? Object.entries(l.offers)
                                      .filter(([ten]) => ten !== l.vendorName)
                                      .map(([ten, gia]) => `${ten}: ${formatNumber(Number(gia))}`).join(' · ') || '—'
                                  : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {l.vuotDuToanPct === null ? (
                                  <span style={{ color: 'var(--text-muted)' }}>chưa có dự toán</span>
                                ) : (
                                  <span style={{ color: l.vuotDuToanPct > 0 ? SEMANTIC_COLORS.danger.solid : SEMANTIC_COLORS.success.solid }}>
                                    {l.vuotDuToanPct > 0 ? '+' : ''}{l.vuotDuToanPct}%
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {chiTiet.approval.fileUrl && (
                      <a href={chiTiet.approval.fileUrl} target="_blank" rel="noreferrer"
                        className="text-sm underline" style={{ color: 'var(--accent)' }}>
                        Xem file báo giá / giải trình (lưu bên hệ Thương mại)
                      </a>
                    )}

                    {d.status === 'PENDING' && duocDuyet && (
                      <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--border)' }}>
                        <textarea value={lyDo} onChange={e => setLyDo(e.target.value)} rows={2}
                          placeholder="Lý do — bắt buộc khi trả lại, tuỳ ý khi duyệt"
                          className="input text-sm w-full" />
                        <div className="flex gap-2 justify-end">
                          <Button variant="outline" onClick={() => quyet(d.id, 'REJECT')} disabled={dangQuyet}>
                            Trả lại Thương mại
                          </Button>
                          <Button variant="primary" onClick={() => quyet(d.id, 'APPROVE')} disabled={dangQuyet}>
                            {dangQuyet ? 'Đang ghi…' : 'Duyệt'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {d.status === 'PENDING' && !duocDuyet && (
                      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Chỉ BGĐ được duyệt. Bạn đang xem để đối chiếu.
                      </div>
                    )}

                    {d.status !== 'PENDING' && (
                      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {NHAN_TRANG_THAI[d.status]} {d.decidedAt ? `ngày ${formatDate(d.decidedAt)}` : ''}
                        {d.reason ? ` — lý do: ${d.reason}` : ''}
                        {!d.daBaoVeTM && ' · CHƯA báo được sang Thương mại'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
