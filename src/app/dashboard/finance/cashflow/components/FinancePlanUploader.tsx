'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { BarChart3 } from 'lucide-react'

interface Project {
  id: string
  projectCode: string
  projectName: string
}

export default function FinancePlanUploader({ onUploaded }: { onUploaded?: (projectId: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [startMonth, setStartMonth] = useState<string>(new Date().toISOString().slice(0, 7)) // YYYY-MM
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    // Load projects to select
    apiFetch('/api/projects').then(res => {
      if (res.ok) setProjects(res.projects || [])
    })
  }, [])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError('')
    setSuccess('')
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0])
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    maxFiles: 1
  })

  // Parse excel and submit
  const handleProcess = async () => {
    if (!file) return setError('Vui lòng chọn file')
    if (!selectedProjectId) return setError('Vui lòng chọn dự án để map dữ liệu')
    if (!startMonth) return setError('Vui lòng chọn tháng bắt đầu (Tháng 1)')

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        
        // ── Mẫu chuẩn QT30-DT02 ("Dòng tiền dự án") ────────────────────────────────
        // Ưu tiên sheet "Dòng tiền" (DT02); có dòng tiêu đề chứa các cột "Tháng N".
        const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('dòng tiền'))
          || workbook.SheetNames.find(n => n.toLowerCase().includes('dự toán'))
          || workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][]
        if (!rows || rows.length < 10) {
          throw new Error('File dòng tiền không hợp lệ (quá ít dòng).')
        }

        const num = (v: any): number => {
          if (typeof v === 'number') return v
          const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
          return isNaN(n) ? 0 : n
        }

        // 1) Tìm DÒNG TIÊU ĐỀ: dòng chứa ≥3 ô "Tháng N" → xác định ĐÚNG các cột tháng (không đoán cột D).
        let headerIdx = -1
        const monthCols: { colIdx: number; m: number }[] = []
        for (let r = 0; r < Math.min(rows.length, 25); r++) {
          const found: { colIdx: number; m: number }[] = []
          const row = rows[r] || []
          for (let c = 0; c < row.length; c++) {
            const mt = String(row[c]).match(/Tháng\s*(\d{1,2})/i)
            if (mt) found.push({ colIdx: c, m: parseInt(mt[1], 10) })
          }
          if (found.length >= 3) { headerIdx = r; monthCols.push(...found); break }
        }
        if (headerIdx < 0) {
          throw new Error('Không thấy dòng tiêu đề các cột "Tháng N" (mẫu QT30-DT02). Kiểm tra lại file.')
        }

        // Cột "Nội dung"/"Mã CP"/"Dự toán Kinh doanh" — dò theo tiêu đề, fallback vị trí mặc định.
        const header = rows[headerIdx]
        const col = (kw: string, dft: number) => {
          const i = header.findIndex((h: any) => String(h).toLowerCase().includes(kw))
          return i >= 0 ? i : dft
        }
        const nameCol = col('nội dung', 2)
        const codeCol = col('mã cp', 1)
        const budgetCol = col('dự toán', 5)

        // 2) THÁNG lấy TỪ FILE; NĂM gối từ năm người dùng chọn (12 → 1 sang năm mới).
        const [pickYear] = startMonth.split('-').map(Number)
        let runYear = pickYear
        let prevM: number | null = null
        const monthMeta = monthCols.map(({ colIdx, m }) => {
          if (prevM !== null && m < prevM) runYear++
          prevM = m
          return { colIdx, month: m, year: runYear }
        })

        // 3) Duyệt thân bảng: dòng NHÓM La Mã (I..VI) = dòng tiền RA theo tháng;
        //    dòng CHI TIẾT (STT là số) = 1 dòng dự toán (tổng ở cột "Dự toán KD").
        const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/
        const sectionOf = (name: string): string => {
          const u = name.toUpperCase()
          if (u.includes('VẬT TƯ')) return 'MATERIAL'
          if (u.includes('NHÂN CÔNG')) return 'LABOUR'
          if (u.includes('THUÊ NGOÀI') || u.includes('DỊCH VỤ')) return 'SERVICE'
          if (u.includes('QUẢN LÝ')) return 'OVERHEAD'
          if (u.includes('BẢO LÃNH')) return 'GUARANTEE'
          if (u.includes('THUẾ')) return 'TAX'
          return 'OTHER'
        }

        const budgetLines: any[] = []
        const monthlyCashflows: any[] = []
        let currentSectionType = 'OTHER'

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i]; if (!row) continue
          const stt = String(row[0] ?? '').trim()
          const name = String(row[nameCol] ?? '').trim()
          if (!name) continue
          if (/^A$/i.test(stt)) continue          // "A" = tổng dòng tiền ra (đã bằng Σ I..VI) → bỏ
          if (/^B$/i.test(stt) || /^C$/i.test(stt)) break  // "B" dòng tiền vào / "C" chênh lệch → dừng phần chi ra

          if (ROMAN.test(stt)) {
            currentSectionType = sectionOf(name)
            for (const mm of monthMeta) {
              const val = num(row[mm.colIdx])
              if (val > 0) monthlyCashflows.push({ month: mm.month, year: mm.year, amountVnd: val, category: name.substring(0, 30) })
            }
            continue
          }
          if (/^\d+(\.\d+)?$/.test(stt)) {
            const total = num(row[budgetCol])
            if (total > 0) {
              budgetLines.push({
                sectionType: currentSectionType,
                categoryCode: String(row[codeCol] ?? '').trim() || `${currentSectionType.substring(0, 3)}-${i}`,
                itemName: name.substring(0, 80),
                unit: 'LS', quantity: 1, unitPrice: total, totalBudget: total,
              })
            }
          }
        }

        if (monthlyCashflows.length === 0) {
          throw new Error('Không đọc được dòng tiền theo tháng (các dòng nhóm I..VI trống). Kiểm tra lại mẫu file.')
        }

        // 4) Master data: Khách hàng, Scope, Giá trị HĐ (= tổng "Dòng tiền vào" B, fallback "Doanh thu").
        const rowByLabel = (kw: string, labelCol = 1) =>
          rows.find(r => String(r?.[labelCol] ?? '').toLowerCase().includes(kw))
        const customerId = String(rowByLabel('khách hàng')?.[2] ?? '').trim()
        const scopeDescription = String(rowByLabel('scope', 0)?.[1] ?? '').trim()
        let contractValue = 0
        for (const r of rows) {
          if (/^B$/i.test(String(r?.[0] ?? '').trim()) && String(r?.[nameCol] ?? '').toLowerCase().includes('dòng tiền vào')) {
            contractValue = num(r[budgetCol]); break
          }
        }
        if (!contractValue) contractValue = num(rowByLabel('doanh thu')?.[2])

        const payload = {
          projectId: selectedProjectId,
          customerId: customerId.substring(0, 50),
          scopeDescription: scopeDescription.substring(0, 200) || undefined,
          contractValue,
          budgetLines,
          monthlyCashflows,
        }

        const res = await apiFetch('/api/finance/cashflow/plan', {
          method: 'POST',
          body: JSON.stringify(payload)
        })

        if (!res.ok) throw new Error(res.error || 'Lỗi lưu dữ liệu dự án')
        
        setSuccess(`Xử lý thành công! Đã tạo ${budgetLines.length} dòng dự toán và phân bổ ${monthlyCashflows.length} cell dòng tiền.`)
        if (onUploaded) onUploaded(selectedProjectId)
      }
      reader.readAsArrayBuffer(file)

    } catch (err: any) {
      setError(err.message || 'Lỗi xử lý file')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-6 border-2 border-dashed" style={{ borderColor: isDragActive ? 'var(--accent)' : 'var(--border-light)' }}>
      <h3 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Import Phương án Tài chính (Excel)</h3>
      
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-secondary)' }}>Dự án *</label>
          <select className="input" value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
            <option value="">-- Chọn dự án --</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} - {p.projectName}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tháng/năm của cột &quot;Tháng&quot; ĐẦU TIÊN trong file (để suy ra năm) *</label>
          <input type="month" className="input" value={startMonth} onChange={e => setStartMonth(e.target.value)} />
        </div>
      </div>

      <div {...getRootProps()} className="p-8 text-center cursor-pointer rounded-lg bg-[var(--bg-primary)] mb-4 hover:bg-[var(--bg-secondary)] transition-colors">
        <input {...getInputProps()} />
        <div className="mb-2 flex justify-center"><BarChart3 className="h-12 w-12 text-muted-foreground" /></div>
        {file ? (
          <p className="font-medium text-green-600 dark:text-green-400">Đã chọn: {file.name}</p>
        ) : (
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Kéo thả file Phương án Tài chính Excel (mẫu QT30-DT02 — sheet &quot;Dòng tiền dự án&quot;) vào đây, hoặc click để chọn file
          </p>
        )}
      </div>

      {error && <div className="p-3 mb-4 rounded bg-red-50 text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 mb-4 rounded bg-green-50 text-green-600 text-sm font-medium">{success}</div>}

      <div className="flex justify-end">
        <button 
          onClick={handleProcess} 
          disabled={!file || !selectedProjectId || loading}
          className="btn-accent px-6 py-2 shadow-lg disabled:opacity-50"
        >
          {loading ? 'Đang bóc tách...' : 'Bắt đầu xử lý (Parse)'}
        </button>
      </div>
    </div>
  )
}
