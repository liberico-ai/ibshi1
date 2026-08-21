'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { notify } from '@/components/ui/Toast'
import { Badge, Button, Card } from '@/components/ui'
import { formatDate, formatNumber } from '@/lib/utils'

// Kho cấp vật tư THEO LỆNH SẢN XUẤT: mỗi WO một phiếu, đủ danh mục vật tư của lệnh đó.
// Khác luồng cũ (mỗi dòng vật tư một việc P4.5 riêng, không biết của lệnh nào): ở đây thấy rõ
// mã WO · hạng mục · công đoạn · xưởng. Cấp đủ toàn bộ danh mục → WO tự chuyển sang "Chờ".

interface Line {
  materialId: string; materialCode: string; name: string; specification: string | null
  unit: string; requested: number; issued: number; remaining: number; currentStock: number; source: string
}
interface WoTicket {
  id: string; woCode: string; description: string; status: string; teamCode: string
  pieceMark: string | null; plannedStart: string | null; plannedEnd: string | null
  project: { projectCode: string; projectName: string }
  lines: Line[]; totalLines: number; pendingLines: number; fulfilled: boolean
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_MATERIAL: 'Chờ vật tư', OPEN: 'Chờ nhận', IN_PROGRESS: 'Đang chạy', ON_HOLD: 'Tạm dừng',
  QC_PENDING: 'Chờ QC', QC_PASSED: 'QC đạt', QC_FAILED: 'QC lỗi',
}

export default function WoIssueSection() {
  const [items, setItems] = useState<WoTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    const r = await apiFetch('/api/production/material-issue')
    if (r.ok) setItems(r.items || [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const issue = async (wo: WoTicket) => {
    const lines = wo.lines
      .map((l) => ({ materialId: l.materialId, quantity: Number(qty[`${wo.id}_${l.materialId}`] || 0) }))
      .filter((l) => l.quantity > 0)
    if (lines.length === 0) { notify('Chưa nhập khối lượng thực xuất nào', 'error'); return }

    setSubmitting(true)
    const r = await apiFetch(`/api/production/${wo.id}/material-issue`, { method: 'POST', body: JSON.stringify({ lines }) })
    setSubmitting(false)
    if (!r.ok) { notify(r.error || 'Lỗi cấp phát', 'error'); return }
    notify(r.message || 'Đã cấp phát', 'success')
    setQty((q) => {
      const next = { ...q }
      wo.lines.forEach((l) => delete next[`${wo.id}_${l.materialId}`])
      return next
    })
    if (r.opened || r.fulfilled) setOpenId(null)
    await load()
  }

  if (loading) return <div className="h-16 skeleton rounded-xl" />

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Cấp vật tư theo lệnh sản xuất</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {items.length} lệnh đang cần cấp · cấp đủ danh mục thì lệnh tự chuyển sang &ldquo;Chờ nhận&rdquo;
        </p>
      </div>

      {items.length === 0 ? (
        <Card padding="spacious" className="text-center">
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-primary)' }}>Không có lệnh nào chờ cấp vật tư</p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Phiếu xuất hiện khi PM lập danh mục vật tư cho lệnh sản xuất</p>
        </Card>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã WO</th><th>Hạng mục / công đoạn</th><th>Xưởng</th><th>Dự án</th>
                <th>Kế hoạch</th><th>Vật tư</th><th>Trạng thái</th><th className="text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {items.map((wo) => {
                const isOpen = openId === wo.id
                return (
                  <React.Fragment key={wo.id}>
                    <tr className={isOpen ? 'bg-sky-50 dark:bg-sky-900/20' : ''} style={{ cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : wo.id)}>
                      <td className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>{wo.woCode}</td>
                      <td className="text-xs">{wo.description}</td>
                      <td className="text-xs">{wo.teamCode || '—'}</td>
                      <td className="text-xs">{wo.project.projectCode}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {wo.plannedStart ? formatDate(wo.plannedStart) : '—'}{wo.plannedEnd ? ` → ${formatDate(wo.plannedEnd)}` : ''}
                      </td>
                      <td className="text-xs">
                        <b style={{ color: wo.pendingLines > 0 ? '#b45309' : '#16a34a' }}>{wo.totalLines - wo.pendingLines}/{wo.totalLines}</b> dòng đủ
                      </td>
                      <td><Badge variant={wo.status === 'PENDING_MATERIAL' ? 'warning' : 'default'}>{STATUS_LABEL[wo.status] || wo.status}</Badge></td>
                      <td className="text-right">
                        <Button variant={isOpen ? 'outline' : 'primary'} size="sm" onClick={(e) => { e.stopPropagation(); setOpenId(isOpen ? null : wo.id) }}>
                          {isOpen ? 'Thu gọn' : 'Cấp phát'}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="p-4" style={{ background: 'var(--bg-secondary)' }}>
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Mã VT</th><th>Tên</th><th className="text-right">Đề nghị</th><th className="text-right">Đã cấp</th>
                                  <th className="text-right">Còn thiếu</th><th className="text-right">Tồn kho</th><th className="text-right">Thực xuất</th>
                                </tr>
                              </thead>
                              <tbody>
                                {wo.lines.map((l) => {
                                  const key = `${wo.id}_${l.materialId}`
                                  const val = Number(qty[key] || 0)
                                  const overRemaining = val > l.remaining
                                  const overStock = val > l.currentStock
                                  const done = l.remaining <= 0
                                  return (
                                    <tr key={l.materialId} style={done ? { background: 'var(--bg-card)' } : undefined}>
                                      <td className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{l.materialCode}</td>
                                      <td className="text-xs">{l.name}{l.specification ? ` · ${l.specification}` : ''}</td>
                                      <td className="text-right text-xs">{formatNumber(l.requested)} {l.unit}</td>
                                      <td className="text-right text-xs" style={{ color: l.issued > 0 ? '#0ea5e9' : 'var(--text-muted)' }}>{l.issued > 0 ? formatNumber(l.issued) : '—'}</td>
                                      <td className="text-right text-xs" style={{ fontWeight: 700, color: done ? '#16a34a' : '#b45309' }}>{done ? 'đủ' : formatNumber(l.remaining)}</td>
                                      <td className="text-right text-xs" style={{ color: l.currentStock > 0 ? '#16a34a' : '#dc2626' }}>{formatNumber(l.currentStock)}</td>
                                      <td className="text-right">
                                        {done ? <span className="text-xs" style={{ color: '#16a34a' }}>—</span> : (
                                          <>
                                            <input type="number" min="0" max={Math.min(l.remaining, l.currentStock)} className="input"
                                              value={qty[key] || ''} onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))}
                                              style={{ width: 110, textAlign: 'right', padding: '4px 8px', fontSize: '0.82rem', borderColor: (overRemaining || overStock) ? '#dc2626' : undefined }} />
                                            {overStock && <div className="text-[10px] font-bold" style={{ color: '#dc2626' }}>Vượt tồn kho</div>}
                                            {!overStock && overRemaining && <div className="text-[10px] font-bold" style={{ color: '#dc2626' }}>Vượt phần còn thiếu</div>}
                                          </>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                            {(() => {
                              // Chặn ngay ở giao diện: vượt tồn kho / vượt phần còn thiếu thì không cho bấm,
                              // khỏi phải bấm rồi mới nhận lỗi từ máy chủ.
                              const vals = wo.lines.map((l) => ({ l, v: Number(qty[`${wo.id}_${l.materialId}`] || 0) }))
                              const bad = vals.filter(({ l, v }) => v > 0 && (v > l.remaining || v > l.currentStock))
                              const filled = vals.filter(({ v }) => v > 0)
                              const reason = bad.length > 0
                                ? `${bad.length} dòng nhập quá tồn kho hoặc quá phần còn thiếu`
                                : filled.length === 0 ? 'Nhập khối lượng thực xuất để cấp phát' : ''
                              return (
                                <div className="flex justify-end items-center gap-3 mt-3">
                                  {reason && <span className="text-xs" style={{ color: bad.length > 0 ? '#dc2626' : 'var(--text-muted)' }}>{reason}</span>}
                                  <Button variant="primary" onClick={() => issue(wo)} loading={submitting}
                                    disabled={bad.length > 0 || filled.length === 0}>Xác nhận cấp phát</Button>
                                </div>
                              )
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
