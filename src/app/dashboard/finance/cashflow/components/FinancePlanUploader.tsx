'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'

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
        
        // Use the first sheet or the specific one 
        const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('dự toán') || n.toLowerCase().includes('dòng tiền')) || workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        
        // Parse raw matrix to easily get cells
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][]

        if (!jsonData || jsonData.length < 15) {
          throw new Error('Định dạng file không gian dòng tiền không hợp lệ (cần lớn hơn 15 dòng)')
        }

        // Bóc tách Master Data
        const customerId = jsonData[4]?.[1] || '' // B5
        const contractValue = parseFloat(jsonData[5]?.[1]?.toString().replace(/[^\d.-]/g, '')) || 0 // B6

        const budgetLines = []
        const monthlyCashflows = []
        let currentSectionType = 'OTHER'

        const [sYear, sMonth] = startMonth.split('-').map(Number)

        // Bóc tách Body (Từ Row 13 / Index 12 đổ đi theo tài liệu)
        // Assume Col A: STT, B: Hạng mục, C: Tổng dự toán, D -> R: Dòng tiền các tháng
        for (let i = 12; i < Math.min(jsonData.length, 200); i++) {
          const row = jsonData[i]
          const stt = row[0]?.toString()?.trim() || ''
          let itemName = row[1]?.toString()?.trim() || ''
          const totalBudgetRaw = row[2]?.toString()?.replace(/[^\d.-]/g, '')
          const totalBudget = parseFloat(totalBudgetRaw) || 0

          // Detect Section (Vật tư, Nhân công)
          if (itemName.toUpperCase().includes('VẬT TƯ')) currentSectionType = 'MATERIAL'
          else if (itemName.toUpperCase().includes('NHÂN CÔNG')) currentSectionType = 'LABOUR'
          else if (itemName.toUpperCase().includes('THUÊ NGOÀI')) currentSectionType = 'SUBCONTRACT'
          else if (itemName.toUpperCase().includes('CHI PHÍ KHÁC')) currentSectionType = 'OTHER'

          if (!itemName || stt.match(/^[A-Z]+$/)) {
            continue; // Skip group headers A, B, C, I, II
          }

          // Generate budget line
          const categoryCode = `${currentSectionType.substring(0,3)}-${i}`
          
          if (totalBudget > 0 || row.some((v: any, idx: number) => idx >= 3 && parseFloat(v))) {
             budgetLines.push({
               sectionType: currentSectionType,
               categoryCode,
               itemName: itemName.substring(0, 50),
               unit: 'LS',
               quantity: 1,
               unitPrice: totalBudget,
               totalBudget: totalBudget
             })

             // Detect month columns from D (idx 3) to Math.min(row.length, 20)
             for (let j = 3; j < Math.min(row.length, 20); j++) {
               const val = parseFloat(row[j]?.toString()?.replace(/[^\d.-]/g, ''))
               if (val && !isNaN(val)) {
                  // Calculate absolute month
                  const offset = j - 3 // D is month 1 (offset 0)
                  const targetDate = new Date(sYear, sMonth - 1 + offset, 1)
                  monthlyCashflows.push({
                    month: targetDate.getMonth() + 1,
                    year: targetDate.getFullYear(),
                    amountVnd: val,
                    category: itemName.substring(0, 30),
                  })
               }
             }
          }
        }

        const payload = {
          projectId: selectedProjectId,
          customerId: customerId.toString().substring(0, 50),
          contractValue,
          budgetLines,
          monthlyCashflows
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
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-secondary)' }}>Tháng bắt đầu dòng tiền (Tháng 1 ở cột D) *</label>
          <input type="month" className="input" value={startMonth} onChange={e => setStartMonth(e.target.value)} />
        </div>
      </div>

      <div {...getRootProps()} className="p-8 text-center cursor-pointer rounded-lg bg-[var(--bg-primary)] mb-4 hover:bg-[var(--bg-secondary)] transition-colors">
        <input {...getInputProps()} />
        <div className="text-4xl mb-2">📊</div>
        {file ? (
          <p className="font-medium text-green-600 dark:text-green-400">Đã chọn: {file.name}</p>
        ) : (
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Kéo thả file Phương án Tài chính Excel (VOGT 095) vào đây, hoặc click để chọn file
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
