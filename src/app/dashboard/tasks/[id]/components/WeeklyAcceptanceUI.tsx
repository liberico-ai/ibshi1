'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface WeeklyItem {
  lsxCode: string
  wbsItem: string
  stageKey: string
  stageLabel: string
  teamName: string
  phamVi: string
  unit: string
  totalLsx: number
  dailyVolumes: Record<string, number>
  weekTotal: number
  cumulativeAccepted: number
}

interface WeeklyAcceptanceUIProps {
  task: any
  isActive: boolean
}

/**
 * GIAO DIỆN "SIÊU BẢNG" NGHIỆM THU KHỐI LƯỢNG TUẦN
 *
 * Hiển thị ma trận: Hạng mục > LSX > Công đoạn theo hàng dọc.
 * Cột ngang: Khối lượng báo cáo T2→T6, Tổng tuần, Lũy kế, Ô trống "KHỐI LƯỢNG THỰC NGHIỆM".
 *
 * Khi Submit → lưu WeeklyAcceptanceLog (immutable) → không bao giờ sửa được.
 */
export default function WeeklyAcceptanceUI({ task, isActive }: WeeklyAcceptanceUIProps) {
  const [items, setItems] = useState<WeeklyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [weekInfo, setWeekInfo] = useState<{ weekNumber: number; year: number; weekStartDate: string; weekEndDate: string } | null>(null)

  // Acceptance inputs: lsxCode → accepted volume
  const [acceptanceInputs, setAcceptanceInputs] = useState<Record<string, string>>({})
  const [acceptanceNotes, setAcceptanceNotes] = useState<Record<string, string>>({})

  const rd = (task.resultData as Record<string, any>) || {}
  const isAlreadySubmitted = rd._acceptanceSubmitted === true
  const role = task.stepCode === 'P5.3' ? 'QC' : 'PM'

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/api/tasks/${task.id}/weekly-acceptance`)
      if (data.success) {
        setItems(data.items || [])
        setWeekInfo({
          weekNumber: data.weekNumber,
          year: data.year,
          weekStartDate: data.weekStartDate,
          weekEndDate: data.weekEndDate,
        })
        
        if (role === 'PM') {
          const prefillInputs: Record<string, string> = {}
          const prefillNotes: Record<string, string> = {}
          ;(data.items || []).forEach((item: any) => {
            if (item.qcAcceptedVolume !== undefined && item.qcAcceptedVolume !== null) {
              prefillInputs[item.lsxCode] = item.qcAcceptedVolume.toString()
            }
            if (item.qcNotes) {
              prefillNotes[item.lsxCode] = item.qcNotes
            }
          })
          setAcceptanceInputs(prefillInputs)
          setAcceptanceNotes(prefillNotes)
        }
      } else {
        setError(data.error || 'Lỗi tải dữ liệu')
      }
    } catch (err) {
      console.error('Weekly acceptance fetch error:', err)
      setError('Lỗi kết nối API')
    } finally {
      setLoading(false)
    }
  }, [task.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSubmit = async () => {
    if (isAlreadySubmitted) return

    // Validate: at least one acceptance value must be entered
    const filledItems = items.filter(item => {
      const val = acceptanceInputs[item.lsxCode]
      return val !== undefined && val !== '' && !isNaN(Number(val))
    })

    if (filledItems.length === 0) {
      setError('⚠️ Vui lòng nhập ít nhất 1 giá trị "Khối lượng thực nghiệm" trước khi gửi.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const acceptanceData = items.map(item => ({
        lsxCode: item.lsxCode,
        reportedTotal: item.weekTotal,
        acceptedVolume: Number(acceptanceInputs[item.lsxCode] || 0),
        notes: acceptanceNotes[item.lsxCode] || '',
      })).filter(d => d.acceptedVolume > 0 || acceptanceInputs[d.lsxCode] !== undefined)

      const res = await apiFetch(`/api/tasks/${task.id}/weekly-acceptance`, {
        method: 'POST',
        body: JSON.stringify({
          acceptanceData,
          userId: 'current-user', // Will be replaced by session in production
          notes: `${role} nghiệm thu tuần W${weekInfo?.weekNumber}`,
        }),
      })

      if (res.success) {
        setSuccess(`✅ ${res.message}`)
      } else {
        setError(res.error || 'Lỗi khi gửi nghiệm thu')
      }
    } catch (err) {
      setError('Lỗi kết nối khi gửi nghiệm thu')
    } finally {
      setSubmitting(false)
    }
  }

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) } catch { return '—' }
  }
  const fmtNum = (n: number) => n > 0 ? n.toLocaleString('vi-VN') : '—'
  const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6']
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri']

  return (
    <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', borderTop: '4px solid #0ea5e9' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#0369a1', display: 'flex', alignItems: 'center', gap: 8 }}>
          📋 {role === 'PM' ? 'PHÊ DUYỆT KHỐI LƯỢNG TUẦN' : 'NGHIỆM THU KHỐI LƯỢNG TUẦN'}
          <span style={{
            fontSize: '0.75rem', padding: '3px 10px', borderRadius: 12, fontWeight: 700,
            background: role === 'QC' ? '#dbeafe' : '#fef3c7',
            color: role === 'QC' ? '#1d4ed8' : '#92400e',
          }}>
            {role}
          </span>
        </h3>
        {weekInfo && (
          <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Tuần {weekInfo.weekNumber}/{weekInfo.year}</div>
            <div>{fmtDate(weekInfo.weekStartDate)} → {fmtDate(weekInfo.weekEndDate)}</div>
          </div>
        )}
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.6 }}>
        {role === 'PM'
          ? <>Kiểm tra Khối lượng do QC xác nhận và <strong>Bấm Duyệt</strong> để hoàn thành biên bản nghiệm thu tuần.</>
          : <>Đối chiếu khối lượng báo cáo hàng ngày (T2→T6) của các Tổ thi công. Nhập <strong>Khối lượng thực nghiệm</strong> sau khi đi kiểm tra thực tế.</>
        }
        <br />
        <span style={{ color: '#dc2626', fontWeight: 600 }}>
          ⚠️ Sau khi bấm GỬI, dữ liệu sẽ được lưu vĩnh viễn và KHÔNG THỂ chỉnh sửa.
        </span>
      </p>

      {/* Already submitted banner */}
      {isAlreadySubmitted && (
        <div style={{
          padding: '12px 16px', background: '#dcfce7', borderRadius: 8, border: '1px solid #86efac',
          color: '#166534', marginBottom: 16, fontWeight: 600, fontSize: '0.9rem',
        }}>
          ✅ Phiếu nghiệm thu tuần này đã được gửi thành công. Dữ liệu đã được bảo vệ vĩnh viễn.
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', borderRadius: 8, color: '#dc2626', marginBottom: 16, fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: '12px 16px', background: '#dcfce7', borderRadius: 8, color: '#166534', marginBottom: 16, fontSize: '0.9rem', fontWeight: 600 }}>
          {success}
        </div>
      )}

      {/* Matrix Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={thStyle} rowSpan={2}>Hạng Mục</th>
              <th style={thStyle} rowSpan={2}>Phạm Vi</th>
              <th style={thStyle} rowSpan={2}>Công Đoạn</th>
              <th style={thStyle} rowSpan={2}>Tổ Thực Hiện</th>
              <th style={thStyle} rowSpan={2}>Tổng LSX</th>
              <th style={{ ...thStyle, background: '#e0f2fe', textAlign: 'center' }} colSpan={5}>Báo Cáo Tổ SX (T2 → T6)</th>
              <th style={{ ...thStyle, background: '#fef3c7' }} rowSpan={2}>Tổng Tuần</th>
              <th style={{ ...thStyle, background: '#f3e8ff' }} rowSpan={2}>Lũy Kế NT</th>
              <th style={{ ...thStyle, background: '#dcfce7', color: '#047857', minWidth: 120 }} rowSpan={2}>
                KL THỰC NGHIỆM
              </th>
              <th style={thStyle} rowSpan={2}>Ghi chú</th>
            </tr>
            <tr style={{ background: '#e0f2fe' }}>
              {DAY_LABELS.map(day => (
                <th key={day} style={{ ...thStyle, background: '#e0f2fe', fontSize: '0.75rem', padding: '4px 8px' }}>{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Đang tải dữ liệu...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Không có dữ liệu báo cáo trong tuần này.</td></tr>
            ) : items.map((item, idx) => {
              const remaining = Math.max(0, item.totalLsx - item.cumulativeAccepted)
              const acceptedVal = Number(acceptanceInputs[item.lsxCode]) || 0
              const isOverReport = item.weekTotal > remaining
              return (
                <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 200 }}>{item.wbsItem}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: item.phamVi === 'IBS' ? '#0ea5e9' : '#8b5cf6' }}>{item.phamVi}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{item.stageLabel}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: '#f59e0b' }}>{item.teamName}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{fmtNum(item.totalLsx)}</td>
                  {DAY_KEYS.map(key => (
                    <td key={key} style={{ ...tdStyle, textAlign: 'center', background: '#fafbfc', fontSize: '0.8rem' }}>
                      {item.dailyVolumes[key] > 0 ? fmtNum(item.dailyVolumes[key]) : '—'}
                    </td>
                  ))}
                  <td style={{
                    ...tdStyle, textAlign: 'center', fontWeight: 700, background: '#fffbeb',
                    color: isOverReport ? '#dc2626' : '#92400e',
                  }}>
                    {fmtNum(item.weekTotal)}
                    {isOverReport && <div style={{ fontSize: '0.65rem', color: '#dc2626' }}>⚠️ vượt</div>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#7c3aed', fontWeight: 600 }}>
                    {fmtNum(item.cumulativeAccepted)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', background: '#f0fdf4' }}>
                    {isAlreadySubmitted || role === 'PM' ? (
                      <div style={{
                        fontWeight: 700, color: '#047857', display: 'inline-block', minWidth: 60,
                        textAlign: 'center', padding: '6px 10px', background: '#d1fae5', borderRadius: 6,
                        border: '1px solid #10b981'
                      }}>
                        {acceptanceInputs[item.lsxCode] ? fmtNum(Number(acceptanceInputs[item.lsxCode])) : '—'}
                      </div>
                    ) : (
                      <input
                        type="number"
                        className="input"
                        value={acceptanceInputs[item.lsxCode] ?? ''}
                        onChange={e => setAcceptanceInputs(prev => ({ ...prev, [item.lsxCode]: e.target.value }))}
                        disabled={!isActive}
                        placeholder={String(item.weekTotal)}
                        style={{
                          width: 90, textAlign: 'center', fontWeight: 700,
                          fontSize: '0.9rem', padding: '6px 8px',
                          border: `2px solid ${acceptedVal > 0 && acceptedVal < item.weekTotal ? '#f59e0b' : '#10b981'}`,
                          borderRadius: 6,
                        }}
                      />
                    )}
                  </td>
                  <td style={{ ...tdStyle }}>
                    {isAlreadySubmitted || role === 'PM' ? (
                      <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                        {acceptanceNotes[item.lsxCode] || '—'}
                      </span>
                    ) : (
                      <input
                        type="text"
                        className="input"
                        value={acceptanceNotes[item.lsxCode] ?? ''}
                        onChange={e => setAcceptanceNotes(prev => ({ ...prev, [item.lsxCode]: e.target.value }))}
                        disabled={!isActive}
                        placeholder="..."
                        style={{ width: 100, fontSize: '0.75rem', padding: '4px 6px' }}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Submit button */}
      {isActive && !isAlreadySubmitted && !success && (
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '12px 32px', background: '#0ea5e9', color: '#fff',
              border: 'none', borderRadius: 10, cursor: submitting ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: '1rem',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? '⏳ Đang xử lý...' : (role === 'PM' ? '✅ DUYỆT KHỐI LƯỢNG (Chốt dữ liệu)' : '📤 GỬI NGHIỆM THU (Không thể sửa sau khi gửi)')}
          </button>
        </div>
      )}

      {/* Footer note */}
      <div style={{
        padding: '1rem', marginTop: 16, background: '#f8fafc', borderRadius: 8,
        fontStyle: 'italic', color: '#64748b', fontSize: '0.8rem', lineHeight: 1.5,
      }}>
        * Dữ liệu nghiệm thu sau khi bấm GỬI sẽ được lưu vào Sổ lưu trữ riêng trên máy chủ
        (Lịch sử Xác nhận Nghiệm thu) — dùng cho đối soát tài chính và trả lương khoán nội bộ.
        <br />
        * Mỗi phiếu nghiệm thu chỉ được gửi <strong>MỘT LẦN DUY NHẤT</strong> mỗi tuần.
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  border: '1px solid #e2e8f0',
  fontSize: '0.8rem',
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #e2e8f0',
  verticalAlign: 'middle',
}
