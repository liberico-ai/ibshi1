'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface DailyReportRow {
  lsxCode: string
  wbsItem: string
  stageKey: string
  stageLabel: string
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
  const [todayInputs, setTodayInputs] = useState<Record<string, number>>({})
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/api/tasks/${task.id}/daily-report?date=${selectedDate}`)
      if (data.success) {
        setLogs(data.items || [])
        const inputs: Record<string, number> = {}
        for (const item of (data.items || [])) {
          if (item.todayVolume > 0) inputs[item.lsxCode] = item.todayVolume
        }
        setTodayInputs(inputs)
      } else {
        setError(data.error || 'Lỗi tải dữ liệu')
        console.error('Daily report error:', data)
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
    if (!isActive) return
    const itemsToSubmit = logs
      .map(row => ({
        lsxCode: row.lsxCode,
        wbsStage: row.stageKey,
        reportedVolume: todayInputs[row.lsxCode] || 0
      }))
      .filter(item => item.reportedVolume > 0)

    if (itemsToSubmit.length === 0) {
      alert('Vui lòng nhập khối lượng hoàn thành cho ít nhất 1 công đoạn để gửi báo cáo.')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/daily-report`, {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          userId: 'user', // Normally from useAuth()
          items: itemsToSubmit
        })
      })
      if (res.success) {
        alert('Gửi báo cáo thành công!')
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
        Giao diện nhập liệu hằng ngày. Vui lòng nhập số liệu khối lượng hoàn thành trong ca làm việc.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="date" className="input" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ width: 160 }} />
        <button onClick={fetchData} className="btn-primary" style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>Tải lại Cập nhật</button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', borderRadius: 8, color: '#dc2626', marginBottom: 16, fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}

      <table className="wbs-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '20%' }}>Công Đoạn</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '15%' }}>Tổng LSX (kg)</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '15%' }}>Lũy kế trước (kg)</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', background: '#ecfdf5', color: '#047857', width: '25%' }}>Khối lượng Hôm Nay</th>
            <th style={{ padding: 12, textAlign: 'center', border: '1px solid #e2e8f0', width: '25%' }}>Cấn trừ Còn Lại (kg)</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải dữ liệu lệnh sản xuất...</td></tr>
          ) : logs.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Chưa có lệnh sản xuất nào được phát hành cho dự án này.</td></tr>
          ) : (
            Object.entries(groupedLogs).map(([wbsItem, rows], groupIdx) => (
              <React.Fragment key={groupIdx}>
                {/* WBS Item Header Row */}
                <tr>
                  <td colSpan={5} style={{ padding: '12px 16px', background: '#e2e8f0', border: '1px solid #cbd5e1', fontWeight: 600, color: '#334155' }}>
                    📦 Hạng mục: {wbsItem}
                  </td>
                </tr>
                {/* Stages for this WBS Item */}
                {rows.map((row, idx) => {
                  const todayVal = todayInputs[row.lsxCode] || 0
                  const remaining = Math.max(0, row.totalLsx - (row.previousAccumulated || 0) - todayVal)
                  return (
                    <tr key={row.lsxCode} style={{ background: '#ffffff' }}>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 500, color: '#475569' }}>{row.stageLabel}</td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center' }}>{Number(row.totalLsx).toLocaleString('vi-VN')}</td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center' }}>{Number(row.previousAccumulated || 0).toLocaleString('vi-VN')}</td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', background: '#f8fafc' }}>
                        <input type="number" className="input"
                          value={todayInputs[row.lsxCode] ?? ''}
                          onChange={e => setTodayInputs(prev => ({ ...prev, [row.lsxCode]: Number(e.target.value) || 0 }))}
                          placeholder="VD: 20" style={{ width: 100, textAlign: 'center' }} />
                      </td>
                      <td style={{ padding: 12, border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 'bold', color: remaining === 0 ? '#10b981' : 'inherit' }}>{remaining.toLocaleString('vi-VN')}</td>
                    </tr>
                  )
                })}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>

      {logs.length > 0 && (
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

      <div style={{ padding: '1rem', marginTop: 16, background: '#f8fafc', borderRadius: 8, fontStyle: 'italic', color: '#64748b' }}>
        * Bảng nhập tự động khóa (readonly) sau khi bấm "Gửi Mốc" mỗi ngày. Khối lượng sẽ tự lùi trừ vào 00:00 sáng mai.
      </div>
    </div>
  )
}
