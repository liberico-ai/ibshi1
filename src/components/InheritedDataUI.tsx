'use client'

import MomSectionsUI from '@/components/MomSectionsUI'
import { formatCurrency, formatNumber } from '@/lib/utils'

interface Props {
  resultData: Record<string, unknown>
  project?: { projectCode?: string; projectName?: string; clientName?: string; contractValue?: number | string; productType?: string } | null
}

export default function InheritedDataUI({ resultData, project }: Props) {
  if (!resultData || Object.keys(resultData).length === 0) return null

  const hasEstimate = !!(resultData.totalEstimate || resultData.dt02Detail)
  const hasMom = !!(resultData.momSections || resultData.momAttendants)
  const hasBomPr = !!resultData.bomPr

  if (!hasEstimate && !hasMom && !hasBomPr) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Estimate (DT02) readonly */}
      {hasEstimate && <EstimateReadonly data={resultData} project={project} />}

      {/* MOM readonly */}
      {hasMom && (
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #7c3aed' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', color: '#7c3aed' }}>Biên bản họp (từ bước trước)</h3>
          <MomSectionsUI
            isEditable={false}
            attendantsData={resultData.momAttendants}
            sectionsData={resultData.momSections}
            onAttendantsChange={() => {}}
            onSectionsChange={() => {}}
          />
        </div>
      )}

      {/* PR data indicator */}
      {hasBomPr && !hasEstimate && (
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #2563eb' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: '#2563eb' }}>Dữ liệu đề xuất vật tư (PR) từ bước trước</h3>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Đã có dữ liệu PR kế thừa. Xem chi tiết tại tab PR bên dưới.</div>
        </div>
      )}
    </div>
  )
}

function EstimateReadonly({ data, project }: { data: Record<string, unknown>; project?: Props['project'] }) {
  const totalMat = Number(data.totalMaterial) || 0
  const totalLab = Number(data.totalLabor) || 0
  const totalSvc = Number(data.totalService) || 0
  const totalOvh = Number(data.totalOverhead) || 0
  const totalEst = Number(data.totalEstimate) || 0
  const contractVal = Number(project?.contractValue) || 0
  const profit = contractVal - totalEst
  const fmtVND = (v: number) => v > 0 ? formatCurrency(v) : '—'
  const pctEst = (v: number) => totalEst > 0 ? ((v / totalEst) * 100).toFixed(1) + '%' : '—'

  let dt02Rows: { maCP: string; noiDung: string; giaTri: number }[] = []
  try {
    const parsed = data.dt02Detail ? JSON.parse(String(data.dt02Detail)) : null
    if (Array.isArray(parsed)) dt02Rows = parsed
  } catch { /* ignore */ }

  return (
    <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid #f59e0b' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#b45309' }}>Dữ liệu dự toán thi công (từ bước trước)</h3>

      {project && (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', padding: '0.75rem', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '0.85rem' }}>
            {project.projectCode && <div><span style={{ color: 'var(--text-muted)' }}>Mã DA:</span> <strong>{project.projectCode}</strong></div>}
            {project.clientName && <div><span style={{ color: 'var(--text-muted)' }}>Khách hàng:</span> <strong>{project.clientName}</strong></div>}
            {project.projectName && <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--text-muted)' }}>Tên DA:</span> <strong>{project.projectName}</strong></div>}
            {contractVal > 0 && <div><span style={{ color: 'var(--text-muted)' }}>Giá trị HĐ:</span> <strong style={{ color: '#059669' }}>{formatCurrency(contractVal)}</strong></div>}
          </div>
        </div>
      )}

      {totalEst > 0 ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: '0.85rem' }}>
          {[
            { label: 'I. Chi phí vật tư', value: totalMat, color: '#E1251B' },
            { label: 'II. Chi phí nhân công', value: totalLab, color: '#f59e0b' },
            { label: 'III. Chi phí dịch vụ', value: totalSvc, color: '#3b82f6' },
            { label: 'IV. Chi phí chung', value: totalOvh, color: '#8b5cf6' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>{item.label}</span>
              <span style={{ textAlign: 'right', fontWeight: 600, color: item.color }}>{fmtVND(item.value)}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{pctEst(item.value)}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '10px 12px', background: 'var(--bg-secondary)', fontWeight: 700, fontSize: '0.95rem' }}>
            <span>TỔNG CHI PHÍ</span>
            <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{fmtVND(totalEst)}</span>
            <span style={{ textAlign: 'right' }}>100%</span>
          </div>
          {contractVal > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderTop: '2px solid var(--border)' }}>
              <span style={{ fontWeight: 600 }}>Lợi nhuận dự kiến</span>
              <span style={{ textAlign: 'right', fontWeight: 700, color: profit >= 0 ? '#059669' : '#dc2626' }}>{fmtVND(Math.abs(profit))}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{((profit / contractVal) * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chưa có dữ liệu tổng hợp chi phí</div>
      )}

      {dt02Rows.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Chi tiết DT02 ({dt02Rows.length} dòng)
          </summary>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: 6, fontSize: '0.8rem' }}>
            {dt02Rows.map((row, i) => {
              const isHeader = ['I', 'II', 'III', 'IV'].includes(row.maCP)
              return (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '60px 1fr 120px',
                  padding: '4px 10px', borderBottom: '1px solid var(--border)',
                  background: isHeader ? 'var(--bg-secondary)' : 'transparent',
                  fontWeight: isHeader ? 700 : 400,
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>{row.maCP}</span>
                  <span>{row.noiDung}</span>
                  <span style={{ textAlign: 'right' }}>{row.giaTri > 0 ? formatNumber(row.giaTri) : ''}</span>
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}
