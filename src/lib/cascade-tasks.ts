import { diffBomVersions, computeImpact } from './bom-diff-engine'
import type { DiffLine, ImpactLine, BomCategory, BomLayer } from './bom-diff-engine'
import { createTask } from './work-engine'
import type { CreateTaskInput } from './schemas/work.schema'

// ── Role mapping per §6 ──

type CascadeGroup =
  | 'DESIGN'       // R04 — vật tư chính đổi
  | 'NORM_REVIEW'  // R02 — hàn/sơn/tiêu hao (định mức)
  | 'WAREHOUSE'    // R05 — phụ/đóng kiện (tồn kho)
  | 'PROCUREMENT'  // R07 — PR/PO changes
  | 'COST'         // R03 — tính lại chi phí
  | 'WBS'          // R02 — piece-mark đổi → WBS

const GROUP_ROLE: Record<CascadeGroup, string> = {
  DESIGN: 'R04',
  NORM_REVIEW: 'R02',
  WAREHOUSE: 'R05',
  PROCUREMENT: 'R07',
  COST: 'R03',
  WBS: 'R02',
}

const GROUP_LABEL: Record<CascadeGroup, string> = {
  DESIGN: 'Kỹ thuật cập nhật BOM chính',
  NORM_REVIEW: 'Duyệt định mức hàn/sơn/tiêu hao',
  WAREHOUSE: 'Kho rà phụ kiện/đóng kiện',
  PROCUREMENT: 'Thương mại xử lý PR/PO',
  COST: 'KTKH tính lại chi phí',
  WBS: 'PM phân giao lại WBS/piece-mark',
}

const PROC_STATUS_LABEL: Record<string, string> = {
  NOT_PURCHASED: 'Chưa mua',
  IN_PR: 'Đã tạo PR',
  IN_PO: 'Đã đặt PO',
  IN_STOCK: 'Đã nhập kho',
  ISSUED: 'Đã cấp phát',
  FABRICATED: 'Đã chế tạo',
}

const ACTION_LABEL: Record<string, string> = {
  UPDATE_PR: 'Cập nhật PR hiện tại',
  ADD_PR: 'Tạo PR bổ sung',
  REDUCE_PR: 'Giảm SL trên PR',
  CANCEL_PR: 'Huỷ dòng khỏi PR',
  ALERT_PO: 'Đã PO → KHÔNG đổi PO, cảnh báo TM đàm phán',
  RETURN_STOCK: 'Dư tồn kho → trả/điều chuyển',
  USE_STOCK: 'Dùng tồn kho có sẵn',
  NCR: 'Cần NCR đánh giá',
  NONE: 'Không cần hành động',
}

// ── Grouping logic ──

function layerFromCategory(cat: BomCategory): BomLayer {
  const map: Record<BomCategory, BomLayer> = {
    MAIN: 'HARD', WELD: 'NORM', PAINT: 'NORM', AUX: 'STOCK', CONSUMABLE: 'STOCK',
  }
  return map[cat] || 'HARD'
}

function classifyLine(impact: ImpactLine): CascadeGroup[] {
  const groups: CascadeGroup[] = []
  const layer = layerFromCategory(impact.diffLine.category)

  if (layer === 'HARD') groups.push('DESIGN')
  if (layer === 'NORM') groups.push('NORM_REVIEW')
  if (layer === 'STOCK') groups.push('WAREHOUSE')

  if (impact.suggestedActionCode !== 'NONE') {
    groups.push('PROCUREMENT')
  }

  if (impact.diffLine.pieceMark && impact.diffLine.action !== 'REMOVED') {
    groups.push('WBS')
  }

  groups.push('COST')

  return [...new Set(groups)]
}

// ── Format helpers ──

function formatDiffLine(d: DiffLine): string {
  const action = d.action === 'ADDED' ? '➕ Thêm'
    : d.action === 'REMOVED' ? '➖ Xoá'
    : d.action === 'QTY_CHANGED' ? '🔄 Đổi SL'
    : '🔄 Đổi quy cách'
  const mark = d.pieceMark ? ` [${d.pieceMark}]` : ''
  const delta = d.qtyDelta > 0 ? `+${d.qtyDelta}` : `${d.qtyDelta}`
  return `${action}: ${d.materialCode} — ${d.materialName}${mark} (${d.qtyOld}→${d.qtyNew}, Δ${delta} ${d.unit})`
}

function formatImpactContext(impact: ImpactLine): string {
  const proc = PROC_STATUS_LABEL[impact.procurementStatus] || impact.procurementStatus
  const act = ACTION_LABEL[impact.suggestedActionCode] || impact.suggestedAction
  return `  Trạng thái mua: ${proc} | Hành động: ${act}`
}

// ── Main cascade function ──

export interface CascadeResult {
  taskIds: string[]
  groups: { group: CascadeGroup; role: string; taskId: string; lineCount: number }[]
  skippedNoChanges: boolean
}

export async function runCascade(
  oldVersionId: string,
  newVersionId: string,
  projectId: string,
  ecoCode: string,
  userId: string,
): Promise<CascadeResult> {
  const diff = await diffBomVersions(oldVersionId, newVersionId)

  if (diff.lines.length === 0) {
    return { taskIds: [], groups: [], skippedNoChanges: true }
  }

  const impact = await computeImpact(newVersionId)

  const grouped = new Map<CascadeGroup, ImpactLine[]>()
  for (const line of impact.lines) {
    const targets = classifyLine(line)
    for (const g of targets) {
      if (!grouped.has(g)) grouped.set(g, [])
      grouped.get(g)!.push(line)
    }
  }

  const results: CascadeResult['groups'] = []
  const taskIds: string[] = []

  for (const [group, lines] of grouped) {
    const role = GROUP_ROLE[group]
    const label = GROUP_LABEL[group]

    const itemDetails = lines.map(l =>
      `${formatDiffLine(l.diffLine)}\n${formatImpactContext(l)}`
    ).join('\n\n')

    const description = [
      `📋 Cascade từ ECO ${ecoCode}`,
      `Nhóm: ${label}`,
      `Số dòng thay đổi: ${lines.length}`,
      '',
      '─── Chi tiết vật tư thay đổi ───',
      itemDetails,
      '',
      `⚠️ Task này do hệ thống tự sinh khi BOM version được kích hoạt.`,
      `Chỉ xử lý điều chỉnh theo hướng dẫn — KHÔNG sửa PR/PO cũ trực tiếp.`,
    ].join('\n')

    const taskInput: CreateTaskInput = {
      title: `[Cascade] ${label} — ${ecoCode}`,
      description,
      projectId,
      taskType: 'CASCADE',
      priority: 'HIGH',
      assignees: [{ role }],
    }

    try {
      const task = await createTask(taskInput, userId)
      taskIds.push(task.id)
      results.push({ group, role, taskId: task.id, lineCount: lines.length })
    } catch (err) {
      console.error(`[cascade] Failed to create task for group=${group} role=${role}:`, err)
    }
  }

  return { taskIds, groups: results, skippedNoChanges: false }
}
