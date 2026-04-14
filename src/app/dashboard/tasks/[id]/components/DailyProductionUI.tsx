'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface DailyReportRow {
  lsxCode: string
  wbsItem: string
  stageKey: string
  stageLabel: string
  teamName: string
  phamVi: string
  totalLsx: number
  unit: string
  previousAccumulated: number
  todayVolume: number
  todayLogId: string | null
}

interface DailyProductionUIProps {
  task: any
  isActive: boolean
}

export default function DailyProductionUI({ task, isActive }: DailyProductionUIProps) {
  const [logs, setLogs] = useState<DailyReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [todayInputs, setTodayInputs] = useState<Record<string, string>>({})
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  // Kiểm tra hôm nay đã gửi báo cáo chưa (có todayLogId hoặc todayVolume > 0)
  const isSubmittedToday = logs.some(row => row.todayLogId !== null || row.todayVolume > 0)

  // Ngày đang xem có phải hôm nay không
  const todayStr = new Date().toISOString().split('T')[0]
  const isViewingToday = selectedDate === todayStr

  // Khóa input nếu: đã gửi hôm nay VÀ đang xem ngày hôm nay
  // Hoặc: đang xem ngày quá khứ (không cho sửa ngày cũ)
  const isLocked = (isViewingToday && isSubmittedToday) || selectedDate < todayStr

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/api/tasks/${task.id}/daily-report?date=${selectedDate}`)
      if (data.success) {
        setLogs(data.items || [])
        const inputs: Record<string, string> = {}
        for (const item of (data.items || [])) {
          if (item.todayVolume > 0) inputs[item.lsxCode] = item.todayVolume.toString()
        }
        setTodayInputs(inputs)
      } else {
        setError(data.error || 'Lỗi tải dữ liệu')
      }
    } catch (err) {
      console.error('Daily report fetch error:', err)
      setError('Lỗi kết nối API')
    } finally {
      setLoading(false)
    }
  }, [task.id, selectedDate])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleGlobalSubmit = async () => {
    if (!isActive || isLocked) return
    const itemsToSubmit = logs
      .map(row => ({
        lsxCode: row.lsxCode,
        wbsStage: row.stageKey,
        reportedVolume: Number(todayInputs[row.lsxCode]) || 0
      }))
      .filter(item => item.reportedVolume > 0)

    if (itemsToSubmit.length === 0) {
      alert('Vui lòng nhập khối lượng hoàn thành cho ít nhất 1 tổ/công đoạn để gửi báo cáo.')
      return
    }

    // Validate trước khi gửi
    for (const item of itemsToSubmit) {
      const row = logs.find(r => r.lsxCode === item.lsxCode)
      if (row) {
        const maxAllowed = Math.max(0, row.totalLsx - (row.previousAccumulated || 0))
        if (item.reportedVolume > maxAllowed) {
          alert(`Khối lượng nhập (${item.reportedVolume}) vượt quá cấn trừ còn lại (${maxAllowed}) cho công đoạn ${row.stageLabel}.`)
          return
        }
      }
    }

    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/daily-report`, {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          userId: 'user',
          items: itemsToSubmit
        })
      })
      if (res.success) {
        alert('✅ Gửi báo cáo thành công! Báo cáo hôm nay đã được khóa.')
        // Reload data để cập nhật todayLogId → khóa input
        fetchData()
      } else {
        alert('Lỗi: ' + (res.error || 'Không thể gửi báo cáo'))
      }
    } catch (err) {
      alert('Lỗi kết nối')
    } finally {
      setSubmitting(false)
    }
  }

  // Group logs by wbsItem
  const groupedLogs = logs.reduce((acc, row) => {
    if (!acc[row.wbsItem]) acc[row.wbsItem] = []
    acc[row.wbsItem].push(row)
    return acc
  }, {} as Record<string, DailyReportRow[]>)

  return (
    <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', borderTop: '4px solid #10b981' }}>
      <h3 style={{ marginTop: 0, fontSize: '1.2rem', paddingBottom: 8, marginBottom: 16, color: '#047857', display: 'flex', alignItems: 'center', gap: 8 }}>
        📝 SỔ BÁO CÁO KHỐI LƯỢNG HẰNG NGÀY (TỔ THI CÔNG)
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
        Giao diện nhập liệu hằng ngày. Vui lòng nhập số liệu khối lượng hoàn thành trong ca làm việc cho từng Tổ.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="date" className="input" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ width: 160 }} />
        <button onClick={fetchData} className="btn-primary" style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>Tải lại Cập nhật</button>
      </div>

      {/* Locked state banner */}
      {isLocked && (
        <div style={{ padding: '12px 16px', background: '#fff7ed', borderRadius: 8, color: '#c2410c', marginBottom: 16, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #fed7aa' }}>
          🔒 {isViewingToday
            ? 'Báo cáo hôm nay đã được gửi và khóa. Ngày mai mới được nhập báo cáo mới.'
            : `Dữ liệu ngày ${selectedDate} chỉ hiển thị để xem lại, không chỉnh sửa được.`
          }
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', borderRadius: 8, color: '#dc2626', marginBottom: 16, fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}

      <table className="wbs-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '15%' }}>Công Đoạn</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '15%' }}>Tổ Thực Hiện</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '10%' }}>Tổng (kg)</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '15%' }}>Lũy kế trước</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', background: isLocked ? '#f1f5f9' : '#ecfdf5', color: isLocked ? '#94a3b8' : '#047857', width: '25%' }}>Khối lượng Hôm Nay</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '20%' }}>Cấn trừ Còn Lại</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải dữ liệu lệnh sản xuất...</td></tr>
          ) : logs.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Chưa có lệnh sản xuất nào được phát hành cho dự án này.</td></tr>
          ) : (
            Object.entries(groupedLogs).map(([wbsItem, rows], groupIdx) => (
              <React.Fragment key={groupIdx}>
                <tr>
                  <td colSpan={6} style={{ padding: '12px 16px', background: '#e2e8f0', border: '1px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>
                    📦 Hạng mục: {wbsItem}
                  </td>
                </tr>
                {rows.map((row) => {
                  const todayVal = Number(todayInputs[row.lsxCode]) || 0
                  // Lũy kế thực tế = lũy kế trước + KL hôm nay (nếu đã lock thì todayVolume đã nằm trong server)
                  const effectiveAccumulated = isLocked
                    ? (row.previousAccumulated || 0) + (row.todayVolume || 0)
                    : (row.previousAccumulated || 0) + todayVal
                    
                  // Calculate raw remaining to detect over-reporting
                  const rawRemaining = row.totalLsx - effectiveAccumulated
                  const isOverReport = rawRemaining < 0
                  const remaining = Math.max(0, rawRemaining)
                  
                  // Max cho phép nhập = Tổng LSX - Lũy kế trước
                  const maxInput = Math.max(0, row.totalLsx - (row.previousAccumulated || 0))

                  return (
                    <tr key={row.lsxCode} style={{ background: '#ffffff' }}>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 500, color: '#475569' }}>{row.stageLabel}</td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 600, color: '#f59e0b' }}>{row.teamName}</td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center' }}>{Number(row.totalLsx).toLocaleString('vi-VN')}</td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: isLocked ? 600 : 400, color: isLocked ? '#0369a1' : 'inherit' }}>
                        {isLocked
                          ? effectiveAccumulated.toLocaleString('vi-VN')
                          : Number(row.previousAccumulated || 0).toLocaleString('vi-VN')
                        }
                      </td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', background: isLocked ? '#f8fafc' : '#f0fdf4' }}>
                        {isLocked ? (
                          <span style={{ fontWeight: 600, color: '#059669' }}>
                            {(row.todayVolume || 0).toLocaleString('vi-VN')} {row.unit}
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <input type="number" className="input"
                              value={todayInputs[row.lsxCode] ?? ''}
                              onChange={e => setTodayInputs(prev => ({ ...prev, [row.lsxCode]: e.target.value }))}
                              max={maxInput}
                              min={0}
                              placeholder={`Tối đa ${maxInput.toLocaleString('vi-VN')}`}
                              style={{ 
                                width: 120, 
                                textAlign: 'center',
                                borderColor: isOverReport ? '#ef4444' : undefined,
                                background: isOverReport ? '#fef2f2' : undefined,
                                color: isOverReport ? '#ef4444' : undefined,
                                fontWeight: isOverReport ? 'bold' : 'normal'
                              }}
                            />
                            {isOverReport && <span style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>Cần nhập ≤ {maxInput.toLocaleString('vi-VN')}</span>}
                          </div>
                        )}
                      </td>
                      <td style={{
                        padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 'bold',
                        color: isOverReport ? '#dc2626' : (remaining === 0 ? '#10b981' : '#f59e0b')
                      }}>
                        {isOverReport ? (
                          <div style={{ color: '#dc2626', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span>⚠️ Vượt quá</span>
                            <span>{Math.abs(rawRemaining).toLocaleString('vi-VN')}</span>
                          </div>
                        ) : (
                           remaining.toLocaleString('vi-VN')
                        )}
                      </td>
                    </tr>
                  )
                })}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>

      {logs.length > 0 && !isLocked && (
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleGlobalSubmit}
            disabled={!isActive || submitting}
            className="btn-primary"
            style={{ padding: '10px 24px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: (!isActive || submitting) ? 'not-allowed' : 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {submitting ? '⏳ Đang lưu...' : '📤 Gửi báo cáo hôm nay'}
          </button>
        </div>
      )}

      {isLocked && isViewingToday && (
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <span style={{ padding: '10px 24px', background: '#f1f5f9', color: '#64748b', borderRadius: 8, fontWeight: 600, fontSize: '0.95rem' }}>
            ✅ Đã gửi báo cáo hôm nay
          </span>
        </div>
      )}

      <div style={{ padding: '1rem', marginTop: 16, background: '#f8fafc', borderRadius: 8, fontStyle: 'italic', color: '#64748b' }}>
        * Sau khi gửi báo cáo, dữ liệu sẽ bị khóa. Khối lượng hôm nay sẽ tự động cộng vào Lũy kế trước vào ngày hôm sau.
      </div>
    </div>
  )
}
