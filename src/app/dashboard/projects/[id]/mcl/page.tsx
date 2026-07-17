'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/hooks/useAuth'
import { PageHeader, EmptyState } from '@/components/ui'
import { SEMANTIC_COLORS } from '@/lib/design-tokens'
import { formatNumber } from '@/lib/utils'
import { Package, Download } from 'lucide-react'

interface MclRow {
  key: string
  materialId: string | null
  itemCode: string
  description: string
  profile: string
  grade: string
  unit: string
  neededPr: number
  neededBom: number
  needed: number
  ordered: number
  received: number
  onHand: number
  issued: number
  shortage: number
}

interface MclSummary {
  totalRows: number
  shortageRows: number
  totalNeeded: number
  totalOrdered: number
  totalReceived: number
  totalShortage: number
}

interface MclResponse {
  ok: boolean
  error?: string
  project?: { projectCode: string; projectName: string }
  rows?: MclRow[]
  summary?: MclSummary
}

function num(n: number): string {
  if (!n) return '—'
  return formatNumber(n)
}

const HEADERS = [
  'Mã VT', 'Mô tả', 'Quy cách', 'Mác', 'ĐVT',
  'Cần', 'Đã đặt (PO)', 'Đã về (GRN)', 'Tồn', 'Đã cấp', 'Còn thiếu',
]

export default function ProjectMclPage() {
  const params = useParams()
  const [data, setData] = useState<MclResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    if (!params.id) return
    apiFetch(`/api/projects/${params.id}/mcl`).then((r: MclResponse) => {
      if (r.ok) { setData(r); setError('') }
      else setError(r.error || 'Không tải được dữ liệu')
      setLoading(false)
    }).catch(() => { setError('Lỗi mạng'); setLoading(false) })
  }, [params.id])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => data?.rows || [], [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.itemCode.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.profile.toLowerCase().includes(q) ||
      r.grade.toLowerCase().includes(q),
    )
  }, [rows, search])

  const exportCsv = useCallback(() => {
    const esc = (v: string | number) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [HEADERS.map(esc).join(',')]
    for (const r of filtered) {
      lines.push([
        r.itemCode, r.description, r.profile, r.grade, r.unit,
        r.needed, r.ordered, r.received, r.onHand, r.issued, r.shortage,
      ].map(esc).join(','))
    }
    // BOM UTF-8 để Excel đọc đúng tiếng Việt
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const code = data?.project?.projectCode || String(params.id)
    a.download = `MCL_${code}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5_000)
  }, [filtered, data, params.id])

  if (loading) {
    return <div className="space-y-4 animate-fade-in">{[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>
  }
  if (error || !data) {
    return <div className="card p-6 text-center" style={{ color: SEMANTIC_COLORS.danger.solid }}>{error || 'Lỗi'}</div>
  }

  const { project, summary } = data

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`Kiểm soát vật tư (MCL) — ${project?.projectCode || ''}`}
        subtitle={project?.projectName}
        actions={
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
            style={{ background: SEMANTIC_COLORS.info.solid }}
          >
            <Download size={16} /> Xuất CSV
          </button>
        }
      />

      {/* ── Tóm tắt ── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryTile label="Tổng dòng vật tư" value={formatNumber(summary.totalRows)} />
          <SummaryTile label="Dòng còn thiếu" value={formatNumber(summary.shortageRows)} color={summary.shortageRows > 0 ? SEMANTIC_COLORS.danger.solid : undefined} />
          <SummaryTile label="Tổng đã về (GRN)" value={formatNumber(summary.totalReceived)} />
          <SummaryTile label="Tổng còn thiếu" value={formatNumber(summary.totalShortage)} color={summary.totalShortage > 0 ? SEMANTIC_COLORS.warning.solid : undefined} />
        </div>
      )}

      {/* ── Tìm kiếm ── */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Tìm theo mã / mô tả / quy cách / mác…"
          className="input flex-1 max-w-md"
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} / {rows.length} dòng
        </span>
      </div>

      {/* ── Bảng ── */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="Chưa có dữ liệu vật tư"
          description="Dự án này chưa có PR/BOM/PO/tồn kho/cấp phát để tổng hợp."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="Không tìm thấy kết quả"
          description="Thử đổi từ khóa tìm kiếm."
        />
      ) : (
        <div className="card overflow-x-auto" style={{ padding: 0 }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                <Th>Mã VT</Th>
                <Th>Mô tả</Th>
                <Th>Quy cách</Th>
                <Th>Mác</Th>
                <Th>ĐVT</Th>
                <Th right>Cần</Th>
                <Th right>Đã đặt</Th>
                <Th right>Đã về</Th>
                <Th right>Tồn</Th>
                <Th right>Đã cấp</Th>
                <Th right>Còn thiếu</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const short = r.shortage > 0
                return (
                  <tr
                    key={r.key}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      background: short ? 'rgba(220, 38, 38, 0.06)' : undefined,
                    }}
                  >
                    <Td mono>{r.itemCode || '—'}</Td>
                    <Td>{r.description || '—'}</Td>
                    <Td>{r.profile || '—'}</Td>
                    <Td>{r.grade || '—'}</Td>
                    <Td>{r.unit || '—'}</Td>
                    <Td right>{num(r.needed)}</Td>
                    <Td right>{num(r.ordered)}</Td>
                    <Td right>{num(r.received)}</Td>
                    <Td right>{num(r.onHand)}</Td>
                    <Td right>{num(r.issued)}</Td>
                    <Td right>
                      <span style={{ fontWeight: 700, color: short ? SEMANTIC_COLORS.danger.solid : 'var(--text-muted)' }}>
                        {num(r.shortage)}
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Còn thiếu = Cần − Tồn − (Đã đặt − Đã về). Cần lấy từ PR (ưu tiên) hoặc BOM ACTIVE. Tồn = kho dùng chung + kho của dự án.
      </p>
    </div>
  )
}

function SummaryTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: right ? 'right' : 'left',
        fontWeight: 600,
        fontSize: 12,
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td
      style={{
        padding: '8px 12px',
        textAlign: right ? 'right' : 'left',
        color: 'var(--text-primary)',
        fontFamily: mono ? 'var(--font-mono, monospace)' : undefined,
        whiteSpace: right ? 'nowrap' : undefined,
      }}
    >
      {children}
    </td>
  )
}
