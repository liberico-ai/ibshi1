'use client'

import { useEffect, useState } from 'react'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { confirmDialog } from '@/components/ui/Toast'

interface Step { id: string; code: string; title: string; roleCode: string | null; deptCode: string | null; deadlineDays: number | null; hookKeys: string[] }
interface Tpl { id: string; code: string; name: string; projectType: string; productType: string | null; version: number; _count: { steps: number } }
interface Proj { id: string; projectCode: string; projectName: string }

interface FieldDiff { field: string; from: unknown; to: unknown }
interface StepDiff { id: string; code: string; title: string; diffs: FieldDiff[]; graphDiffs: FieldDiff[] }
interface SyncReport {
  total: number; pending: StepDiff[]; graphPending: StepDiff[]
  retired: { code: string; title: string }[]; missing: string[]
  invalidDept: { code: string; deptCode: string }[]
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Tên bước', roleCode: 'Role giao việc', deptCode: 'Phòng (nhãn)',
  deadlineDays: 'Hạn (ngày)', nextCodes: 'Bước kế', gateCodes: 'Điều kiện gate',
}
const showVal = (v: unknown) => v === null || v === undefined ? '—' : Array.isArray(v) ? `[${v.join(', ')}]` : String(v)

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [projects, setProjects] = useState<Proj[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [sel, setSel] = useState<Tpl | null>(null)
  const [applyProj, setApplyProj] = useState('')
  const [msg, setMsg] = useState('')
  const [report, setReport] = useState<SyncReport | null>(null)
  const [linked, setLinked] = useState<{ linkedTasks: number; openTasks: number } | null>(null)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const roleCode = useAuthStore((s) => s.user?.roleCode) || ''
  const canSync = ['R01', 'R10'].includes(roleCode)

  useEffect(() => {
    apiFetch('/api/work/templates').then((r) => { if (r.ok) setTemplates(r.templates) })
    apiFetch('/api/projects?limit=100').then((r) => { if (r.ok) setProjects(r.projects || []) })
  }, [])

  const loadReport = async () => {
    setSyncMsg('')
    const r = await apiFetch('/api/admin/template-steps/sync')
    if (r.ok) { setReport(r.report); setLinked({ linkedTasks: r.linkedTasks, openTasks: r.openTasks }) }
    else setSyncMsg(r.error || 'Không đọc được đối chiếu')
  }

  const runSync = async () => {
    if (!report?.pending.length) return
    const ok = await confirmDialog(
      `Đồng bộ ${report.pending.length} bước theo code?\n\n` +
      `• Chỉ sửa tên bước / role / nhãn phòng / hạn — KHÔNG đổi cấu trúc chuỗi (bước kế, gate).\n` +
      `• Task đang mở giữ nguyên người nhận; role mới chỉ áp cho task sinh sau này.\n` +
      `• Giá trị cũ được ghi vào Nhật ký hệ thống để hoàn nguyên nếu cần.`,
    )
    if (!ok) return
    setSyncing(true)
    const r = await apiFetch('/api/admin/template-steps/sync', { method: 'POST', body: JSON.stringify({}) })
    setSyncing(false)
    setSyncMsg(r.ok ? `✓ ${r.message}` : (r.error || 'Lỗi đồng bộ'))
    if (r.ok) {
      setReport(r.report)
      if (sel) apiFetch(`/api/work/templates/${sel.id}`).then((x) => { if (x.ok) setSteps(x.template.steps) })
    }
  }

  const open = (t: Tpl) => { setSel(t); setSteps([]); apiFetch(`/api/work/templates/${t.id}`).then((r) => { if (r.ok) setSteps(r.template.steps) }) }
  const apply = async () => {
    if (!sel || !applyProj) return
    setMsg('')
    const res = await apiFetch('/api/work/templates/apply', { method: 'POST', body: JSON.stringify({ projectId: applyProj, templateCode: sel.code }) })
    setMsg(res.ok ? `✓ ${res.message}` : res.error)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Quy trình & Template</h1>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Template theo loại dự án. Áp vào dự án để tự sinh các công việc chuẩn (động).</p>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        {templates.map((t) => (
          <div key={t.id} onClick={() => open(t)} className="rounded-xl p-4 cursor-pointer hover:shadow-md"
            style={{ background: 'var(--surface)', border: `1px solid ${sel?.id === t.id ? 'var(--text-heading)' : 'var(--border)'}` }}>
            <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{t.name}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t.code} · {t.projectType}{t.productType ? ` · ${t.productType}` : ' · Chung'} · v{t.version} · {t._count.steps} bước</div>
          </div>
        ))}
        {templates.length === 0 && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chưa có template. Chạy seed-dynamic-workflow.</div>}
      </div>

      {/* Đối chiếu template trong DB với WORKFLOW_RULES trong code.
          Task quy trình lấy tên bước + role TỪ DB, nên DB lệch code = task sinh ra sai tên/sai người nhận. */}
      {canSync && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div>
              <h3 className="font-semibold" style={{ color: 'var(--text-heading)' }}>Đối chiếu với quy trình trong code</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Task sinh ra lấy tên bước và người nhận từ bảng này. Nếu lệch so với code, task sẽ mang tên cũ hoặc giao nhầm phòng.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={loadReport} className="text-sm px-4 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                Kiểm tra lệch
              </button>
              {!!report?.pending.length && (
                <button onClick={runSync} disabled={syncing} className="btn-primary text-sm px-4 py-1.5 rounded-lg" style={{ opacity: syncing ? 0.5 : 1 }}>
                  {syncing ? 'Đang đồng bộ…' : `Đồng bộ ${report.pending.length} bước`}
                </button>
              )}
            </div>
          </div>

          {syncMsg && <div className="text-sm mt-3" style={{ color: syncMsg.startsWith('✓') ? '#059669' : 'var(--danger)' }}>{syncMsg}</div>}

          {report && (
            <div className="mt-4 space-y-3">
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {report.total} bước trong DB
                {linked && ` · ${linked.linkedTasks} task đang gắn (${linked.openTasks} chưa xong)`}
                {' · '}
                {report.pending.length === 0
                  ? 'khớp code'
                  : `${report.pending.length} bước lệch`}
              </div>

              {report.pending.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                      {['Mã', 'Trường', 'Trong DB', 'Theo code'].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {report.pending.flatMap((s) => s.diffs.map((d, i) => (
                        <tr key={`${s.id}-${d.field}`} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--ibs-red)' }}>{i === 0 ? s.code : ''}</td>
                          <td className="px-3 py-2 text-xs">{FIELD_LABEL[d.field] || d.field}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{showVal(d.from)}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>{showVal(d.to)}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.graphPending.length > 0 && (
                <div className="text-xs rounded-lg p-3" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                  {report.graphPending.length} bước lệch <b>cấu trúc chuỗi</b> (bước kế / điều kiện gate):{' '}
                  {report.graphPending.map((s) => s.code).join(', ')}. Nút đồng bộ <b>không đụng tới</b> phần này — sửa cấu trúc chuỗi cần rà riêng.
                </div>
              )}

              {report.missing.length > 0 && (
                <div className="text-xs rounded-lg p-3" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                  Bước có trong code nhưng <b>thiếu trong DB</b> (chuỗi sẽ không tự sinh): {report.missing.join(', ')}
                </div>
              )}

              {report.retired.length > 0 && (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Bước đã bỏ khỏi quy trình nhưng còn trong DB (không đụng tới): {report.retired.map((r) => r.code).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {sel && (
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-2 items-center justify-between mb-3">
            <h3 className="font-semibold" style={{ color: 'var(--text-heading)' }}>{sel.name} — {steps.length} bước</h3>
            <div className="flex gap-2 items-center">
              <select value={applyProj} onChange={(e) => setApplyProj(e.target.value)} className="text-sm px-2 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', background: '#f8fafc' }}>
                <option value="">— Chọn dự án —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode}</option>)}
              </select>
              <button onClick={apply} disabled={!applyProj} className="btn-primary text-sm px-4 py-1.5 rounded-lg">Áp vào dự án</button>
            </div>
          </div>
          {msg && <div className="text-sm mb-3" style={{ color: msg.startsWith('✓') ? '#059669' : 'var(--danger)' }}>{msg}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--surface-hover,#f1f5f9)' }}>
                {['#', 'Mã', 'Tên bước', 'Phòng/Role', 'Deadline', 'Hook tự động'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--ibs-red)' }}>{s.code}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{s.title}</td>
                    <td className="px-3 py-2 text-xs">{s.deptCode || s.roleCode || '—'}</td>
                    <td className="px-3 py-2 text-xs">{s.deadlineDays ? `${s.deadlineDays} ngày` : '—'}</td>
                    <td className="px-3 py-2 text-xs">{s.hookKeys?.length ? s.hookKeys.join(', ') : '—'}</td>
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
