'use client'

import React, { useState } from 'react'
import { apiFetch } from '@/hooks/useAuth'

interface QualityAcceptanceUIProps {
  task: any
  isActive: boolean
  project?: any
  currentUser?: any
}

export default function QualityAcceptanceUI({ task, isActive, project, currentUser }: QualityAcceptanceUIProps) {
  const rd = task.resultData || {}
  const [ntDate, setNtDate] = useState('')
  const [ntResult, setNtResult] = useState('')
  const [ntNotes, setNtNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!ntDate || !ntResult) return
    if (!confirm(`Xác nhận nghiệm thu chất lượng: ${ntResult === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}?`)) return

    setSubmitting(true)
    try {
      await apiFetch(`/api/tasks/${task.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          userId: currentUser?.id,
          resultData: {
            ...rd,
            ngayNghiemThu: ntDate,
            ketQua: ntResult,
            ghiChu: ntNotes,
            completedAt: new Date().toISOString(),
          }
        })
      })
      alert(`✅ Nghiệm thu chất lượng: ${ntResult === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}`)
      window.location.reload()
    } catch (err) {
      alert('Lỗi: ' + (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', borderTop: '4px solid #f59e0b' }}>
      <h3 style={{ marginTop: 0, fontSize: '1.2rem', color: '#b45309', display: 'flex', alignItems: 'center', gap: 8 }}>
        🔍 NGHIỆM THU CHẤT LƯỢNG HẠNG MỤC (QAQC)
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ padding: '10px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', fontWeight: 600, width: '30%' }}>Dự án</td>
            <td style={{ padding: '10px 16px', border: '1px solid #e2e8f0' }}>{rd.projectName || project?.projectCode || ''}</td>
          </tr>
          <tr>
            <td style={{ padding: '10px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', fontWeight: 600 }}>Hạng mục</td>
            <td style={{ padding: '10px 16px', border: '1px solid #e2e8f0', fontWeight: 600, color: '#0369a1' }}>{rd.hangMucName || ''}</td>
          </tr>
          <tr>
            <td style={{ padding: '10px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', fontWeight: 600 }}>Tổng KL thiết kế</td>
            <td style={{ padding: '10px 16px', border: '1px solid #e2e8f0' }}>{Number(rd.totalKL || 0).toLocaleString('vi-VN')} kg</td>
          </tr>
        </tbody>
      </table>

      {isActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, marginBottom: 4, display: 'block' }}>Ngày nghiệm thu *</label>
              <input type="date" className="input" value={ntDate} onChange={e => setNtDate(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, marginBottom: 4, display: 'block' }}>Kết quả *</label>
              <select className="input" value={ntResult} onChange={e => setNtResult(e.target.value)} style={{ width: '100%', padding: '8px 12px' }}>
                <option value="">-- Chọn --</option>
                <option value="PASS">✅ Đạt (PASS)</option>
                <option value="FAIL">❌ Không đạt (FAIL)</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontWeight: 600, marginBottom: 4, display: 'block' }}>Ghi chú</label>
            <textarea className="input" rows={3} value={ntNotes} onChange={e => setNtNotes(e.target.value)} placeholder="Nhận xét, yêu cầu khắc phục..." style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn-primary"
              disabled={!ntDate || !ntResult || submitting}
              onClick={handleSubmit}
              style={{
                padding: '10px 24px',
                background: ntResult === 'PASS' ? '#10b981' : ntResult === 'FAIL' ? '#ef4444' : '#94a3b8',
                color: 'white', border: 'none', borderRadius: 8, fontWeight: 600,
                cursor: (!ntDate || !ntResult || submitting) ? 'not-allowed' : 'pointer', fontSize: '1rem'
              }}
            >
              {submitting ? '⏳ Đang lưu...' : ntResult === 'PASS' ? '✅ Xác nhận ĐẠT' : ntResult === 'FAIL' ? '❌ Xác nhận KHÔNG ĐẠT' : '📝 Lưu kết quả nghiệm thu'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
