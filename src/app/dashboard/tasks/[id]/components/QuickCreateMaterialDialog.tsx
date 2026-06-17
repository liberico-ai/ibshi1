'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'

export interface PickedMaterial {
  id: string
  materialCode: string
  name: string
  unit: string
  isProvisional?: boolean
}

interface Candidate {
  id: string; materialCode: string; name: string; unit: string; currentStock: number; aliasCount: number; specification?: string; grade?: string
}

interface Props {
  open: boolean
  initialName?: string
  initialUnit?: string
  initialSpec?: string
  initialSearch?: string   // seed the dedupe search differently from the name (e.g. by dimensions/profile)
  defaultPrefix?: string
  onClose: () => void
  onPicked: (m: PickedMaterial) => void
}

function suggestSubgroup(name: string): string {
  const words = (name || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 4)
  return words.map((w) => w[0]).join('').slice(0, 4)
}

export default function QuickCreateMaterialDialog({ open, initialName = '', initialUnit = '', initialSpec = '', initialSearch = '', defaultPrefix = '', onClose, onPicked }: Props) {
  const [phase, setPhase] = useState<'search' | 'create'>('search')
  const [query, setQuery] = useState(initialSearch || initialName)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState(initialName)
  const [unit, setUnit] = useState(initialUnit)
  const [spec, setSpec] = useState(initialSpec)
  const [prefix, setPrefix] = useState(defaultPrefix)
  const [subgroup, setSubgroup] = useState(suggestSubgroup(initialName))
  const [price, setPrice] = useState('')

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setCandidates([]); return }
    setSearching(true)
    const res = await apiFetch(`/api/materials?q=${encodeURIComponent(q.trim())}&page=1`)
    setCandidates(res.ok ? res.materials : [])
    setSearching(false)
  }, [])

  useEffect(() => {
    if (open) {
      const q0 = initialSearch || initialName
      setPhase('search'); setError('')
      setQuery(q0); setName(initialName); setUnit(initialUnit)
      setSpec(initialSpec); setPrefix(defaultPrefix); setSubgroup(suggestSubgroup(initialName)); setPrice('')
      runSearch(q0)
    }
  }, [open, initialName, initialUnit, initialSpec, initialSearch, defaultPrefix, runSearch])

  if (!open) return null

  const submitCreate = async () => {
    setError('')
    if (!prefix.trim() || !subgroup.trim() || !name.trim() || !unit.trim()) {
      setError('Cần đủ: Nhóm, Phân nhóm, Tên, ĐVT'); return
    }
    setSubmitting(true)
    const res = await apiFetch('/api/materials/quick-create', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(), unit: unit.trim(), specification: spec.trim() || undefined,
        prefix: prefix.trim().toUpperCase(), subgroup: subgroup.trim().toUpperCase(),
        confirmedNotDuplicate: true,
        estimatedUnitPrice: price ? Number(price) : undefined,
      }),
    })
    setSubmitting(false)
    if (res.ok) {
      onPicked({ id: res.material.id, materialCode: res.material.materialCode, name: res.material.name, unit: res.material.unit, isProvisional: true })
      onClose()
    } else setError(res.error || 'Lỗi tạo mã')
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(10,37,64,0.6)', backdropFilter: 'blur(4px)' }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: 'var(--surface, #fff)' }}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: '#0a2540' }}>
          <div>
            <h3 className="text-white font-bold text-base m-0">
              {phase === 'search' ? 'Tra cứu vật tư trong kho' : 'Tạo mã vật tư mới'}
            </h3>
            <p className="text-blue-200 text-xs mt-0.5 m-0">
              {phase === 'search' ? 'Tìm mã sẵn có trước khi tạo mới' : 'Sinh mã tạm — chờ KTKH/Kho chuẩn hóa'}
            </p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl bg-transparent border-none cursor-pointer">✕</button>
        </div>

        <div className="px-6 py-5" style={{ maxHeight: '70vh', overflowY: 'auto' }}>

          {phase === 'search' && (
            <>
              {/* Search bar */}
              <div className="flex gap-2 mb-4">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch(query)}
                  placeholder="Nhập tên hoặc mã vật tư..."
                  className="flex-1 px-3 py-2.5 text-sm rounded-lg border outline-none"
                  style={{ borderColor: 'var(--border, #e2e8f0)', backgroundColor: 'var(--surface-hover, #f8fafc)', color: 'var(--text-primary, #1a202c)' }}
                />
                <button
                  onClick={() => runSearch(query)}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer transition-colors"
                  style={{ backgroundColor: '#0a2540', color: '#fff' }}
                >
                  Tìm
                </button>
              </div>

              {/* Results */}
              <div className="rounded-xl border overflow-hidden mb-4" style={{ borderColor: 'var(--border, #e2e8f0)' }}>
                <div className="px-3 py-2 text-xs font-semibold" style={{ backgroundColor: 'var(--surface-hover, #f1f5f9)', color: 'var(--text-muted, #64748b)' }}>
                  {searching ? 'Đang tìm...' : candidates.length > 0 ? `Tìm thấy ${candidates.length} kết quả` : 'Không có kết quả khớp'}
                </div>

                {candidates.length > 0 && (
                  <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {candidates.map((c, i) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-blue-50"
                        style={{ borderTop: i > 0 ? '1px solid var(--border, #e2e8f0)' : 'none' }}
                      >
                        {/* Material info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="font-mono text-sm font-bold" style={{ color: '#0a2540' }}>{c.materialCode}</span>
                            {c.specification && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 font-mono">
                                {c.specification}
                              </span>
                            )}
                            {c.grade && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                {c.grade}
                              </span>
                            )}
                            {c.currentStock > 0 ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Tồn: {c.currentStock.toLocaleString('vi-VN')}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                Hết hàng
                              </span>
                            )}
                          </div>
                          <div className="text-xs truncate" style={{ color: 'var(--text-secondary, #475569)' }}>
                            {c.name} <span className="opacity-50">({c.unit})</span>
                          </div>
                        </div>

                        {/* Action */}
                        <button
                          onClick={() => { onPicked({ id: c.id, materialCode: c.materialCode, name: c.name, unit: c.unit }); onClose() }}
                          className="px-4 py-2 rounded-lg text-xs font-bold border-none cursor-pointer transition-all whitespace-nowrap"
                          style={{ backgroundColor: '#059669', color: '#fff' }}
                        >
                          Chọn mã này
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Create new button */}
              <button
                onClick={() => setPhase('create')}
                className="w-full py-3 rounded-xl text-sm font-bold border-2 border-dashed cursor-pointer transition-colors"
                style={{ borderColor: '#e63946', color: '#e63946', backgroundColor: '#fff5f5' }}
              >
                Không tìm thấy → Tạo mã mới (mã tạm)
              </button>
            </>
          )}

          {phase === 'create' && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <label className="col-span-2 text-xs font-semibold" style={{ color: 'var(--text-secondary, #475569)' }}>
                  Tên vật tư *
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-primary)' }} />
                </label>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Nhóm (prefix) *
                  <input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="VD: VLH"
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border outline-none font-mono"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-primary)' }} />
                </label>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Phân nhóm *
                  <input value={subgroup} onChange={(e) => setSubgroup(e.target.value.toUpperCase())} placeholder="VD: QUEH"
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border outline-none font-mono"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-primary)' }} />
                </label>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  ĐVT *
                  <input value={unit} onChange={(e) => setUnit(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-primary)' }} />
                </label>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Đơn giá ước tính
                  <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="(tuỳ chọn)"
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-primary)' }} />
                </label>
                <label className="col-span-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Quy cách / Mác thép
                  <input value={spec} onChange={(e) => setSpec(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-primary)' }} />
                </label>
              </div>

              {/* Preview */}
              <div className="rounded-lg px-4 py-3 mb-4 text-xs" style={{ backgroundColor: '#f0f4f8', color: 'var(--text-secondary)' }}>
                Mã sinh ra: <code className="font-mono font-bold text-sm" style={{ color: '#0a2540' }}>{prefix || 'NHÓM'}-{subgroup || 'PN'}-NNN</code>
                <span className="ml-2 opacity-60">• Trạng thái: chờ chuẩn hóa</span>
              </div>

              {error && <div className="text-red-600 text-xs mb-3 font-medium">{error}</div>}

              <div className="flex gap-3">
                <button onClick={() => setPhase('search')}
                  className="px-4 py-2.5 rounded-lg text-sm border cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface-hover)' }}>
                  ← Quay lại
                </button>
                <button onClick={submitCreate} disabled={submitting}
                  className="flex-1 py-2.5 rounded-lg text-sm font-bold border-none cursor-pointer transition-opacity"
                  style={{ backgroundColor: '#0a2540', color: '#fff', opacity: submitting ? 0.6 : 1 }}>
                  {submitting ? 'Đang tạo...' : 'Tạo mã tạm'}
                </button>
              </div>
            </>
          )}

          {error && phase === 'search' && <div className="text-red-600 text-xs mt-3 font-medium">{error}</div>}
        </div>
      </div>
    </div>
  )
}
