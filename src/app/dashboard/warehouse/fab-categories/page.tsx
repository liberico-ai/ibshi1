'use client'

import { useEffect, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/hooks/useAuth'
import { notify, confirmDialog } from '@/components/ui/Toast'
import { PageHeader, Button } from '@/components/ui'

interface Proj { id: string; projectCode: string; projectName: string }
interface Cat { id: string; code: string; name: string; sortOrder: number; ghiChu: string | null }

export default function FabCategoriesPage() {
  const [projects, setProjects] = useState<Proj[]>([])
  const [projectId, setProjectId] = useState('')
  const [cats, setCats] = useState<Cat[]>([])
  const [form, setForm] = useState({ code: '', name: '', sortOrder: '', ghiChu: '' })
  const [editing, setEditing] = useState<Cat | null>(null)
  const [importResult, setImportResult] = useState<{ soDongNhan: number; soDongNhap: number; soDongBoQua: number; loi: Array<{ dong: number; ly_do: string }> } | null>(null)

  useEffect(() => { apiFetch('/api/projects?page=1&limit=100').then(r => { if (r.ok) setProjects(r.projects || []) }) }, [])

  const load = useCallback(() => {
    if (!projectId) { setCats([]); return }
    apiFetch(`/api/procurement/fab-categories?projectId=${projectId}`).then(r => { if (r.ok) setCats(r.categories || []) })
  }, [projectId])
  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { notify('Nhập mã và tên hạng mục', 'error'); return }
    const body = JSON.stringify({ code: form.code.trim(), name: form.name.trim(), sortOrder: form.sortOrder || undefined, ghiChu: form.ghiChu || undefined })
    const r = editing
      ? await apiFetch(`/api/procurement/fab-categories/${editing.id}`, { method: 'PATCH', body })
      : await apiFetch(`/api/procurement/fab-categories?projectId=${projectId}`, { method: 'POST', body })
    if (r.ok) { notify(r.message || 'Đã lưu', 'success'); setForm({ code: '', name: '', sortOrder: '', ghiChu: '' }); setEditing(null); load() }
    else notify(r.error || 'Lỗi', 'error')
  }
  const startEdit = (c: Cat) => { setEditing(c); setForm({ code: c.code, name: c.name, sortOrder: String(c.sortOrder), ghiChu: c.ghiChu || '' }) }
  const cancelEdit = () => { setEditing(null); setForm({ code: '', name: '', sortOrder: '', ghiChu: '' }) }
  const del = async (c: Cat) => {
    if (!await confirmDialog(`Xóa hạng mục "${c.code}"?`)) return
    const r = await apiFetch(`/api/procurement/fab-categories/${c.id}`, { method: 'DELETE' })
    if (r.ok) { notify(r.message || 'Đã xóa', 'success'); load() } else notify(r.error || 'Lỗi xóa', 'error')
  }

  const downloadTemplate = () => {
    const data = cats.length > 0
      ? cats.map(c => ({ 'Mã hạng mục': c.code, 'Tên hạng mục': c.name, 'Thứ tự': c.sortOrder, 'Ghi chú': c.ghiChu || '' }))
      : [{ 'Mã hạng mục': 'INLET-U1', 'Tên hạng mục': 'Cụm cửa vào Unit 1', 'Thứ tự': 1, 'Ghi chú': '' }]
    const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 8 }, { wch: 24 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'HangMuc')
    XLSX.writeFile(wb, `MauHangMucCheTao.xlsx`)
  }
  const importExcel = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (raw.length === 0) { notify('File không có dòng nào', 'error'); return }
      const rows = raw.map(r => ({ code: r['Mã hạng mục'], name: r['Tên hạng mục'], sortOrder: r['Thứ tự'], ghiChu: r['Ghi chú'] }))
      const r = await apiFetch(`/api/procurement/fab-categories/import?projectId=${projectId}`, { method: 'POST', body: JSON.stringify({ rows }) })
      if (r.ok) { notify(r.message || 'Đã nhập', 'success'); setImportResult({ soDongNhan: r.soDongNhan, soDongNhap: r.soDongNhap, soDongBoQua: r.soDongBoQua, loi: r.loi || [] }); load() }
      else { setImportResult(null); notify(r.error || 'Lỗi nhập', 'error') }
    } catch (e) { console.error(e); notify('Không đọc được file Excel', 'error') }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Hạng mục chế tạo" subtitle="Khai bộ hạng mục (cụm/kết cấu) của từng dự án — dùng cho lưới phân bổ chế tạo" />

      <div className="flex gap-3 items-center flex-wrap">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm" style={{ maxWidth: 380 }}>
          <option value="">— Chọn dự án —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
        </select>
        {projectId && (
          <div className="flex gap-2">
            <button type="button" onClick={downloadTemplate} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--surface)' }}>⬇ Tải mẫu Excel</button>
            <label className="text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer" style={{ border: '1px solid #16a34a', color: '#166534', background: '#f0fdf4' }}>
              ⬆ Import Excel
              <input type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = '' }} />
            </label>
          </div>
        )}
      </div>

      {/* Panel kết quả nhập file (chi tiết dòng bỏ qua + lỗi) */}
      {importResult && (
        <div className="card p-4 space-y-2" style={{ borderLeft: `3px solid ${importResult.soDongBoQua ? '#f59e0b' : '#16a34a'}` }}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Kết quả nhập file</div>
            <button onClick={() => setImportResult(null)} className="text-xs" style={{ color: 'var(--text-muted)' }}>✕ Ẩn</button>
          </div>
          <div className="flex gap-4 text-xs flex-wrap">
            <span>Đọc: <b className="font-mono">{importResult.soDongNhan}</b></span>
            <span style={{ color: '#166534' }}>Đã nhập: <b className="font-mono">{importResult.soDongNhap}</b></span>
            <span style={{ color: importResult.soDongBoQua ? '#b45309' : 'var(--text-muted)' }}>Bỏ qua: <b className="font-mono">{importResult.soDongBoQua}</b></span>
          </div>
          {importResult.loi.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <table className="w-full text-[11px]">
                <thead><tr style={{ color: '#92400e' }}><th className="text-left px-2 py-1" style={{ width: 60 }}>Dòng</th><th className="text-left px-2 py-1">Lý do bỏ qua</th></tr></thead>
                <tbody>
                  {importResult.loi.map((l, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #fde68a' }}><td className="px-2 py-0.5 font-mono" style={{ color: '#b45309' }}>{l.dong}</td><td className="px-2 py-0.5" style={{ color: '#78350f' }}>{l.ly_do}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {projectId && (
        <div className="card p-5 space-y-4">
          {/* Form thêm/sửa */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div><label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Mã hạng mục *</label><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} className="input text-sm w-full" placeholder="INLET-U1" /></div>
            <div className="md:col-span-2"><label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tên hạng mục *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input text-sm w-full" placeholder="Cụm cửa vào Unit 1" /></div>
            <div><label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Thứ tự</label><input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: e.target.value })} className="input text-sm w-full" placeholder="1" /></div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={submit}>{editing ? 'Cập nhật' : '+ Thêm'}</Button>
              {editing && <Button variant="outline" onClick={cancelEdit}>Huỷ</Button>}
            </div>
            <div className="md:col-span-5"><input value={form.ghiChu} onChange={e => setForm({ ...form, ghiChu: e.target.value })} className="input text-sm w-full" placeholder="Ghi chú (không bắt buộc)" /></div>
          </div>

          {/* Bảng hạng mục */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                <th className="text-right px-2 py-1.5" style={{ width: 50 }}>Thứ tự</th>
                <th className="text-left px-2 py-1.5">Mã</th><th className="text-left px-2 py-1.5">Tên hạng mục</th>
                <th className="text-left px-2 py-1.5">Ghi chú</th><th className="text-center px-2 py-1.5" style={{ width: 120 }}>Thao tác</th>
              </tr></thead>
              <tbody>
                {cats.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>Chưa có hạng mục — thêm ở trên hoặc import Excel</td></tr>
                ) : cats.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{c.sortOrder}</td>
                    <td className="px-2 py-1 font-mono font-semibold" style={{ color: 'var(--accent)' }}>{c.code}</td>
                    <td className="px-2 py-1">{c.name}</td>
                    <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>{c.ghiChu || ''}</td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => startEdit(c)} className="text-[11px] px-2 py-0.5 rounded mr-1" style={{ border: '1px solid var(--border)', color: 'var(--accent)' }}>Sửa</button>
                      <button onClick={() => del(c)} className="text-[11px] px-2 py-0.5 rounded" style={{ border: '1px solid #fecaca', color: '#dc2626' }}>Xóa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
